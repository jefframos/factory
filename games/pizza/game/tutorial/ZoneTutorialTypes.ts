// ZoneTutorialTypes.ts
//
// Per-zone, ordered tutorial: an array of steps the player is walked through one at a time
// while standing in that zone, each step pointing a screen-space arrow (see
// ZoneTutorialArrow.ts) at whatever they still need to go do next — gather a resource, then
// deliver it to the craft table/gate that's actually waiting on it (see
// ZoneTutorialController.ts's own doc for the full gather/deliver state machine). Keyed by
// zoneNumber, same 0-based convention ZoneTypes.ts's own ZONE_CONFIG uses ("zone1" in
// level-designer terms is zoneNumber 0 — see that file's own doc).
//
// No generic "requirement" plumbing of its own — a 'craft'/'gate' step resolves its OWN
// (resourceType, amount) from whatever real system it's already pointing at (a craft table's
// recipe cost, a gate's resource requirement), rather than duplicating that data here. See
// ZoneTutorialController.resolveStepRequirement() for how each kind resolves, including the
// "primary recipe"/"resource-only gate" simplifications documented there. A 'trigger' step is
// simpler still — no resource to gather at all, just "walk here" — see
// ZoneTutorialController's own doc for why it skips the gather/deliver phase machinery
// entirely.
//
// arrowTextureId/use3dArrow live at the CONFIG level (one per zone), not per-step — a zone's
// tutorial is one guided flow with one arrow style throughout; nothing today needs a
// mid-tutorial style switch, and per-step would just mean repeating the same value on every
// entry.

import { GateId } from '../data/GateTypes';

export interface ZoneTutorialCraftStep {
    kind: 'craft';
    /** A CraftTypes.ts CRAFT_CONFIG_BY_ID key — see ZoneTutorialController's own doc for how its required (resourceType, amount) and completion are resolved. */
    craftId: string;
}

export interface ZoneTutorialGateStep {
    kind: 'gate';
    /** A GateTypes.ts GateId — ONLY a gate whose own `requirement` is a 'resource' kind is actually usable here (see ZoneTutorialController's own doc); any other requirement kind is skipped gracefully with a console.warn. */
    gateId: GateId;
}

export interface ZoneTutorialTriggerStep {
    kind: 'trigger';
    /** A TriggerTypes.ts TRIGGER_CONFIG_BY_ID key AND the matching Tiled "trigger" object's own id (see WorldObjectRegistry.ts) — the arrow points at that placed volume's location until TriggerStorage marks it activated. No resource/amount to resolve at all, unlike the other two kinds. */
    triggerId: string;
}

export type ZoneTutorialStep = ZoneTutorialCraftStep | ZoneTutorialGateStep | ZoneTutorialTriggerStep;

export interface ZoneTutorialConfig {
    /** Walked through in order, one at a time — see TutorialProgressStorage.ts for how far along a given zone's player already is. */
    steps: ZoneTutorialStep[];
    /**
     * A bare packed UI-icon texture name (same "no path/bundle/extension, just the name"
     * convention Gate.ts's own lock/badge icons use — resolved via PIXI.Texture.from(), not
     * getAssetIcon(), since this isn't an AssetLibraryKey), shown as the guiding arrow's
     * sprite. Optional (same reasoning as ZONE_CONFIG.requirement's own optionality — the
     * Zone Tutorial tab auto-discovers a bare `{steps: []}` entry for every zoneNumber painted
     * on the map, whether or not a designer has configured a real tutorial for it yet) —
     * ZoneTutorialController falls back to DEFAULT_ARROW_TEXTURE_ID when unset.
     */
    arrowTextureId?: string;
    /**
     * Placeholder for a future real 3D world-space arrow (e.g. a floating indicator hovering
     * over the actual target in 3D, rather than a flat screen-space overlay) — NOT implemented
     * yet, see ZoneTutorialController's own hook. The screen-space arrow (ZoneTutorialArrow.ts)
     * always renders regardless of this flag's value. Optional, same reasoning as
     * arrowTextureId above; defaults to false (screen-space only).
     */
    use3dArrow?: boolean;
}

/** ZoneTutorialConfig.arrowTextureId's fallback when a zone's auto-discovered entry hasn't set one yet — see that field's own doc. */
export const DEFAULT_ARROW_TEXTURE_ID = 'pointer';

/**
 * zoneNumber -> its own tutorial config — sparse, same "only a level designer's actually
 * configured entries show up" convention ZoneTypes.ts's ZONE_CONFIG uses. Seed data below
 * mirrors the very first moments of the game: gather bark, craft the starter axe (see
 * CraftTypes.ts's "craftAxe" table), then gather wood and feed GateId.GateAxe's own
 * resource requirement (5 wood — see GateTypes.ts; despite the "Axe" name/doc comment, this
 * gate's actual requirement field is resource/wood/5, which is exactly what makes it usable
 * as a tutorial 'gate' step at all).
 */
export const ZONE_TUTORIAL_CONFIG: Partial<Record<number, ZoneTutorialConfig>> = {
    "0": {
        steps: [
            {
                "kind": "trigger",
                "triggerId": "walkTutorialTrigger"
            }
        ],
        // Placeholder — 'pointer' is a real frame in ui.webp's atlas (confirmed against
        // public/pizza/images/ui.webp.json), unlike the previous 'Icon_Up_Green' guess, which
        // wasn't an actual frame name (only 'Slider_Level02_Icon_Up_Green', ShopTypes.ts's own
        // slider sub-icon, contains that substring) — PIXI.Texture.from() silently falls back
        // to treating an unknown key as an image URL, so that guess 404'd instead of erroring
        // loudly. Swap for a real compass-arrow asset once one exists.
        arrowTextureId: "arrow-down",
        use3dArrow: false,
    },
    "1": {
        "steps": [
            {
                "kind": "craft",
                "craftId": "craftAxe"
            },
            {
                "kind": "gate",
                "gateId": GateId.GateAxe
            }
        ],
        "arrowTextureId": "arrow-down"
    },
    "2": {
        "steps": []
    },
    "4": {
        "steps": []
    },
    "3": {
        "steps": []
    }
};

export function getZoneTutorialConfig(zoneNumber: number): ZoneTutorialConfig | undefined {
    return ZONE_TUTORIAL_CONFIG[zoneNumber];
}
