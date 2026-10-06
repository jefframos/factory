// DemoTypes.ts
//
// End of the demo: once `endRequirement` is met (today: the store's deposit room is built), an
// "end of the demo" popup shows — once per save (DemoStorage.ts). It waits for whatever met the
// requirement to finish playing first (a build's animation/camera trip — see PizzaScene's
// updateDemoEnd()), then `delaySec` more. The game stays playable after it's closed.
//
// Same one-"default"-entry record shape as PlayerConfig.ts. Edited from the pizza web editor's
// Demo tab.

import type { MilestoneRequirement } from './MilestoneRequirement';
import { BuildingId } from './BuildingId';

export interface DemoConfigEntry {
    /** Met = the demo is over. Unset = the demo never ends. */
    endRequirement?: MilestoneRequirement;
    /** Seconds after the requirement is met (and the player can move again) before the popup shows. Unset = 0. */
    delaySec?: number;
    /** Popup title. */
    title: string;
    /** Popup body text. */
    message: string;
    /** When true, no end-of-demo popup at all. */
    disabled?: boolean;
}

export const DEMO_CONFIG_BY_ID: Partial<Record<string, DemoConfigEntry>> = {
    "default": {
        "endRequirement": {
            "type": "building",
            "buildingId": BuildingId.StoreRoom2,
            "level": 1
        },
        "delaySec": 1,
        "title": "End of the Demo",
        "message": "Thanks for playing! You've reached the end of the demo. More is coming soon!"
    }
};

/** The one config the game uses — the "default" entry. */
export function getDemoConfig(): DemoConfigEntry | undefined {
    return DEMO_CONFIG_BY_ID.default;
}
