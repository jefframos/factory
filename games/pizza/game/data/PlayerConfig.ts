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
}

const DEFAULT_PLAYER_CONFIG: PlayerConfigEntry = {
    walkSpeed: 5,
    runSpeedMultiplier: 1.8,
    resourceDetectionRadius: 3,
    resourceDetectionAngleDeg: 120,
};

export const PLAYER_CONFIG_BY_ID: Partial<Record<string, PlayerConfigEntry>> = {
    default: { ...DEFAULT_PLAYER_CONFIG },
};

/** The live player-balance config — always PLAYER_CONFIG_BY_ID.default, falling back to the hand-authored default if a designer ever deletes that entry via the web editor instead of just editing it in place. */
export function getPlayerConfig(): PlayerConfigEntry {
    return PLAYER_CONFIG_BY_ID.default ?? DEFAULT_PLAYER_CONFIG;
}
