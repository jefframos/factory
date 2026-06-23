import * as PIXI from "pixi.js";
import { LiftSaveState, LiftSystemDefinition } from "./MiningDemoTypes";
import { TextPopSystem } from "./TextPopSystem";
import { OfficeEntity } from "./OfficeEntity";
import { LiftEntity } from "./LiftEntity";
import { TransportWorkerEntity } from "./TransportWorkerEntity";
import type { LaneEntity } from "./LaneEntity";

export class LiftSystem extends PIXI.Container {
    private office: OfficeEntity;
    private lifts: LiftEntity[] = [];
    private transportWorkers: TransportWorkerEntity[] = [];

    public onLiftStateChanged?: (state: LiftSaveState) => void;

    public constructor(
        private readonly def: LiftSystemDefinition,
        private readonly textPopSystem: TextPopSystem
    ) {
        super();

        this.office = new OfficeEntity(def.office, textPopSystem);
        this.addChild(this.office);

        this.createLifts();
        this.createTransportWorkers();
    }

    public getOffice(): OfficeEntity {
        return this.office;
    }

    public restoreLiftState(saved: LiftSaveState): void {
        this.lifts[0]?.restoreState(saved);
    }

    public setLanes(lanes: LaneEntity[]): void {
        for (const lift of this.lifts) {
            lift.setLanes(lanes);
        }
    }

    public update(delta: number): void {
        for (const lift of this.lifts) {
            lift.update(delta);
        }

        for (const worker of this.transportWorkers) {
            worker.update(delta);
        }
    }

    private createLifts(): void {
        for (let i = 0; i < this.def.liftCount; i++) {
            const lift = new LiftEntity(this.def.defaultLift, this.textPopSystem);

            // Lift starts at office Y (dropbox center), then goes down through lanes.
            const officeStopWorld = this.office.getDropboxPositionGlobal();
            const officeStopLocal = this.toLocal(officeStopWorld);
            lift.x = officeStopLocal.x + i * 60;
            lift.y = officeStopLocal.y;

            lift.onStateChanged = (s) => this.onLiftStateChanged?.(s);
            lift.setOffice(this.office);
            this.lifts.push(lift);
            this.addChild(lift);
        }
    }

    private createTransportWorkers(): void {
        for (const workerDef of this.def.defaultTransportWorkers) {
            const worker = new TransportWorkerEntity(workerDef, this.textPopSystem);

            worker.setOffice(this.office);

            const pickupPosition = this.office.getWorkerPickupPosition(Math.max(0, workerDef.id - 1));
            worker.position.set(pickupPosition.x, pickupPosition.y);

            this.transportWorkers.push(worker);
            this.office.getWorkerContainer().addChild(worker);

            worker.startWaitingForPickup();
        }
    }
}
