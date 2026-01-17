import { Game } from '@core/Game';
import * as PIXI from 'pixi.js';

/**
 * Base class for all game scenes.
 */
export abstract class GameScene extends PIXI.Container {
    protected game: Game;
    constructor(game: Game) {
        super();
        this.game = game;
    }
    public build(...data: any[]): void { };
    public resize(): void { };
    public show(): void { };
    public hide(): void { };
    public abstract destroy(): void;
    public abstract update(delta: number): void;
}
