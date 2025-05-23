import { Game } from "@core/Game";
import { GameScene } from "@core/scene/GameScene";
import { ExtractTiledFile } from "@core/tiled/ExtractTiledFile";
import TiledAutoPositionObject from "@core/tiled/TiledAutoPositionObject";
import TiledLayerObject from "@core/tiled/TiledLayerObject";
import BaseButton from "@core/ui/BaseButton";
import * as PIXI from 'pixi.js';
import SwipeInputManager from "../io/SwipeInputManager";
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

    constructor() {
        super();

        if (ExtractTiledFile.TiledData) {
            this.background.build(ExtractTiledFile.TiledData, ['Background'])
            this.addChild(this.background)
        }



        this.highScore = parseInt(localStorage.getItem('meme_highscore') || '0');

        const menu = new PIXI.Container();
        this.addChild(menu);

        const labels = ['Start', 'Autoplay', 'Clear Cookies', 'Reset Game'];
        const ids = ['start', 'autoplay', 'clearCookies', 'resetGame'];
        const callbacks = [
            () => {
                this.gridManager.start();
            },
            () => {
                this.autoplay();
            },
            () => {
                localStorage.clear();
            },
            () => {
                this.canAutoMove = false;
                this.gridManager.reset();
            }
        ]

        const buttons: BaseButton[] = [];

        const buttonWidth = 150;
        const buttonHeight = 90;
        const spacing = 20;

        labels.forEach((label, i) => {
            const button = new BaseButton({
                standard: {
                    allPadding: 35,
                    texture: PIXI.Texture.from('Button01_s_Blue'),
                    width: buttonWidth,
                    height: buttonHeight,
                    fontStyle: new PIXI.TextStyle({
                        fontFamily: 'LEMONMILK-Bold',
                        fill: 0xffffff,
                        stroke: "#0c0808",
                        strokeThickness: 4,
                    }),
                    fitText: 0.8
                },
                over: {
                    texture: PIXI.Texture.from('Button01_s_Purple'),
                },
                click: {
                    callback: () => {
                        callbacks[i]()
                    }
                }
            });

            button.position.set(i * (buttonWidth + spacing), 0);
            menu.addChild(button);
            button.setLabel(labels[i])
            buttons.push(button);
        });

        menu.position.set(0, Game.DESIGN_HEIGHT - 120);


        if (ExtractTiledFile.TiledData) {
            const layer = new TiledLayerObject();
            layer.build(ExtractTiledFile.TiledData, ['ScoreMenu'])
            this.scoreUi = new ScoreUi(layer)
            this.addChild(this.scoreUi)
        }
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
        // this.gridManager.onWin.add(stop);

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

        this.background?.update(delta)

        this.scoreUi.x = Game.DESIGN_WIDTH / 2
        this.scoreUi.y = 250
        this.gameplayContainer.x = Game.DESIGN_WIDTH / 2
        this.gameplayContainer.y = Game.DESIGN_HEIGHT / 2
        // future animations or per-frame logic
    }
}
