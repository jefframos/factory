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
 * it out while still tracking real distance changes (the player actually walking closer/farther)
 * within a few frames.
 */
const SCALE_SMOOTHING_SPEED = 10;

/** Same easing as SCALE_SMOOTHING_SPEED, applied to the projected screen position — smooths out the same per-frame noise (camera/player position isn't perfectly stable, worldToScreen's projection amplifies tiny 3D jitter into visible 2D pixel movement) instead of snapping content.position straight to the raw projection every frame. */
const POSITION_SMOOTHING_SPEED = 15;

/** How fast `content` fades IN once it starts being shown again (see smoothedAlpha's own doc) — deliberately only eased on the way in; hideContent() still snaps `visible` straight to false, since a pop on the way OUT is far less noticeable (and far cheaper) than one on the way in. */
const ALPHA_FADE_IN_SPEED = 10;

/** Same exponential-decay easing as POSITION_SMOOTHING_SPEED, applied to how much `avoidViewer` currently pushes content aside — without its own easing this would snap sideways the instant the viewer crosses into `radius` (and snap back the instant they leave), which reads as a jump-cut; smoothing it makes the dodge itself feel like a deliberate little slide. */
const AVOID_SMOOTHING_SPEED = 8;
/** Length/thickness (px, in overlay-local space) of the placeholder pointer sprite avoidViewer shows while displaced — see PIXI.Texture.WHITE's own doc in awake() for why this is a plain tinted rectangle rather than a real arrow asset. */
const POINTER_LENGTH = 16;
const POINTER_THICKNESS = 3;

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
    private readonly scratchLocalPoint = new PIXI.Point();
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
            this.pointer = new PIXI.Sprite(PIXI.Texture.WHITE);
            this.pointer.anchor.set(0, 0.5);
            this.pointer.width = POINTER_LENGTH;
            this.pointer.height = POINTER_THICKNESS;
            this.pointer.visible = false;
            this.host.overlayContainer.addChild(this.pointer);
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

        // avoidViewer: push the TRUE anchor point (scratchLocalPoint) sideways, away from the
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

                const dx = this.scratchLocalPoint.x - this.scratchViewerLocalPoint.x;
                const dy = this.scratchLocalPoint.y - this.scratchViewerLocalPoint.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const { radius } = avoidRegion;
                if (dist < radius) {
                    // Directly on top of the viewer (dist ~ 0) has no real direction to push
                    // along — default to straight up, which reads naturally for a popup that's
                    // meant to sit near the viewer's feet anyway.
                    const nx = dist > 0.001 ? dx / dist : 0;
                    const ny = dist > 0.001 ? dy / dist : -1;
                    const push = radius - dist;
                    avoidPushX = nx * push;
                    avoidPushY = ny * push;
                }
            }
        }

        const avoidT = 1 - Math.exp(-AVOID_SMOOTHING_SPEED * delta);
        this.smoothedAvoidPushX += (avoidPushX - this.smoothedAvoidPushX) * avoidT;
        this.smoothedAvoidPushY += (avoidPushY - this.smoothedAvoidPushY) * avoidT;
        const avoidedX = this.scratchLocalPoint.x + this.smoothedAvoidPushX;
        const avoidedY = this.scratchLocalPoint.y + this.smoothedAvoidPushY;

        if (this.pointer) {
            // Only worth pointing back at the true anchor once the dodge is actually visible —
            // a fraction-of-a-pixel push (easing settling back to 0 after the viewer moves away
            // again) shouldn't leave a barely-visible sliver of a pointer hanging around.
            const showPointer = Math.hypot(this.smoothedAvoidPushX, this.smoothedAvoidPushY) > 1;
            this.pointer.visible = showPointer;
            if (showPointer) {
                this.pointer.position.set(avoidedX, avoidedY);
                this.pointer.rotation = Math.atan2(this.scratchLocalPoint.y - avoidedY, this.scratchLocalPoint.x - avoidedX);
                this.pointer.alpha = this.content.alpha;
            }
        }

        const positionT = 1 - Math.exp(-POSITION_SMOOTHING_SPEED * delta);
        this.smoothedX = this.smoothedX === undefined ? avoidedX : this.smoothedX + (avoidedX - this.smoothedX) * positionT;
        this.smoothedY = this.smoothedY === undefined ? avoidedY : this.smoothedY + (avoidedY - this.smoothedY) * positionT;
        this.content.position.set(this.smoothedX, this.smoothedY);

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
        if (this.pointer) {
            this.pointer.visible = false;
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
        this.content.destroy({ children: true });
        this.pointer?.destroy();
    }
}
