// FaceTowerTypes.ts

import type { BasePhysicsEntity } from 'core/phyisics/entities/BaseEntity';
import type { PieceDefinition } from './PieceStorage';

export enum FaceTowerState {
    Initialising = 'initialising',
    MovingBlock = 'moving-block',
    DroppingBlock = 'dropping-block',
    WaitingForTower = 'waiting-for-tower',
    PanningCamera = 'panning-camera',
    GameOver = 'game-over',
}

export interface FaceTowerBlock {
    id: number;
    /** BoxEntity for a plain rect piece, PolygonEntity when the piece has a `polygon` override — see FaceTowerBlockController.spawnHeldBlock. */
    entity: BasePhysicsEntity;
    checkpointFrozen: boolean;
    /** Which piece (color/texture/scale) this block was spawned from — see PieceManager. */
    piece: PieceDefinition;
}

export interface FaceTowerConfig {
    // Screen-space anchors (design-space pixels, Game.DESIGN_WIDTH/HEIGHT).
    // The camera keeps these fixed on screen no matter how tall the tower gets.
    spawnScreenY: number;
    floorScreenY: number;
    deathScreenY: number;

    minBlockX: number;
    maxBlockX: number;

    blockWidth: number;
    blockHeight: number;

    floorWidth: number;
    floorHeight: number;
    floorX: number;
    floorY: number;

    maximumSettleDuration: number;
    settleDuration: number;
    settleLinearSpeed: number;
    settleAngularSpeed: number;

    // World-space height (px) the player must build above the current base
    // before that base freezes and a new one is placed on the target line.
    zoneHeight: number;
    cameraPanSpeed: number;

    // Matter.js world gravity (y is downward-positive, same as Matter's default).
    gravityX: number;
    gravityY: number;

    // Extra impulse applied to a block the instant it's released, on top of
    // gravity. Zero means "just drop it" — positive dropForceY nudges it down
    // faster, dropForceX can be used for a sideways toss.
    dropForceX: number;
    dropForceY: number;

    // Solid (non-sensor) bumper rails flush against the base's edges — keep
    // blocks contained in the build column under normal play.
    wallWidth: number;
    wallHeight: number;

    // Manual vertical nudge (world px, +down) for the walls' position on
    // top of the flush-with-base-top placement — see
    // TowerDeadZoneController.rebuild(). Plain additive fudge factor for
    // when the flush math doesn't quite read right visually, instead of
    // re-deriving the "correct" offset from wall/base geometry.
    wallOffsetY: number;

    // Invisible sensor strips beyond the walls (and one under the base).
    // Only reachable if something gets knocked past a wall, e.g. during a
    // collapse — touching one ends the run immediately.
    deadZoneWidth: number;

    // --- 2D block visuals ---

    // Global fill opacity (0-1) for every 2D block's body — the 3D world
    // renders underneath the 2D overlay, so this is what lets it show
    // through instead of being fully hidden.
    blockFillAlpha: number;
    blockStrokeColor: number;
    blockStrokeWidth: number;

    // Corner radius for the block-body texture — 0 draws a plain square,
    // anything above draws a rounded rect. See BlockBodyTextureCache.
    blockBevelRadius: number;

    // Master toggle for the whole 2D visual layer (blocks/bases/target line)
    // — physics, camera, and score keep running either way; this only hides
    // the Pixi view so you can preview 3D-only. See IslandViewScene.
    render2D: boolean;

    // Master toggle for the whole 3D layer (island cluster, camera, mirrored
    // pieces/bases/poles) — physics, camera tracking math, and score keep
    // running either way; this just skips the THREE render call and hides
    // its canvas, so you can preview 2D-only. See IslandViewScene.update().
    render3D: boolean;

    // Whether newly-spawned blocks draw their piece's face texture on top
    // of the colored/stroked body. Independent of render2D so you can have
    // plain colored boxes without faces even with the 2D layer visible.
    render2DFaces: boolean;

    // Height (world px in 2D, converted via pixelsPerUnit for 3D) of the
    // "landing preview" strip shown at the held piece's own base — a
    // vfx/grad.webp gradient (opaque at the piece, fading to transparent
    // below it) tinted to the piece's color, hinting where it'll land. 0
    // disables it entirely. Width always matches the piece's own visual
    // span (see PieceDefinition.previewOffset for per-piece position
    // tuning, and margin/margin3D below for per-piece width tuning).
    previewStripHeight: number;

    // Insets the strip's WIDTH symmetrically (world px in 2D, world units
    // in 3D) — NOT a gap/offset — same as a CSS margin: a margin of 1
    // removes half a px from the strip's left edge and half from the
    // right, so it stays centered but reads narrower than the piece's own
    // visual span. Stacks with PieceDefinition.margin/margin3D (per-piece).
    previewMargin2D: number;
    previewMargin3D: number;

    // Flat (x, y) nudge (2D world px / 3D world units) applied to EVERY
    // piece's preview strip on top of that piece's own
    // PieceDefinition.previewOffset — for a constant adjustment that
    // doesn't scale with piece dimensions.
    previewGlobalOffset2D: { x: number; y: number };
    previewGlobalOffset3D: { x: number; y: number };

    // --- 3D piece visuals — see PieceBoxBuilder ---

    // Z thickness of a piece's 3D mesh, as a fraction of its shorter
    // width/height — 1 means "as thick as the piece is wide/tall (whichever
    // is smaller)", so pieces read as flat plates rather than long boxes.
    pieceDepthRatio: number;

    // Corner-fillet radius, as a fraction of the piece's shorter
    // width/height — 0 turns off rounding entirely (sharp corners).
    pieceBevelRadiusRatio: number;

    // How far the bevel extrudes outward, as a fraction of
    // min(depth, bevel radius) — 0 turns off the bevel extrude (flat-edged
    // fillet only).
    pieceBevelThicknessRatio: number;
}

export type TowerSettleResult =
    | 'waiting'
    | 'stable'
    | 'failed';

export interface TowerZoneResult {
    zoneIndex: number;
    lineWorldY: number;
}
