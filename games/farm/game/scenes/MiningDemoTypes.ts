export type ResourceType = "gold";

export interface LaneDefinition {
    id: string;
    resourceType: ResourceType;

    maxWorkers: number;

    miningSlots: number;
    miningQueueSpacing: number;

    depositSlots: number;
    depositQueueSpacing: number;
    depositDurationSeconds: number;

    depositLimit: number;

    entranceX: number;
    entranceY: number;

    miningX: number;
    miningY: number;

    depositX: number;
    depositY: number;
}

export interface WorkerDefinition {
    id: number;
    velocity: number;
    miningSpeed: number;
    carryCapacity: number;
}

export enum WorkerState {
    MovingToMiningQueue = "MovingToMiningQueue",
    WaitingInMiningQueue = "WaitingInMiningQueue",
    MovingToMiningSpot = "MovingToMiningSpot",
    Mining = "Mining",

    MovingToDepositQueue = "MovingToDepositQueue",
    WaitingInDepositQueue = "WaitingInDepositQueue",
    MovingToDepositSpot = "MovingToDepositSpot",
    Depositing = "Depositing",
}
