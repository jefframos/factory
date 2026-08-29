// ResourceNodeRegistry.ts
//
// Live-instance lookup for ResourceNode AND LooseResourceNode — added specifically so
// ZoneTutorialController can find the nearest live thing that actually PRODUCES a given
// ResourceType, to point its gather-phase arrow at (see that file's own doc), without either
// entity needing to know anything about tutorials exist. Plain O(n) distance scan over a live
// Set — this game's per-zone resource node count is small enough (streamed in/out by
// WorldManager's/DynamicResourceSpawner's own proximity radius, never the whole map at once)
// that a spatial index would be premature.
//
// Both entity kinds register the SAME way — see GatherTarget below — because some
// ResourceType values (e.g. bark — see ResourceTypes.ts's own doc) are ONLY ever loose ground
// loot, never dispensed by a harvestable ResourceNode provider at all. A registry that only
// tracked ResourceNode would leave the tutorial arrow with nowhere to point for those types
// even though the resource is right there on the ground.
//
// register()/unregister() are called from ResourceNode.awake()/destroy() and
// LooseResourceNode.awake()/destroy() — an instance materializing (streamed into range) or
// leaving the world entirely (streamed back out, consumed, or genuinely destroyed) is exactly
// when this set should gain/lose it. For ResourceNode, isAvailable is re-checked live by
// findNearest() below rather than unregistering on deplete(), so a respawn doesn't need
// re-registration either — LooseResourceNode has no such state, it simply leaves the world the
// instant it's picked up (see tryPickup()), which already unregisters it via destroy().

import * as THREE from 'three';
import { ResourceType } from '../actions/ResourceTypes';
import { PROVIDER_CONFIG } from '../actions/ProviderTypes';
import ResourceNode from './ResourceNode';
import LooseResourceNode from './LooseResourceNode';

/** Whatever ResourceNodeRegistry can point a gather arrow at — see this file's own doc for why both entity kinds share one registry. */
export type GatherTarget = ResourceNode | LooseResourceNode;

export default class ResourceNodeRegistry {
    private static readonly liveNodes = new Set<GatherTarget>();

    static register(node: GatherTarget): void {
        this.liveNodes.add(node);
    }

    static unregister(node: GatherTarget): void {
        this.liveNodes.delete(node);
    }

    /**
     * The closest currently-available live node/loot that produces `resourceType`, or
     * undefined if none exist right now — the caller (ZoneTutorialController) treats that as a
     * data-misconfiguration and warns rather than crashing. A ResourceNode's provider drop
     * table (PROVIDER_CONFIG[type].drops) can list more than one resource type (a weighted
     * table) — it counts as producing `resourceType` if ANY drop entry can yield it, not just
     * the highest-weight one. A LooseResourceNode has exactly one resourceType, no drop table.
     */
    static findNearest(resourceType: ResourceType, fromPosition: THREE.Vector3): GatherTarget | undefined {
        let nearest: GatherTarget | undefined;
        let nearestDistSq = Infinity;

        for (const node of this.liveNodes) {
            if (node instanceof ResourceNode) {
                if (!node.isAvailable) {
                    continue;
                }
                const drops = PROVIDER_CONFIG[node.providerType].drops;
                if (!drops.some(drop => drop.resourceType === resourceType)) {
                    continue;
                }
            } else if (node.resourceType !== resourceType) {
                continue;
            }

            const distSq = node.position.distanceToSquared(fromPosition);
            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearest = node;
            }
        }

        return nearest;
    }
}
