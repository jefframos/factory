import * as PIXI from "pixi.js";
import { LiftDefinition, LiftSaveState, LiftState, ResourceType } from "./MiningDemoTypes";
import { TextPopSystem } from "./TextPopSystem";
import type { LaneEntity } from "./LaneEntity";
import type { OfficeEntity } from "./OfficeEntity";

export class LiftEntity extends PIXI.Container {
    public state: LiftState = LiftState.MovingDown;

    public onStateChanged?: (state: LiftSaveState) => void;

    private currentLaneIndex = 0;
    private lanesVisited = 0;
    private readonly cargoByResource: Record<ResourceType, number> = {
        gold: 0,
        iron: 0,
        coal: 0,
        crystal: 0,
    };

    private collectTimer = 0;
    private readonly body = new PIXI.Graphics();
    private readonly stateLabel: PIXI.Text;

    private lanes: LaneEntity[] = [];
    private office: OfficeEntity | undefined;

    public constructor(
        public readonly def: LiftDefinition,
        private readonly textPopSystem: TextPopSystem
    ) {
        super();

        this.drawBody();

        this.stateLabel = new PIXI.Text("", new PIXI.TextStyle({
            fontFamily: "Arial",
            fontSize: 10,
            fill: 0xffffff,
            stroke: "#000000",
            strokeThickness: 2,
        }));

        this.stateLabel.anchor.set(0.5);
        this.stateLabel.y = 40;
        this.addChild(this.stateLabel);
    }

    public setLanes(lanes: LaneEntity[]): void {
        this.lanes = lanes;
    }

    public setOffice(office: OfficeEntity): void {
        this.office = office;
    }

    public getState(): LiftSaveState {
        return {
            state: this.state,
            currentLaneIndex: this.currentLaneIndex,
            lanesVisited: this.lanesVisited,
            cargoByResource: { ...this.cargoByResource },
            positionY: this.y,
        };
    }

    public restoreState(saved: LiftSaveState): void {
        this.state = saved.state as LiftState;
        this.currentLaneIndex = Math.max(0, saved.currentLaneIndex);
        this.lanesVisited = Math.max(0, saved.lanesVisited);
        const c = saved.cargoByResource;
        this.cargoByResource.gold = typeof c.gold === "number" ? c.gold : 0;
        this.cargoByResource.iron = typeof c.iron === "number" ? c.iron : 0;
        this.cargoByResource.coal = typeof c.coal === "number" ? c.coal : 0;
        this.cargoByResource.crystal = typeof c.crystal === "number" ? c.crystal : 0;
        if (typeof saved.positionY === "number") {
            this.y = saved.positionY;
        }
    }

    public update(delta: number): void {
        this.stateLabel.text = this.getDebugStateText();

        switch (this.state) {
            case LiftState.MovingDown:
                this.updateMovingDown(delta);
                break;

            case LiftState.Collecting:
                this.updateCollecting(delta);
                break;

            case LiftState.MovingUp:
                this.updateMovingUp(delta);
                break;

            case LiftState.Depositing:
                this.updateDepositing(delta);
                break;
        }
    }

    private updateMovingDown(delta: number): void {
        if (this.lanes.length === 0) {
            return;
        }

        // If we've visited all lanes, start going up
        if (this.lanesVisited >= this.lanes.length) {
            this.state = LiftState.MovingUp;
            this.onStateChanged?.(this.getState());
            return;
        }

        const currentLane = this.lanes[this.currentLaneIndex];
        const laneDepositSpot = currentLane.view.getDepositSpotPosition();
        const laneDepositSpotWorld = currentLane.toGlobal(
            new PIXI.Point(laneDepositSpot.x, laneDepositSpot.y)
        );
        const targetLocal = this.parent?.toLocal(laneDepositSpotWorld);
        if (!targetLocal) {
            return;
        }
        const targetWorldY = targetLocal.y;

        const dy = targetWorldY - this.y;
        const distance = Math.abs(dy);

        if (distance <= 1) {
            this.y = targetWorldY;
            this.state = LiftState.Collecting;
            this.collectTimer = 0;
            this.onStateChanged?.(this.getState());
            return;
        }

        const step = this.def.velocity * delta;
        this.y += Math.sign(dy) * Math.min(step, distance);
    }

