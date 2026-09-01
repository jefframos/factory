// ScreenAnchorComponent.ts
//
// Centralized "track a 3D point with a 2D Pixi overlay" component — the ECS
// version of the EntityIndicator/EntityIndicatorManager pattern used
// elsewhere in this repo (games/tower, games/clog), generalized: instead of
// one manager owning a pool of a SPECIFIC indicator type (name + boost
// bar), this is a plain Component any entity can carry, pointed at ANY
// world position, wrapping ANY Pixi content the caller builds. Add it to
// an entity, give it a target and some content, and it handles positioning
// + hiding — nothing else.
//
//   entity.addComponent(new ScreenAnchorComponent(host, content, () => targetPosition))
//
// Two shapes, same component — the only difference is whether you pass
// `ttlSec`:
//   - PERSISTENT (a label that should live as long as its entity does — see
//     DropZone's "Drop Zone" nameplate): omit `ttlSec`, add it to that
//     entity's own awake().
//   - THROWAWAY (a popup that should clean itself up — see ResourceNode's
//     damage numbers): pass `ttlSec`, add it to a `world.spawn()`'d entity.
//     This component despawns that entity for you once the TTL elapses —
//     the caller never has to track a lifetime/remaining-seconds array by
//     hand (see DropZone.ts's git history for the manual version of this).
//
// Every frame: run the target through BendService.applyToPosition() (see
// that method's own doc — the world curves away from the player under
// BendService.applyBend(), and ThreeScene.worldToScreen() has no idea that
// happened, so skipping this would make anchored UI visibly drift off its
// target as the bend increases with distance), project THROUGH
// `host.worldToScreen()`, hide `content` if that's null (behind the camera)
// OR the projected point falls outside the actual viewport (worldToScreen
// only checks "behind camera," not "within the visible screen rectangle" —
// see its own doc), otherwise show it (fading alpha in from 0 rather than
// popping straight to full opacity — see ALPHA_FADE_IN_SPEED; disappearing
// itself stays an instant snap, only the way back in eases) and reposition
// it into `host.overlayContainer`'s local space. Ordinary Component lifecycle
// otherwise: awake() parents `content` into the overlay once, destroy()
// tears it down — the caller never has to remember to add/remove it from
// the Pixi tree by hand.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import Component from '../ecs/Component';
import { BendService } from '../services/BendService';
import ViewUtils from 'core/utils/ViewUtils';

/** Whatever a ScreenAnchorComponent needs from its host scene — the same structural-interface pattern PlayerMovementController's MovementInputHost already uses, so this doesn't have to import a concrete scene class. Whichever container the host hands in here is treated as the "base in-game UI" tier — PizzaScene wires this to `game.uiLayer` (see core/Game.ts's own doc on its three z-ordered overlay tiers), so every zone nameplate/requirement panel/flying resource icon always draws under a toast notification and under a popup, regardless of add-order. */
export interface ScreenAnchorHost {
    worldToScreen(position: THREE.Vector3): { x: number; y: number } | null;
    readonly overlayContainer: PIXI.Container;
    /** Optional — only consulted when ScreenAnchorOptions.maxDistance and/or distanceScale are set (see their own docs). Omit entirely on a host nothing ever asks to cull/scale by distance. */
    getViewerPosition?(): THREE.Vector3;
    /** Optional — only consulted when ScreenAnchorOptions.avoidViewer is set. Returns the live "keep UI off the player" region (see PlayerUIAvoidanceComponent.ts — anchored at the player's HEAD, not the base point getViewerPosition() above returns), or undefined if that component isn't present (e.g. a headless test player with no UI at all). Omit entirely on a host nothing ever asks to dodge the player. */
    getUIAvoidancePoint?(): { position: THREE.Vector3; radius: number } | undefined;
}

/** Shrinks content from scale 1 (at/below nearDistance) down to minScale (at/beyond farDistance), linearly in between — see ScreenAnchorOptions.distanceScale. */
export interface ScreenAnchorDistanceScale {
    nearDistance: number;
    farDistance: number;
    minScale: number;
}

