// BuildingTypes.ts
//
// Data-driven definition of a building's upgrade ladder — same philosophy as
// ResourceTypes.ts's RESOURCE_CONFIG: BuildingZone/BuildingStorage read this
// instead of hardcoding per-building/per-level branches, so a new building or
// an extra level is just a new config entry.
//
// Each level is a rung on the ladder: `requirements` is what must be
// deposited (on top of whatever the previous rungs already consumed) to
// clear that level, and `effect` is what the building actually DOES once
// that level completes — data only for now (nothing reads `effect` yet),
// but shaped so a future gameplay system can key off `type` without this
// file changing again.

import * as PIXI from 'pixi.js';
import { ResourceType } from '../actions/ResourceTypes';
import { MilestoneRequirement } from './MilestoneRequirement';
import { PopupMode } from '../ui/PopupConfig';
import { FrameName } from '../ui/FrameRegistry';
import { ToolId } from '../actions/ToolRegistry';

export enum BuildingId {
    Camp = "tower",
    Tower2 = "tower2",
    Floor1 = "floor1"
}

export interface BuildingEffect {
    /** Machine-readable effect kind — the hook point for whatever system eventually applies this (e.g. 'backpackCapacity', 'gatherSpeed'). Nothing reads this yet. */
    type: string;
    /** Magnitude of the effect — units depend on `type` (a flat capacity bump, a percentage multiplier, ...). */
    value: number;
    /** Human-readable summary for UI — e.g. "+5 backpack capacity". */
    description: string;
}

/**
 * Placeholder box art for a building at a given level — same "plain colored primitive until
 * real art exists" convention as ResourceConfig.color/solidRadius. Plain numbers (not
 * THREE.Vector3) so this data file stays engine-import-free, same as ResourceTypes.ts/
 * BuildingTypes.ts's other configs — BuildingZone is the one place that turns this into an
 * actual THREE.BoxGeometry.
 */
export interface BuildingMeshConfig {
    /** [width, height, depth], world units. */
    size: [number, number, number];
    color: number;
}

export interface BuildingLevelConfig {
    /** 1-based — matches BuildingStorage's persisted `level` once this rung is cleared. */
    level: number;
    /** Resources needed to clear this level, deposited via BuildingZone. */
    requirements: Partial<Record<ResourceType, number>>;
    effect: BuildingEffect;
    /** What the building looks like once THIS level is cleared — see getMeshConfigForLevel(). */
    mesh: BuildingMeshConfig;
    /** Optional real-mesh override for this level, keyed into EntityViewRegistry.ts's ENTITY_VIEW_CONFIG — set from the pizza web editor's Map/Entities tabs. When set (and the view actually has a model — see resolveEntityView()), BuildingZone swaps its box placeholder for this glb instead; undefined keeps the box (`mesh` above), unchanged from before this field existed. */
    view?: string;
    /** Forces this level's reveal sweep (see BuildingZone.playRevealEffect()) to its full 100% fill regardless of where this level sits within a run of consecutive levels sharing the same `view`/mesh — see getFillFractionForLevel()'s own doc. undefined/false uses the computed run-position fraction instead, unchanged from before this field existed. */
    fillFull?: boolean;
}

