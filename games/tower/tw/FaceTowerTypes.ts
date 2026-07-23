// FaceTowerTypes.ts

import type { BasePhysicsEntity } from 'core/phyisics/entities/BaseEntity';
import type { PieceDefinition } from './PieceStorage';

export enum FaceTowerState {
    Initialising = 'initialising',
    MovingBlock = 'moving-block',
    DroppingBlock = 'dropping-block',
    WaitingForTower = 'waiting-for-tower',
    PanningCamera = 'panning-camera',
    /** A powerup's async freeze/grey queue is still draining — see PowerupSystem.isBusy(). Next block spawns once it empties. */
    PowerupEffect = 'powerup-effect',
    GameOver = 'game-over',
}

/**
 * What a powerup's dropped piece does to each block it touches, and how
 * many it's allowed to affect before it also removes itself — see
 * PowerupSystem. Normalized out of the raw PowerupStorage.PowerupDefinition
 * JSON shape by FaceTowerGameController.spawnPowerup so PowerupSystem and
 * FaceTowerBlockController only ever deal with one consistent shape
 * regardless of which powerup type produced it.
 */
export interface PowerupEffectConfig {
    /** 'freeze' greys+freezes a touched block in place (the lightning); 'destroy' removes it outright (bomb/super bomb); 'shrink' shrinks it in place, physics body included (the shrink ray). */
    action: 'freeze' | 'destroy' | 'shrink';
    /** Required when action === 'freeze' — see FaceTowerBlockController.freezeBlockForPowerup. */
    greyColorHex?: number;
    /** Required when action === 'shrink' — multiplies the touched block's CURRENT size (compounds on repeat hits, floored — see FaceTowerBlockController.shrinkBlockForPowerup). 0.6 means "60% of its current size", not 60% of its original size. */
    shrinkFactor?: number;
    /** Seconds between processing each additional queued block, so a run of simultaneous touches cascades one at a time instead of all snapping/vanishing/shrinking at once. */
    stepDelay: number;
    /** Max blocks this can affect before it also removes itself right away instead of continuing to fall — 1 for a single-target bomb, omit for unlimited (falls until it exits the bottom, like the lightning/super bomb/shrink ray). */
    maxTargets?: number;
    /** Overrides FaceTowerConfig.dropForceY for this piece's release — see PowerupDefinition.dropForceY. */
    dropForceY?: number;
}

export interface FaceTowerBlock {
    id: number;
    /** BoxEntity for a plain rect piece, PolygonEntity when the piece has a `polygon` override — see FaceTowerBlockController.spawnHeldBlock. */
    entity: BasePhysicsEntity;
    checkpointFrozen: boolean;
    /** Which piece (color/texture/scale) this block was spawned from — see PieceManager. */
    piece: PieceDefinition;
    /** Seconds left in the one-shot "shoot" bounce (see PieceAnimations.sampleShoot) — set on release. */
    shootRemaining: number;
    /** Seconds left in the one-shot "jiggle" wiggle (see PieceAnimations.sampleJiggle) — set on first physical contact, once ever. */
    jiggleRemaining: number;
    /** True once this block's first-hit jiggle has already fired — prevents every subsequent collision from re-triggering it. */
    hasJiggled: boolean;
    /** Cumulative multiplier from every shrink-ray hit this block has ever taken (1 = original size, shrinks compound, floored — see FaceTowerBlockController.shrinkBlockForPowerup). Applied every frame in updatePieceAnim so it survives past the shoot/jiggle animations finishing. */
    shrinkScale: number;
    /**
     * Set only for a powerup's dropped piece (see PowerupSystem). Its body
     * becomes a sensor the instant it's released (see
     * FaceTowerBlockController.releaseHeldBlock) — falls under gravity but
     * passes through everything instead of colliding — and it never settles
     * into the tower: PowerupSystem destroys it once it falls past the
     * bottom of the play column (or hits its maxTargets cap), ending the effect.
     */
    powerup?: PowerupEffectConfig;
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
    wallHeight: number[];

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
