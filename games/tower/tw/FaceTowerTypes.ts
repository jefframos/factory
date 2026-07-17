// FaceTowerTypes.ts

import type { BoxEntity } from 'core/phyisics/entities/BoxEntity';

export enum FaceTowerState {
    Initialising = 'initialising',
    MovingBlock = 'moving-block',
    DroppingBlock = 'dropping-block',
    WaitingForTower = 'waiting-for-tower',
    GameOver = 'game-over',
}

export interface FaceTowerBlock {
    id: number;
    entity: BoxEntity;
    checkpointFrozen: boolean;
}

export interface FaceTowerConfig {
    spawnY: number;

    minBlockX: number;
    maxBlockX: number;

    blockWidth: number;
    blockHeight: number;

    floorWidth: number;
    floorHeight: number;
    floorX: number;
    floorY: number;

    deathY: number;

    maximumSettleDuration: number;
    settleDuration: number;
    settleLinearSpeed: number;
    settleAngularSpeed: number;

    checkpointEvery: number;
    checkpointKeepBlocks: number;
}

export type TowerSettleResult =
    | 'waiting'
    | 'stable'
    | 'failed';