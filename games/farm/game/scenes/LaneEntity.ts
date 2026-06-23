import * as PIXI from "pixi.js";
import { LaneDefinition, WorkerDefinition } from "./MiningDemoTypes";
import { TextPopSystem } from "./TextPopSystem";
import { WorkerEntity } from "./WorkerEntity";
import { LaneView } from "./LaneView";

export class LaneEntity extends PIXI.Container {
    public readonly view: LaneView;

    private readonly workers: WorkerEntity[] = [];

    private readonly miningQueue: WorkerEntity[] = [];
    private readonly miningReady: Set<WorkerEntity> = new Set();
    private readonly activeMiners: Set<WorkerEntity> = new Set();

    private readonly depositQueue: WorkerEntity[] = [];
    private readonly depositReady: Set<WorkerEntity> = new Set();
    private readonly activeDepositors: Set<WorkerEntity> = new Set();

    private depositedAmount = 0;
    private totalMinedAmount = 0;

    public constructor(
        public readonly laneDef: LaneDefinition,
        private readonly textPopSystem: TextPopSystem,
        initialTotalMinedAmount = 0,
        private readonly onTotalMinedChanged?: (laneId: string, totalMinedAmount: number) => void,
        initialDepositAmount = 0,
        private readonly onDepositChanged?: (laneId: string, amount: number) => void
    ) {
        super();

        this.view = new LaneView(laneDef.layout, laneDef.resourceType);
        this.addChild(this.view);

        this.totalMinedAmount = Math.max(0, initialTotalMinedAmount);
        this.depositedAmount = Math.max(0, Math.min(initialDepositAmount, laneDef.depositLimit));
        this.applyMiningProgress();

        this.refreshView();
    }

    public get resourceType() {
        return this.laneDef.resourceType;
    }

    public get isDepositFull(): boolean {
        return this.depositedAmount >= this.laneDef.depositLimit;
    }

    public get remainingDepositSpace(): number {
        return Math.max(0, this.laneDef.depositLimit - this.depositedAmount);
    }

    public getStoredResourceAmount(): number {
        return this.depositedAmount;
    }

    public collectStoredResources(): number {
        const amount = this.depositedAmount;

        this.depositedAmount = 0;
        this.refreshView();
        this.onDepositChanged?.(this.laneDef.id, 0);

        return amount;
    }

    public addWorker(workerDef: WorkerDefinition): WorkerEntity | undefined {
        if (this.workers.length >= this.laneDef.maxWorkers) {
            return undefined;
        }

        const worker = new WorkerEntity(workerDef, this, this.textPopSystem);
        const entrance = this.view.getEntrancePosition();

        worker.position.set(
            entrance.x,
            entrance.y + this.workers.length * 34
        );

        this.workers.push(worker);
        this.addChild(worker);

        worker.startMiningLoop();

        return worker;
    }

    public enqueueMining(worker: WorkerEntity): void {
        this.removeFromDepositQueue(worker);
        this.depositReady.delete(worker);
        this.activeDepositors.delete(worker);

        if (this.miningQueue.includes(worker) || this.activeMiners.has(worker)) {
            return;
        }

        this.miningQueue.push(worker);
        this.rebuildMiningQueueTargets();
        this.tryStartMiningServices();
    }

    public notifyMiningQueueReady(worker: WorkerEntity): void {
        if (!this.miningQueue.includes(worker)) {
            return;
        }

        this.miningReady.add(worker);
        this.tryStartMiningServices();
    }

    public releaseMiningService(worker: WorkerEntity): void {
        this.activeMiners.delete(worker);
    }

    public enqueueDeposit(worker: WorkerEntity): void {
        this.removeFromMiningQueue(worker);
        this.miningReady.delete(worker);
        this.activeMiners.delete(worker);

        if (this.depositQueue.includes(worker) || this.activeDepositors.has(worker)) {
            return;
        }

        this.depositQueue.push(worker);
        this.rebuildDepositQueueTargets();
        this.tryStartDepositServices();
    }

    public notifyDepositQueueReady(worker: WorkerEntity): void {
        if (!this.depositQueue.includes(worker)) {
            return;
        }

        this.depositReady.add(worker);
        this.tryStartDepositServices();
    }

    public releaseDepositService(worker: WorkerEntity): void {
        this.activeDepositors.delete(worker);
    }