/**
 * How fast the applied scale eases toward its distance-derived target — same exponential-decay
 * shape PizzaScene's own camera follow uses (`1 - Math.exp(-speed * delta)`). Snapping `content.scale`
 * straight to the raw per-frame value instead visibly shimmers: sprites/text resample on every
 * scale write, and the target itself is never perfectly stable frame-to-frame (physics resting
 * contacts leave the player's position with sub-unit noise even "standing still"), so an
 * unsmoothed scale chases that noise every frame and reads as jitter. Smoothing low-pass-filters
 * it out while still tracking real distance changes (the plapbackpoayer actually walking closer/farther)
 * within a few frames.
 */
const SCALE_SMOOTHING_SPEED = 10;

/** Same easing as SCALE_SMOOTHING_SPEED, applied to the projected screen position — smooths out the same per-frame noise (camera/player position isn't perfectly stable, worldToScreen's projection amplifies tiny 3D jitter into visible 2D pixel movement) instead of snapping content.position straight to the raw projection every frame. */
const POSITION_SMOOTHING_SPEED = 15;

/** How fast `content` fades IN once it starts being shown again (see smoothedAlpha's own doc) — deliberately only eased on the way in; hideContent() still snaps `visible` straight to false, since a pop on the way OUT is far less noticeable (and far cheaper) than one on the way in. */
const ALPHA_FADE_IN_SPEED = 10;

/** Same exponential-decay easing as POSITION_SMOOTHING_SPEED, applied to how much `avoidViewer` currently pushes content aside — without its own easing this would snap sideways the instant the viewer crosses into `radius` (and snap back the instant they leave), which reads as a jump-cut; smoothing it makes the dodge itself feel like a deliberate little slide. */
const AVOID_SMOOTHING_SPEED = 8;
/** Content-local units the pointer's root is nudged away from content's own center, along the same direction as its clamped boundary point — 0 sits it exactly ON the boundary (the previous behavior), positive pushes it OUTSIDE the popup (floating just past the edge), negative pulls it INSIDE (overlapping the frame's own border). Tune this to taste once real pointer art exists — a triangle/arrow asset will usually want a small negative value so its tip visually meets the frame instead of hovering just past it. */
const POINTER_EDGE_PADDING = -20;
/** How far (content-local units) the TRUE target must sit outside content's own rect before the pointer is considered "meaningfully displaced" and fades toward visible — below this it fades toward invisible instead. Deliberately measured from the target-vs-rect geometry itself (see distOutside in update()), not avoidViewer's own push magnitude — those two ease on different schedules and drifting out of sync was exactly what caused the pointer to visibly slide toward content's center right before vanishing (see smoothedPointerAlpha's own doc). */
const POINTER_SHOW_THRESHOLD = 0;
/** How fast the pointer's own alpha eases toward its 0/1 target — same exponential-decay shape as ALPHA_FADE_IN_SPEED, just applied both ways (fading OUT included, unlike content's own alpha) since a pointer popping suddenly invisible reads worse than content doing the same (it's a small, already-attention-grabbing accent, not the main panel). */
const POINTER_ALPHA_SMOOTHING_SPEED = 10;

