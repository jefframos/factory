import { TruckMover } from "games/net/netgame/services/TruckMover";

export class InputService {
    private keys: Record<string, boolean> = {};
    private mover: TruckMover | null = null; // Target the mover instead

    constructor() {
        window.addEventListener('keydown', (e) => this.keys[e.code] = true);
        window.addEventListener('keyup', (e) => this.keys[e.code] = false);
    }

    public setMover(mover: TruckMover) {
        this.mover = mover;
    }

    public update() {
        if (!this.mover) return;

        if (this.keys['ArrowRight'] || this.keys['KeyD']) {
            this.mover.moveForward();
        } else if (this.keys['ArrowLeft'] || this.keys['KeyA']) {
            this.mover.moveBackward();
        }

        // Use a specific check for jump
        if (this.keys['Space'] || this.keys['ArrowUp'] || this.keys['KeyW']) {
            this.mover.jump();
            // Optional: clear the key so they can't "fly" by holding space
            this.keys['Space'] = false;
            this.keys['ArrowUp'] = false;
            this.keys['KeyW'] = false;
        }

        if (this.keys['KeyS']) {
            this.mover.brake();
        }
    }
}