export interface BuildingConfig {
    name: string;
    /** Texture alias (packed 'images'/'ui' bundle) representing this building elsewhere in the UI — e.g. GateConfig's own requirement icon, for a gate whose requirement is reaching one of this building's levels (see Gate.ts's resolveRequirementIcon()). Optional — getBuildingIcon() falls back to a blank white square, same "icon-optional, blank fallback" convention as AssetLibraryEntry.icon. */
    icon?: string;
    /**
     * ToolRegistry id the player must own (checked via ItemStorage — see
     * ItemType/ToolId sharing the same string values, same cast idiom
     * AutoGatherController.hasRequiredTool() uses) before BuildingZone will let
     * them deposit into ANY level of this building at all. undefined means no
     * tool needed — unchanged deposit-on-approach behavior from before this
     * field existed. Checked once per fresh trigger overlap; while missing,
     * BuildingZone shows PlayerNotificationComponent's "missing tool" popup
     * instead of draining the backpack — see BuildingZone.tryDeposit().
     */
    requiredTool?: ToolId;
    /** What the building looks like before its first level is ever cleared (level 0) — a small foundation/stub, distinct from every subsequent level's own `mesh`. */
    baseMesh: BuildingMeshConfig;
    /** Optional real-mesh override for level 0 (before any level clears) — see BuildingLevelConfig.view's own doc. */
    baseView?: string;
    /** See BuildingLevelConfig.fillFull's own doc — same override, for level 0 (baseView) instead of a levels[] entry. */
    baseFillFull?: boolean;
    /**
     * 0-1 — how much of the base mesh's run (see getFillFractionForLevel()'s own doc) should
     * already read as "built" right from level 0, before a single unit's ever been deposited.
     * Only applies to a run that STARTS at level 0 (base and however many levels after it share
     * one mesh) — a later, genuinely different mesh's own run always starts filling from
     * scratch regardless of this. Every level within that run then grows LINEARLY from this
     * floor up to 1 at the run's last level (e.g. 0.1 with a 3-level run: level 0 -> 0.1,
     * level 1 -> 0.4, level 2 -> 0.7, level 3 -> 1) instead of the eased position/length curve
     * getFillFractionForLevel() uses elsewhere — a designer who's explicitly set this floor has
     * already made the "don't look empty at low levels" call themselves, so the extra easing
     * would just fight their own number. undefined (the default) leaves that run on the usual
     * eased curve, unchanged from before this field existed.
     */
    baseFillFraction?: number;
    /** Ordered ascending by `level` — BuildingStorage/BuildingZone index into this by `currentLevel` to find the next rung. */
    levels: BuildingLevelConfig[];
    /** Optional — when set, this building's BuildingZone isn't spawned at all (see PizzaScene.setupBuildingZone(), which registers it as a RequirementRegistry spawn gate) until MilestoneRequirement.ts's isMilestoneRequirementMet() says this is satisfied. Same shared requirement shape GateConfig.requirement/QueueConfig.appearRequirement use. undefined (the only case today — Camp is the very first building, nothing gates it) means "always appears." */
    appearRequirement?: MilestoneRequirement;
    /** Requirements-panel style — see PopupConfig.ts's own doc. undefined behaves as 'complete' (this building's existing title + resource-row panel), unchanged from before this field existed. */
    popupMode?: PopupMode;
    /** How high above this building's own base the requirements panel floats — see PopupConfig.ts's own doc. undefined/0 sits it right at the building's base instead of floating. */
    popupBobOffset?: number;
    /** Overrides FrameRegistry.ts's 'BuildingFrame' default for THIS building's own popup — see PopupConfig.ts's resolvePopupFrameName()'s own doc. undefined uses the type-wide default. */
    frame?: FrameName;
    /** 0-1 fraction of this building's own deposit-trigger footprint that becomes a SOLID collider blocking the player — see SolidArea.ts's own doc for the shared 0/1/0.5 semantics every provider/building/shop/craft-table/queue's `solid` field uses. undefined/0 (the default for every building until a designer opts one in) means no solid collider at all — unchanged walk-through behavior from before this field existed. Ignored when `solidFromMap` is set — see that field's own doc. */
    solid?: number;
    /**
     * When true, `solid` above is ignored entirely and BuildingZone instead builds ONE solid
     * collider PER "useOwnMesh" piece this building is drawn from (see
     * WorldObjectRegistry.OwnMeshPlacement.solid's own doc / BuildingZone.addSolidAreasFromMap()),
     * each sized to THAT piece's own drawn bounds (not the shared trigger footprint) and only
     * for pieces whose own map-drawn "solid" custom property is actually set — 1 for a collider
     * matching that piece's full bounds, 0.5 for half that size, same 0-1 fraction semantics as
     * `solid` above, just scoped per piece instead of to the whole building. Lets a composite
     * building assembled from several pieces sharing one id (e.g. separate wall and floor
     * pieces — see the multi-mesh support this building type already has) collide only on the
     * pieces a designer actually marked (the walls), leaving the rest (the floor) walk-through,
     * something one single whole-footprint `solid` fraction can't express. A building with no
     * "useOwnMesh" pieces at all has nothing to source per-piece solidity from — this flag then
     * just means "no solid collider," same as `solid: 0`. These colliders track the building's
     * OWN visibility, not just its spawn time — a piece with `solid` set still has no collider
     * for as long as its mesh itself isn't showing yet (e.g. a negative `baseFillFraction`
     * hiding everything before the first level clears — see that field's own doc), and gets one
     * the instant its mesh actually drops in. undefined/false (the default) keeps the single
     * `solid`-driven collider, unchanged from before this field existed.
     */
    solidFromMap?: boolean;
    /** Optional one-shot particle burst fired every time this building levels up (see BuildingZone.playLevelUpSequence()) — the "update" slot in the common particleEffectId/updateParticleEffectId/destroyParticleEffectId trio every entity config now carries (see ParticleRegistry.ts). undefined means no burst at all. */
    updateParticleEffectId?: string;
    /** How many particles the burst above launches — ignored if updateParticleEffectId isn't set. undefined falls back to a small default (see BuildingZone.playLevelUpSequence()). */
    updateParticleCount?: number;
    /**
     * When true, the requirements panel (both its persistent nameplate and the rising
     * "Level Up!" callout — see BuildingZone.spawnLevelUpPopup()) and the `updateParticleEffectId`
     * burst above all anchor to this building's own Tiled "dropper" (see
     * WorldObjectRegistry.ts's own doc / the BuildingZone constructor's `triggerArea` param
     * doc) instead of the building's own visual-mesh position — e.g. a building drawn
     * somewhere the player can't actually stand next to, whose real walk-up-and-deposit spot
     * (and so where their eyes/camera actually are when the feedback fires) is elsewhere on
     * the map entirely. Falls back to the mesh position when this building has no dropper at
     * all — nothing to switch to. Doesn't affect the visual mesh itself, or the camera-focus
     * point BuildingZone.playLevelUpSequence() sends the camera to on level-up, both of which
     * always stay at the mesh regardless. undefined/false (the default) keeps every one of
     * these at the mesh position, unchanged from before this field existed.
     */
    anchorAtDropper?: boolean;
}