export interface ScreenAnchorOptions {
    /** Auto-despawns the OWNING ENTITY this many seconds after awake() — see this file's own doc's "THROWAWAY" shape. Only pass this for an entity obtained via world.spawn() specifically for this popup; omit it entirely for a persistent label. */
    ttlSec?: number;
    /** Hides content entirely once the viewer (ScreenAnchorHost.getViewerPosition()) is farther than this from the target position — e.g. a zone nameplate that shouldn't clutter the screen from across the map. Requires the host to implement getViewerPosition(); no-ops otherwise. */
    maxDistance?: number;
    /** Scales content down as the viewer gets farther from the target — see ScreenAnchorDistanceScale. Requires getViewerPosition(); no-ops otherwise. */
    distanceScale?: ScreenAnchorDistanceScale;
    /**
     * Keeps `content` from landing on top of the player's own on-screen position — meant for a
     * popup anchored right at an entity's base (see PopupConfig.ts's 'simple' style/
     * popupBobOffset), which is exactly where the player's own character ends up once they walk
     * into the zone to interact with it. Every frame, reads the LIVE region from
     * `ScreenAnchorHost.getUIAvoidancePoint()` (see PlayerUIAvoidanceComponent.ts — anchored at
     * the player's head, with a designer-tunable radius, not a fixed value baked in here) and,
     * when the projected target would land inside it, slides content sideways (smoothly, see
     * AVOID_SMOOTHING_SPEED) just far enough to clear that radius, fading in a small pointer
     * sprite pointing back at the TRUE (un-avoided) anchor point so it's still clear which
     * entity the popup belongs to once it's no longer sitting right on it. Requires the host to
     * implement getUIAvoidancePoint(); no-ops otherwise (e.g. a headless test player with no UI
     * avoidance component at all).
     */
    avoidViewer?: boolean;
    /**
     * Which point within `content`'s own bounds represents "the popup," in normalized
     * PIXI-anchor units (0,0 = top-left, 0.5,1 = bottom-center, ...) — this is the point that
     * ends up placed exactly at the target position (and, with avoidViewer on, the point every
     * distance/direction calculation above measures FROM). Omitted (the default) means content's
     * own local origin (0,0) already IS that point — true for every existing caller, whose
     * content builds its own text/icons anchored such that local (0,0) sits where they want it
     * (typically bottom-center, e.g. `text.anchor.set(0.5, 1)`) — so this only needs setting when
     * a caller wants a DIFFERENT point of content's rendered bounds to be "the popup," without
     * having to rebuild content's own internal anchoring to match (see PopupConfig.ts's 'simple'
     * style, which sets this to {x: 0.5, y: 0} — top-center — instead of restructuring every
     * zone's own icon/text layout).
     */
    anchor?: { x: number; y: number };
    /**
     * Shows the avoidViewer pointer as soon as content is displaced at ALL, instead of waiting
     * for the displacement to clear POINTER_SHOW_THRESHOLD first — the only thing that still
     * fades it out is the target genuinely sitting inside/on content's own rect (distOutside ~
     * 0, the same degenerate case that already has to fade it — see the pointer block in
     * update()'s own doc), not an extra "is this worth mentioning yet" margin on top of that.
     * Omitted (the default, false) keeps the small buffer so a barely-there dodge doesn't flash
     * the pointer for a couple frames on its way to settling back to nothing.
     */
    pointerAlwaysVisible?: boolean;
}

export default class ScreenAnchorComponent extends Component {
    private readonly host: ScreenAnchorHost;
    private readonly content: PIXI.Container;
    private readonly getTargetPosition: () => THREE.Vector3;
    private readonly options: ScreenAnchorOptions;
    /** undefined means persistent — see ScreenAnchorOptions.ttlSec. */
    private remainingSec?: number;

    /** Scratch — avoids allocating a new PIXI.Point/Vector3 every frame. */
    private readonly scratchPoint = new PIXI.Point();
    /** The TRUE projected target position — see getTargetPosition() — in overlay-local space. Never shifted by ScreenAnchorOptions.anchor (unlike scratchAnchoredPoint below); this is what the avoidViewer pointer points AT, since it needs the real target, not wherever content's own local origin happens to be placed to make that anchor point line up with it. */
    private readonly scratchLocalPoint = new PIXI.Point();
    /** Where content's own LOCAL ORIGIN needs to sit so ScreenAnchorOptions.anchor's chosen point lands on scratchLocalPoint instead — see the anchor block in update(). Identical to scratchLocalPoint whenever no anchor is set. This (not scratchLocalPoint) is what avoidance/positioning below actually place content at. */
    private readonly scratchAnchoredPoint = new PIXI.Point();
    private readonly scratchPosition = new THREE.Vector3();
    /** Scratch for avoidViewer's own player-head-region projection — see the avoidViewer block in update(). */
    private readonly scratchViewerPoint = new PIXI.Point();
    private readonly scratchViewerLocalPoint = new PIXI.Point();
    private readonly scratchViewerPosition = new THREE.Vector3();

    /** A plain tinted-rectangle placeholder "arrow" (see awake()) shown only while avoidViewer is actively pushing content aside — undefined when `options.avoidViewer` was never set at all. */
    private pointer?: PIXI.Sprite;
    /** Eased toward however far avoidViewer currently needs to push content aside (0 when not overlapping) — see AVOID_SMOOTHING_SPEED's own doc. Reset to 0 whenever content is hidden, same "don't carry stale state into the next appearance" reasoning as smoothedX/Y. */
    private smoothedAvoidPushX = 0;
    private smoothedAvoidPushY = 0;
    /** Eased toward 1 while the target sits far enough outside content's own rect to bother showing the pointer, toward 0 once it doesn't (see POINTER_SHOW_THRESHOLD) — a plain lerp toward a binary target, same shape as smoothedAlpha's own fade-in, so the pointer fades smoothly in/out instead of popping visible/invisible right at the threshold. Reset to 0 whenever content is hidden. */
    private smoothedPointerAlpha = 0;

