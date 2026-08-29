// ZoneTypes.ts
//
// Per-zone UNLOCK requirement — the piece that was missing for the fog-of-war/zone-lock
// system (see ZoneVisibilityManager.ts) to unlock a zone on its own instead of only through
// WorldManager's debug-only revealNextZone() ("Open Next Zone" button). Keyed by zoneNumber
// (0-based — the SAME number TileMapConfig.buildZoneTileCells() derives from a painted
// "zones" tile's local id; "zone1" in level-designer terms is zoneNumber 0), edited from the
// pizza web editor's Zones tab, right next to the Map tab.
//
// A zone with no entry here (or an entry with no `requirement` set) has no automatic unlock —
// it only ever opens via revealNextZone() or some other explicit call. `requirement` reuses
// the same MilestoneRequirement union every gate/building/shop/queue/craft-table's own
// appear/unlock condition already uses (see MilestoneRequirement.ts) — including its `gate`
// arm, added specifically so a zone can require another gate's own unlock (e.g. "zone2 opens
// once gate1 is passed"), alongside the existing building-level/item/resource kinds.

import { MilestoneRequirement } from './MilestoneRequirement';
import { ItemType } from "../crafting/ItemTypes";
import { GateId } from "./GateTypes";

export interface ZoneConfigEntry {
    requirement?: MilestoneRequirement;
}

/** zoneNumber -> its own config — see this file's own doc. Sparse: only zones a level designer has actually set a requirement for need an entry at all. */
export const ZONE_CONFIG: Partial<Record<number, ZoneConfigEntry>> = {
    "0": {
    },
    "1": {
        "requirement": {
            "type": "trigger",
            "triggerId": "walkTutorialTrigger"
        }
    },
    "2": {
        "requirement": {
            "type": "gate",
            "gateId": GateId.GateAxe
        }
    },
    "4": {
        "requirement": {
            "type": "gate",
            "gateId": GateId.Gate1
        }
    },
    "3": {
        "requirement": {
            "type": "item",
            "item": ItemType.Pickaxe
        }
    }
};
