// AutoGatherController.ts
//
// The "no interaction required" half of the design doc: listens for the
// player's own RigidBody overlapping a ResourceNode's gather-radius trigger
// (Layers.Resource) and, if the player isn't already busy, starts the
// matching action via PlayerActionController — the same
// onPlayActionAnimation() entry point anything else would use. The action
// then chips away at the node's life on its own schedule (see
// PlayerActionController/ActionTypes.ts); this component only reacts to how
// it ended, banking the yield on 'completed' and ignoring 'cancelled'.
//
// Leaving the node's trigger cancels the in-flight action (when the action's
// cancelOnLeaveRange says so) — the node keeps its remaining life, so
// wandering off and returning resumes the same tree.
//
// Deliberately doesn't touch movement/facing/timing/damage itself — those
// live in PlayerActionController/FacingComponent/the action config; this
// component's only job is "notice a resource, kick off the right action,
// bank the result, stop when out of range."

import Component from '../ecs/Component';
import RigidBody from '../physics/RigidBody';
import PlayerActionController from './PlayerActionController';
import BackpackComponent from './BackpackComponent';
import ResourceNode from '../player/ResourceNode';
import { RESOURCE_CONFIG } from '../actions/ResourceTypes';
import { ACTION_CONFIG } from '../actions/ActionTypes';

export default class AutoGatherController extends Component {
    public awake(): void {
        const rigidBody = this.entity.getComponent(RigidBody)!;
        rigidBody.onTriggerEnter.add(other => this.tryGather(other));
        rigidBody.onTriggerExit.add(other => this.tryCancel(other));
    }

    private tryGather(other: RigidBody): void {
        const node = other.entity;
        if (!(node instanceof ResourceNode) || !node.isAvailable) {
            return;
        }

        const actionController = this.entity.getComponent(PlayerActionController)!;
        if (actionController.isBusy) {
            // Already gathering (or otherwise acting) — this node just doesn't get a turn
            // this time; walking into it again once free will retry via a fresh onTriggerEnter.
            return;
        }

        const config = RESOURCE_CONFIG[node.resourceType];

        void actionController.onPlayActionAnimation(config.action, node).then(result => {
            if (result !== 'completed') {
                // Cancelled — the node kept its damage (see ResourceNode.life), nothing to bank.
                return;
            }

            const added = this.entity.getComponent(BackpackComponent)?.add(node.resourceType, config.amountPerGather) ?? 0;
            console.log(`[gather] +${added} ${config.label}`);
        });
    }

    /**
     * Player left something's trigger — cancel the action if that something is what we're
     * currently acting on.
     *
     * The `node.isAvailable` guard is what separates "walked away" from "just finished it":
     * a node depleting inside applyHit() unregisters its own RigidBody, and
     * PhysicsWorld.unregister() fires onTriggerExit synchronously for the pair — so this
     * handler runs mid-completion, while PlayerActionController is still technically busy
     * with that very target. Without the guard, every successful harvest would cancel
     * itself a beat before it could report 'completed', and nothing would ever be banked.
     */
    private tryCancel(other: RigidBody): void {
        const node = other.entity;
        if (!(node instanceof ResourceNode) || !node.isAvailable) {
            return;
        }

        const actionController = this.entity.getComponent(PlayerActionController)!;
        if (actionController.target !== node) {
            return;
        }

        if (!ACTION_CONFIG[RESOURCE_CONFIG[node.resourceType].action].cancelOnLeaveRange) {
            return;
        }

        actionController.cancel();
    }
}
