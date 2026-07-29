// Tower3DConfig.ts
//
// Tweakable surface for the 3D backdrop — camera framing around the origin
// island cluster, and how the 3D camera follows the 2D tower's climb.
export type SurfaceType =
    | 'water-islands'
    | 'rocky-flat'
    | 'desert-rock'
    | 'gas-clouds'
    | 'ringed-clouds'
    | 'ice-ocean'
    | 'storm-ocean'
    | 'frozen-rock'
    | 'asteroid-field'
    | 'deep-ice'
    | 'comet-cloud'
    | 'stellar'
    | 'galactic';



const KM_PER_LIGHT_YEAR = 9_460_730_472_580.8;

/** Largest-first — the first threshold `distanceKm` clears wins. */
const DISTANCE_UNITS: { threshold: number; divisor: number; suffix: string }[] = [
    { threshold: KM_PER_LIGHT_YEAR, divisor: KM_PER_LIGHT_YEAR, suffix: 'ly' },
    { threshold: 1_000_000_000_000, divisor: 1_000_000_000_000, suffix: 'T' },
    { threshold: 1_000_000_000, divisor: 1_000_000_000, suffix: 'B' },
    { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M' },
    { threshold: 1_000, divisor: 1_000, suffix: 'K' },
];

/** Compact "1M km" / "225M km" / "1.5B km" / "4T km" / "1.2ly" style — short abbreviations rather than spelled-out magnitude words, since these numbers get big fast (levels-config.json's distanceFromPreviousKm runs well past quintillions by the last few levels). */
export function formatSpaceDistance(distanceKm: number): string {

    const safeDistance = Math.max(0, distanceKm);
    const unit = DISTANCE_UNITS.find(candidate => safeDistance >= candidate.threshold);

    if (!unit) {
        return `${Math.round(safeDistance).toLocaleString('en-US')} km`;
    }

    const scaled = formatCompactNumber(safeDistance / unit.divisor);

    // "1M km" / "225M km" (no space before the letter, one before "km") vs
    // light-years, which has no "km" suffix at all — "1.2 ly".
    return unit.suffix === 'ly' ? `${scaled} ly` : `${scaled}${unit.suffix} km`;
}

/**
 * Compact "12.4m" below 1km, deferring to formatSpaceDistance's own K/M/B/T
 * ladder above it (on the meters-as-km value) — see
 * TowerHeightGauge/GameHud, whose current/goal/milestone height readouts
 * would otherwise show a bare, unabbreviated meters count once a climb
 * runs into the thousands.
 */
export function formatHeight(meters: number): string {
    const safeMeters = Math.max(0, meters);

    if (safeMeters < 1000) {
        return `${safeMeters.toFixed(1)}m`;
    }

    return formatSpaceDistance(safeMeters / 1000);
}

/** Same as formatHeight() but rounded to a whole meter below 1km instead of one decimal place — see GameHud's "next level" line, which always wants a rounded figure regardless of the raw/converted toggle. */
export function formatHeightRounded(meters: number): string {
    const safeMeters = Math.max(0, meters);

    if (safeMeters < 1000) {
        return `${Math.round(safeMeters)}m`;
    }

    return formatSpaceDistance(safeMeters / 1000);
}

/**
 * Same magnitude ladder as formatSpaceDistance() — just the rounded number
 * plus its K/M/B/T/ly letter, no trailing " km"/" ly" text (e.g. "225M",
 * "1.5B", "42" under 1000) — for a compact HUD readout that already reads
 * as a distance from its own context (a label following the tower's climb),
 * so repeating the unit next to it would be redundant. See
 * TowerHeightMarkers3D.
 */
export function formatSpaceDistanceValue(distanceKm: number): string {
    const safeDistance = Math.max(0, distanceKm);
    const unit = DISTANCE_UNITS.find(candidate => safeDistance >= candidate.threshold);

    if (!unit) {
        return Math.round(safeDistance).toLocaleString('en-US');
    }

    return `${formatCompactNumber(safeDistance / unit.divisor)}${unit.suffix}`;
}

function formatCompactNumber(value: number): string {
    return value.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: value < 10 ? 2 : 1,
    });
}

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

    // Extra height (THREE units) added ONLY to the camera's own position,
    // not its look-at target — see DEFAULT_TOWER_3D_CONFIG's own comment
    // on this field for why cameraMasterOffsetY alone can't do this.
    cameraExtraLiftY: number;

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

    // --- HUD height/distance display (see IslandViewScene.update()) ---

    // When true, every height readout (2D gauge's current/goal, GameHud's
    // level line, the 3D height markers) shows the tower's own raw climbed
    // data — plain meters via formatHeight(), GameHud's separate "next: Xm"
    // — same as before distance-unification existed. When false, current/
    // goal instead show progress toward the current level's own
    // distanceFromPreviousKm (levels-config.json), in the SAME unit as that
    // destination distance, so climbing the tower visibly approaches it
    // instead of showing two unrelated-looking numbers. Checked live every
    // frame, not just at startup.
    useRawHeightValues: boolean;
}

export const DEFAULT_TOWER_3D_CONFIG: Tower3DConfig = {
    cameraYawDeg: 0,
    cameraPitchDeg: -5,
    cameraDistance: 8,
    cameraDistanceMax: 15,

    cameraMasterOffsetY: 4.9,

    // Extra height (THREE units) added ONLY to the camera's own position,
    // not its look-at target — unlike cameraMasterOffsetY (which shifts
    // camera+target together and so has ~zero net effect on framing, it's
    // just the follow-scroll tracking height), this actually tilts the view
    // down a touch, pushing tower content higher in the frame so it clears
    // bottom-of-screen UI. See positionCamera().
    cameraExtraLiftY: 0.8,

    clusterDiameter: 0, // 16 world units at pixelsPerUnit: 80 — matches the old fixed radius
    clusterCellSize: 0,
    clusterHeight: 1,
    clusterDepthBelow: 20,
    clusterBevelRadius: 1.5,

    pixelsPerUnit: 85,
    towerBaseOffset: { x: 0, y: 0.3, z: 0 },

    baseColor: 0x33cc66,
    platformDepth: 0.3,

    poleColor: 0x3388ff,

    goalMarkerLayout: 'centered',
    progressMarkerLayout: 'side',
    showGoalMarker: true,
    showProgressMarker: true,
    heightMarkerSideMargin: 0,
    heightMarkerSideWidth: 1,

    // Defaults to the pre-conversion look — see the toggle's own doc.
    useRawHeightValues: true,
};
