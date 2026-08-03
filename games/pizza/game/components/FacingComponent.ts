// FacingComponent.ts
//
// Generic, reusable "turn to face a point" component — not action-specific.
// PlayerActionController uses it to turn the player toward whatever
// resource it's currently acting on (see faceToward()), but nothing here
// knows about actions, gathering, or resources; it just tracks a target
// world position and, every frame it has one, tells the entity's
// CharacterVisualComponent (if any) which direction to face.
//
// The actual smoothing already lives in CharacterBody.update() (see
// CharacterBody.faceDirection()'s own doc) — this component just recomputes
// the direction to the target every frame (since a moving target, or the
// entity itself settling into its final position, changes that direction)
// and hands it off; it does no interpolation of its own.
//
// A no-op until the character has loaded (no CharacterVisualComponent yet)
// — same "physics/logic never waits on the async character" rule
// everything else in this ECS follows.

import * as THREE from 'three';
import Component from '../ecs/Component';
import CharacterVisualComponent from './CharacterVisualComponent';

export default class FacingComponent extends Component {
    private target?: THREE.Vector3;

    /** Start turning toward `target` (world position), every frame, until clearTarget() is called. */
    public faceToward(target: THREE.Vector3): void {
        this.target = target;
    }

    /** Stop overriding facing — the character's normal move-direction-driven rotation (see CharacterBody.update()) takes back over on the next frame that has nonzero move input. */
    public clearTarget(): void {
        this.target = undefined;
    }

    public update(): void {
        if (!this.target) {
            return;
        }

        const visual = this.entity.getComponent(CharacterVisualComponent);
        if (!visual) {
            return;
        }

        const position = this.entity.transform.position;
        visual.character.faceDirection(this.target.x - position.x, this.target.z - position.z);
    }
}
