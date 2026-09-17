// ThirdPersonCharacter.ts
//
// Player-driven controller wrapping CharacterBody (the mesh/animation half —
// see that file). Driven externally — call update() once per frame with
// whatever position/move-input the host scene's own player physics already
// computed (see CharacterVisualComponent), rather than owning any physics
// itself.

import * as THREE from 'three';
import CharacterBody from './CharacterBody';
import { WorldBendService } from '../services/BendService';
import { getPlayerMoveSpeed } from '../data/PlayerSettings';

export default class ThirdPersonCharacter {
    public readonly body: CharacterBody;

    public isSliding: boolean = false;
    public isRolling: boolean = false;

    /** `bendService` defaults to CharacterBody's own default (BendService, the hub's plain radial dip) — RunnerMinigameScene/SwipeMinigameScene pass RunnerBendService instead so the player's own materials bend the same interactive way as the track under them. */
    public constructor(bendService?: WorldBendService) {
        this.body = new CharacterBody(bendService);
    }

    public get container(): THREE.Group {
        return this.body.container;
    }

    public get animator() {
        return this.body.animator;
    }

    /** Effective ground speed, world units/second — reads PlayerSettings.ts live, so tuning it (by hand or via the dev-GUI) takes effect immediately. Delegates to the standalone getPlayerMoveSpeed() (see its own doc) rather than duplicating the formula — MainPlayer calls that same function directly for PlayerMovementController/SwipeRunnerController, since both need a real speed value before this character even finishes loading. */
    public getMoveSpeed(sprinting: boolean = false): number {
        return getPlayerMoveSpeed(sprinting);
    }

    public async loadMesh(url: string): Promise<void> {
        return this.body.loadMesh(url);
    }

    public async registerAnimation(id: string, url: string): Promise<void> {
        return this.body.registerAnimation(id, url);
    }

    /** Registers the idle/walk/run/jump/roll state graph — call once after loadMesh()/registerAnimation() for every clip have resolved. */
    public setUp(idleToWalkSpeed?: number, walkToRunSpeed?: number): void {
        this.body.setUp(idleToWalkSpeed, walkToRunSpeed);
    }

    /** Colors the body + attaches a matching smooth (rounded-corner) head with `faceTexture` decaled onto it. */
    public applyCharacterView(color: THREE.ColorRepresentation, faceTexture: THREE.Texture): void {
        this.body.applyCharacterView(color, faceTexture);
    }

    public setHeadOffset(x: number, y: number, z: number): void {
        this.body.setHeadOffset(x, y, z);
    }

    /**
     * Call once per frame from the host scene. `moveInputX`/`moveInputZ` are
     * the normalized (-1..1) move input, used here purely to drive the
     * idle/walk/run animation state and facing rotation, not to move
     * anything — the host owns actual position via `worldPosition`.
     */
    public update(delta: number, worldPosition: THREE.Vector3, moveInputX: number, moveInputZ: number, extraVars: Record<string, number | boolean> = {}): void {
        this.body.container.position.copy(worldPosition);
        this.body.update(delta, moveInputX, moveInputZ, extraVars);
    }

    /** Fires the jump animator trigger — the actual vertical impulse is applied by whoever owns the RigidBody (see PlayerMovementController). */
    public jump(): void {
        this.body.animator.animatorBoard?.setTrigger('jump');
    }

    /** Fires the roll/dodge animator trigger. */
    public dodge(): void {
        if (this.isSliding || this.isRolling) {
            return;
        }
        this.body.animator.animatorBoard?.setTrigger('roll');
    }

    /** Fires the slide animator trigger — see SwipeRunnerController's swipe-down. */
    public slide(): void {
        if (this.isSliding || this.isRolling) {
            return;
        }
        this.body.animator.animatorBoard?.setTrigger('slide');
    }

    /** Fires the "hit an obstacle" animator trigger — see ObstacleBuilder.ts/RunnerMinigameScene/SwipeMinigameScene. No mutual-exclusion guard (unlike dodge()/slide()): getting hit always takes over, and the whole scene freezes right after, so there's nothing left to protect against re-triggering. */
    public hit(): void {
        this.body.animator.animatorBoard?.setTrigger('hit');
    }

    public destroy(): void {
        this.body.destroy();
    }
}
