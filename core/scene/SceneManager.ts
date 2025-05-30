import * as PIXI from 'pixi.js';
import { GameScene } from "./GameScene";
type SceneConstructor = new (...constructorParams: any | undefined[]) => GameScene;

export class SceneManager {
    private appContainer: PIXI.Container;
    private scenes = new Map<string, GameScene>();
    private currentKey: string | null = null;

    constructor(app: PIXI.Container) {
        this.appContainer = app;
    }

    /** Register a scene under a key */
    public register<T>(key: string, sceneCtor: SceneConstructor, ...constructorParams: any | undefined[]): T {
        if (this.scenes.has(key)) {
            throw new Error(`Scene "${key}" already registered.`);
        }
        const scene = new sceneCtor(...constructorParams)
        this.scenes.set(key, scene);

        return scene as T
    }

    /** Switch to a registered scene */
    public changeScene(key: string, ...buildParams: any | undefined[]): void {
        if (key === this.currentKey) return;

        // tear down current
        if (this.currentKey) {
            const old = this.scenes.get(this.currentKey)!;
            old.hide();
            old.destroy();
            this.appContainer.removeChild(old);
        }

        // bring in new
        const next = this.scenes.get(key);
        if (!next) throw new Error(`Scene "${key}" not found.`);
        this.currentKey = key;
        next.build(...buildParams);
        this.appContainer.addChild(next);
        next.resize();
        next.show();
    }

    public update(delta: number): void {
        if (!this.currentKey) return;
        const scene = this.scenes.get(this.currentKey)!;
        scene.update(delta);
    }
    public resize(): void {
        if (!this.currentKey) return;
        const scene = this.scenes.get(this.currentKey)!;
        scene.resize();
    }
}
