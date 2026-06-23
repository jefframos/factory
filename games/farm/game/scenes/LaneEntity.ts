import * as PIXI from "pixi.js";
import { LaneDefinition, WorkerDefinition } from "./MiningDemoTypes";
import { TextPopSystem } from "./TextPopSystem";
import { WorkerEntity } from "./WorkerEntity";

export class LaneEntity extends PIXI.Container {
    public readonly laneDef: LaneDefinition;

    private readonly workers: WorkerEntity[] = [];

    private readonly miningQueue: WorkerEntity[] = [];
    private readonly miningReady: Set<WorkerEntity> = new Set();
    private readonly activeMiners: Set<WorkerEntity> = new Set();

    private readonly depositQueue: WorkerEntity[] = [];
    private readonly depositReady: Set<WorkerEntity> = new Set();
    private readonly activeDepositors: Set<WorkerEntity> = new Set();

    private depositedAmount = 0;

    private readonly graphics = new PIXI.Graphics();

    public constructor(
        laneDef: LaneDefinition,
        private readonly textPopSystem: TextPopSystem
    ) {
        super();

        this.laneDef = laneDef;

        this.addChild(this.graphics);
        this.drawLane();
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
        this.drawLane();

        return amount;
    }

    public addWorker(workerDef: WorkerDefinition): WorkerEntity | undefined {
        if (this.workers.length >= this.laneDef.maxWorkers) {
            return undefined;
        }

        const worker = new WorkerEntity(workerDef, this, this.textPopSystem);

        worker.position.set(
            this.laneDef.entranceX,
            this.laneDef.entranceY + this.workers.length * 34
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
        this.drawLane();

        if (accepted > 0) {
            this.textPopSystem.show(
                `+${accepted.toFixed(1)} ${this.laneDef.resourceType}`,
                this.laneDef.depositX,
                this.laneDef.depositY - 45
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
        this.miningQueue.forEach((worker, index) => {
            this.miningReady.delete(worker);

            worker.moveToMiningQueueSlot(
                this.laneDef.miningX - ((index + 1) * this.laneDef.miningQueueSpacing),
                this.laneDef.miningY
            );
        });
    }
    private rebuildDepositQueueTargets(): void {
        this.depositQueue.forEach((worker, index) => {
            this.depositReady.delete(worker);

            worker.moveToDepositQueueSlot(
                this.laneDef.depositX + ((index + 1) * this.laneDef.depositQueueSpacing),
                this.laneDef.depositY
            );
        });
    }

    private drawLane(): void {
        this.graphics.clear();

        this.graphics.lineStyle(6, 0xffffff, 0.35);
        this.graphics.moveTo(this.laneDef.entranceX, this.laneDef.entranceY);
        this.graphics.lineTo(this.laneDef.miningX, this.laneDef.miningY);

        this.graphics.beginFill(0x5c3a1e);
        this.graphics.drawCircle(this.laneDef.miningX, this.laneDef.miningY, 35);
        this.graphics.endFill();

        this.graphics.beginFill(this.isDepositFull ? 0xff3333 : 0xffcc00);
        this.graphics.drawRect(
            this.laneDef.depositX - 45,
            this.laneDef.depositY + 35,
            90,
            25
        );
        this.graphics.endFill();

        this.drawQueueMarkers();
    }

    private drawQueueMarkers(): void {
        this.graphics.lineStyle(2, 0xffffff, 0.2);

        for (let i = 0; i < this.laneDef.maxWorkers; i++) {
            this.graphics.drawCircle(
                this.laneDef.miningX -
                ((i + 1) * this.laneDef.miningQueueSpacing),
                this.laneDef.miningY,
                18
            );

            this.graphics.drawCircle(
                this.laneDef.depositX +
                ((i + 1) * this.laneDef.depositQueueSpacing),
                this.laneDef.depositY,
                18
            );
        }
    }
}
