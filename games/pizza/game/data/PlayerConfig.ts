// PlayerConfig.ts
//
// Global player-balance knobs, editable from the web editor's Player tab —
// movement speed, and the resource-detection radius/cone that replaces
// "the player must physically stand inside the resource's own trigger box"
// gathering (see AutoGatherController.ts's own doc for the full before/
// after). Reuses ShopTypes.ts/ToolRegistry.ts's own open-ended
// Partial<Record<string, ...>> convention for editor-managed data — even
// though there's only ever meant to be ONE entry here ("default") — purely
// so this needed zero new editor-side plumbing (a brand-new "singleton"
// entity kind in entityMap.mjs/syncToSource.mjs/app.js) beyond one more
// `partialRecord` mapping, identical to how shops/tools/crafting already
// work. getPlayerConfig() is the one read path everything else should use.

/**
 * The idle/run/jump state graph's own clip bindings (see CharacterBody.setUp()) — each field
 * is a clip id that must match one of `MODELS.Characters`' own keys (modelsRegistry.ts), e.g.
 * "Idle", "Walking", "Running", "JumpingUp", "FallingIdle", "Landing", "Talking", "Excited".
 * NPCs reusing CharacterBody (see that file's own doc) read this same table so a quest giver's
 * idle/walk/talk/happy poses stay in lockstep with the player's without hand-editing code —
 * see CharacterBody.setUp()'s own doc for how `walk`/`talk`/`happy` slot into the board.
 */
export interface PlayerAnimationConfig {
    idle: string;
    walk: string;
    run: string;
    jumpUp: string;
    falling: string;
    landing: string;
    /** Played while a quest giver NPC is offering/explaining a task — see QuestGiverTypes.ts. Unused by the player's own board today. */
    talk: string;
    /** Played once on task completion/delivery (give/deliver) — see QuestGiverTypes.ts. Unused by the player's own board today. */
    happy: string;
}

/**
 * The player's CARRIER — the prop mounted on the rig's Chest bone that the carry stack sits in
 * (see CharacterBody.mountCarrier()). Not to be confused with the "backpack" inventory
 * (BackpackStorage / the backpack popup). How much it holds is the Carrier TOOL's own capacity,
 * upgraded at the carrier shop — see data/CarrierCapacity.ts. Units match the old placeholder cube's: character-RIG units,
 * i.e. before MainPlayer's CHARACTER_SCALE (0.0075) shrinks the whole character — so 100 here is
 * ~0.75 world units. The holder cancels the Chest bone's own inherited scale, so these are true
 * rig units regardless of how the FBX's bones happen to be scaled.
 */
/**
 * How CarrierStackVisual lays carried items out in the carrier:
 *   - 'grid':  a 3x3 grid per layer inside the crate, a few layers deep, peeking over the rim.
 *   - 'tower': one item per level, stacked straight up out of the crate — bigger and much more
 *              visible from a distance (the classic hyper-casual "carry stack").
 * Switchable live from the dev GUI's Carrier folder for play-testing both.
 */
export type CarrierStackMode = 'grid' | 'tower';

export interface PlayerCarrierConfig {
    /**
     * MODELS "Group.Key" dot-paths (e.g. "Restaurant.Crate" — same form the web editor's model
     * picker stores), resolved at runtime via ModelSnapshotTool.resolveModelDef(), same
     * "string ref, not an AST MODELS.* expression" convention `animations` below uses. Only the
     * first entry is used. Empty (or an unknown ref) falls back to the old brown placeholder cube.
     */
    models: string[];
    /** Offset from the Chest bone's origin, rig units — see this interface's own doc. -z reads as "behind the character" on this rig. */
    offset: { x: number; y: number; z: number };
    /** Local rotation, degrees (XYZ euler), applied to the model only (not the offset). */
    rotationDeg: { x: number; y: number; z: number };
    /** Uniform scale on the model's own native size (Restaurant.Crate is 2 x 0.8 x 2 units, pivot at its bottom-center, so 40 -> an 80 x 32 x 80 rig-unit crate). Ignored by the placeholder cube. */
    scale: number;
    /** How carried items pile up in it — see CarrierStackMode's own doc. */
    stackMode: CarrierStackMode;
    /**
     * Multiplier on each carried item's real world size (see ResourceDisplayModel.ts), applied on
     * the stack AND during its flight onto it, so nothing pops size on landing. 1 = exactly the
     * resource's own world size; bump it if the pile reads too small on the character. Live-tunable
     * from the dev GUI's Carrier folder. Optional — missing means 1.
     */
    itemScale?: number;
    /**
     * Optional fixed yaw (degrees) for every carried item — e.g. carrots all lying the same way. Also
     * turns off the tower's small sideways wobble, so the stack is perfectly straight. Unset = the
     * natural scattered look. Live on the next stack change.
     */
    itemYawDeg?: number;
}

