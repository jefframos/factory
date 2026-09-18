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
    /**
     * World-units/second constant forward pace for THIS minigame specifically —
     * deliberately separate from PlayerSettings.walkSpeed/runSpeedMultiplier
     * (which still govern the hub's own free-roam walk/run). Passed into
     * MainPlayer as a `getMoveSpeed` override (see WorldEnvironment.spawnPlayer()'s
     * own doc) rather than sharing the hub's speed function, so tuning one
     * never accidentally changes the other.
     */
    forwardSpeed: number;
}

export const RUNNER_MINIGAME_SETTINGS: RunnerMinigameSettings = {
    laneLength: 400,
    forwardSpeed: 13,
};

export interface SwipeMinigameSettings {
    /** Fixed real-time seconds the swipe-lane minigame runs before it ends and returns to the hub — a timer rather than a finish line, so a session always has a known, short length regardless of how well the player dodges/paces themselves. */
    durationSec: number;
    /** How many discrete lanes, and how wide (world units) each one is — same values LANE_SETTINGS.ts used to hold back when this ran as a corridor inside the hub. */
    laneCount: number;
    laneWidth: number;
    /** One color per lane, by index — cycles (via modulo) if there are more lanes than colors. */
    laneColors: number[];
    /** Same idea as RunnerMinigameSettings.forwardSpeed — this minigame's own constant forward pace, independent of both the hub AND RunnerMinigameScene's own speed. */
    forwardSpeed: number;
}

export const SWIPE_MINIGAME_SETTINGS: SwipeMinigameSettings = {
    durationSec: 25,
    laneCount: 3,
    laneWidth: 2.5,
    laneColors: [0xff5252, 0x4caf50, 0x448aff],
    forwardSpeed: 15,
};

export interface RunnerFloorSettings {
    /** World units — the LOGICAL/physics-collider floor size (WorldEnvironment's own floorSize param), must comfortably exceed whichever minigame's own lane length/duration*speed runs the farthest, or the player runs off the edge of the ground collider before reaching the finish gate / the timer running out. This is NOT how big the VISIBLE floor mesh is — see patchSize/patchSegments. */
    size: number;
    /** World units per side of the small, densely-tessellated visual floor patch that stays snapped/centered under the player as they move (see WorldEnvironment.recenterFloorPatch()'s own doc) — independent of `size` above, and can be far smaller since it only ever needs to cover the ground actually visible around the player. */
    patchSize: number;
    /** Vertices per side of that patch — much higher than a full-level floor mesh could ever afford. patchSize/patchSegments is also the world-unit size of the patch's own grid cell, i.e. the increment it snaps by each time it recenters — keeping that equal to FloorBuilder's 1-world-unit grid-texture repeat (patchSize === patchSegments) is what keeps the snap itself invisible. */
    patchSegments: number;
    /** World units wide, each of the two flat sidewalk strips running alongside the patch (see WorldEnvironment.VisualFloorPatch.sidewalks' own doc) — recenters in lockstep with the main patch, Z-only. */
    sidewalkWidth: number;
    /** World units of clearance from the lane's own edge out to the near edge of each sidewalk strip. */
    sidewalkOffset: number;
}

/** Shared by both minigame scenes (see WorldEnvironment's own floorSize/visualFloorPatch constructor params) — the hub keeps WorldEnvironment's plain default (a single static, FLOOR_SIZE-wide floor, no recentering, no sidewalks). */
export const RUNNER_FLOOR_SETTINGS: RunnerFloorSettings = {
    size: 900,
    patchSize: 120,
    patchSegments: 120,
    sidewalkWidth: 50,
    sidewalkOffset: -3,
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
    halfExtents: new THREE.Vector3(1, 1, 5),
    runnerLateralOffset: 2,
};
