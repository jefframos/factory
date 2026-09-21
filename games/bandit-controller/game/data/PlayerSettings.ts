// PlayerSettings.ts
//
// Single source of truth for the player's own tunable numbers — speed,
// jump, and the one-shot action durations — read LIVE by MainPlayer/
// PlayerMovementController/SwipeRunnerController/CharacterVisualComponent,
// so editing these (by hand, or via the dev-GUI sliders HubScene wires up
// — ?dev in the URL) takes effect immediately with no rebuild, in
// whichever scene is currently active (this is a plain module-level
// object, not a per-scene copy).

import * as THREE from 'three';

export interface PlayerSettings {
    /** Base ground speed, world units/second, while not sprinting. */
    walkSpeed: number;
    /** Multiplied onto walkSpeed while sprinting/running (see ThirdPersonCharacter.getMoveSpeed(true)) — also the constant pace used for both runner modes' automatic forward movement. */
    runSpeedMultiplier: number;
    slideMultiplier: number;
    rollMultiplier: number;
    /**
     * Vertical launch speed applied to the RigidBody on jump, world units/second — apex
     * height = jumpSpeed^2 / (2 * |WorldSettings.gravity|) world units up. With
     * WorldSettings.gravity = -30, 16.4 gives an apex of ~4.48 — enough to land directly on
     * top of a TRAIN (height 4, see MinigameSettings.OBSTACLE_KINDS) from a standing jump,
     * with a little margin, not just clip its edge.
     *
     * MUST stay tuned against every jump-over/land-on piece's own halfExtents (see
     * MinigameSettings.ts's OBSTACLE_KINDS doc for the actual margin math — "must be over
     * the piece's height for at least as long as it takes to cross its depth at running
     * speed, with room to spare") and both minigames' own forwardSpeed. Changing gravity OR
     * a piece's height/depth OR forwardSpeed without re-checking that margin can silently
     * make clearing (or landing on) it impossible again.
     */
    jumpSpeed: number;
    /** How long the roll/dodge animation's "rolling" state lasts before the animator is free to transition back to idle/walk/run. */
    rollDuration: number;
    /** How long the slide animation's "sliding" state lasts (swipe-down, see SwipeRunnerController) — also how long the player's RigidBody stays shrunk to slideHalfHeight (see CharacterVisualComponent.update()). */
    slideDuration: number;
    /** World-units above `transform.position` (feet level) that world pickups (Collectible) aim for — see MainPlayer.getCollectTargetPosition(). Roughly body-center rather than the ground, so a collected item flies to the player's chest instead of their feet. */
    collectTargetHeight: number;
    /** Player collider half-width/half-depth, world units — constant regardless of standing/sliding (only the height profile changes, see standHalfHeight/slideHalfHeight). */
    colliderHalfWidth: number;
    /** Player collider half-height while standing/running/jumping — full standing height = 2x this. See MainPlayer.awake(). */
    standHalfHeight: number;
    /**
     * Player collider half-height while sliding (see CharacterVisualComponent.update()) —
     * shorter so the player fits under a raised bar obstacle with no collider below
     * ObstacleSettings.barBottomY (see ObstacleBuilder.buildObstacle's `baseY` param). Full
     * slide height (2x this) must stay comfortably under barBottomY — see
     * MinigameSettings.ts's OBSTACLE_SETTINGS doc.
     */
    slideHalfHeight: number;
    /** World-units/second the player gets shoved BACKWARD (opposite of whichever runner-lane direction was current) the instant they hit an obstacle — see HitKickbackController. Decays linearly to 0 over hitKickbackDuration, it's never a sustained push. */
    hitKickbackSpeed: number;
    /** Seconds the hit-kickback velocity takes to decay from hitKickbackSpeed down to a dead stop — see HitKickbackController.fixedUpdate(). */
    hitKickbackDuration: number;
}

export const PLAYER_SETTINGS: PlayerSettings = {
    walkSpeed: 5,
    runSpeedMultiplier: 1.8,
    slideMultiplier: 1.2,
    rollMultiplier: 1.2,
    jumpSpeed: 16.4,
    rollDuration: 0.6,
    slideDuration: 1,
    collectTargetHeight: 1.5,
    colliderHalfWidth: 0.4,
    standHalfHeight: 0.9,
    slideHalfHeight: 0.35,
    hitKickbackSpeed: 8,
    hitKickbackDuration: 0.35,
};

/**
 * Player collider half-extents/centerOffset for the given `sliding` state — a matched pair
 * (never call one without the other) so the box's BOTTOM always stays anchored at
 * transform.position (feet level) regardless of which height profile is active: centerOffset.y
 * is always exactly halfHeight, same convention MainPlayer.awake() always used before this
 * became switchable. See RigidBody.setSize()'s own doc — these are safe to pass there live,
 * mid-game, not just at construction.
 */
export function getPlayerColliderHalfExtents(sliding: boolean): THREE.Vector3 {
    const halfHeight = sliding ? PLAYER_SETTINGS.slideHalfHeight : PLAYER_SETTINGS.standHalfHeight;
    return new THREE.Vector3(PLAYER_SETTINGS.colliderHalfWidth, halfHeight, PLAYER_SETTINGS.colliderHalfWidth);
}

export function getPlayerColliderCenterOffset(sliding: boolean): THREE.Vector3 {
    const halfHeight = sliding ? PLAYER_SETTINGS.slideHalfHeight : PLAYER_SETTINGS.standHalfHeight;
    return new THREE.Vector3(0, halfHeight, 0);
}

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
