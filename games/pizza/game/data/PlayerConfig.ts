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
};

export const PLAYER_CONFIG_BY_ID: Partial<Record<string, PlayerConfigEntry>> = {
    default: { ...DEFAULT_PLAYER_CONFIG },
};

/** The live player-balance config — always PLAYER_CONFIG_BY_ID.default, falling back to the hand-authored default if a designer ever deletes that entry via the web editor instead of just editing it in place. */
export function getPlayerConfig(): PlayerConfigEntry {
    return PLAYER_CONFIG_BY_ID.default ?? DEFAULT_PLAYER_CONFIG;
}
