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

import * as THREE from 'three';
import Component from '../ecs/Component';
import RigidBody from '../physics/RigidBody';
import PlayerActionController, { ActionTarget } from './PlayerActionController';
import CharacterVisualComponent from './CharacterVisualComponent';
import ResourceNode from '../player/ResourceNode';
import ResourceNodeRegistry from '../player/ResourceNodeRegistry';
import { BackpackStorage } from '../data/BackpackStorage';
import { ResourceType } from '../actions/ResourceTypes';
import { PROVIDER_CONFIG, rollProviderDrop } from '../actions/ProviderTypes';
import { ACTION_CONFIG, ActionType } from '../actions/ActionTypes';
import { ItemStorage } from '../crafting/ItemStorage';
import { ItemType } from '../crafting/ItemTypes';
import { ToolId, getToolIcon } from '../actions/ToolRegistry';
import PlayerNotificationComponent from './PlayerNotificationComponent';

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

        if (node.isAvailable && !this.hasRequiredTool(node)) {
            this.notifyMissingTool(node);
        }

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

        if (!ACTION_CONFIG[PROVIDER_CONFIG[node.providerType].action].cancelOnLeaveRange) {
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
        const tool = ACTION_CONFIG[PROVIDER_CONFIG[node.providerType].action].tool;
        return tool === undefined || ItemStorage.hasCount(tool as ItemType, 1);
    }

    /**
     * Surfaces `node`'s missing-tool block to the player — a bubble with the required tool's
     * own icon (+ exclamation badge) over their head, via PlayerNotificationComponent (see that
     * file's own doc). Only called from onTriggerEnter (a fresh overlap), not from every
     * tryGatherNext() retry — walking in without the axe shows the bubble once; standing there
     * doesn't spam it again on every action-completion retry loop. Optional-chained since
     * PlayerNotificationComponent is only present when MainPlayer was built with a
     * screenHost (omitted for the headless test harness — see that file's own doc).
     */
    private notifyMissingTool(node: ResourceNode): void {
        const tool = ACTION_CONFIG[PROVIDER_CONFIG[node.providerType].action].tool;
        if (tool === undefined) {
            return;
        }

        this.entity.getComponent(PlayerNotificationComponent)?.showBlocked(getToolIcon(tool as ToolId));
    }

    private tryGather(node: ResourceNode): void {
        const actionController = this.entity.getComponent(PlayerActionController)!;
        const config = PROVIDER_CONFIG[node.providerType];

        void actionController.onPlayActionAnimation(
            config.action,
            node,
            (target, hits) => this.onHitLanded(target, hits),
            () => this.getConeTargets(node, config.action),
        ).then(result => {
            if (result === 'completed') {
                console.log(`[gather] fully harvested ${config.label}`);
            }
            // Either ending (completed or cancelled) may leave the player still standing in
            // another resource's trigger — see this method's own doc / tryGatherNext()'s.
            this.tryGatherNext();
        });
    }

    /**
     * Every other available ResourceNode caught in the tool's current hit cone alongside
     * `primary` — see PlayerActionController's getAdditionalTargets param, which calls this
     * fresh on every hit tick rather than once at swing start.
     *
     * The cone's own facing direction is the character's ACTUAL current visual forward — read
     * off CharacterBody's own rotated container (`container.quaternion`), not the raw
     * origin -> primary.position vector FacingComponent merely feeds toward. Those two only
     * agree at the instant a swing starts: CharacterBody.faceDirection() sets a `targetRotation`
     * that the body then slerps toward over several frames (ROTATION_SLERP, see its own doc),
     * AND movement input (never frozen during an action, see PlayerActionController's own doc)
     * overwrites that same targetRotation every frame it's held — so mid-swing, while the
     * player is still turning or is actively walking a different way, the model can easily be
     * facing somewhere other than straight at `primary`. Basing the cone on the real rotation
     * keeps what gets hit matching what's actually on screen instead of an idealized "already
     * perfectly aimed" assumption. Falls back to the raw vector toward `primary` only if the FBX
     * character hasn't loaded yet (no container to read a rotation off of at all).
     */
    private getConeTargets(primary: ResourceNode, action: ActionType): ActionTarget[] {
        const origin = this.entity.transform.position;
        const character = this.entity.getComponent(CharacterVisualComponent)?.character;

        let dirX: number;
        let dirZ: number;
        if (character) {
            const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(character.container.quaternion);
            const len = Math.hypot(forward.x, forward.z);
            if (len < 1e-6) {
                return [];
            }
            dirX = forward.x / len;
            dirZ = forward.z / len;
        } else {
            const dx = primary.position.x - origin.x;
            const dz = primary.position.z - origin.z;
            const len = Math.hypot(dx, dz);
            if (len < 1e-6) {
                return [];
            }
            dirX = dx / len;
            dirZ = dz / len;
        }

        const config = ACTION_CONFIG[action];
        const halfAngleRad = (config.hitAngleDeg * Math.PI / 180) / 2;
        return ResourceNodeRegistry
            .findInCone(origin, dirX, dirZ, action, config.hitRangeMeters, halfAngleRad)
            .filter(node => node !== primary);
    }

    /**
     * Fired on every landed swing — on the primary target AND on every extra AoE cone target
     * alike (see PlayerActionController's onHit param and its getAdditionalTargets doc) — not
     * just once at the end. `target` is only ever a ResourceNode in this game (the other
     * ActionTarget implementor would be some future non-resource damageable, see
     * PlayerActionController's own doc); a target this component didn't itself hand out here
     * is silently ignored rather than assumed to be one.
     *
     * Banks amountPerGather * resourcePerHit * hits immediately and flies a small placeholder
     * chip from the node to wherever the backpack cube currently sits, purely as visual
     * feedback for the bank. `hits` is whatever PlayerActionController.update() actually removed
     * this swing for THIS target — already capped at its own remaining life for a killing blow
     * (see that file's own doc) — but resourcePerHit (read fresh off ACTION_CONFIG, see
     * ActionTypes.ts's own doc) is NOT capped the same way, so a resourcePerHit upgrade banks
     * proportionally more per hit all the way through the tree's very last hit, not just on
     * hits that don't finish it off. The chip-flying half no-ops if the FBX character (and
     * therefore the backpack cube) hasn't loaded yet, but the backpack still gets its
     * resources either way.
     *
     * The total unit count still comes from the provider's OWN config (amountPerGather *
     * resourcePerHit * hits) — what actually gets CREDITED per unit is resolved by
     * rollProviderDrop(), one roll per unit (see ProviderTypes.ts's own doc on why per-unit
     * rather than per-hit), so a provider with only one drop-table entry still banks 100%
     * that type exactly as before providers existed, while one with more than one entry
     * (e.g. a stone deposit set up 90% stone / 10% pebble) converges to that split over a
     * harvest instead of committing an entire swing to one outcome.
     */
    private onHitLanded(target: ActionTarget, hits: number): void {
        if (!(target instanceof ResourceNode)) {
            return;
        }
        const node = target;

        const config = PROVIDER_CONFIG[node.providerType];
        const resourcePerHit = ACTION_CONFIG[config.action].resourcePerHit;
        const totalUnits = Math.round(config.amountPerGather * resourcePerHit * hits);

        const creditedCounts = new Map<ResourceType, number>();
        for (let i = 0; i < totalUnits; i++) {
            const droppedType = rollProviderDrop(node.providerType);
            creditedCounts.set(droppedType, (creditedCounts.get(droppedType) ?? 0) + 1);
        }

        // Track the single BIGGEST credited type/amount this hit — the floating gain popup
        // shows one icon + one number (see ResourceNode.showResourceGainPopup()'s own doc), so
        // for a provider with a weighted multi-resource drop table (e.g. a stone deposit's 90%
        // stone / 10% pebble) the rare minority roll on an otherwise-majority hit just doesn't
        // get its own popup — showing the majority type's real icon+amount is far better than
        // showing an unrelated provider icon next to a number that might not even be for it.
        let added = 0;
        let topType: ResourceType | undefined;
        let topAmount = 0;
        for (const [droppedType, amount] of creditedCounts) {
            added += BackpackStorage.add(droppedType, amount);
            if (amount > topAmount) {
                topType = droppedType;
                topAmount = amount;
            }
        }
        console.log(`[gather] +${added} from ${config.label}`);

        if (topType !== undefined) {
            node.showResourceGainPopup(topType, topAmount);
        }

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
