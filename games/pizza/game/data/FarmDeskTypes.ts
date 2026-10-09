// FarmDeskTypes.ts
//
// A FARM DESK — the farm manager NPC standing by a farm's gate, where the player buys farm
// upgrades (FarmUpgradeTypes.ts) through FarmUpgradesPopup. Same interaction as a store's hire
// desk: walk onto its spot -> a button appears -> tap it -> popup (store/FarmDeskZone.ts).
//
// On the Tiled map: a "type=farmDesk" rect with an id on a mapSettings layer — the NPC stands at
// its center — plus an optional "dropper" targeting that id: where the player stands to talk to
// it (else the desk rect itself). A store level can list the desk under `enables` too.
//
// Same {default, byId} shape as StorageTypes.ts. Edited from the pizza web editor's Farm Desks tab.

import type { MilestoneRequirement } from './MilestoneRequirement';

export interface FarmDeskConfig {
    /** Shown in the editor and as the popup's title. Optional. */
    name?: string;
    /** NPCs tab id of the farm manager. Unset = the shared worker look (WORKER_NPC_ID). */
    npcId?: string;
    /** The desk (and its NPC) appear once this is met. Unset = right away. */
    appearRequirement?: MilestoneRequirement;
    /** Label on the button that opens the popup. Unset = "Farms". */
    buttonLabel?: string;
    /** When true, this desk isn't spawned at all. */
    disabled?: boolean;
}

export const DEFAULT_FARM_DESK_CONFIG: FarmDeskConfig = {
    "name": "Farm Manager",
    "buttonLabel": "Farms"
};

export const FARM_DESK_CONFIG_BY_ID: Partial<Record<string, FarmDeskConfig>> = {
    "farmDesk1": {
        "name": "Farm Manager",
        "buttonLabel": "Farms"
    }
};

export function getFarmDeskConfig(id: string): FarmDeskConfig {
    return FARM_DESK_CONFIG_BY_ID[id] ?? DEFAULT_FARM_DESK_CONFIG;
}
