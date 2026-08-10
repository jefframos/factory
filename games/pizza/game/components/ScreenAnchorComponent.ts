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
// see its own doc), otherwise show it and reposition it into
// `host.overlayContainer`'s local space. Ordinary Component lifecycle
// otherwise: awake() parents `content` into the overlay once, destroy()
// tears it down — the caller never has to remember to add/remove it from
// the Pixi tree by hand.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import Component from '../ecs/Component';
import { BendService } from '../services/BendService';

/** Whatever a ScreenAnchorComponent needs from its host scene — the same structural-interface pattern PlayerMovementController's MovementInputHost already uses, so this doesn't have to import a concrete scene class. */
export interface ScreenAnchorHost {
    worldToScreen(position: THREE.Vector3): { x: number; y: number } | null;
    readonly overlayContainer: PIXI.Container;
    /** Optional — only consulted when ScreenAnchorOptions.maxDistance and/or distanceScale are set (see their own docs). Omit entirely on a host nothing ever asks to cull/scale by distance. */
    getViewerPosition?(): THREE.Vector3;
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

export interface ScreenAnchorOptions {
    /** Auto-despawns the OWNING ENTITY this many seconds after awake() — see this file's own doc's "THROWAWAY" shape. Only pass this for an entity obtained via world.spawn() specifically for this popup; omit it entirely for a persistent label. */
    ttlSec?: number;
    /** Hides content entirely once the viewer (ScreenAnchorHost.getViewerPosition()) is farther than this from the target position — e.g. a zone nameplate that shouldn't clutter the screen from across the map. Requires the host to implement getViewerPosition(); no-ops otherwise. */
    maxDistance?: number;
    /** Scales content down as the viewer gets farther from the target — see ScreenAnchorDistanceScale. Requires getViewerPosition(); no-ops otherwise. */
    distanceScale?: ScreenAnchorDistanceScale;
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

    /** Eased toward the distance-derived target scale each frame — see SCALE_SMOOTHING_SPEED's own doc. `undefined` whenever the next frame should SNAP instead of ease (the first distance-scaled frame, or right after content was hidden — see the two `hideContent()` call sites). */
    private smoothedScale?: number;
    /** Eased toward the projected target position each frame — see POSITION_SMOOTHING_SPEED's own doc. Same `undefined`-means-snap convention as smoothedScale. */
    private smoothedX?: number;
    private smoothedY?: number;

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
        this.scratchPoint.set(screen.x, screen.y);
        this.host.overlayContainer.toLocal(this.scratchPoint, this.host.overlayContainer.parent ?? undefined, this.scratchLocalPoint);

        const positionT = 1 - Math.exp(-POSITION_SMOOTHING_SPEED * delta);
        this.smoothedX = this.smoothedX === undefined ? this.scratchLocalPoint.x : this.smoothedX + (this.scratchLocalPoint.x - this.smoothedX) * positionT;
        this.smoothedY = this.smoothedY === undefined ? this.scratchLocalPoint.y : this.smoothedY + (this.scratchLocalPoint.y - this.smoothedY) * positionT;
        this.content.position.set(this.smoothedX, this.smoothedY);

        if (this.options.distanceScale && distance !== undefined) {
            const targetScale = this.computeDistanceScale(distance, this.options.distanceScale);
            this.smoothedScale = this.smoothedScale === undefined
                ? targetScale
                : this.smoothedScale + (targetScale - this.smoothedScale) * (1 - Math.exp(-SCALE_SMOOTHING_SPEED * delta));
            this.content.scale.set(this.smoothedScale);
        }
    }

    /** Hides content AND resets the smoothing state (see smoothedX/Y/Scale's own docs) — so the next time this becomes visible again, it snaps straight to its new spot instead of visibly easing in from wherever it was last shown (which could be anywhere on screen after e.g. crossing back under maxDistance from a completely different angle). */
    private hideContent(): void {
        this.content.visible = false;
        this.smoothedX = undefined;
        this.smoothedY = undefined;
        this.smoothedScale = undefined;
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
    }
}
