// MilestoneRequirement.ts
//
// The shared "some other game milestone has to have happened" requirement —
// originally GateTypes.ts's own GateRequirement, pulled out here once a
// SECOND system (QueueTypes.ts's QueueConfig.appearRequirement — a queue
// that doesn't even appear on the map until its requirement is met) needed
// the exact same shape: a building reaching a required level, the player
// owning a particular crafted item/tool, or the player holding a given
// amount of a resource. Anything that gates on "has milestone X happened
// yet" reads this same union and calls isMilestoneRequirementMet() — no
// reason for a gate's requirement and a queue's appearance requirement to
// be two different types that happen to look alike.
//
// This is the DATA half of the shared requirement system — see
// RequirementRegistry.ts (game/world/) for the piece that actually spawns/
// unlocks something once a requirement is met, and for how a brand new
// entity type plugs into both without either file needing to change.
//
// Adding a FOURTH milestone kind later (a queue delivered N times, a shop
// upgrade bought, ...) is another arm of this union plus a matching branch
// in isMilestoneRequirementMet() — every existing caller keeps working
// unchanged.

import { BuildingStorage } from './BuildingStorage';
import { BuildingId } from './BuildingTypes';
import { ItemStorage } from '../crafting/ItemStorage';
import { ItemType } from '../crafting/ItemTypes';
import { BackpackStorage } from './BackpackStorage';
import { ResourceType } from '../actions/ResourceTypes';
import { GateStorage } from './GateStorage';
// Type-only — GateTypes.ts's own GateConfig.requirement field is typed as MilestoneRequirement,
// so a plain runtime import here would be circular. GateId is only ever used as a TYPE
// annotation below (the 'gate' arm's own `gateId` field), never a runtime value, so `import
// type` erases entirely at compile time and never actually completes that cycle.
import type { GateId } from './GateTypes';

/** A building must be AT LEAST `level` — the original (and still default) milestone kind. */
export interface BuildingMilestoneRequirement {
    type: 'building';
    buildingId: BuildingId;
    level: number;
}

/** The player must own at least one `item` — see ItemStorage.hasCount(). Met the instant ANY craft table (or future source) hands out that item, not tied to one specific table's id. Covers "have a tool" (axe, pickaxe, ...). */
export interface ItemMilestoneRequirement {
    type: 'item';
    item: ItemType;
}

/** The player must currently be holding AT LEAST `amount` of `resourceType` — see BackpackStorage.getCount(). Unlike ItemMilestoneRequirement (crafted goods, never spent by BackpackStorage itself), this reads the backpack's live count, so it can become UN-met again if the player later spends the resource — callers that want a one-way "ever reached this much" milestone instead should gate on an item/building, not this. */
export interface ResourceMilestoneRequirement {
    type: 'resource';
    resourceType: ResourceType;
    amount: number;
}

/** `gateId` must already be UNLOCKED — see GateStorage.isUnlocked(). Lets one gate's own unlock double as another zone/queue/shop's own appear/reveal condition, e.g. "zone2 opens once gate1 is passed" — added for ZoneTypes.ts's own per-zone unlock requirement (see that file's own doc), which needed a milestone kind referencing a gate; nothing else required this until then. */
export interface GateMilestoneRequirement {
    type: 'gate';
    gateId: GateId;
}

export type MilestoneRequirement = BuildingMilestoneRequirement | ItemMilestoneRequirement | ResourceMilestoneRequirement | GateMilestoneRequirement;

/** True once whichever storage backs `requirement`'s own kind says it's already satisfied — the one place that actually reads BuildingStorage/ItemStorage/BackpackStorage/GateStorage for this; callers (Gate.isRequirementMet(), RequirementRegistry, WorldManager's zone-unlock check) never touch any of those directly. */
export function isMilestoneRequirementMet(requirement: MilestoneRequirement): boolean {
    switch (requirement.type) {
        case 'building':
            return BuildingStorage.getLevel(requirement.buildingId) >= requirement.level;
        case 'item':
            return ItemStorage.hasCount(requirement.item, 1);
        case 'resource':
            return BackpackStorage.getCount(requirement.resourceType) >= requirement.amount;
        case 'gate':
            return GateStorage.isUnlocked(requirement.gateId);
    }
}
