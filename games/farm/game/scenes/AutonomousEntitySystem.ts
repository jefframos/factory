import { LaneManager } from "./LaneManager";

export class AutonomousEntitySystem {
    public constructor(private readonly laneManager: LaneManager) {}

    public update(delta: number): void {
        this.laneManager.update(delta);
    }
}
