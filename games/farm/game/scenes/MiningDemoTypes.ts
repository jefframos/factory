import * as PIXI from "pixi.js";

export type ResourceType = "gold" | "iron" | "coal" | "crystal";

export interface ResourceDefinition {
    id: ResourceType;
    displayName: string;
}

export interface LaneLayoutDefinition {
    width: number;
    height: number;

    entrance: PIXI.IPointData;
    miningStartSpot?: PIXI.IPointData;
    miningSpot: PIXI.IPointData;
    depositSpot: PIXI.IPointData;

    miningQueueDirection: PIXI.IPointData;
    depositQueueDirection: PIXI.IPointData;

    miningQueueSpacing: number;
    depositQueueSpacing: number;
}

export interface LaneDefinition {
    id: string;
    resourceType: ResourceType;

    maxWorkers: number;

    miningSlots: number;
    depositSlots: number;

    depositDurationSeconds: number;
    depositLimit: number;
    miningProgressMaxAmount: number;

    layout: LaneLayoutDefinition;
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

export interface LaneManagerDefinition {
    maxLanes: number;
    laneSpacing: number;
    baseLaneCost: number;
    laneCostGrowth: number;
}

export interface LaneFactoryDefinition {
    defaultLayout: LaneLayoutDefinition;
    defaultWorkers: WorkerDefinition[];
    defaultMaxWorkers: number;
    defaultMiningSlots: number;
    defaultDepositSlots: number;
    defaultDepositDurationSeconds: number;
    defaultDepositLimit: number;
    defaultMiningProgressMaxAmount: number;
}

export interface LiftDefinition {
    id: string;
    velocity: number;
    collectCapacity: number;
    collectDurationSeconds: number;
}

export enum LiftState {
    MovingDown = "MovingDown",
    Collecting = "Collecting",
    MovingUp = "MovingUp",
    Depositing = "Depositing",
}

export interface LiftSaveState {
    state: string;
    currentLaneIndex: number;
    lanesVisited: number;
    cargoByResource: Record<string, number>;
    positionY?: number;
}

export interface TransportWorkerDefinition {
    id: number;
    velocity: number;
    carryCapacity: number;
    depositDurationSeconds: number;
}

export enum TransportWorkerState {
    MovingToLift = "MovingToLift",
    WaitingAtLift = "WaitingAtLift",
    MovingToOffice = "MovingToOffice",
    Depositing = "Depositing",
}

export interface OfficeDefinition {
    position: PIXI.IPointData;
    depositLimit: number;
}

export interface LiftSystemDefinition {
    liftCount: number;
    defaultLift: LiftDefinition;
    defaultTransportWorkers: TransportWorkerDefinition[];
    office: OfficeDefinition;
}