    public depositFromWorker(amount: number): number {
        if (this.isDepositFull) {
            return 0;
        }

        const accepted = Math.min(amount, this.remainingDepositSpace);

        this.depositedAmount += accepted;
        this.refreshView();
        this.onDepositChanged?.(this.laneDef.id, this.depositedAmount);

        if (accepted > 0) {
            const depositSpot = this.view.getDepositSpotPosition();
            const worldPos = this.view.toGlobal(new PIXI.Point(depositSpot.x, depositSpot.y - 45));

            this.textPopSystem.show(
                `+${accepted.toFixed(1)} ${this.laneDef.resourceType}`,
                worldPos.x,
                worldPos.y
            );
        }

        return accepted;
    }

    public update(delta: number): void {
        for (const worker of this.workers) {
            worker.update(delta);
        }

        this.tryStartMiningServices();
        this.tryStartDepositServices();
    }

    public reportMinedAmount(amount: number): void {
        if (amount <= 0) {
            return;
        }

        const previousProgress = this.getMiningProgress();
        this.totalMinedAmount += amount;
        const nextProgress = this.getMiningProgress();

        if (nextProgress !== previousProgress) {
            this.applyMiningProgress();
        }

        this.onTotalMinedChanged?.(this.laneDef.id, this.totalMinedAmount);
    }

    private tryStartMiningServices(): void {
        while (
            this.activeMiners.size < this.laneDef.miningSlots &&
            this.miningQueue.length > 0
        ) {
            const worker = this.miningQueue[0];

            if (!this.miningReady.has(worker)) {
                return;
            }

            this.miningQueue.shift();
            this.miningReady.delete(worker);

            this.activeMiners.add(worker);
            this.rebuildMiningQueueTargets();

            worker.moveToMiningSpot();
        }
    }

    private tryStartDepositServices(): void {
        while (
            !this.isDepositFull &&
            this.activeDepositors.size < this.laneDef.depositSlots &&
            this.depositQueue.length > 0
        ) {
            const worker = this.depositQueue[0];

            if (!this.depositReady.has(worker)) {
                return;
            }

            this.depositQueue.shift();
            this.depositReady.delete(worker);

            this.activeDepositors.add(worker);
            this.rebuildDepositQueueTargets();

            worker.moveToDepositSpot();
        }
    }

    private removeFromMiningQueue(worker: WorkerEntity): void {
        const index = this.miningQueue.indexOf(worker);

        if (index < 0) {
            return;
        }

        this.miningQueue.splice(index, 1);
        this.miningReady.delete(worker);
        this.rebuildMiningQueueTargets();
    }

    private removeFromDepositQueue(worker: WorkerEntity): void {
        const index = this.depositQueue.indexOf(worker);

        if (index < 0) {
            return;
        }

        this.depositQueue.splice(index, 1);
        this.depositReady.delete(worker);
        this.rebuildDepositQueueTargets();
    }

    private rebuildMiningQueueTargets(): void {
        for (let i = 0; i < this.miningQueue.length; i++) {
            const worker = this.miningQueue[i];

            this.miningReady.delete(worker);

            const queuePosition = this.view.getMiningQueuePosition(i);

            worker.moveToMiningQueueSlot(
                queuePosition.x,
                queuePosition.y
            );
        }

        for (const worker of this.activeMiners) {
            worker.refreshMiningSpotTarget();
        }
    }

    private rebuildDepositQueueTargets(): void {
        for (let i = 0; i < this.depositQueue.length; i++) {
            const worker = this.depositQueue[i];

            this.depositReady.delete(worker);

            const queuePosition = this.view.getDepositQueuePosition(i);

            worker.moveToDepositQueueSlot(
                queuePosition.x,
                queuePosition.y
            );
        }
    }

    private refreshView(): void {
        this.view.setStorageState(this.depositedAmount, this.isDepositFull);
    }

    private getMiningProgress(): number {
        if (this.laneDef.miningProgressMaxAmount <= 0) {
            return 1;
        }

        return Math.min(1, this.totalMinedAmount / this.laneDef.miningProgressMaxAmount);
    }

    private applyMiningProgress(): void {
        this.view.setMiningProgress(this.getMiningProgress());
        this.rebuildMiningQueueTargets();
    }
}
