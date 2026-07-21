// FaceTowerConfig.ts
//
// Single tweakable surface for the tower minigame. Tuned against
// Game.DESIGN_WIDTH = 720 / Game.DESIGN_HEIGHT = 1080 — all X/Y values below
// are design-space pixels, not raw screen pixels.

import type { FaceTowerConfig } from './FaceTowerTypes';

export const DEFAULT_FACE_TOWER_CONFIG: FaceTowerConfig = {
    // --- Playfield anchors (screen-space, fixed regardless of camera scroll) ---
    spawnScreenY: 150,   // where the held block hovers before it's dropped
    floorScreenY: 940,   // where the "current" base always sits on screen
    deathScreenY: 1030,  // cross this and it's game over

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

    // --- Settle detection (when is a dropped block "done moving") ---
    settleLinearSpeed: 0.35,
    settleAngularSpeed: 0.05,
    settleDuration: 0.35,
    maximumSettleDuration: 2.5,

    // --- Zones / milestones ---
    zoneHeight: 480,     // world-space height to build before the base freezes
    cameraPanSpeed: 1400, // px/sec the camera scrolls when a zone completes

    // --- Physics feel ---
    gravityX: 0,
    gravityY: 1.8,       // Matter.js gravity scale; higher = faster fall

    // Extra velocity (px/sec) applied the instant a block is released, on
    // top of gravity. Leave both at 0 for a plain drop.
    dropForceX: 0,
    dropForceY: 8,

    // --- Containment ---
    wallWidth: 24,
    wallHeight: 180, // just tall enough to bumper the first block or two off the base
    wallOffsetY: 100,
    deadZoneWidth: 1400,

    // --- 2D block visuals ---
    blockFillAlpha: 1,
    blockStrokeColor: 0x555555,
    blockStrokeWidth: 2,
    blockBevelRadius: 12,
    render2D: true,
    render2DFaces: true,

    // --- 3D piece visuals ---
    pieceDepthRatio: 0.25,
    pieceBevelRadiusRatio: 0.15,
    pieceBevelThicknessRatio: 0.5,
};
