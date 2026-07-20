// FaceTowerTypes.ts

import type { BoxEntity } from 'core/phyisics/entities/BoxEntity';
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
    entity: BoxEntity;
    checkpointFrozen: boolean;
    /** Which piece (shape/color/texture/scale) this block was spawned from — see PieceManager. */
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

    // Whether newly-spawned blocks draw their piece's face texture on top
    // of the colored/stroked body. Independent of render2D so you can have
    // plain colored boxes without faces even with the 2D layer visible.
    render2DFaces: boolean;
}

export type TowerSettleResult =
    | 'waiting'
    | 'stable'
    | 'failed';

export interface TowerZoneResult {
    zoneIndex: number;
    lineWorldY: number;
}
