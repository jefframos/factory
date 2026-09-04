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
// use3dArrow lives at the CONFIG level (one per zone), not per-step — nothing today needs a
// mid-tutorial arrow-STYLE (2D vs 3D) switch. arrowTextureId ALSO lives at the config level as
// the tutorial's overall fallback icon, but each step can override it via its own
// `iconTextureId` — a multi-step tutorial commonly wants a different icon per step (e.g. an axe
// icon while gathering wood, then a hammer icon while crafting), so the override is per-step
// while the config-level value stays as the "good enough for every step that doesn't care" base.
//
// `offset` is a per-step 3D world-space nudge applied ON TOP of whatever position the step's
// own target already resolves to (a gather ResourceNode, or a deliver craft table/gate/trigger's
// placed location — see ZoneTutorialController.resolveStepOffset()) — same `[x, y, z]` tuple
// shape (and editor 'vector3' field) EntityViewRegistry.ts's own `offset` already uses, not a
// plain `{x,y,z}` object. Optional; an unset step behaves exactly as if it were `[0, 0, 0]`.

import { GateId } from '../data/GateTypes';

export interface ZoneTutorialCraftStep {
    kind: 'craft';
    /** A CraftTypes.ts CRAFT_CONFIG_BY_ID key — see ZoneTutorialController's own doc for how its required (resourceType, amount) and completion are resolved. */
    craftId: string;
    /** See this file's own top-of-file doc on why this lives per-step. Optional — ZoneTutorialController falls back to the config's own arrowTextureId (then DEFAULT_ARROW_TEXTURE_ID) when unset. */
    iconTextureId?: string;
    /** See this file's own top-of-file doc on `offset`. Optional — unset behaves as `[0, 0, 0]`. */
    offset?: [number, number, number];
}

export interface ZoneTutorialGateStep {
    kind: 'gate';
    /** A GateTypes.ts GateId — ONLY a gate whose own `requirement` is a 'resource' kind is actually usable here (see ZoneTutorialController's own doc); any other requirement kind is skipped gracefully with a console.warn. */
    gateId: GateId;
    /** See ZoneTutorialCraftStep.iconTextureId's own doc — same per-step override, same fallback chain. */
    iconTextureId?: string;
    /** See this file's own top-of-file doc on `offset`. Optional — unset behaves as `[0, 0, 0]`. */
    offset?: [number, number, number];
}

export interface ZoneTutorialTriggerStep {
    kind: 'trigger';
    /** A TriggerTypes.ts TRIGGER_CONFIG_BY_ID key AND the matching Tiled "trigger" object's own id (see WorldObjectRegistry.ts) — the arrow points at that placed volume's location until TriggerStorage marks it activated. No resource/amount to resolve at all, unlike the other two kinds. */
    triggerId: string;
    /** See ZoneTutorialCraftStep.iconTextureId's own doc — same per-step override, same fallback chain. */
    iconTextureId?: string;
    /** See this file's own top-of-file doc on `offset`. Optional — unset behaves as `[0, 0, 0]`. */
    offset?: [number, number, number];
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
     * When true, this zone's tutorial ADDITIONALLY points a real 3D world-space arrow orbiting
     * the player (ZoneTutorial3dArrow.ts) — on top of, not instead of, the default flat
     * screen-space overlay (ZoneTutorialArrow.ts, always on regardless of this flag) — see
     * ZoneTutorialController's own doc on updateArrow()/hideArrow(), the one pair of call sites
     * that drives both together. Optional; defaults to false (screen-space only).
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
                "triggerId": "walkTutorialTrigger",
                "offset": [
                    0,
                    -2,
                    0
                ]
            }
        ],
        // Placeholder — 'pointer' is a real frame in ui.webp's atlas (confirmed against
        // public/pizza/images/ui.webp.json), unlike the previous 'Icon_Up_Green' guess, which
        // wasn't an actual frame name (only 'Slider_Level02_Icon_Up_Green', ShopTypes.ts's own
        // slider sub-icon, contains that substring) — PIXI.Texture.from() silently falls back
        // to treating an unknown key as an image URL, so that guess 404'd instead of erroring
        // loudly. Swap for a real compass-arrow asset once one exists.
        arrowTextureId: "tutorialHand2",
        use3dArrow: true,
    },
    "1": {
        "steps": [
            {
                "kind": "craft",
                "craftId": "craftAxe",
                "offset": [
                    0,
                    0,
                    0
                ],
                "iconTextureId": "tutorialHand2"
            },
            {
                "kind": "gate",
                "gateId": GateId.GateAxe,
                "offset": [
                    0,
                    0,
                    0
                ],
                "iconTextureId": "woodcutters-axe"
            },
            {
                "kind": "gate",
                "gateId": GateId.GateWood,
                "offset": [
                    0,
                    0,
                    0
                ],
                "iconTextureId": "woodcutters-axe"
            }
        ],
        "arrowTextureId": "woodcutters-axe",
        "use3dArrow": true
    },
    "2": {
        "steps": [
            {
                "offset": [
                    0,
                    0,
                    0
                ],
                "craftId": "craftPickaxe",
                "iconTextureId": "tutorialHand2",
                "kind": "craft"
            }
        ],
        "use3dArrow": true
    },
    "4": {
        "steps": []
    },
    "3": {
        "steps": []
    },
    "10": {
        "steps": []
    }
};

export function getZoneTutorialConfig(zoneNumber: number): ZoneTutorialConfig | undefined {
    return ZONE_TUTORIAL_CONFIG[zoneNumber];
}
