// AutoGatherController.ts
//
// The "no interaction required" half of the design doc: tracks every
// ResourceNode whose gather-radius trigger (Layers.Resource) the player is
// CURRENTLY overlapping (see `overlapping`, not just the one being acted
// on), and — if the player isn't already busy — starts the matching action
// via PlayerActionController against the first available one, the same
// onPlayActionAnimation() entry point anything else would use.
//
// Tracking every overlap (not just "the one that triggered this") matters
// once the player stands where two resources' triggers overlap: only the
// FIRST one's onTriggerEnter fires while walking in — the second one's
// already-fired-and-forgotten. Finishing the first action needs to check
// `overlapping` itself for "is there another one right here" rather than
// waiting for a fresh onTriggerEnter that will never come — that's what
// tryGatherNext() being called both from onTriggerEnter AND from every
// action's completion/cancellation is for (see that method's own doc).
//
// This component banks amountPerGather * resourcePerHit * hits on EVERY
// landed swing (see onHitLanded()), not just once at the end — matching the
// visual (a chip flies per swing too). resourcePerHit (see ActionTypes.ts's
// own doc) is a tool-upgrade knob, never capped by a target's remaining
// life the way the hit COUNT is, so a fully-upgraded axe can pull a total
// yield well past a tree's own maxLife — a resourcePerHit-3 axe still banks
// 3x on the tree's very last hit, not just 1x. Cancelling mid-harvest keeps
// whatever hits already landed; nothing is refunded, same as the node's own
// damage persisting (see ResourceNode.life's doc).
//
// Leaving a node's trigger cancels the in-flight action against THAT node
// (when the action's cancelOnLeaveRange says so) — the node keeps its
// remaining life, so wandering off and returning resumes the same tree.
//
// Deliberately doesn't touch movement/facing/timing/damage itself — those
// live in PlayerActionController/FacingComponent/the action config; this
// component's only job is "notice resources, kick off the right action,
// bank the result, and always have somewhere to go next while still
// standing in range of one."

import Component from '../ecs/Component';
import RigidBody from '../physics/RigidBody';
import PlayerActionController from './PlayerActionController';
import CharacterVisualComponent from './CharacterVisualComponent';
import ResourceNode from '../player/ResourceNode';
import { BackpackStorage } from '../data/BackpackStorage';
import { RESOURCE_CONFIG } from '../actions/ResourceTypes';
import { ACTION_CONFIG } from '../actions/ActionTypes';
import { ItemStorage } from '../crafting/ItemStorage';
import { ItemType } from '../crafting/ItemTypes';

export default class AutoGatherController extends Component {
    /** Every ResourceNode whose trigger the player is currently standing inside — see this file's own doc. */
    private readonly overlapping = new Set<ResourceNode>();

    public awake(): void {
        const rigidBody = this.entity.getComponent(RigidBody)!;
        rigidBody.onTriggerEnter.add(other => this.onTriggerEnter(other));
        rigidBody.onTriggerExit.add(other => this.onTriggerExit(other));
    }

    private onTriggerEnter(other: RigidBody): void {
        const node = other.entity;
        if (!(node instanceof ResourceNode)) {
            return;
        }

        this.overlapping.add(node);
        this.tryGatherNext();
    }

