import { Game } from "@core/Game";
import { GameScene } from "@core/scene/GameScene";
import BaseButton from "@core/ui/BaseButton";
import * as PIXI from 'pixi.js';
import { Fonts } from "../character/Types";
import SwipeInputManager from "../io/SwipeInputManager";
import { GridManager } from "./GridManager";

export default class GameplayScene extends GameScene {

    private gameplayContainer = new PIXI.Container();
    private gridManager!: GridManager;
    private inputManager!: SwipeInputManager;
    private isTransitioning = false;



    public highScore = 0;
    private canAutoMove: boolean = false;

    private scoreText!: PIXI.Text;

    constructor() {
        super();
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


        this.scoreText = new PIXI.Text('', { ...Fonts.Main } as Partial<PIXI.TextStyle>);
        this.scoreText.anchor.set(0, 0);
        this.scoreText.position.set(20, 20);
        this.addChild(this.scoreText);
    }
    private updateScoreText(points: number) {

        if (points > this.highScore) {
            this.highScore = points;
            localStorage.setItem('meme_highscore', String(this.highScore));
        }
        this.scoreText.text = `Score: ${points}\nHighscore: ${this.highScore}`;
    }
    public build(): void {
        this.addChild(this.gameplayContainer);

        this.gridManager = new GridManager(this.gameplayContainer);
        this.gridManager.onPointsUpdated.add(this.updateScoreText.bind(this));
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

        this.gameplayContainer.x = Game.DESIGN_WIDTH / 2
        this.gameplayContainer.y = Game.DESIGN_HEIGHT / 2
        // future animations or per-frame logic
    }
}
