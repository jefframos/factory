import * as PIXI from "pixi.js";
import {
    LaneDefinition,
    LaneFactoryDefinition,
    LaneManagerDefinition,
    ResourceType,
} from "./MiningDemoTypes";
import { TextPopSystem } from "./TextPopSystem";
import { LaneEntity } from "./LaneEntity";
import { LaneProgressStorage } from "./LaneProgressStorage";

export class LaneManager extends PIXI.Container {
    private readonly lanes: LaneEntity[] = [];

    public onBoughtLanesChanged?: (lanes: { resourceType: ResourceType }[]) => void;

    private laneMinedTotalsById: Record<string, number> = {};
    private laneProgressDirty = false;
    private laneProgressSaveTimer = 0;

    private laneDepositsById: Record<string, number> = {};
    private laneDepositsDirty = false;
    private laneDepositsSaveTimer = 0;

    public constructor(
        private readonly managerDef: LaneManagerDefinition,
        private readonly factoryDef: LaneFactoryDefinition,
        private readonly textPopSystem: TextPopSystem,
        private readonly laneProgressStorage: LaneProgressStorage
    ) {
        super();
    }

    public async initialize(): Promise<void> {
        this.laneMinedTotalsById = await this.laneProgressStorage.load();
        this.laneDepositsById = await this.laneProgressStorage.loadDeposits();
    }

    public get laneCount(): number {
        return this.lanes.length;
    }

    public get canBuyLane(): boolean {
        return this.lanes.length < this.managerDef.maxLanes;
    }

    public getLanes(): LaneEntity[] {
        return this.lanes;
    }

    public getNextLaneCost(): number {
        return Math.floor(
            this.managerDef.baseLaneCost *
            Math.pow(this.managerDef.laneCostGrowth, this.lanes.length)
        );
    }

    public createInitialLane(resourceType: ResourceType): LaneEntity | undefined {
        return this.addLane(resourceType, true);
    }

    public restoreLane(resourceType: ResourceType): LaneEntity | undefined {
        return this.addLane(resourceType, false);
    }

    public buyLane(resourceType: ResourceType): LaneEntity | undefined {
        if (!this.canBuyLane) {
            return undefined;
        }

        return this.addLane(resourceType, true);
    }

    public collectAllStoredResources(): Partial<Record<ResourceType, number>> {
        const result: Partial<Record<ResourceType, number>> = {};

        for (const lane of this.lanes) {
            const amount = lane.collectStoredResources();
            if (amount <= 0) continue;

            result[lane.resourceType] = (result[lane.resourceType] ?? 0) + amount;
        }

        return result;
    }

    public update(delta: number): void {
        for (const lane of this.lanes) {
            lane.update(delta);
        }

        if (this.laneProgressDirty) {
            this.laneProgressSaveTimer -= delta;

            if (this.laneProgressSaveTimer <= 0) {
                this.laneProgressSaveTimer = 0.5;
                void this.saveLaneProgress();
            }
        }

        if (this.laneDepositsDirty) {
            this.laneDepositsSaveTimer -= delta;

            if (this.laneDepositsSaveTimer <= 0) {
                this.laneDepositsSaveTimer = 0.5;
                void this.saveLaneDeposits();
            }
        }
    }

    private addLane(resourceType: ResourceType, fireCallback: boolean): LaneEntity | undefined {
        const laneDef = this.createLaneDefinition(resourceType, this.lanes.length);
        const lane = new LaneEntity(
            laneDef,
            this.textPopSystem,
            this.laneMinedTotalsById[laneDef.id] ?? 0,
            this.onLaneMinedTotalChanged,
            this.laneDepositsById[laneDef.id] ?? 0,
            this.onLaneDepositChanged
        );

        this.lanes.push(lane);
        this.addChild(lane);

        this.positionLanes();
        this.addDefaultWorkers(lane);

        if (fireCallback) {
            this.onBoughtLanesChanged?.(this.lanes.map(l => ({ resourceType: l.resourceType })));
        }

        return lane;
    }

    private createLaneDefinition(
        resourceType: ResourceType,
        laneIndex: number
    ): LaneDefinition {
        return {
            id: `lane-${laneIndex}-${resourceType}`,
            resourceType,

            maxWorkers: this.factoryDef.defaultMaxWorkers,

            miningSlots: this.factoryDef.defaultMiningSlots,
            depositSlots: this.factoryDef.defaultDepositSlots,

            depositDurationSeconds: this.factoryDef.defaultDepositDurationSeconds,
            depositLimit: this.factoryDef.defaultDepositLimit,
            miningProgressMaxAmount: this.factoryDef.defaultMiningProgressMaxAmount,

            layout: this.factoryDef.defaultLayout,
        };
    }

    private readonly onLaneMinedTotalChanged = (
        laneId: string,
        totalMinedAmount: number
    ): void => {
        this.laneMinedTotalsById[laneId] = totalMinedAmount;
        this.laneProgressDirty = true;
    };

    private readonly onLaneDepositChanged = (
        laneId: string,
        amount: number
    ): void => {
        this.laneDepositsById[laneId] = amount;
        this.laneDepositsDirty = true;
    };

    private async saveLaneProgress(): Promise<void> {
        if (!this.laneProgressDirty) {
            return;
        }

        this.laneProgressDirty = false;

        try {
            await this.laneProgressStorage.save(this.laneMinedTotalsById);
        } catch {
            this.laneProgressDirty = true;
        }
    }

    private async saveLaneDeposits(): Promise<void> {
        if (!this.laneDepositsDirty) {
            return;
        }

        this.laneDepositsDirty = false;

        try {
            await this.laneProgressStorage.saveDeposits(this.laneDepositsById);
        } catch {
            this.laneDepositsDirty = true;
        }
    }

    private addDefaultWorkers(lane: LaneEntity): void {
        for (const workerDef of this.factoryDef.defaultWorkers) {
            lane.addWorker(workerDef);
        }
    }

    private positionLanes(): void {
        for (let i = 0; i < this.lanes.length; i++) {
            this.lanes[i].position.set(0, i * this.managerDef.laneSpacing);
        }
    }
}
