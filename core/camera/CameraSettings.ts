// CameraSettings.ts
//
// The plain-data shape VirtualCameraSystem blends between — see that
// file's own doc. Each game defines its own named presets against this
// interface (e.g. games/bandit-controller/game/data/GameSettings.ts).

export interface CameraSettings {
    /** Degrees the camera is rotated around the player, around Y (0 = behind, looking toward -Z; positive turns it clockwise viewed from above). */
    yawDeg: number;
    /** Degrees the camera looks down from level with the player (0 = level, 90 = straight overhead). */
    pitchDeg: number;
    /** How far back the camera sits from its follow target. */
    distance: number;
    /** Exponential follow-ease rate the camera's target chases the player's actual position at — higher = snappier, lower = laggier/smoother. */
    followSpeed: number;
    /** World-space offset added to the player's position before the camera orbits/looks at it — e.g. raising the look-at point to chest/head height instead of the feet-level transform origin. */
    offset: { x: number; y: number; z: number };
}