    /** Eased toward the distance-derived target scale each frame — see SCALE_SMOOTHING_SPEED's own doc. `undefined` whenever the next frame should SNAP instead of ease (the first distance-scaled frame, or right after content was hidden — see the two `hideContent()` call sites). */
    private smoothedScale?: number;
    /** Eased toward the projected target position each frame — see POSITION_SMOOTHING_SPEED's own doc. Same `undefined`-means-snap convention as smoothedScale. */
    private smoothedX?: number;
    private smoothedY?: number;
    /** Eased toward 1 every frame content is shown — see ALPHA_FADE_IN_SPEED's own doc. `undefined` (reset by hideContent()) means "start the next appearance from 0," so re-appearing always fades in from invisible instead of popping straight to full opacity. */
    private smoothedAlpha?: number;

    /**
     * `getTargetPosition` is a function, not a fixed Vector3, so the tracked point can
     * keep moving (an entity's own transform.position, a point offset above it, another
     * entity entirely) without this component needing to know why it moves.
     */
    public constructor(
        host: ScreenAnchorHost,
        content: PIXI.Container,
        getTargetPosition: () => THREE.Vector3,
        options: ScreenAnchorOptions = {},
    ) {
        super();
        this.host = host;
        this.content = content;
        this.getTargetPosition = getTargetPosition;
        this.options = options;
        this.remainingSec = options.ttlSec;
    }

    public awake(): void {
        this.content.visible = false;
        this.host.overlayContainer.addChild(this.content);

        if (this.options.avoidViewer) {
            // PIXI.Texture.WHITE (a built-in 1x1 white pixel, not a real asset) stretched into a
            // thin rectangle — a placeholder "arrow" until real pointer art exists, same
            // "primitive until real art exists" convention BoxVisualComponent uses for 3D props.
            // anchor (0, 0.5) pivots at the LEFT-middle edge, so this.pointer.rotation alone
            // (set every frame in update()) is enough to make the rectangle's far end point
            // wherever it needs to — no separate direction vector -> sprite-orientation math.
            //
            // A CHILD of `content` (not a sibling in host.overlayContainer) — positioned every
            // frame in CONTENT-LOCAL coordinates (see update()), it then inherits content's own
            // position/scale automatically through the normal Pixi transform hierarchy, with no
            // separate tracking to keep in sync. An earlier version computed the pointer's
            // position independently in overlay-space, which could visibly detach from the
            // popup whenever the two were computed from even slightly different snapshots of
            // content's own position (e.g. before vs. after that frame's own smoothing pass) —
            // parenting it here makes that entire class of bug structurally impossible.
            this.pointer = PIXI.Sprite.from('pointer');
            this.pointer.anchor.set(0, 0.5);
            this.pointer.scale.set(ViewUtils.elementScaler(this.pointer, 10));
            //this.pointer.width = POINTER_LENGTH;
            //this.pointer.height = POINTER_THICKNESS;
            this.pointer.visible = false;
            this.content.addChild(this.pointer);
        }
    }

