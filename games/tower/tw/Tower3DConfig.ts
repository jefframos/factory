// Tower3DConfig.ts
//
// Tweakable surface for the 3D backdrop — camera framing around the origin
// island cluster, and how the 3D camera follows the 2D tower's climb.

export interface Tower3DConfig {
    cameraYawDeg: number;
    cameraPitchDeg: number;
    cameraDistance: number;

    // THREE units the camera (and its look-at target) rises per design-space
    // pixel the 2D tower camera has scrolled. 0 disables the pairing.
    towerFollowScale: number;

    // Constant baseline lift (THREE units) applied on top of the dynamic
    // follow above — calibrates where the rig sits before the tower has
    // climbed at all, independent of towerFollowScale.
    cameraMasterOffsetY: number;

    // --- Origin island cluster (a single connected blob, not the chunk streamer) ---

    // Diameter in design pixels — converted to world units via pixelsPerUnit
    // (below), same conversion the 2D↔3D block mirroring uses.
    clusterDiameter: number;
    clusterCellSize: number;
    clusterHeight: number;
    clusterDepthBelow: number;
    clusterBevelRadius: number;

    // --- 2D → 3D block mirroring (see TowerBlockSync3D) ---

    // Design pixels per THREE unit — an 80x80 2D block becomes a 1x1x1 cube
    // at the default value.
    pixelsPerUnit: number;

    // World-space (THREE units) position the mirrored tower is anchored to
    // — added to every cube's mapped position, so the tower can sit
    // somewhere other than dead-center on the island cluster.
    towerBaseOffset: { x: number; y: number; z: number };
}

export const DEFAULT_TOWER_3D_CONFIG: Tower3DConfig = {
    cameraYawDeg: 0,
    cameraPitchDeg: 5,
    cameraDistance: 9,

    towerFollowScale: 0.025,
    cameraMasterOffsetY: 5,

    clusterDiameter: 550, // 16 world units at pixelsPerUnit: 80 — matches the old fixed radius
    clusterCellSize: 1,
    clusterHeight: 1,
    clusterDepthBelow: 20,
    clusterBevelRadius: 1.5,

    pixelsPerUnit: 80,
    towerBaseOffset: { x: 0, y: 1, z: 0 },
};
