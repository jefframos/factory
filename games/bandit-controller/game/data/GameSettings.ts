// GameSettings.ts
//
// Named camera setting presets ("modes") for every scene's follow camera
// (see game/scenes/shared/WorldEnvironment.ts, which every scene composes)
// — same shape as bandit's CameraTemplateTypes.ts, trimmed to just what this
// controller demo needs. STANDARD_CAMERA_SETTINGS is the default mode;
// VirtualCameraSystem starts on a live COPY of it (see its own `current`
// field) so dev-GUI edits never mutate the shared preset object itself.

export type { CameraSettings } from 'core/camera/CameraSettings';
import type { CameraSettings } from 'core/camera/CameraSettings';

export const STANDARD_CAMERA_SETTINGS: CameraSettings = {
    yawDeg: 0,
    pitchDeg: 25,
    distance: 10,
    followSpeed: 6,
    offset: { x: 0, y: 1.2, z: 0 },
};

/** Tighter, more head-on shot — a second preset mostly so VirtualCameraSystem has something to blend TO/FROM out of the box (see HubScene's camera hotkeys). */
export const CLOSEUP_CAMERA_SETTINGS: CameraSettings = {
    yawDeg: 0,
    pitchDeg: 12,
    distance: 3.5,
    followSpeed: 8,
    offset: { x: 0, y: 1.4, z: 0 },
};

/** Straight overhead — pitchDeg near 90 so the orbit math (cameraOrbitOffset() in game/scenes/shared/WorldEnvironment.ts) stays well-defined; see that function's own doc for why exactly 90 is avoided. */
export const TOPDOWN_CAMERA_SETTINGS: CameraSettings = {
    yawDeg: 0,
    pitchDeg: 85,
    distance: 16,
    followSpeed: 5,
    offset: { x: 0, y: 0, z: 0 },
};

/**
 * Subway-Surfers-style runner shot — tighter and a bit higher/steeper than
 * STANDARD so more of the lane ahead is visible, snappier followSpeed since
 * runner-mode movement (see PlayerMovementController.enterRunnerMode()) is
 * faster and constant. yawDeg matches STANDARD's (0 = behind, looking
 * toward -Z) since both minigame scenes' runner lanes also run along -Z (see
 * MinigameSettings.RUNNER_LANE_DIRECTION) — the camera and the lane's own
 * forward need to agree, or the camera would sit behind the player looking
 * the WRONG way down the lane.
 */
export const RUNNER_CAMERA_SETTINGS: CameraSettings = {
    yawDeg: 0,
    pitchDeg: 25,
    distance: 12,
    followSpeed: 12,
    offset: { x: 0, y: 1.0, z: 0 },
};

/**
 * Same shot as RUNNER, but the look-at point sits well above the player's
 * own chest height (offset.y) instead of near it — the camera/look-at pair
 * always frame that point dead-center, so raising it relative to the
 * player's feet pushes the player's own body further toward the bottom of
 * the frame, leaving more screen space above to see incoming lane
 * obstacles/swipe cues. Used only by SwipeMinigameScene — RunnerMinigameScene
 * keeps the plain "runner" mode's more centered framing.
 */
export const SWIPE_CAMERA_SETTINGS: CameraSettings = {
    yawDeg: 0,
    pitchDeg: 15,
    distance: 9,
    followSpeed: 12,
    offset: { x: 0, y: 5, z: 0 },
};

/** CameraSettings by mode id — register these with a VirtualCameraSystem (see game/camera/VirtualCameraSystem.ts) and blendTo()/cutTo() between them by id. */
export const CAMERA_SETTINGS_BY_MODE: Record<string, CameraSettings> = {
    standard: STANDARD_CAMERA_SETTINGS,
    closeup: CLOSEUP_CAMERA_SETTINGS,
    topdown: TOPDOWN_CAMERA_SETTINGS,
    runner: RUNNER_CAMERA_SETTINGS,
    swipe: SWIPE_CAMERA_SETTINGS,
};

export const DEFAULT_CAMERA_MODE = 'standard';

/** Resolves `mode` to its own settings, falling back to DEFAULT_CAMERA_MODE if `mode` is unset OR doesn't match any real entry. */
export function getCameraSettings(mode: string = DEFAULT_CAMERA_MODE): CameraSettings {
    return CAMERA_SETTINGS_BY_MODE[mode] ?? STANDARD_CAMERA_SETTINGS;
}
