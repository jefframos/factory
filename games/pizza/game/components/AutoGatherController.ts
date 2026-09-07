// AutoGatherController.ts
//
// The "no interaction required" half of the design doc: every frame,
// notices every available ResourceNode within PlayerConfig's own
// resourceDetectionRadius (see getPlayerConfig(), plain distance — no
// facing/cone filter), and — if the player isn't already busy — starts the
// matching action via PlayerActionController against whichever in-range,
// tool-owned node is BOTH the nearest one AND currently inside the player's
// own facing cone (resourceDetectionAngleDeg, symmetric around the same
// real visual-forward direction getConeTargets() below reads). A resource
// sitting in range but off to the side/behind is noticed (see
// updateMissingToolNotifications()) but never auto-targeted until the
// player turns toward it — this is the actual answer to "the player
// shouldn't have to stand directly on the tile": distance now matters
// (resourceDetectionRadius), but so does DIRECTION (resourceDetectionAngleDeg),
// so walking past several resources without facing any of them doesn't
// start chopping/mining one at random.
//
// Replaces what used to be a physics-trigger-driven design (RigidBody
// onTriggerEnter/onTriggerExit against each ResourceNode's own gather-radius
// trigger, Layers.Resource) with a plain per-frame registry scan — simpler
// once "in range" needed to mean "within a tunable radius" rather than "the
// player physically overlaps this exact box," and it needs re-evaluating
// continuously anyway (the target set changes as the player turns, not just
// as they walk).
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
// The current target falling out of resourceDetectionRadius cancels the
// in-flight action against it (when the action's cancelOnLeaveRange says
// so) — the node keeps its remaining life, so wandering off and returning
// resumes the same tree.
//
// Deliberately doesn't touch movement/timing/damage itself — those live in
// PlayerActionController/the action config; this component's only job is
// "notice resources, kick off the right action, bank the result, and always
// have somewhere to go next while still in range/facing one."

import * as THREE from 'three';
import Component from '../ecs/Component';
import PlayerActionController, { ActionTarget } from './PlayerActionController';
import CharacterVisualComponent from './CharacterVisualComponent';
import ThirdPersonCharacter from '../entities/ThirdPersonCharacter';
import ResourceNode from '../player/ResourceNode';
import ResourceNodeRegistry from '../player/ResourceNodeRegistry';
import { BackpackStorage } from '../data/BackpackStorage';
import { ResourceType } from '../actions/ResourceTypes';
import { PROVIDER_CONFIG, rollProviderDrop } from '../actions/ProviderTypes';
import { ACTION_CONFIG, ActionType } from '../actions/ActionTypes';
import { ItemStorage } from '../crafting/ItemStorage';
import { ItemType } from '../crafting/ItemTypes';
import { ToolId, getToolIcon } from '../actions/ToolRegistry';
import { getPlayerConfig } from '../data/PlayerConfig';
import PlayerNotificationComponent from './PlayerNotificationComponent';

export default class AutoGatherController extends Component {
    /**
     * Every in-range node found missing its tool as of the LAST frame — diffed against this
     * frame's fresh scan in updateMissingToolNotifications() so a designer/player only sees the
     * "missing tool" bubble once per approach, same one-shot feel the old onTriggerEnter path
     * had, rather than every single frame the node stays in range.
     */
    private readonly lastMissingTool = new Set<ResourceNode>();

    public update(): void {
        const actionController = this.entity.getComponent(PlayerActionController)!;
        const origin = this.entity.transform.position;
        const candidates = ResourceNodeRegistry.findWithinRadius(origin, getPlayerConfig().resourceDetectionRadius);

        this.updateMissingToolNotifications(candidates);

        if (actionController.isBusy) {
            this.cancelIfTargetOutOfRange(actionController, candidates);
        }

        // cancelIfTargetOutOfRange() resolves synchronously (see PlayerActionController.cancel()'s
        // own doc) — isBusy is already false again by here if it just cancelled, so falling
        // through to pick a fresh target the SAME frame (rather than waiting a tick) is safe.
        if (actionController.isBusy) {
            return;
        }

        const character = this.entity.getComponent(CharacterVisualComponent)?.character;
        const node = this.pickTarget(origin, character, candidates);
        if (node) {
            this.tryGather(node);
        }
    }

