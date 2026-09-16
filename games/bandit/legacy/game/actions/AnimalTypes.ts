// AnimalTypes.ts
//
// Data-driven definition of an ANIMAL — an autonomous, wandering entity
// (AnimalNode.ts) caught by a PRESENCE timer instead of the repeated-hit
// cycle every other action (Chop/Mine/Gather) uses — see
// AnimalCatchController.ts's own doc for the full mechanic. `captureSec` is
// how long the player has to stand in this animal's trigger, continuously
// meeting `requirementItem`/`requirementAmount` (if set), before it's
// caught.
//
// `requirementItem`/`requirementAmount` are a PAIR — either both set or
// both undefined (see AnimalCatchController.hasRequirement()) — some
// animals need nothing at all (undefined means a bare-handed catch, no
// item check whatsoever), same "not every provider needs a drop table
// entry beyond one" open-endedness ProviderTypes.ts already has. "Rope
// level 1" (Pig's own requirement below) just means requirementAmount: 1 —
// there's no real per-item LEVEL/tier system anywhere in this codebase yet
// (ItemStorage only tracks a flat owned COUNT), so for now this is read as
// a plain ownership-count check, same shape AutoGatherController's own
// hasRequiredTool() already uses for Chop/Mine's tool gate.
//
// `resourceType` is NOT banked anywhere on a successful catch — a caught
// animal becomes a FOLLOWER (AnimalFollowStorage.ts/AnimalNode.startFollowing(),
// see AnimalCatchController.ts's own doc), never a BackpackStorage credit.
// It still exists purely so this animal's WORLD visual and its caught-state
// icon (the same AssetLibraryRegistry entry, reused — see
// resolveResourceAssetKey()) have somewhere to live, same "a provider's
// world appearance and its bankable resource are still separate concepts
// even when they happen to share one config field" split ProviderTypes.ts/
// ResourceTypes.ts already established.
//
// `wanderSpeed`/`wanderPauseRangeSec` are AnimalNode's own movement tuning
// — see that file's own doc for the actual move-to-a-random-point-then-
// pause loop these drive. Wander bounds themselves are NOT part of this
// config: they come from wherever the animal was spawned (a ShapeResourcePlacement's
// own spawner shape, see ShapeResourceTypes.ts's own doc on `spawnType:
// 'animal'`), since the same Pig could wander a tiny pen in one shape and a
// huge pasture in another without needing two different AnimalType entries.
//
// Add a new animal: an AnimalType member + ANIMAL_CONFIG entry here + an
// AssetLibraryRegistry.ts entry keyed the same as `resourceType` (reused
// for BOTH the live wandering visual AND the caught resource's own icon —
// see AssetLibraryRegistry.ts's "pig" entry for the worked example) + a
// ResourceType/RESOURCE_CONFIG entry for whatever it banks — then reference
// it from a shapeResourcePlacements entry with `spawnType: 'animal'`.

import { ResourceType } from './ResourceTypes';
import { ItemType } from '../crafting/ItemTypes';

export enum AnimalType {
    Pig = 'pig',
}

export interface AnimalConfig {
    /** Display name for UI/editor. */
    label: string;
    /** Which AssetLibraryRegistry entry (see resolveResourceAssetKey()) this animal's world model AND caught-state icon come from — never actually banked to BackpackStorage, see this file's own doc. */
    resourceType: ResourceType;
    /** Seconds the player must stand in this animal's trigger, continuously meeting the requirement below (if any), to catch it — see AnimalCatchController.ts's own doc for why this is a plain presence TIMER, not a hit-cycle. Resets to 0 the instant the player leaves range or the requirement stops being met — no partial-progress carry-over. */
    captureSec: number;
    /** Item the player must own to even ATTEMPT a capture — undefined means no requirement at all (a bare-handed catch). Always paired with requirementAmount — see this file's own doc. */
    requirementItem?: ItemType;
    /** How many of requirementItem must be owned — see this file's own doc on why this is the "level" for now. Meaningless (and unread) when requirementItem is undefined. */
    requirementAmount?: number;
    /** World units/sec AnimalNode moves at while walking to its current wander target — see AnimalNode.ts's own doc. */
    wanderSpeed: number;
    /** [min, max] seconds AnimalNode idles between wander legs — rolled fresh each time it arrives at a wander target. */
    wanderPauseRangeSec: [number, number];
    /** Half-extent (world units) of this animal's WILD capture trigger — how close the player has to stand to start capturing it, and the radius of its own on-ground capture-ring visual (see AnimalNode.ts's own doc — both share this exact value on purpose). Defaults to 1 (AnimalNode.DEFAULT_TRIGGER_RADIUS) when omitted, same size every animal used before this field existed. Bump this per-animal for a bigger creature that should be catchable from further away. */
    triggerRadius?: number;
}

/**
 * Reverse lookup — the AnimalType whose `resourceType` is `resourceType`, or undefined for the
 * overwhelming majority of ResourceTypes (ordinary bankable goods, not animal-backed at all).
 * Used by QueueZone.ts to notice a task that's actually asking to deliver a FOLLOWED ANIMAL
 * (e.g. "bring 1 Pig") instead of a real BackpackStorage-held resource — see that file's own
 * doc on why delivery works completely differently in that case (drains
 * AnimalFollowStorage's own follower list instead of the backpack).
 */
export function findAnimalTypeForResource(resourceType: ResourceType): AnimalType | undefined {
    return (Object.keys(ANIMAL_CONFIG) as AnimalType[]).find(type => ANIMAL_CONFIG[type].resourceType === resourceType);
}

export const ANIMAL_CONFIG: Record<AnimalType, AnimalConfig> = {
    [AnimalType.Pig]: {
        label: "Pig",
        resourceType: ResourceType.Pig,
        captureSec: 3,
        requirementItem: ItemType.Rope,
        wanderSpeed: 1.2,
        wanderPauseRangeSec: [
            1,
            3
        ],
        triggerRadius: 2
    },
};
