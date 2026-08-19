// LooseResourceNode.ts
//
// A ResourceNode subclass for dynamically-spawned, spawner-cluster-managed
// ground loot (e.g. a wood log lying on the grass — see
// DynamicResourceSpawner.ts, the one thing that constructs these) rather
// than a fixed map-painted resource (see ResourceNode.ts's own doc — trees/
// stones/berries, positioned from the Tiled map's resourcesLayer and kept
// alive forever by WorldManager). Reuses EVERYTHING about ResourceNode
// (trigger, visual, gain popup, damage/hit handling, the whole
// PlayerActionController/AutoGatherController pipeline) except one thing:
// once fully harvested, a fixed ResourceNode respawns itself in the exact
// same spot after a cooldown; this one instead leaves the world FOR GOOD
// and tells DynamicResourceSpawner (via `onConsumed`) that its slot is free
// — the spawner decides if/where a replacement shows up next, which may not
// be the same spot at all.
//
// `isAvailable` is overridden (not just `deplete()`) so the very same
// "walking away mid-harvest cancels the action; the harvest ITSELF must
// not" guard AutoGatherController.onTriggerExit() already relies on for
// ordinary ResourceNode depletion keeps working correctly here too — see
// that method's own doc. `consumed` flips to true synchronously, before
// this leaves the world (whose RigidBody teardown is what actually fires
// the trigger-exit), so the guard sees "depleted", never "walked away",
// exactly like a normal ResourceNode.

import * as THREE from 'three';
import ResourceNode from './ResourceNode';
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';

export default class LooseResourceNode extends ResourceNode {
    /** Flips true the instant this is fully harvested — see this file's own doc for why isAvailable checks this instead of the (never-set, for this subclass) respawn timer ResourceNode's own getter reads. */
    private consumed = false;
    /** Notifies DynamicResourceSpawner that this instance's slot just freed up — called once, right before this leaves the world. */
    private readonly onConsumed?: () => void;

    public constructor(
        resourceType: ResourceType,
        position: THREE.Vector3,
        screenHost?: ScreenAnchorHost,
        onConsumed?: () => void,
    ) {
        super(resourceType, position, RESOURCE_CONFIG[resourceType].maxLife, undefined, screenHost);
        this.onConsumed = onConsumed;
    }

    public override get isAvailable(): boolean {
        return !this.consumed;
    }

    /** Overrides ResourceNode's "hide + start a respawn timer, revive in place later" with "leave for good" — see this file's own doc. */
    protected override deplete(): void {
        this.consumed = true;
        this.onConsumed?.();
        this.world?.remove(this);
    }
}
