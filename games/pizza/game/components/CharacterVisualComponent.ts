// CharacterVisualComponent.ts
//
// Wraps a ThirdPersonCharacter (mesh + animation state graph, see that
// file) as an Entity component. ThirdPersonCharacter.update() sets its own
// container's position directly to a WORLD position each frame, so its
// container is added straight to the THREE scene by the caller (same as
// PizzaScene's original, component-less usage) rather than parented under
// entity.transform — nesting it there would double-apply the offset.
// Every frame this reads the RigidBody's collider center (minus half its
// height, since the rig's own origin is at its feet) and forwards the
// current move input so idle/run animation + facing keep working.

import * as THREE from 'three';
import Component from '../ecs/Component';
import ThirdPersonCharacter from '../entities/ThirdPersonCharacter';
import RigidBody from '../physics/RigidBody';

export default class CharacterVisualComponent extends Component {
    public readonly character: ThirdPersonCharacter;

    /** Read by update() each frame — set this from your input/controller before the entity updates. */
    public moveInput = new THREE.Vector2(0, 0);

    private readonly worldPosition = new THREE.Vector3();

    public constructor(character: ThirdPersonCharacter) {
        super();
        this.character = character;
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

        this.character.update(delta, this.worldPosition, this.moveInput.x, this.moveInput.y);
    }

    public destroy(): void {
        this.character.destroy();
    }
}
