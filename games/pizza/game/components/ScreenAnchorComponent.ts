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
// Every frame: project the target through `host.worldToScreen()`, hide
// `content` if that's null (behind the camera) OR the projected point
// falls outside the actual viewport (worldToScreen only checks "behind
// camera," not "within the visible screen rectangle" — see its own doc),
// otherwise show it and reposition it into `host.overlayContainer`'s local
// space. Ordinary Component lifecycle otherwise: awake() parents `content`
// into the overlay once, destroy() tears it down — the caller never has to
// remember to add/remove it from the Pixi tree by hand.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import Component from '../ecs/Component';

/** Whatever a ScreenAnchorComponent needs from its host scene — the same structural-interface pattern PlayerMovementController's MovementInputHost already uses, so this doesn't have to import a concrete scene class. */
export interface ScreenAnchorHost {
    worldToScreen(position: THREE.Vector3): { x: number; y: number } | null;
    readonly overlayContainer: PIXI.Container;
}

export default class ScreenAnchorComponent extends Component {
    private readonly host: ScreenAnchorHost;
    private readonly content: PIXI.Container;
    private readonly getTargetPosition: () => THREE.Vector3;

    /** Scratch — avoids allocating a new PIXI.Point every frame. */
    private readonly scratchPoint = new PIXI.Point();

    /**
     * `getTargetPosition` is a function, not a fixed Vector3, so the tracked point can
     * keep moving (an entity's own transform.position, a point offset above it, another
     * entity entirely) without this component needing to know why it moves.
     */
    public constructor(host: ScreenAnchorHost, content: PIXI.Container, getTargetPosition: () => THREE.Vector3) {
        super();
        this.host = host;
        this.content = content;
        this.getTargetPosition = getTargetPosition;
    }

    public awake(): void {
        this.content.visible = false;
        this.host.overlayContainer.addChild(this.content);
    }

    public update(): void {
        const screen = this.host.worldToScreen(this.getTargetPosition());

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
