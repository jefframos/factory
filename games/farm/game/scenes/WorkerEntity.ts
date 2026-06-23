import * as PIXI from "pixi.js";
import { WorkerDefinition, WorkerState } from "./MiningDemoTypes";
import { TextPopSystem } from "./TextPopSystem";
import { LaneEntity } from "./LaneEntity";

export class WorkerEntity extends PIXI.Container {
    public state: WorkerState = WorkerState.MovingToMiningQueue;

    private carriedAmount = 0;

    private mineTickTimer = 0;
    private mineTickAmount = 0;

    private depositTimer = 0;

    private targetX = 0;
    private targetY = 0;

    private readonly body = new PIXI.Graphics();
    private readonly idLabel: PIXI.Text;
    private readonly stateLabel: PIXI.Text;

    public constructor(
        public readonly workerDef: WorkerDefinition,
        public readonly lane: LaneEntity,
        private readonly textPopSystem: TextPopSystem
    ) {
        super();

        this.drawBody();

        this.idLabel = new PIXI.Text(workerDef.id.toString(), new PIXI.TextStyle({
            fontFamily: "LEMONMILK-Bold",
            fontSize: 14,
            fill: 0xffffff,
            stroke: "#000000",
            strokeThickness: 3,
        }));

        this.idLabel.anchor.set(0.5);
        this.idLabel.y = -28;
        this.addChild(this.idLabel);

        this.stateLabel = new PIXI.Text("", new PIXI.TextStyle({
            fontFamily: "Arial",
            fontSize: 10,
            fill: 0xffffff,
            stroke: "#000000",
            strokeThickness: 2,
        }));

        this.stateLabel.anchor.set(0.5);
        this.stateLabel.y = 24;
        this.addChild(this.stateLabel);
    }

    public update(delta: number): void {
        this.stateLabel.text = this.getDebugStateText();

        switch (this.state) {
            case WorkerState.MovingToMiningQueue:
                this.updateMove(delta, () => {
                    this.state = WorkerState.WaitingInMiningQueue;
                    this.lane.notifyMiningQueueReady(this);
                });
                break;

            case WorkerState.WaitingInMiningQueue:
                break;

            case WorkerState.MovingToMiningSpot:
                this.updateMove(delta, () => {
                    this.resetMiningTick();
                    this.state = WorkerState.Mining;
                });
                break;

            case WorkerState.Mining:
                this.updateMining(delta);
                break;

            case WorkerState.MovingToDepositQueue:
                this.updateMove(delta, () => {
                    this.state = WorkerState.WaitingInDepositQueue;
                    this.lane.notifyDepositQueueReady(this);
                });
                break;

            case WorkerState.WaitingInDepositQueue:
                break;

            case WorkerState.MovingToDepositSpot:
                this.updateMove(delta, () => {
                    this.depositTimer = 0;
                    this.state = WorkerState.Depositing;
                });
                break;

            case WorkerState.Depositing:
                this.updateDepositing(delta);
                break;
        }
    }

    public get carryAmount(): number {
        return this.carriedAmount;
    }

    public get hasFullCarry(): boolean {
        return this.carriedAmount >= this.workerDef.carryCapacity;
    }

    public get hasCarry(): boolean {
        return this.carriedAmount > 0;
    }

    public moveToMiningQueueSlot(x: number, y: number): void {
        this.targetX = x;
        this.targetY = y;

        if (
            this.state === WorkerState.Depositing ||
            this.state === WorkerState.WaitingInMiningQueue ||
            this.state === WorkerState.MovingToMiningQueue
        ) {
            this.state = WorkerState.MovingToMiningQueue;
        }
    }

    public moveToDepositQueueSlot(x: number, y: number): void {
        this.targetX = x;
        this.targetY = y;

        if (
            this.state === WorkerState.Mining ||
            this.state === WorkerState.WaitingInDepositQueue ||
            this.state === WorkerState.MovingToDepositQueue
        ) {
            this.state = WorkerState.MovingToDepositQueue;
        }
    }