    public update(delta: number): void {
        if (this.remainingSec !== undefined) {
            this.remainingSec -= delta;
            if (this.remainingSec <= 0) {
                this.entity.world?.despawn(this.entity);
                return;
            }
        }

        const targetPosition = this.getTargetPosition();

        // Distance is measured in REAL world space (pre-bend) — BendService's curve is a
        // rendering-only visual displacement, not an actual change in how far apart things are.
        const viewerPosition = (this.options.maxDistance !== undefined || this.options.distanceScale)
            ? this.host.getViewerPosition?.()
            : undefined;
        const distance = viewerPosition?.distanceTo(targetPosition);

        if (this.options.maxDistance !== undefined && distance !== undefined && distance > this.options.maxDistance) {
            this.hideContent();
            return;
        }

        this.scratchPosition.copy(targetPosition);
        const bent = BendService.applyToPosition(this.scratchPosition);
        const screen = this.host.worldToScreen(bent);

        if (!screen || !this.isOnScreen(screen)) {
            this.hideContent();
            return;
        }

        this.content.visible = true;

        // Fades in from 0 rather than popping straight to full opacity — see
        // ALPHA_FADE_IN_SPEED/smoothedAlpha's own docs. Undefined only right after
        // hideContent(), so THIS frame (the first one visible again) starts the fade at 0.
        const alphaT = 1 - Math.exp(-ALPHA_FADE_IN_SPEED * delta);
        this.smoothedAlpha = this.smoothedAlpha === undefined ? 0 : this.smoothedAlpha + (1 - this.smoothedAlpha) * alphaT;
        this.content.alpha = this.smoothedAlpha;

        this.scratchPoint.set(screen.x, screen.y);
        // `from` deliberately omitted (not `host.overlayContainer.parent`) — `screen` (from
        // worldToScreen()) is already in GLOBAL/stage space, and toLocal() treats an omitted
        // `from` as exactly that, applying host.overlayContainer's own full worldTransform
        // (whatever scale/offset it inherits from its ancestors, however deeply nested it is —
        // see core/Game.ts's uiLayer/notificationLayer/popupLayer tiers) — using `.parent`
        // instead only happened to work before those tiers existed, when overlayContainer's
        // parent was app.stage (identity transform, so it was a no-op either way).
        this.host.overlayContainer.toLocal(this.scratchPoint, undefined, this.scratchLocalPoint);

        // ScreenAnchorOptions.anchor — re-express the target as "where content's own LOCAL
        // ORIGIN needs to sit" (scratchAnchoredPoint) so the caller's chosen anchor point, not
        // necessarily local origin itself, ends up placed at the TRUE target (scratchLocalPoint,
        // left untouched here on purpose — the avoidViewer pointer below points AT that real
        // target, not at this shifted placement value; conflating the two used to make the
        // pointer aim at the wrong spot whenever an anchor was set). Avoidance/position-smoothing
        // below read scratchAnchoredPoint instead of scratchLocalPoint for exactly this reason.
        // Uses last frame's scale/bounds (both already one-frame-stale elsewhere in this file,
        // e.g. the pointer block) — content resizing/rescaling mid-frame is rare enough that the
        // lag is never visible.
        this.scratchAnchoredPoint.copyFrom(this.scratchLocalPoint);
        if (this.options.anchor) {
            const anchorBounds = this.content.getLocalBounds();
            const anchorScale = this.content.scale.x || 1;
            this.scratchAnchoredPoint.x -= (anchorBounds.x + this.options.anchor.x * anchorBounds.width) * anchorScale;
            this.scratchAnchoredPoint.y -= (anchorBounds.y + this.options.anchor.y * anchorBounds.height) * anchorScale;
        }

        // avoidViewer: push the placement point (scratchAnchoredPoint) sideways, away from the
        // LIVE player-head region (see ScreenAnchorHost.getUIAvoidancePoint()/
        // PlayerUIAvoidanceComponent.ts), whenever they'd otherwise overlap — see
        // ScreenAnchorOptions.avoidViewer's own doc. Computed BEFORE the position-smoothing
        // block below so the dodge itself gets exactly the same easing as ordinary movement,
        // no separate smoothing pass needed for the content's own position.
        let avoidPushX = 0;
        let avoidPushY = 0;
        const avoidRegion = this.options.avoidViewer ? this.host.getUIAvoidancePoint?.() : undefined;
        if (avoidRegion) {
            this.scratchViewerPosition.copy(avoidRegion.position);
            const viewerBent = BendService.applyToPosition(this.scratchViewerPosition);
            const viewerScreen = this.host.worldToScreen(viewerBent);
            if (viewerScreen) {
                this.scratchViewerPoint.set(viewerScreen.x, viewerScreen.y);
                this.host.overlayContainer.toLocal(this.scratchViewerPoint, undefined, this.scratchViewerLocalPoint);

                // dx/dy is content's LOCAL ORIGIN placement (scratchAnchoredPoint — already
                // accounts for ScreenAnchorOptions.anchor, see above) relative to the viewer —
                // corners/center below are all expressed relative to THIS same reference (their
                // own local bounds offset, scaled), never against the viewer directly, so this
                // one projection is all update() needs regardless of how many points get tested
                // against it.
                const dx = this.scratchAnchoredPoint.x - this.scratchViewerLocalPoint.x;
                const dy = this.scratchAnchoredPoint.y - this.scratchViewerLocalPoint.y;
                const { radius } = avoidRegion;
                const bounds = this.content.getLocalBounds();
                const scale = this.content.scale.x || 1;
                const corners: Array<[number, number]> = [
                    [bounds.x, bounds.y],
                    [bounds.x + bounds.width, bounds.y],
                    [bounds.x, bounds.y + bounds.height],
                    [bounds.x + bounds.width, bounds.y + bounds.height],
                ];

                // GATING must be rect-based, not anchor-based — the anchor point alone can sit
                // well outside `radius` (e.g. approaching a bottom-anchored panel from directly
                // above, near its far TOP edge) while the rectangle itself already overlaps the
                // viewer, which used to mean avoidance never even triggered. Clamping the
                // viewer's own position into the rect's bounds finds the true nearest point on
                // the rectangle to the viewer — 0 distance once the viewer is inside it.
                const nearestOffsetX = Math.min(Math.max(-dx / scale, bounds.x), bounds.x + bounds.width);
                const nearestOffsetY = Math.min(Math.max(-dy / scale, bounds.y), bounds.y + bounds.height);
                const nearestQx = dx + nearestOffsetX * scale;
                const nearestQy = dy + nearestOffsetY * scale;
                const nearestDist = Math.hypot(nearestQx, nearestQy);

                if (nearestDist < radius) {
                    // DIRECTION is based on the rectangle's own CENTER relative to the viewer,
                    // not the anchor point — pushing "away from the viewer" only makes sense
                    // measured from somewhere inside the shape actually being moved. Using the
                    // anchor for direction too meant a tall/offset panel could get pushed along a
                    // direction that barely relates to where its own bulk actually sits (e.g.
                    // sliding sideways when it really needed to clear vertically), leaving part
                    // of it still overlapping even though the loop below would faithfully solve
                    // for SOME corner's clearance along that (poorly chosen) direction.
                    const centerOffsetX = bounds.x + bounds.width / 2;
                    const centerOffsetY = bounds.y + bounds.height / 2;
                    const centerQx = dx + centerOffsetX * scale;
                    const centerQy = dy + centerOffsetY * scale;
                    const centerDist = Math.hypot(centerQx, centerQy);
                    // Viewer sitting exactly on the rect's own center (centerDist ~ 0) has no
                    // real direction to push along — default to straight up.
                    const nx = centerDist > 0.001 ? centerQx / centerDist : 0;
                    const ny = centerDist > 0.001 ? centerQy / centerDist : -1;

                    // Pushing just far enough for the CENTER to clear the circle isn't enough —
                    // content is a RECTANGLE. Solve per-corner instead: for each corner of
                    // content's own bounds, find the push distance (along nx/ny) at which THAT
                    // corner sits exactly on the circle (the larger root of
                    // |corner + t*n| = radius, quadratic in t — the smaller root is where the
                    // corner would cross back INTO the circle further out, not the one we
                    // want), then push by the largest of those so every corner clears
                    // simultaneously and the nearest one ends up exactly tangent to the circle
                    // (touching it) rather than stopping some arbitrary margin short.
                    let push = radius - nearestDist;
                    for (const [cornerX, cornerY] of corners) {
                        const qx = dx + cornerX * scale;
                        const qy = dy + cornerY * scale;
                        const nDotQ = qx * nx + qy * ny;
                        const discriminant = nDotQ * nDotQ - (qx * qx + qy * qy - radius * radius);
                        if (discriminant < 0) {
                            // This corner's path along the push direction never comes within
                            // `radius` of the viewer at all — already safe no matter how far we
                            // push, so it imposes no constraint here.
                            continue;
                        }
                        push = Math.max(push, -nDotQ + Math.sqrt(discriminant));
                    }

                    avoidPushX = nx * push;
                    avoidPushY = ny * push;
                }
            }
        }

        const avoidT = 1 - Math.exp(-AVOID_SMOOTHING_SPEED * delta);
        this.smoothedAvoidPushX += (avoidPushX - this.smoothedAvoidPushX) * avoidT;
        this.smoothedAvoidPushY += (avoidPushY - this.smoothedAvoidPushY) * avoidT;
        const avoidedX = this.scratchAnchoredPoint.x + this.smoothedAvoidPushX;
        const avoidedY = this.scratchAnchoredPoint.y + this.smoothedAvoidPushY;

        const positionT = 1 - Math.exp(-POSITION_SMOOTHING_SPEED * delta);
        this.smoothedX = this.smoothedX === undefined ? avoidedX : this.smoothedX + (avoidedX - this.smoothedX) * positionT;
        this.smoothedY = this.smoothedY === undefined ? avoidedY : this.smoothedY + (avoidedY - this.smoothedY) * positionT;
        this.content.position.set(this.smoothedX, this.smoothedY);

        if (this.pointer) {
            // Only worth pointing back at the true target once the dodge is actually visible —
            // a fraction-of-a-pixel push (easing settling back to 0 after the viewer moves away
            // again) shouldn't leave a barely-visible sliver of a pointer hanging around.
            //
            // Hidden BEFORE measuring content's own bounds below — the pointer is now a CHILD
            // of content (see awake()'s own doc), so leaving it visible here would fold its own
            // (last frame's) position/size into content.getLocalBounds(), corrupting the very
            // rectangle it's about to be positioned against — a feedback loop where the pointer
            // could creep away from the popup a little further every frame instead of settling.
            this.pointer.visible = false;

            // Nearest point on content's OWN boundary to the TRUE (un-avoided) target —
            // clamping the target's coordinates into content's local bounds on each axis
            // independently always lands exactly ON that boundary, whichever edge or corner
            // that actually turns out to be for the current push direction, rather than
            // guessing a point via the avoidance CIRCLE's geometry (which doesn't necessarily
            // touch the rectangle at all — see this file's own history for that earlier,
            // detaching attempt). Everything here is in CONTENT-LOCAL space (the coordinate
            // system this.pointer, as a child of content, actually renders in) — the target is
            // converted into it by undoing content's own current position and scale, so the
            // pointer inherits content's real on-screen transform for free through the ordinary
            // Pixi parent/child hierarchy instead of needing to track it separately (see
            // awake()'s own doc for why that used to visibly detach).
            const bounds = this.content.getLocalBounds();
            const scale = this.content.scale.x || 1;
            const targetLocalX = (this.scratchLocalPoint.x - this.content.position.x) / scale;
            const targetLocalY = (this.scratchLocalPoint.y - this.content.position.y) / scale;
            const boundaryX = Math.min(Math.max(targetLocalX, bounds.x), bounds.x + bounds.width);
            const boundaryY = Math.min(Math.max(targetLocalY, bounds.y), bounds.y + bounds.height);

            // How far the TRUE target actually sits OUTSIDE content's own rect right now — 0
            // once it's inside/on it. This is the one quantity the fade must key off, not
            // avoidPush's own (separately-smoothed) magnitude: as a dodge eases back down,
            // content slides back toward the target on its own schedule (POSITION_SMOOTHING_
            // SPEED), which is NOT the same schedule avoidPush itself eases on (AVOID_
            // SMOOTHING_SPEED) — so keying the fade off avoidPush let the two drift out of
            // sync, and for a beat near the end of a dodge the target would already have
            // crept back INSIDE the rect (making the clamp above a no-op — boundaryX/Y just
            // reprint targetLocalX/Y, dragging the "edge" point in toward content's own
            // center) while the pointer was still fading out on its own separate timer,
            // reading as a visible bug (the pointer sliding to the center right before
            // vanishing) rather than a clean fade. Driving the fade off THIS distance instead
            // means it can only ever be fully visible while the position math is actually
            // meaningful (target genuinely outside the rect), and is already most of the way
            // to invisible by the time the target gets close enough to start dragging the
            // point inward.
            const distOutside = Math.hypot(targetLocalX - boundaryX, targetLocalY - boundaryY);

            // Eased toward that 0/1 target rather than snapped — see smoothedPointerAlpha's own
            // doc — so the pointer fades in as it clears the threshold and fades back out as it
            // approaches, instead of popping visible/invisible right at the threshold.
            // pointerAlwaysVisible drops that threshold to effectively 0 — the only thing left
            // that can still fade it out is the target genuinely sitting inside/on content's own
            // rect (distOutside itself hitting 0), not an extra "worth mentioning yet" margin —
            // see that option's own doc.
            const showThreshold = this.options.pointerAlwaysVisible ? 0 : POINTER_SHOW_THRESHOLD;
            const pointerTargetAlpha = distOutside > showThreshold ? 1 : 0;
            const pointerAlphaT = 1 - Math.exp(-POINTER_ALPHA_SMOOTHING_SPEED * delta);
            this.smoothedPointerAlpha += (pointerTargetAlpha - this.smoothedPointerAlpha) * pointerAlphaT;
            this.pointer.alpha = this.smoothedPointerAlpha;

            // Fully faded out (settled at 0, not just momentarily dipped below 1) is the only
            // case worth skipping the position/rotation update for below — anywhere above that,
            // even mid-fade, it should keep tracking the target so the fade-out doesn't freeze
            // it at a stale angle right as it disappears.
            if (this.smoothedPointerAlpha > 0.01) {
                // Clamped point sits EXACTLY on the boundary — POINTER_EDGE_PADDING then nudges
                // it along the same direction from content's own center (0 = stay right on the
                // boundary, positive = outside the popup, negative = inside/overlapping the
                // frame's own border — see that constant's own doc). anchor(0, 0.5) plus a
                // rotation pointing AT the target (on the opposite side of the popup from this
                // edge, since the popup was just pushed away from it) means the sprite's own
                // body extends outward from here regardless of the padding's sign, never back
                // over the popup's own content.
                const centerX = bounds.x + bounds.width / 2;
                const centerY = bounds.y + bounds.height / 2;
                const outLen = Math.hypot(boundaryX - centerX, boundaryY - centerY) || 1;
                const pointerX = boundaryX + ((boundaryX - centerX) / outLen) * POINTER_EDGE_PADDING;
                const pointerY = boundaryY + ((boundaryY - centerY) / outLen) * POINTER_EDGE_PADDING;

                this.pointer.position.set(pointerX, pointerY);
                // Points AT the true target (in the same content-local space) — the entity this
                // popup is actually about, not the viewer being avoided — like a speech bubble's
                // tail pointing at its speaker.
                this.pointer.rotation = Math.atan2(targetLocalY - pointerY, targetLocalX - pointerX);
                this.pointer.visible = true;
            }
        }

        if (this.options.distanceScale && distance !== undefined) {
            const targetScale = this.computeDistanceScale(distance, this.options.distanceScale);
            this.smoothedScale = this.smoothedScale === undefined
                ? targetScale
                : this.smoothedScale + (targetScale - this.smoothedScale) * (1 - Math.exp(-SCALE_SMOOTHING_SPEED * delta));
            this.content.scale.set(this.smoothedScale);
        }
    }

