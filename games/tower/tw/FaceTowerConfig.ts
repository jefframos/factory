// FaceTowerConfig.ts

import type { FaceTowerConfig } from './FaceTowerTypes';

export const DEFAULT_FACE_TOWER_CONFIG: FaceTowerConfig = {
    spawnY: 110,

    minBlockX: 80,
    maxBlockX: 1120,

    blockWidth: 90,
    blockHeight: 90,

    floorWidth: 1200,
    floorHeight: 60,
    floorX: 600,
    floorY: 700,

    deathY: 900,

    settleLinearSpeed: 0.35,
    settleAngularSpeed: 0.05,

    settleDuration: 0.35,
    maximumSettleDuration: 2.5,

    checkpointEvery: 10,
    checkpointKeepBlocks: 6,
};