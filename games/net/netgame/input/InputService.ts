import { TruckMover } from "../services/TruckMover";
import { InputBinder, InputMode } from "./InputBinder";

export class InputService {
    private binder: InputBinder;
    private mover: TruckMover | null = null;

    constructor() {
        this.binder = new InputBinder();

        // Bindings are created once, but they check the current mover every frame
        this.binder.bind(['ArrowUp', 'KeyW'], InputMode.HOLD, () => {
            this.mover?.rotateForward();
        });

        this.binder.bind(['ArrowDown', 'KeyS'], InputMode.HOLD, () => {
            this.mover?.rotateBackward();
        });

        this.binder.bind(['ArrowRight', 'KeyD'], InputMode.HOLD, () => {
            this.mover?.moveForward();
        });

        this.binder.bind(['ArrowLeft', 'KeyA'], InputMode.HOLD, () => {
            this.mover?.moveBackward();
        });

        this.binder.bind('Space', InputMode.PRESSED, () => {
            this.mover?.jump();
        });
    }

    /**
     * Re-inserts the ability to change the active entity
     */
    public setMover(mover: TruckMover): void {
        this.mover = mover;
    }

    public update(): void {
        this.binder.update();
    }
}