    private updateCollecting(delta: number): void {
        this.collectTimer += delta;

        if (this.collectTimer < this.def.collectDurationSeconds) {
            return;
        }

        if (this.lanesVisited < this.lanes.length) {
            const currentLane = this.lanes[this.currentLaneIndex];
            const laneStored = currentLane.getStoredResourceAmount();

            if (laneStored > 0) {
                const collected = currentLane.collectStoredResources();

                this.cargoByResource[currentLane.resourceType] += collected;

                const worldPos = this.toGlobal(new PIXI.Point(0, -40));
                this.textPopSystem.show(
                    `Lift: +${collected.toFixed(1)}`,
                    worldPos.x,
                    worldPos.y
                );
            }

            this.currentLaneIndex = (this.currentLaneIndex + 1) % this.lanes.length;
            this.lanesVisited++;
        }

        this.state = LiftState.MovingDown;
        this.onStateChanged?.(this.getState());
    }

    private updateMovingUp(delta: number): void {
        if (!this.office) {
            return;
        }

        const officeStopWorld = this.office.getDropboxPositionGlobal();
        const targetLocal = this.parent?.toLocal(officeStopWorld);
        if (!targetLocal) {
            return;
        }

        const targetWorldY = targetLocal.y;
        const dy = targetWorldY - this.y;
        const distance = Math.abs(dy);

        if (distance <= 1) {
            this.y = targetWorldY;
            this.state = LiftState.Depositing;
            this.collectTimer = 0;
            this.onStateChanged?.(this.getState());
            return;
        }

        const step = this.def.velocity * delta;
        this.y += Math.sign(dy) * Math.min(step, distance);
    }

    private updateDepositing(delta: number): void {
        if (!this.office || this.getTotalCargo() <= 0) {
            // Deposit complete, reset cycle
            this.lanesVisited = 0;
            this.currentLaneIndex = 0;
            this.state = LiftState.MovingDown;
            this.onStateChanged?.(this.getState());
            return;
        }

        this.collectTimer += delta;

        if (this.collectTimer < this.def.collectDurationSeconds) {
            return;
        }

        for (const resourceType of Object.keys(this.cargoByResource) as ResourceType[]) {
            const amount = this.cargoByResource[resourceType];
            if (amount <= 0) {
                continue;
            }

            const deposited = this.office.depositToDropbox(resourceType, amount);
            this.cargoByResource[resourceType] -= deposited;
        }

        if (this.getTotalCargo() <= 0.0001) {
            this.clearCargo();
            this.lanesVisited = 0;
            this.currentLaneIndex = 0;
            this.state = LiftState.MovingDown;
            this.onStateChanged?.(this.getState());
        } else {
            this.collectTimer = 0;
        }
    }

    private getTotalCargo(): number {
        return this.cargoByResource.gold +
            this.cargoByResource.iron +
            this.cargoByResource.coal +
            this.cargoByResource.crystal;
    }

    private clearCargo(): void {
        this.cargoByResource.gold = 0;
        this.cargoByResource.iron = 0;
        this.cargoByResource.coal = 0;
        this.cargoByResource.crystal = 0;
    }

    private getDebugStateText(): string {
        const total = this.getTotalCargo();
        const cargo = total > 0 ? ` [${total.toFixed(0)}]` : "";
        switch (this.state) {
            case LiftState.MovingDown: return `↓${cargo}`;
            case LiftState.Collecting: return `collect${cargo}`;
            case LiftState.MovingUp: return `↑${cargo}`;
            case LiftState.Depositing: return `deposit${cargo}`;
        }
    }

    private drawBody(): void {
        this.body.clear();

        this.body.beginFill(0xffaa00);
        this.body.drawRect(-20, -30, 40, 60);
        this.body.endFill();

        this.body.lineStyle(2, 0xffdd00, 1);
        this.body.moveTo(-25, -35);
        this.body.lineTo(-25, 35);
        this.body.moveTo(25, -35);
        this.body.lineTo(25, 35);

        this.addChild(this.body);
    }
}