export interface PlayerConfigEntry {
    /** Base ground speed, world units/second, while not sprinting — read into ThirdPersonCharacter's own CharacterConfig (see MainPlayer.loadCharacter()). */
    walkSpeed: number;
    /** Multiplied onto walkSpeed while sprinting — see ThirdPersonCharacter.getMoveSpeed(true). */
    runSpeedMultiplier: number;
    /**
     * Max world-units distance AutoGatherController will notice a resource node from at all —
     * this IS "how close the player needs to be," replacing the old fixed physical trigger-box
     * requirement with a tunable radius (see AutoGatherController.ts's own doc).
     */
    resourceDetectionRadius: number;
    /**
     * Full aperture, in degrees, of the "in front of the player" cone AutoGatherController
     * targets within — of every in-range, available, tool-owned resource, the NEAREST one whose
     * direction from the player falls inside this cone (symmetric around the player's own
     * current facing) is what gets auto-gathered. A resource sitting in range but off to the
     * side/behind is noticed (see missing-tool notifications) but never auto-targeted until the
     * player turns toward it.
     */
    resourceDetectionAngleDeg: number;
    /**
     * vars.speed at/below which the board sits in "idle" (see CharacterBody.setUp()). vars.speed
     * is `Math.hypot(moveInputX, moveInputZ)` — the RAW analog stick magnitude (0 = centered, 1 =
     * fully deflected), not a world-units/sec speed, so this is a near-zero deadzone, not a fraction
     * of walkSpeed.
     */
    idleToWalkSpeed: number;
    /**
     * vars.speed at/above which the board switches from "walk" to "run" — since the stick is
     * analog, this is the normalized 0-1 fraction of full deflection (e.g. 0.75 = "run once the
     * stick is pushed past 75% of the way to the edge"), not a world-units/sec speed. Must be
     * greater than idleToWalkSpeed and at most 1. See CharacterBody.setUp().
     */
    walkToRunSpeed: number;
    /** The idle/run/jump board's clip bindings — see PlayerAnimationConfig's own doc. */
    animations: PlayerAnimationConfig;
    /** What's mounted on the player's back — see PlayerCarrierConfig's own doc. */
    carrier: PlayerCarrierConfig;
    /**
     * When true, harvesting a farm cell flies its yield straight onto the top of the player's
     * carry stack (see FlyToStack.ts / CarrierStackVisual.ts), limited by the carrier's capacity (data/CarrierCapacity.ts) —
     * instead of being banked into BackpackStorage instantly with a "+N" popup. Either way the
     * items end up in BackpackStorage (so anything that consumes crops keeps working); this only
     * changes HOW they get there, and whether the stack limit applies.
     */
    harvestIntoStack: boolean;
}

const DEFAULT_PLAYER_CONFIG: PlayerConfigEntry = {
    walkSpeed: 5,
    runSpeedMultiplier: 1.8,
    resourceDetectionRadius: 3,
    resourceDetectionAngleDeg: 120,
    idleToWalkSpeed: 0.01,
    walkToRunSpeed: 0.75,
    animations: {
        idle: 'Idle',
        walk: 'Walking',
        run: 'Running',
        jumpUp: 'JumpingUp',
        falling: 'FallingIdle',
        landing: 'Landing',
        talk: 'Talking',
        happy: 'Excited',
    },
    carrier: {
        models: ['Restaurant.Crate'],
        offset: { x: 0, y: -20, z: -50 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: 40,
        stackMode: 'grid',
        itemScale: 1.5,
    },
    harvestIntoStack: true,
};

export const PLAYER_CONFIG_BY_ID: Partial<Record<string, PlayerConfigEntry>> = {
    default: {
        ...DEFAULT_PLAYER_CONFIG,
        "walkSpeed": 5,
        "runSpeedMultiplier": 1.8,
        "resourceDetectionRadius": 2,
        "resourceDetectionAngleDeg": 120,
        "idleToWalkSpeed": 0.01,
        "walkToRunSpeed": 0.75,
        "animations": {
            "idle": "Idle",
            "walk": "Walking",
            "run": "Running",
            "jumpUp": "JumpingUp",
            "falling": "FallingIdle",
            "landing": "Landing",
            "talk": "Talking",
            "happy": "Excited"
        },
        "carrier": {
            "models": [
                "Restaurant.Crate"
            ],
            "offset": {
                "x": 0,
                "y": -20,
                "z": -50
            },
            "rotationDeg": {
                "x": 0,
                "y": 0,
                "z": 0
            },
            "scale": 40,
            "stackMode": "tower",
            "itemScale": 1.5,
            "itemYawDeg": 0
        },
        "harvestIntoStack": true
    },
};

/** The live player-balance config — always PLAYER_CONFIG_BY_ID.default, falling back to the hand-authored default if a designer ever deletes that entry via the web editor instead of just editing it in place. */
export function getPlayerConfig(): PlayerConfigEntry {
    return PLAYER_CONFIG_BY_ID.default ?? DEFAULT_PLAYER_CONFIG;
}
