// FaceTowerConfig.ts
//
// Single tweakable surface for the tower minigame. Tuned against
// Game.DESIGN_WIDTH = 720 / Game.DESIGN_HEIGHT = 1080 — all X/Y values below
// are design-space pixels, not raw screen pixels.

import type { FaceTowerConfig } from './FaceTowerTypes';

// Where the "current" base (and its trapdoor) always sits on screen — also
// reused below as floorY's own value (see its own doc for why those two
// must always match), so this is the one place to change either.
const FLOOR_SCREEN_Y = 900;

export const DEFAULT_FACE_TOWER_CONFIG: FaceTowerConfig = {
    // --- Playfield anchors (screen-space, fixed regardless of camera scroll) ---
    spawnScreenY: 240,   // where the held block hovers before it's dropped
    floorScreenY: FLOOR_SCREEN_Y,
    deathScreenY: 1030,  // cross this and it's game over

    // Top-edge Y for the 4-slot top powerup row (2 left, 2 right) — see
    // TopPowerupSlots/GameHud.layout(). Tune this to clear whatever else
    // sits at the top of the screen (sound button, next-piece preview,
    // shape-mode toggle).
    powerupSlotsScreenY: 70,

    // Near the top — the settled pile crossing this and staying (see
    // gameOverGraceDuration) ends the run. Fixed forever; trapdoors only
    // ever buy more room BELOW it.
    gameOverLineScreenY: 280,
    gameOverGraceDuration: 6,

    // A tap immediately snaps the held piece under the pointer before
    // dropping it — see FaceTowerConfig.tapMovesPieceOnDrop's own doc.
    tapMovesPieceOnDrop: true,

    // --- Horizontal play area ---
    minBlockX: 150,
    maxBlockX: 570,

    // --- Block / base sizes ---
    blockWidth: 70,
    blockHeight: 70,

    floorWidth: 460,
    floorHeight: 100,
    floorX: 360,
    // Must match floorScreenY — this is the first floor's own WORLD-Y (the
    // camera hasn't panned at all yet at run start, so world Y and screen Y
    // coincide), and also the fixed baseline every 2D-world-Y → 3D
    // conversion measures height from (see TowerBlockSync3D/TowerBaseSync3D/
    // TowerWallSync3D/TowerHeightMarkers3D/TowerGameOverSiren3D/TowerVfxUtils
    // — all read config.floorY directly for that). Letting this drift from
    // floorScreenY silently misplaces the starting floor on screen, so it's
    // derived from the same constant rather than a separately-tuned number.
    floorY: FLOOR_SCREEN_Y,

    // --- Post-drop pacing (when can the next piece spawn) ---
    dropWaitFallbackTimeout: 1.0,

    // Grace period (seconds) before a freshly-merged piece can merge again
    // — see FaceTowerBlock.mergeGraceRemaining/TowerMergeController. Keeps
    // a cascade readable as a sequence of pops instead of everything
    // collapsing in the same instant.
    mergeGraceDuration: 0.3,

    // Forgiving proximity margin (world px) — see TowerMergeProximityController
    // and FaceTowerConfig.mergeProximityMargin's own doc.
    mergeProximityMargin: 15,

    // --- Zones / milestones ---
    // Zone target-weight/pole-percentage per zone now come from
    // levels-config.json (see LevelStorage/TowerLevelController) instead of
    // a fixed value here.
    cameraPanSpeed: 1400, // px/sec the camera scrolls when a trapdoor drops the floor

    // --- Trapdoor (see TowerTrapdoorController) ---
    trapdoorDropHeight: 600, // px the pile free-falls before a new floor is placed
    trapdoorOpenDuration: 0.6, // seconds — cosmetic lead-in AND the two-flap swing-open duration, before the floor is destroyed
    trapdoorSettleDelay: 0.6, // seconds to let the pile visibly finish landing before play resumes/the level-up popup shows
    minDropsPerZone: 5, // pieces that must be dropped in a zone before its weight milestone can trigger the trapdoor, however fast the weight itself clears
    floorFlapRestAngle: 10 * (Math.PI / 180), // ~10deg idle tilt (each flap's inner edge sags toward the center seam)
    floorFlapOpenAngle: 60 * (Math.PI / 180), // ~60deg full swing-open tilt when the trapdoor triggers

    // --- Physics feel ---
    gravityX: 0,
    gravityY: 1.5,       // Matter.js gravity scale; higher = faster fall

    // Extra velocity (px/sec) applied the instant a block is released, on
    // top of gravity. Leave both at 0 for a plain drop.
    dropForceX: 0,
    dropForceY: 10,

    // --- Containment ---
    wallWidth: 1320,
    wallOffsetY: 120,
    deadZoneWidth: 1400,
    // The wall's actual top must clear the TRUE visible top edge of the
    // screen (Y=0, or negative on an aspect ratio with extra vertical
    // letterbox space above it), not just gameOverLineScreenY — a piece
    // flying above the game-over line but still below the screen's own top
    // edge used to have zero containment (the wall stopped short there),
    // letting it drift sideways out of the column. floorScreenY -
    // gameOverLineScreenY + this value is the wall's own height, so the
    // wall's top ends up at (gameOverLineScreenY - this value) in screen
    // space — 700 puts that comfortably above Y=0 with margin to spare.
    containmentTopBuffer: 700,

    // --- 2D block visuals ---
    blockFillAlpha: 1,
    blockStrokeColor: 0x555555,
    blockStrokeWidth: 2,
    blockBevelRadius: 12,
    render2D: false,
    render3D: true,
    render2DFaces: true,
    previewStripHeight: 650,
    previewMargin2D: 0,
    previewMargin3D: 0,
    previewGlobalOffset2D: { x: 0, y: -15 },
    previewGlobalOffset3D: { x: 0, y: 0.1 },

    // --- 3D piece visuals ---
    pieceDepthRatio: 0.15,
    pieceBevelRadiusRatio: 0.15,
    pieceBevelThicknessRatio: 0.25,
};
