import * as PIXI from 'pixi.js';

/**
 * Base class for all game scenes.
 */
export abstract class GameScene extends PIXI.Container {
    public build(...data: any[]): void { };
    public resize(): void { };
    public show(): void { };
    public hide(): void { };
    public abstract destroy(): void;
    public abstract update(delta: number): void;
}
