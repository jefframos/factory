// PlayerSettings.ts
//
// Single source of truth for the player's own tunable numbers — speed,
// jump, and the one-shot action durations — read LIVE by MainPlayer/
// PlayerMovementController/SwipeRunnerController/CharacterVisualComponent,
// so editing these (by hand, or via the dev-GUI sliders HubScene wires up
// — ?dev in the URL) takes effect immediately with no rebuild, in
// whichever scene is currently active (this is a plain module-level
// object, not a per-scene copy).

export interface PlayerSettings {
    /** Base ground speed, world units/second, while not sprinting. */
    walkSpeed: number;
    /** Multiplied onto walkSpeed while sprinting/running (see ThirdPersonCharacter.getMoveSpeed(true)) — also the constant pace used for both runner modes' automatic forward movement. */
    runSpeedMultiplier: number;
    slideMultiplier: number;
    rollMultiplier: number;
    /** Vertical launch speed applied to the RigidBody on jump, world units/second — with WorldSettings.gravity = -20 this reaches an apex of jumpSpeed^2 / (2 * 20) world units up. */
    jumpSpeed: number;
    /** How long the roll/dodge animation's "rolling" state lasts before the animator is free to transition back to idle/walk/run. */
    rollDuration: number;
    /** How long the slide animation's "sliding" state lasts (swipe-down, see SwipeRunnerController). */
    slideDuration: number;
    /** World-units above `transform.position` (feet level) that world pickups (Collectible) aim for — see MainPlayer.getCollectTargetPosition(). Roughly body-center rather than the ground, so a collected item flies to the player's chest instead of their feet. */
    collectTargetHeight: number;
}

export const PLAYER_SETTINGS: PlayerSettings = {
    walkSpeed: 5,
    runSpeedMultiplier: 1.8,
    slideMultiplier: 1.2,
    rollMultiplier: 1.2,
    jumpSpeed: 11,
    rollDuration: 0.6,
    slideDuration: 0.6,
    collectTargetHeight: 1.5,
};

/**
 * Pure function of PLAYER_SETTINGS — deliberately NOT a method on
 * ThirdPersonCharacter/CharacterBody (see ThirdPersonCharacter.getMoveSpeed(),
 * which just delegates here), since MainPlayer wires this straight into
 * PlayerMovementController/SwipeRunnerController's constructors and both
 * need a real speed value from the very first fixedUpdate() tick — well
 * before loadCharacter()'s FBX/animation load resolves. The two runner
 * modes force `sprinting: true` for their whole constant automatic forward
 * pace, so gating this behind the loaded character (the old `this.
 * thirdPersonCharacter?.getMoveSpeed(sprinting) ?? 0` pattern) meant a
 * runner scene's player sat frozen at the start line until the character
 * finished loading.
 */
export function getPlayerMoveSpeed(sprinting: boolean): number {
    return sprinting ? PLAYER_SETTINGS.walkSpeed * PLAYER_SETTINGS.runSpeedMultiplier : PLAYER_SETTINGS.walkSpeed;
}