    /** Hides content AND resets the smoothing state (see smoothedX/Y/Scale/Alpha's own docs) — so the next time this becomes visible again, it snaps straight to its new spot (position/scale) instead of visibly easing in from wherever it was last shown (which could be anywhere on screen after e.g. crossing back under maxDistance from a completely different angle), while still FADING in alpha from 0 (see smoothedAlpha's own doc) rather than popping straight to full opacity. Disappearing itself stays an instant snap — only the way back in eases. */
    private hideContent(): void {
        this.content.visible = false;
        this.smoothedX = undefined;
        this.smoothedY = undefined;
        this.smoothedScale = undefined;
        this.smoothedAlpha = undefined;
        this.smoothedAvoidPushX = 0;
        this.smoothedAvoidPushY = 0;
        this.smoothedPointerAlpha = 0;
        if (this.pointer) {
            this.pointer.visible = false;
            this.pointer.alpha = 0;
        }
    }

    /** 1 at/below nearDistance, minScale at/beyond farDistance, linear (and clamped) in between. */
    private computeDistanceScale(distance: number, { nearDistance, farDistance, minScale }: ScreenAnchorDistanceScale): number {
        if (farDistance <= nearDistance) {
            return distance <= nearDistance ? 1 : minScale;
        }

        const t = Math.min(1, Math.max(0, (distance - nearDistance) / (farDistance - nearDistance)));
        return 1 - t * (1 - minScale);
    }

    /** worldToScreen() only rules out "behind the camera" (see its own doc) — a point far off to either side still projects to a valid-looking, just out-of-viewport, {x,y}. This is the "(and hide if is not on the screen)" half of the contract. */
    private isOnScreen(screen: { x: number; y: number }): boolean {
        return screen.x >= 0 && screen.x <= window.innerWidth && screen.y >= 0 && screen.y <= window.innerHeight;
    }

    public destroy(): void {
        // this.pointer (if any) is a CHILD of content (see awake()'s own doc) — destroying
        // content with `children: true` already tears it down too, a separate destroy() call
        // here would double-destroy it.
        this.content.destroy({ children: true });
    }
}
