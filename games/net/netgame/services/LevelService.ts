import { TruckEntity } from "../truck/TruckEntity";

export const LEVEL_1_CONFIG = {
    spawnPoint: { x: 200, y: 400 },
    finishLineX: 4800,
    floorWidth: 10000,
    floorY: 500
};
export class LevelService {
    constructor(
        private truck: TruckEntity,
        private config: typeof LEVEL_1_CONFIG,
        private onReset: () => void
    ) { }

    public update(): void {
        // Check if truck passed the finish line
        if (this.truck.transform.position.x > this.config.finishLineX) {
            this.resetLevel();
        }
    }

    private resetLevel(): void {
        console.log("Level Complete! Respawning...");
        // Teleport the truck back
        this.truck.teleport(this.config.spawnPoint.x, this.config.spawnPoint.y);
        // Reset velocities so it doesn't fly off instantly
        this.truck.reset();
        // Notify scene to reset camera
        this.onReset();
    }
}