export const BUILDING_CONFIG: Record<BuildingId, BuildingConfig> = {
    [BuildingId.Camp]: {
        name: "Tower",
        requiredTool: 'hammer',
        baseMesh: { size: [1, 0.6, 1], color: 0x8899aa },
        levels: [
            {
                level: 1,
                requirements: {
                    "wood": 5
                },
                effect: {
                    "type": "backpackCapacity",
                    "value": 5,
                    "description": "+5 backpack capacity"
                },
                mesh: { size: [1.4, 1.2, 1.4], color: 0x996633 }
            },
            {
                level: 2,
                requirements: {
                    "wood": 8,
                    "stone": 5
                },
                effect: {
                    "type": "backpackCapacity",
                    "value": 10,
                    "description": "+10 backpack capacity"
                },
                mesh: { size: [1.8, 1.8, 1.8], color: 0xcc8844 }
            },
            {
                "level": 3,
                "requirements": {
                    "stone": 1
                },
                "effect": {},
                mesh: { size: [1.8, 1.8, 1.8], color: 0xcc8844 }
            },
            {
                "level": 4,
                "requirements": {
                    "stone": 1
                },
                "effect": {},
                mesh: { size: [1.8, 1.8, 1.8], color: 0xcc8844 }
            },
            {
                "level": 5,
                "requirements": {
                    "stone": 1
                },
                "effect": {},
                mesh: { size: [1.8, 1.8, 1.8], color: 0xcc8844 }
            },
            {
                "level": 6,
                "requirements": {
                    "stone": 1
                },
                "effect": {},
                mesh: { size: [1.8, 1.8, 1.8], color: 0xcc8844 }
            }
        ],
        "popupMode": "simple",
        "icon": "campfire",
        "updateParticleEffectId": "gateMyst",
        "solid": 0.8,
        "baseFillFraction": 0.1
    },
    "tower2": {
        baseMesh: { size: [1, 0.6, 1], color: 0x8899aa },
        "name": "Tower2",
        requiredTool: 'hammer',
        "icon": "animal-hide",
        "levels": [{
            "level": 1,
            "requirements": {
                "stone": 1
            },
            "effect": {}
        },
        {
            "level": 2,
            "requirements": {
                "stone": 1
            },
            "effect": {}
        }
        ],
        "solid": 1,
        "popupMode": "simple",
        "updateParticleEffectId": "gateMyst",
        "baseFillFraction": 0.1
    },
    "floor1": {
        baseMesh: { size: [1, 0.6, 1], color: 0x8899aa },
        "name": "Tower2 Copy",
        requiredTool: 'hammer',
        "icon": "animal-hide",
        "levels": [{
            "level": 1,
            "requirements": {
                "stone": 1
            },
            "effect": {}
        }],
        "popupMode": "simple",
        "updateParticleEffectId": "gateMyst",
        "baseFillFraction": -1,
        "anchorAtDropper": true,
        "solidFromMap": true
    }
};

/** `undefined` once every level in the ladder is already cleared (see BuildingStorage.isMaxLevel()). */
export function getNextLevelConfig(id: BuildingId, currentLevel: number): BuildingLevelConfig | undefined {
    return BUILDING_CONFIG[id].levels[currentLevel];
}

/** The building's current look — baseMesh at level 0, otherwise that level's own mesh. See BuildingZone's mesh-swap on level-up. */
export function getMeshConfigForLevel(id: BuildingId, level: number): BuildingMeshConfig {
    const config = BUILDING_CONFIG[id];
    return level <= 0 ? config.baseMesh : (config.levels[level - 1]?.mesh ?? config.baseMesh);
}