    public moveToMiningSpot(): void {
        this.targetX = this.lane.laneDef.miningX;
        this.targetY = this.lane.laneDef.miningY;
        this.state = WorkerState.MovingToMiningSpot;
    }

    public moveToDepositSpot(): void {
        this.targetX = this.lane.laneDef.depositX;
        this.targetY = this.lane.laneDef.depositY;
        this.state = WorkerState.MovingToDepositSpot;
    }

    public isReadyForMiningService(): boolean {
        return this.state === WorkerState.WaitingInMiningQueue;
    }

    public isReadyForDepositService(): boolean {
        return this.state === WorkerState.WaitingInDepositQueue;
    }

    public startMiningLoop(): void {
        this.lane.enqueueMining(this);
    }

    private updateMining(delta: number): void {
        if (this.hasFullCarry) {
            this.finishMining();
            return;
        }

        let remainingDelta = delta;

        while (remainingDelta > 0 && !this.hasFullCarry) {
            const timeUntilNextTick = 1 - this.mineTickTimer;
            const timeStep = Math.min(remainingDelta, timeUntilNextTick);

            const remainingCarrySpace =
                this.workerDef.carryCapacity - this.carriedAmount;

            const minedThisStep = Math.min(
                this.workerDef.miningSpeed * timeStep,
                remainingCarrySpace
            );

            this.carriedAmount += minedThisStep;
            this.mineTickAmount += minedThisStep;

            this.mineTickTimer += timeStep;
            remainingDelta -= timeStep;

            if (this.mineTickTimer >= 1) {
                this.showMinePop(this.mineTickAmount);
                this.resetMiningTick();
            }

            if (this.hasFullCarry) {
                if (this.mineTickAmount > 0) {
                    this.showMinePop(this.mineTickAmount);
                    this.resetMiningTick();
                }

                this.finishMining();
                return;
            }
        }
    }

    private resetMiningTick(): void {
        this.mineTickTimer = 0;
        this.mineTickAmount = 0;
    }

    private showMinePop(amount: number): void {
        if (amount <= 0) return;

        this.textPopSystem.show(
            `+${amount.toFixed(1)}`,
            this.x,
            this.y - 38
        );
    }

    private finishMining(): void {
        if (this.state !== WorkerState.Mining) return;

        this.lane.releaseMiningService(this);
        this.state = WorkerState.MovingToDepositQueue;
        this.lane.enqueueDeposit(this);
    }

    private updateDepositing(delta: number): void {
        this.depositTimer += delta;

        if (this.depositTimer < this.lane.laneDef.depositDurationSeconds) {
            return;
        }

        const deposited = this.lane.depositFromWorker(this.carriedAmount);

        this.carriedAmount -= deposited;

        if (this.carriedAmount < 0.0001) {
            this.carriedAmount = 0;
        }

        this.lane.releaseDepositService(this);

        if (this.hasCarry) {
            this.lane.enqueueDeposit(this);
            return;
        }

        this.lane.enqueueMining(this);
    }

    private updateMove(delta: number, onArrive: () => void): void {
        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= 1) {
            this.position.set(this.targetX, this.targetY);
            onArrive();
            return;
        }

        const step = this.workerDef.velocity * delta;
        const ratio = Math.min(1, step / distance);

        this.x += dx * ratio;
        this.y += dy * ratio;
    }

    private getDebugStateText(): string {
        switch (this.state) {
            case WorkerState.MovingToMiningQueue:
                return "to mine q";
            case WorkerState.WaitingInMiningQueue:
                return "mine q";
            case WorkerState.MovingToMiningSpot:
                return "to mine";
            case WorkerState.Mining:
                return "mining";
            case WorkerState.MovingToDepositQueue:
                return "to dep q";
            case WorkerState.WaitingInDepositQueue:
                return "dep q";
            case WorkerState.MovingToDepositSpot:
                return "to dep";
            case WorkerState.Depositing:
                return "deposit";
        }
    }

    private drawBody(): void {
        this.body.clear();

        this.body.beginFill(0x44ccff);
        this.body.drawCircle(0, 0, 16);
        this.body.endFill();

        this.addChild(this.body);
    }
}