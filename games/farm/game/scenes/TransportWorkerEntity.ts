import * as PIXI from "pixi.js";
import { TransportWorkerDefinition, TransportWorkerState, ResourceType } from "./MiningDemoTypes";
import { TextPopSystem } from "./TextPopSystem";
import type { LiftEntity } from "./LiftEntity";
import type { OfficeEntity } from "./OfficeEntity";

export class TransportWorkerEntity extends PIXI.Container {
    public state: TransportWorkerState = TransportWorkerState.WaitingAtLift;

    private carriedAmount = 0;
    private carriedResourceType: ResourceType = "gold";
    private depositTimer = 0;
    private targetX = 0;
    private targetY = 0;

    private readonly body = new PIXI.Graphics();
    private readonly idLabel: PIXI.Text;
    private readonly stateLabel: PIXI.Text;
    private readonly workerIndex: number;

    private office: OfficeEntity | undefined;

    public constructor(
        public readonly def: TransportWorkerDefinition,
        private readonly textPopSystem: TextPopSystem
    ) {
        super();

        this.workerIndex = Math.max(0, def.id - 1);

        this.drawBody();

        this.idLabel = new PIXI.Text(def.id.toString(), new PIXI.TextStyle({
            fontFamily: "LEMONMILK-Bold",
            fontSize: 12,
            fill: 0xffffff,
            stroke: "#000000",
            strokeThickness: 2,
        }));
        this.idLabel.anchor.set(0.5);
        this.idLabel.y = -20;
        this.addChild(this.idLabel);

        this.stateLabel = new PIXI.Text("", new PIXI.TextStyle({
            fontFamily: "Arial",
            fontSize: 9,
            fill: 0xffffff,
            stroke: "#000000",
            strokeThickness: 1,
        }));
        this.stateLabel.anchor.set(0.5);
        this.stateLabel.y = 20;
        this.addChild(this.stateLabel);
    }

    public setLift(_lift: LiftEntity): void {
        // Kept for compatibility with existing callers.
    }

    public setOffice(office: OfficeEntity): void {
        this.office = office;
    }

    public update(delta: number): void {
        this.stateLabel.text = this.getDebugStateText();

        switch (this.state) {
            case TransportWorkerState.WaitingAtLift:
                this.updateWaiting(delta);
                break;
            case TransportWorkerState.MovingToOffice:
                this.updateMove(delta, () => {
                    this.depositTimer = 0;
                    this.state = TransportWorkerState.Depositing;
                });
                break;
            case TransportWorkerState.Depositing:
                this.updateDepositing(delta);
                break;
            case TransportWorkerState.MovingToLift:
                this.updateMove(delta, () => {
                    this.state = TransportWorkerState.WaitingAtLift;
                });
                break;
        }
    }

    public notifyPickupReady(): void {
        // Unused in this flow. Workers self-poll office dropbox.
    }

    public canPickup(): boolean {
        return this.state === TransportWorkerState.WaitingAtLift && this.carriedAmount <= 0;
    }

    public startWaitingForPickup(): void {
        this.moveToPickupZone();
        this.state = TransportWorkerState.MovingToLift;
    }

    private updateWaiting(delta: number): void {
        if (!this.office) {
            return;
        }

        this.updateMove(delta, () => {
            // Hold at pickup zone.
        });

        if (this.office.getDropboxResourceAmount() > 0) {
            this.updatePickup();
        }
    }

    private updatePickup(): void {
        if (!this.office || this.carriedAmount > 0) {
            return;
        }

        const resourceTypes: ResourceType[] = ["gold", "iron", "coal", "crystal"];
        for (const resourceType of resourceTypes) {
            const picked = this.office.pickupFromDropbox(resourceType, this.def.carryCapacity);
            if (picked > 0) {
                this.carriedAmount = picked;
                this.carriedResourceType = resourceType;
                this.depositTimer = 0;
                this.moveToOfficeDepositZone();
                this.state = TransportWorkerState.MovingToOffice;
                return;
            }
        }

        this.state = TransportWorkerState.WaitingAtLift;
    }

    private updateDepositing(delta: number): void {
        if (!this.office || this.carriedAmount <= 0) {
            this.carriedAmount = 0;
            this.depositTimer = 0;
            this.moveToPickupZone();
            this.state = TransportWorkerState.MovingToLift;
            return;
        }

        this.depositTimer += delta;
        if (this.depositTimer < this.def.depositDurationSeconds) {
            return;
        }

        const deposited = this.office.depositResource(this.carriedResourceType, this.carriedAmount);
        this.carriedAmount -= deposited;

        if (this.carriedAmount <= 0.0001) {
            this.carriedAmount = 0;
            this.depositTimer = 0;
            this.moveToPickupZone();
            this.state = TransportWorkerState.MovingToLift;
        } else {
            this.depositTimer = 0;
        }
    }

    private moveToPickupZone(): void {
        if (!this.office) {
            return;
        }

        const pickupPosition = this.office.getWorkerPickupPosition(this.workerIndex);
        this.targetX = pickupPosition.x;
        this.targetY = pickupPosition.y;
    }

    private moveToOfficeDepositZone(): void {
        if (!this.office) {
            return;
        }

        const depositPosition = this.office.getWorkerDepositPosition(this.workerIndex);
        this.targetX = depositPosition.x;
        this.targetY = depositPosition.y;
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

        const step = this.def.velocity * delta;
        const ratio = Math.min(1, step / distance);
        this.x += dx * ratio;
        this.y += dy * ratio;
    }

    private getDebugStateText(): string {
        switch (this.state) {
            case TransportWorkerState.MovingToLift:
                return "to box";
            case TransportWorkerState.WaitingAtLift:
                return "wait";
            case TransportWorkerState.MovingToOffice:
                return "to off";
            case TransportWorkerState.Depositing:
                return "dep";
        }
    }

    private drawBody(): void {
        this.body.clear();
        this.body.beginFill(0x00ccff);
        this.body.drawCircle(0, 0, 12);
        this.body.endFill();
        this.addChild(this.body);
    }
}