/**
 * The building's current EntityViewRegistry id — this level's own `view` if it set one, else
 * whichever more RECENT level did (walking back down the ladder, not straight to `baseView` —
 * e.g. camp's level 3 sets no `view` of its own, so it keeps level 2's "tower2view" rather than
 * reverting to level 1's base look), else `baseView` if NO earlier level ever set one either.
 * undefined only when neither this level, any earlier level, nor baseView ever set a `view` —
 * "keep the box placeholder," same as before this fallback chain existed.
 */
export function getViewIdForLevel(id: BuildingId, level: number): string | undefined {
    const config = BUILDING_CONFIG[id];
    for (let l = Math.max(0, level); l > 0; l--) {
        const view = config.levels[l - 1]?.view;
        if (view) {
            return view;
        }
    }
    return config.baseView;
}

/**
 * How much of `level`'s mesh should be filled by BuildingZone's reveal sweep (see
 * BuildingZone.playRevealEffect()) — 1 (fully built) unless this level's own view id is shared
 * with adjacent levels (e.g. camp's level 1 and level 2 both resolving to "tower2view", the
 * SAME glb reused across a run of levels rather than a new mesh per level), in which case it's
 * this level's 1-based position within that run divided by the run's total length — so the
 * shared mesh visibly fills up a bit more with each level cleared instead of jumping straight
 * to 100% the moment it first appears, only reaching full at the run's last level. A level with
 * BuildingLevelConfig.fillFull (or BuildingConfig.baseFillFull for level 0) set overrides this
 * to 1 regardless of its run position — e.g. a designer wanting the very first appearance of a
 * base mesh to already read as "complete" before any upgrade fills a LATER mesh incrementally.
 */
export function getFillFractionForLevel(id: BuildingId, level: number): number {
    const config = BUILDING_CONFIG[id];
    const maxLevel = config.levels.length;
    const clampedLevel = Math.max(0, Math.min(level, maxLevel));

    if (clampedLevel === 0 ? config.baseFillFull : config.levels[clampedLevel - 1]?.fillFull) {
        return 1;
    }

    const viewId = getViewIdForLevel(id, clampedLevel);
    let start = clampedLevel;
    while (start > 0 && getViewIdForLevel(id, start - 1) === viewId) {
        start--;
    }
    let end = clampedLevel;
    while (end < maxLevel && getViewIdForLevel(id, end + 1) === viewId) {
        end++;
    }

    const runLength = end - start + 1;
    const positionInRun = clampedLevel - start + 1;
    const linearFraction = positionInRun / runLength;

    // A run starting at level 0 with an explicit baseFillFraction — see that field's own doc —
    // grows LINEARLY from that designer-chosen floor up to 1, instead of the eased curve below.
    // A NEGATIVE baseFillFraction is a separate designer sentinel, not just a lower floor: it
    // means "don't show any mesh at all until the first level clears" — level 0's own fraction
    // is forced to exactly 0 (BuildingZone.createBuildingMesh() skips building any visual at
    // all for a <= 0 fraction, rather than a thin near-invisible sliver) regardless of what the
    // raw linear formula below would otherwise compute for this run's length.
    if (start === 0 && config.baseFillFraction !== undefined) {
        if (config.baseFillFraction < 0 && clampedLevel === 0) {
            return 0;
        }
        return config.baseFillFraction + (1 - config.baseFillFraction) * linearFraction;
    }

    // A straight positionInRun/runLength reads as "basically nothing built" for an early level
    // in a long run (e.g. 1/6 = 17%) — sqrt() front-loads the perceptible growth (1/6 -> 41%,
    // 2/6 -> 58%, ...) while still landing exactly on 1 for the run's own last level, so a
    // level-up always visibly ADDS to the mesh without the first few rungs of a long run
    // looking like the building barely exists. MIN_VISIBLE_FILL_FRACTION is a floor on top of
    // that for a pathologically long run where even the eased curve would still start low.
    return Math.max(MIN_VISIBLE_FILL_FRACTION, Math.sqrt(linearFraction));
}

/** Floor under getFillFractionForLevel()'s eased run-position curve — see that function's own doc. Never lets even the very first level of a long shared-mesh run render as "basically invisible." */
const MIN_VISIBLE_FILL_FRACTION = 0.25;

/** `BUILDING_CONFIG[id]`'s icon, as an actual texture — see BuildingConfig.icon's own doc for the blank-fallback convention. */
export function getBuildingIcon(id: BuildingId): PIXI.Texture {
    const icon = BUILDING_CONFIG[id].icon;
    return icon ? PIXI.Texture.from(icon) : PIXI.Texture.WHITE;
}
