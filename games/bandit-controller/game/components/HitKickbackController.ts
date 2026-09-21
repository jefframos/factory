// HitKickbackController.ts
//
// Applies a brief backward velocity impulse the instant the player hits an obstacle — see
// RunnerMinigameScene/SwipeMinigameScene's own onHitObstacle() — and decays it linearly back
// to a dead stop over PlayerSettings.hitKickbackDuration, rather than the abrupt "velocity
// zeroed instantly" a plain freeze read as. Both scenes already disable whichever movement
// controller was driving the player (PlayerMovementController/SwipeRunnerController) BEFORE
// triggering this, so nothing else is fighting over RigidBody.velocity.x/z during the decay.
//
// Deliberately leaves velocity.y alone, both on trigger and every tick after — a player hit
// mid-jump should keep falling under normal gravity, not freeze mid-air; only the horizontal
// kickback is this component's concern.

import * as THREE from 'three';
import Component from 'core/ecs/Component';
import RigidBody from 'core/physics/RigidBody';
import { PLAYER_SETTINGS } from '../data/PlayerSettings';

export default class HitKickbackController extends Component {
    private readonly direction = new THREE.Vector3();
    private elapsed = 0;
    private active = false;

    /**
     * Starts the kickback along `direction` — need only be roughly horizontal, it's
     * flattened (Y zeroed) and normalized here, then scaled by PlayerSettings.
     * hitKickbackSpeed. Immediately overwrites the RigidBody's current X/Z velocity (the
     * whole point — whatever forward momentum the player had is replaced by the kickback,
     * not added to it).
     */
    public trigger(direction: THREE.Vector3): void {
        this.direction.set(direction.x, 0, direction.z).normalize();
        this.elapsed = 0;
        this.active = true;
        this.applyCurrentVelocity();
    }

    public fixedUpdate(delta: number): void {
        if (!this.active) {
            return;
        }

        this.elapsed += delta;
        this.applyCurrentVelocity();

        if (this.elapsed >= PLAYER_SETTINGS.hitKickbackDuration) {
            this.active = false;
        }
    }

    private applyCurrentVelocity(): void {
        const rigidBody = this.entity.getComponent(RigidBody);
        if (!rigidBody) {
            return;
        }

        const t = Math.min(1, this.elapsed / PLAYER_SETTINGS.hitKickbackDuration);
        const speed = PLAYER_SETTINGS.hitKickbackSpeed * (1 - t);
        rigidBody.velocity.x = this.direction.x * speed;
        rigidBody.velocity.z = this.direction.z * speed;
    }
}
