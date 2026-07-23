// Tower3DConfig.ts
//
// Tweakable surface for the 3D backdrop — camera framing around the origin
// island cluster, and how the 3D camera follows the 2D tower's climb.

export interface Tower3DConfig {
    cameraYawDeg: number;
    cameraPitchDeg: number;
    cameraDistance: number;
    cameraDistanceMax: number;

    // Constant baseline lift (THREE units) applied on top of the dynamic
    // follow below — calibrates where the rig sits before the tower has
    // climbed at all.
    //
    // The dynamic part itself is NOT a separate tunable: the camera's focus
    // height is derived as `towerOffsetY / pixelsPerUnit`, the exact same
    // conversion used to place the mirrored 3D cubes/base panels (see
    // TowerBlockSync3D / TowerBaseSync3D). Using any other scale here would
    // let the camera drift away from the base it's supposed to be centered
    // on — see IslandViewScene.update().
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

    // --- Base platform (see TowerBaseSync3D) — color/shape/face come from
    // the 'base'/'milestone' static pieces (see StaticPieceStorage) when
    // configured; baseColor is only the fallback for an unconfigured role.
    baseColor: number;

    // Z-thickness (THREE units) shared by the base slab and the side poles
    // (see TowerBaseSync3D/TowerWallSync3D) — both are flat blocks facing
    // the camera, not full cubes, so this is the one place to tweak how
    // deep they read.
    platformDepth: number;

    // --- Side poles (see TowerWallSync3D — mirrors TowerDeadZoneController's
    // walls) — color/shape/face come from the 'column' static piece when
    // configured; poleColor is only the fallback for an unconfigured role.
    poleColor: number;

    // --- Height marker bars (see TowerHeightMarkers3D — the 3D counterpart
    // of the 2D TowerHeightGauge) — the goal (target line) and progress
    // (current top) bars are independently configurable, both in layout
    // and visibility, since they read as two separate indicators rather
    // than one combined gauge.

    // 'centered' spans a bar the full play-column width, running through
    // the tower (matches the 2D gauge's own "line through the stack" feel).
    // 'side' instead docks a short bar just past the tower's own right
    // edge, out of the way of the actual gameplay column — see
    // heightMarkerSideMargin/heightMarkerSideWidth below for its exact
    // offset/width in that mode. Read once at construction (see
    // TowerHeightMarkers3D's constructor) — a bar's geometry is built for
    // whichever mode is active at startup, not re-built if this value
    // changes afterward.
    goalMarkerLayout: 'centered' | 'side';
    progressMarkerLayout: 'centered' | 'side';

    // Independently hides a marker (bar + its meters label) entirely —
    // checked every frame in TowerHeightMarkers3D.update(), so unlike
    // layout this CAN be toggled live.
    showGoalMarker: boolean;
    showProgressMarker: boolean;

    // How far past the play column's own right edge (world units) a bar
    // sits when its own layout is 'side'. Shared by both markers; unused
    // by one currently set to 'centered'.
    heightMarkerSideMargin: number;

    // A bar's own width (world units) when its layout is 'side' —
    // deliberately much shorter than the full column span, since the point
    // of 'side' mode is to read as a small marker beside the tower, not
    // another bar spanning across it. Shared by both markers; unused by
    // one currently set to 'centered'.
    heightMarkerSideWidth: number;
}

export const DEFAULT_TOWER_3D_CONFIG: Tower3DConfig = {
    cameraYawDeg: 0,
    cameraPitchDeg: 3,
    cameraDistance: 8,
    cameraDistanceMax: 15,

    cameraMasterOffsetY: 6.5,

    clusterDiameter: 0, // 16 world units at pixelsPerUnit: 80 — matches the old fixed radius
    clusterCellSize: 0,
    clusterHeight: 1,
    clusterDepthBelow: 20,
    clusterBevelRadius: 1.5,

    pixelsPerUnit: 80,
    towerBaseOffset: { x: 0, y: 1, z: 0 },

    baseColor: 0x33cc66,
    platformDepth: 0.3,

    poleColor: 0x3388ff,

    goalMarkerLayout: 'centered',
    progressMarkerLayout: 'side',
    showGoalMarker: true,
    showProgressMarker: true,
    heightMarkerSideMargin: 0,
    heightMarkerSideWidth: 1,
};
