// FaceTowerConfig.ts
//
// Single tweakable surface for the tower minigame. Tuned against
// Game.DESIGN_WIDTH = 720 / Game.DESIGN_HEIGHT = 1080 — all X/Y values below
// are design-space pixels, not raw screen pixels.

import type { FaceTowerConfig } from './FaceTowerTypes';

export const DEFAULT_FACE_TOWER_CONFIG: FaceTowerConfig = {
    // --- Playfield anchors (screen-space, fixed regardless of camera scroll) ---
    spawnScreenY: 200,   // where the held block hovers before it's dropped
    floorScreenY: 900,   // where the "current" base always sits on screen
    deathScreenY: 1030,  // cross this and it's game over

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
    floorY: 940,

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
    containmentTopBuffer: 150,

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
