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
}

export interface ScreenAnchorOptions {
    /** Auto-despawns the OWNING ENTITY this many seconds after awake() — see this file's own doc's "THROWAWAY" shape. Only pass this for an entity obtained via world.spawn() specifically for this popup; omit it entirely for a persistent label. */
    ttlSec?: number;
}

export default class ScreenAnchorComponent extends Component {
    private readonly host: ScreenAnchorHost;
    private readonly content: PIXI.Container;
    private readonly getTargetPosition: () => THREE.Vector3;
    /** undefined means persistent — see ScreenAnchorOptions.ttlSec. */
    private remainingSec?: number;

    /** Scratch — avoids allocating a new PIXI.Point/Vector3 every frame. */
    private readonly scratchPoint = new PIXI.Point();
    private readonly scratchPosition = new THREE.Vector3();

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

        this.scratchPosition.copy(this.getTargetPosition());
        const bent = BendService.applyToPosition(this.scratchPosition);
        const screen = this.host.worldToScreen(bent);

        if (!screen || !this.isOnScreen(screen)) {
            this.content.visible = false;
            return;
        }

        this.content.visible = true;
        this.scratchPoint.set(screen.x, screen.y);
        this.host.overlayContainer.toLocal(this.scratchPoint, this.host.overlayContainer.parent ?? undefined, this.content.position);
    }

    /** worldToScreen() only rules out "behind the camera" (see its own doc) — a point far off to either side still projects to a valid-looking, just out-of-viewport, {x,y}. This is the "(and hide if is not on the screen)" half of the contract. */
    private isOnScreen(screen: { x: number; y: number }): boolean {
        return screen.x >= 0 && screen.x <= window.innerWidth && screen.y >= 0 && screen.y <= window.innerHeight;
    }

    public destroy(): void {
        this.content.destroy({ children: true });
    }
}
