import { LaneEntity } from "./LaneEntity";

export class AutonomousEntitySystem {
    private readonly lanes: LaneEntity[] = [];

    public addLane(lane: LaneEntity): void {
        this.lanes.push(lane);
    }

    public update(delta: number): void {
        for (const lane of this.lanes) {
            lane.update(delta);
        }
    }
}