    /** Notifies (once per node, see `lastMissingTool`'s own doc) every in-range node the player currently lacks the tool for. */
    private updateMissingToolNotifications(candidates: ResourceNode[]): void {
        const currentMissingTool = new Set<ResourceNode>();
        for (const node of candidates) {
            if (this.hasRequiredTool(node)) {
                continue;
            }
            currentMissingTool.add(node);
            if (!this.lastMissingTool.has(node)) {
                this.notifyMissingTool(node);
            }
        }
        this.lastMissingTool.clear();
        for (const node of currentMissingTool) {
            this.lastMissingTool.add(node);
        }
    }

    /**
     * Cancels the in-flight action if its target has fallen out of `candidates` (i.e. out of
     * resourceDetectionRadius) and its action says cancelOnLeaveRange — the distance-driven
     * replacement for the old onTriggerExit handler. A depleted target isn't "out of range," it's
     * just gone (still `isAvailable === false`, already filtered out of `candidates` for that
     * reason too) — but that's fine here: PlayerActionController.update() itself is what ends the
     * action once its target reports depleted, this method never needs to special-case it.
     */
    private cancelIfTargetOutOfRange(actionController: PlayerActionController, candidates: ResourceNode[]): void {
        const target = actionController.target;
        if (!(target instanceof ResourceNode)) {
            return;
        }
        if (!ACTION_CONFIG[PROVIDER_CONFIG[target.providerType].action].cancelOnLeaveRange) {
            return;
        }
        if (candidates.includes(target)) {
            return;
        }
        actionController.cancel();
    }

    /**
     * Of every in-range, tool-owned candidate, the NEAREST one whose direction from `origin`
     * falls inside the player's own current facing cone (resourceDetectionAngleDeg, symmetric
     * around real visual forward) — or undefined if none qualify. The facing direction is read
     * off CharacterBody's own rotated container (`container.quaternion`), same "actual current
     * visual forward, not the idealized facing target" reasoning getConeTargets() below uses for
     * the swing's own hit cone — so what gets auto-targeted matches what's actually on screen.
     * Falls back to ignoring the facing cone entirely (nearest in range wins) if the FBX
     * character hasn't loaded yet, same permissive fallback getConeTargets() uses.
     */
    private pickTarget(origin: THREE.Vector3, character: ThirdPersonCharacter | undefined, candidates: ResourceNode[]): ResourceNode | undefined {
        let dirX = 0;
        let dirZ = 0;
        let haveFacing = false;
        if (character) {
            const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(character.container.quaternion);
            const len = Math.hypot(forward.x, forward.z);
            if (len > 1e-6) {
                dirX = forward.x / len;
                dirZ = forward.z / len;
                haveFacing = true;
            }
        }
        const cosHalfAngle = Math.cos((getPlayerConfig().resourceDetectionAngleDeg * Math.PI / 180) / 2);

        let nearest: ResourceNode | undefined;
        let nearestDistSq = Infinity;
        for (const node of candidates) {
            if (!this.hasRequiredTool(node)) {
                continue;
            }

            const dx = node.position.x - origin.x;
            const dz = node.position.z - origin.z;
            const distSq = dx * dx + dz * dz;
            if (haveFacing && distSq > 1e-6) {
                const invLen = 1 / Math.sqrt(distSq);
                const dot = dx * invLen * dirX + dz * invLen * dirZ;
                if (dot < cosHalfAngle) {
                    continue;
                }
            }

            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearest = node;
            }
        }
        return nearest;
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
     * file's own doc). Only called once per node per approach (see updateMissingToolNotifications()
     * / `lastMissingTool`'s own doc) — entering detection range without the axe shows the bubble
     * once; standing there doesn't spam it again every frame. Optional-chained since
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
            // Nothing else to do here — update() re-scans for a fresh target every frame
            // regardless of how the last action ended, so the very next frame already picks up
            // wherever this leaves off.
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