    /**
     * Player left something's trigger — untrack it, and cancel the in-flight action if that
     * something is what we're currently acting on.
     *
     * The `node.isAvailable` guard is what separates "walked away" from "just finished it":
     * a node depleting inside applyHit() unregisters its own RigidBody, and
     * PhysicsWorld.unregister() fires onTriggerExit synchronously for the pair — so this
     * handler runs mid-completion, while PlayerActionController is still technically busy
     * with that very target. Without the guard, every successful harvest would cancel
     * itself a beat before it could report 'completed', and nothing would ever be banked.
     */
    private onTriggerExit(other: RigidBody): void {
        const node = other.entity;
        if (!(node instanceof ResourceNode)) {
            return;
        }

        this.overlapping.delete(node);

        if (!node.isAvailable) {
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
        // cancel() resolves synchronously — the action's own .then() (see tryGather()) will
        // also call tryGatherNext() on the next microtask, but doing it here too means the
        // player doesn't wait even that long if another overlapping node is available right now.
        this.tryGatherNext();
    }

    /**
     * Starts gathering the first available node still in `overlapping` — called from
     * onTriggerEnter (a genuinely new overlap) AND every time an action finishes, whether it
     * completed or was cancelled (see tryGather()'s .then() and onTriggerExit()). That second
     * call site is the actual point of this method: without it, finishing one resource while
     * still standing inside another's trigger left the player idle until they physically left
     * and re-entered a trigger to get a fresh onTriggerEnter.
     */
    private tryGatherNext(): void {
        const actionController = this.entity.getComponent(PlayerActionController)!;
        if (actionController.isBusy) {
            return;
        }

        for (const node of this.overlapping) {
            if (node.isAvailable && this.hasRequiredTool(node)) {
                this.tryGather(node);
                return;
            }
        }
    }

    /**
     * Whether the player actually owns whatever tool `node`'s action equips (see
     * ActionConfig.tool's own doc — undefined means bare-handed, e.g. Gather/berries, always
     * allowed). ToolId and ItemType share the exact same string values ('axe'/'pickaxe' —
     * see ItemTypes.ts's own doc), so the cast below is safe: a tool the player hasn't
     * crafted yet (see CraftZone.ts) just means this resource sits there un-harvestable
     * until they craft it, same as standing next to a tree with no axe at all before this
     * check existed would otherwise have silently let them chop it anyway.
     */
    private hasRequiredTool(node: ResourceNode): boolean {
        const tool = ACTION_CONFIG[RESOURCE_CONFIG[node.resourceType].action].tool;
        return tool === undefined || ItemStorage.hasCount(tool as ItemType, 1);
    }

    private tryGather(node: ResourceNode): void {
        const actionController = this.entity.getComponent(PlayerActionController)!;
        const config = RESOURCE_CONFIG[node.resourceType];

        void actionController.onPlayActionAnimation(config.action, node, hits => this.onHitLanded(node, hits)).then(result => {
            if (result === 'completed') {
                console.log(`[gather] fully harvested ${config.label}`);
            }
            // Either ending (completed or cancelled) may leave the player still standing in
            // another resource's trigger — see this method's own doc / tryGatherNext()'s.
            this.tryGatherNext();
        });
    }

    /**
     * Fired on every landed swing (see PlayerActionController's onHit param), not just once at
     * the end — banks amountPerGather * resourcePerHit * hits immediately and flies a small
     * placeholder chip from the node to wherever the backpack cube currently sits, purely as
     * visual feedback for the bank. `hits` is whatever PlayerActionController.update() actually
     * removed this swing — already capped at the node's remaining life for a killing blow (see
     * that file's own doc) — but resourcePerHit (read fresh off ACTION_CONFIG, see
     * ActionTypes.ts's own doc) is NOT capped the same way, so a resourcePerHit upgrade banks
     * proportionally more per hit all the way through the tree's very last hit, not just on
     * hits that don't finish it off. The chip-flying half no-ops if the FBX character (and
     * therefore the backpack cube) hasn't loaded yet, but the backpack still gets its
     * resources either way.
     */
    private onHitLanded(node: ResourceNode, hits: number): void {
        const config = RESOURCE_CONFIG[node.resourceType];
        const resourcePerHit = ACTION_CONFIG[config.action].resourcePerHit;
        const added = BackpackStorage.add(node.resourceType, config.amountPerGather * resourcePerHit * hits);
        console.log(`[gather] +${added} ${config.label}`);

        const character = this.entity.getComponent(CharacterVisualComponent)?.character;
        const backpackWorldPosition = character?.getBackpackWorldPosition();

        // node.transform is added directly to the THREE.Scene by WorldManager (see
        // spawnFlyingResourceChip's own doc) — its parent IS the scene.
        const scene = node.transform.parent;
        if (!backpackWorldPosition || !scene) {
            return;
        }

        //spawnFlyingResourceChip(scene, node.position, backpackWorldPosition, config.color);
    }
}
