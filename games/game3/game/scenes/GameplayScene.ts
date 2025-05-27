import { Game } from "@core/Game";
import { GameScene } from "@core/scene/GameScene";
import { ExtractTiledFile } from "@core/tiled/ExtractTiledFile";
import TiledAutoPositionObject from "@core/tiled/TiledAutoPositionObject";
import * as PIXI from 'pixi.js';
import SwipeInputManager from "../io/SwipeInputManager";
import MainMenuUi from "../ui/MainMenuUi";
import ScoreUi from "../ui/ScoreUi";
import { GridManager } from "./GridManager";

export default class GameplayScene extends GameScene {

    private gameplayContainer = new PIXI.Container();
    private gridManager!: GridManager;
    private inputManager!: SwipeInputManager;
    private isTransitioning = false;


    public highScore = 0;
    private canAutoMove: boolean = false;

    private background: TiledAutoPositionObject = new TiledAutoPositionObject()
    private scoreUi!: ScoreUi;
    private mainMenu!: MainMenuUi;

    constructor() {
        super();

        if (ExtractTiledFile.TiledData) {
            this.background.build(ExtractTiledFile.TiledData, ['Background'])
            this.addChild(this.background)

            this.mainMenu = new MainMenuUi(ExtractTiledFile.TiledData, ['MainMenu']);
            this.addChild(this.mainMenu);
            this.mainMenu.registerButton('Start', () => {
                this.gridManager.start();
            });
            this.mainMenu.registerButton('Autoplay', () => {
                this.autoplay();
            })
            this.mainMenu.registerButton('Clear Cookies', () => {
                localStorage.clear();
            })
            this.mainMenu.registerButton('Reset Game', () => {
                this.canAutoMove = false;
                this.gridManager.reset();
            })

            this.scoreUi = new ScoreUi(ExtractTiledFile.TiledData, ['ScoreMenu'])
            this.addChild(this.scoreUi)
        }



        this.highScore = parseInt(localStorage.getItem('meme_highscore') || '0');

    }
    private updateScoreText(points: number) {

        if (points > this.highScore) {
            this.highScore = points;
            localStorage.setItem('meme_highscore', String(this.highScore));
        }

        this.scoreUi?.updateScores(points, this.highScore)
    }
    public build(): void {
        this.addChild(this.gameplayContainer);

        this.gridManager = new GridManager(this.gameplayContainer);

        this.gridManager.onGameOver.add(() => {
            //alert('gameover')
        });

        this.gridManager.onPointsUpdated.add(this.updateScoreText.bind(this));
        this.updateScoreText(0)
        this.inputManager = new SwipeInputManager();

        this.inputManager.onMove.add(async (direction) => {
            if (this.isTransitioning) return;

            this.isTransitioning = true;
            await this.gridManager.move(direction);
            this.isTransitioning = false;
        });

    }
    public autoplay() {
        this.gridManager.start();
        this.canAutoMove = true;
        const directions: ("up" | "down" | "left" | "right")[] = ["up", "down", "left", "right"];
        const tryMove = async () => {
            if (this.isTransitioning) return;
            if (!this.canAutoMove) return;

            const dir = directions[Math.floor(Math.random() * directions.length)];
            this.isTransitioning = true;
            await this.gridManager.move(dir);
            this.isTransitioning = false;
            tryMove();
        };

        const stop = () => {
            this.canAutoMove = false;
        };

        // hook game end and win
        this.gridManager.onGameOver.add(stop);
        this.gridManager.onWin.add(stop);
        tryMove();


    }
    public override destroy(): void {
        this.inputManager.destroy();
    }

    public update(delta: number): void {

        this.gridManager.update(delta);

        this.scoreUi?.update(delta)

        this.gameplayContainer.x = Game.DESIGN_WIDTH / 2
        this.gameplayContainer.y = Game.DESIGN_HEIGHT / 2
        // future animations or per-frame logic
    }
}
