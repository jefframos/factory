import { GameScene } from "@core/scene/GameScene";
import AnalogInput from "@core/io/AnalogInput";
import * as PIXI from "pixi.js";
import ClogWorld3dScene from "./ClogWorld3dScene";
import KeyboardInputMovement from "core/io/KeyboardInputMovement";


export default class BaseDemoScene extends GameScene {

    private speedMultiplier = 1;
    private world3d: ClogWorld3dScene;
    private analogInput: AnalogInput;
    private keyboardInput: KeyboardInputMovement;

    public async build(): Promise<void> {
        // Start up the 3D world scene (Three.js handles gameplay)
        this.world3d = new ClogWorld3dScene(this.game);
        await this.world3d.build();

        // Three.js renders below Pixi by default (zIndex: 0)
        // Pixi (this scene) handles the UI — make it interactive so AnalogInput receives pointer events
        this.eventMode = 'static';
        // Hit area much larger than the screen so joystick never loses tracking near edges
        this.hitArea = new PIXI.Rectangle(-2000, -2000, 6000, 6000);

        // AnalogInput lives in Pixi space (this container = full-screen UI layer)
        this.analogInput = new AnalogInput(this);
        this.analogInput.onMove.add(({ direction, magnitude }) => {
            this.world3d.moveInput.x = direction.x * magnitude;
            this.world3d.moveInput.z = direction.y * magnitude; // Pixi Y → Three.js Z
        });

        this.keyboardInput = new KeyboardInputMovement();
        this.keyboardInput.onMove.add(({ direction, magnitude }) => {
            this.world3d.moveInput.x = direction.x * magnitude;
            this.world3d.moveInput.z = direction.y * magnitude; // Pixi Y → Three.js Z
        });


    }

    public update(delta: number): void {
        const scaledDelta = delta * this.speedMultiplier;

        // Drive the Three.js render loop
        this.world3d?.update(scaledDelta);
    }

    public destroy(): void {
        this.world3d?.destroy();
    }


}
