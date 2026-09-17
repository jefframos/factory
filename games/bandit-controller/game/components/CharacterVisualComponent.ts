// CharacterVisualComponent.ts
//
// Wraps a ThirdPersonCharacter (mesh + animation state graph) as an Entity
// component. ThirdPersonCharacter.update() sets its own container's
// position directly to a WORLD position each frame, so its container is
// added straight to the THREE scene by the caller rather than parented
// under entity.transform. Every frame this reads the RigidBody's collider
// center/velocity/grounded state and forwards it so idle/walk/run/jump
// animation + facing keep working.

import * as THREE from 'three';
import Component from '../ecs/Component';
import ThirdPersonCharacter from '../entities/ThirdPersonCharacter';
import RigidBody from '../physics/RigidBody';
import { PLAYER_SETTINGS } from '../data/PlayerSettings';

export default class CharacterVisualComponent extends Component {
    public readonly character: ThirdPersonCharacter;

    /** Read by update() each frame — set this from your input/controller before the entity updates. */
    public moveInput = new THREE.Vector2(0, 0);

    private readonly worldPosition = new THREE.Vector3();
    private rollingRemaining = 0;
    private slidingRemaining = 0;

    public constructor(character: ThirdPersonCharacter) {
        super();
        this.character = character;
    }

    /** Starts the roll/dodge animation — no-op while a roll is already in progress. */
    public dodge(): void {
        if (this.rollingRemaining > 0) {
            return;
        }
        this.rollingRemaining = PLAYER_SETTINGS.rollDuration;
        this.character.dodge();
    }

    /** Starts the slide animation (swipe-down, see SwipeRunnerController) — no-op while a slide is already in progress. */
    public slide(): void {
        if (this.slidingRemaining > 0) {
            return;
        }
        this.slidingRemaining = PLAYER_SETTINGS.slideDuration;
        this.character.slide();
    }

    public update(delta: number): void {
        const rigidBody = this.entity.getComponent(RigidBody);
        if (rigidBody) {
            rigidBody.getCenter(this.worldPosition);
            // Character rig's own origin is at its feet, not the collider center — drop back down by half its height.
            this.worldPosition.y -= rigidBody.halfExtents.y;
        } else {
            this.worldPosition.copy(this.entity.transform.position);
        }

        this.rollingRemaining = Math.max(0, this.rollingRemaining - delta);
        this.slidingRemaining = Math.max(0, this.slidingRemaining - delta);

        this.character.update(delta, this.worldPosition, this.moveInput.x, this.moveInput.y, {
            grounded: rigidBody?.grounded ?? true,
            verticalSpeed: rigidBody?.velocity.y ?? 0,
            rolling: this.rollingRemaining > 0,
            sliding: this.slidingRemaining > 0,
        });
    }

    public destroy(): void {
        this.character.destroy();
    }
}
