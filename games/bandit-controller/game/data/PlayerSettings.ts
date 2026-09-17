// PlayerSettings.ts
//
// Single source of truth for the player's own tunable numbers — speed,
// jump, and the one-shot action durations — read LIVE by MainPlayer/
// PlayerMovementController/SwipeRunnerController/CharacterVisualComponent,
// so editing these (by hand, or via the dev-GUI sliders in ControllerScene
// — ?dev in the URL) takes effect immediately with no rebuild.

export interface PlayerSettings {
    /** Base ground speed, world units/second, while not sprinting. */
    walkSpeed: number;
    /** Multiplied onto walkSpeed while sprinting/running (see ThirdPersonCharacter.getMoveSpeed(true)) — also the constant pace used for both runner modes' automatic forward movement. */
    runSpeedMultiplier: number;
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
    jumpSpeed: 11,
    rollDuration: 0.6,
    slideDuration: 0.6,
    collectTargetHeight: 1.5,
};
