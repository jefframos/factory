// MinigameSettings.ts
//
// Data for the two dedicated minigame scenes (RunnerMinigameScene,
// SwipeMinigameScene) — read live, same "data/ is the single source of
// truth" convention as PlayerSettings.ts/WorldSettings.ts.

import * as THREE from 'three';

/**
 * Shared world-forward direction both runner-style minigames move along —
 * matches every runner-flavored camera preset's own yawDeg: 0 convention
 * (GameSettings.ts) — the camera and the lane's own forward have to agree,
 * or the camera looks the wrong way down the lane.
 */
export const RUNNER_LANE_DIRECTION = new THREE.Vector3(0, 0, -1);

export interface RunnerMinigameSettings {
    /** World units from the start gate to the finish gate — reaching it ends the minigame (see RunnerMinigameScene). */
    laneLength: number;
}

export const RUNNER_MINIGAME_SETTINGS: RunnerMinigameSettings = {
    laneLength: 400,
};

export interface SwipeMinigameSettings {
    /** Fixed real-time seconds the swipe-lane minigame runs before it ends and returns to the hub — a timer rather than a finish line, so a session always has a known, short length regardless of how well the player dodges/paces themselves. */
    durationSec: number;
    /** How many discrete lanes, and how wide (world units) each one is — same values LANE_SETTINGS.ts used to hold back when this ran as a corridor inside the hub. */
    laneCount: number;
    laneWidth: number;
    /** One color per lane, by index — cycles (via modulo) if there are more lanes than colors. */
    laneColors: number[];
}

export const SWIPE_MINIGAME_SETTINGS: SwipeMinigameSettings = {
    durationSec: 25,
    laneCount: 3,
    laneWidth: 2.5,
    laneColors: [0xff5252, 0x4caf50, 0x448aff],
};

export interface RunnerFloorSettings {
    /** World units — must comfortably exceed whichever minigame's own lane length/duration*speed runs the farthest, or the player runs off the edge of the ground collider before reaching the finish gate / the timer running out. */
    size: number;
    /** Vertices per side (see FloorBuilder.build()'s own doc) — higher than the hub's plain 32 so RunnerBendService's wave bend has enough nearby detail to look smooth. */
    segments: number;
    /** > 1 clusters more of those vertices near the center (where the player actually is) and fewer toward the rarely-seen far edges — see FloorBuilder.build()'s own doc on centerBias. */
    centerBias: number;
}

/** Shared by both minigame scenes (see WorldEnvironment's own floorSize/floorSegments/floorCenterBias constructor params) — the hub keeps WorldEnvironment's plain defaults (FLOOR_SIZE, 32 segments, no bias). */
export const RUNNER_FLOOR_SETTINGS: RunnerFloorSettings = {
    size: 900,
    segments: 96,
    centerBias: 1.8,
};

export interface ObstacleSettings {
    /** World units from the start line to the first obstacle — gives the player a moment to get moving before anything can hit them. */
    startOffset: number;
    /** World units between one obstacle and the next along the lane. */
    spacing: number;
    /** Box half-extents (world units) for every obstacle. */
    halfExtents: THREE.Vector3;
    /** RunnerMinigameScene only: how far (world units) alternating obstacles sit from the lane's own centerline — leaves room to steer around on the opposite side each time (see RunnerMinigameScene's own placement code). */
    runnerLateralOffset: number;
}

export const OBSTACLE_SETTINGS: ObstacleSettings = {
    startOffset: 30,
    spacing: 40,
    halfExtents: new THREE.Vector3(1, 1, 1),
    runnerLateralOffset: 2,
};
