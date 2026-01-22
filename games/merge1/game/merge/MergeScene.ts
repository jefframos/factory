import { Game } from "@core/Game";
import PlatformHandler from "@core/platforms/PlatformHandler";
import { PopupManager } from "@core/popup/PopupManager";
import { GameScene } from "@core/scene/GameScene";
import * as PIXI from "pixi.js";
import { Signal } from "signals";

import SoundManager from "@core/audio/SoundManager";
import PatternBackground from "@core/ui/PatternBackground";
import ViewUtils from "@core/utils/ViewUtils";
import MergeAssets from "../MergeAssets";
import { DevGuiManager } from "../utils/DevGuiManager";
import { MergeMediator } from "./MergeMediator";
import MergeHUD from "./ui/MergeHUD"; // Import your new component

export default class MergeScene extends GameScene {
    public readonly onQuit: Signal = new Signal();

    public readonly gameplayContainer: PIXI.Container = new PIXI.Container();
    public hud!: MergeHUD;

    private background: PIXI.Sprite = PIXI.Sprite.from('main-bg');
    private patternBackground!: PatternBackground;

    private highScore: number = 0;
    private paused: boolean = false;
    private mediator!: MergeMediator;

    constructor(game: Game) {
        super(game);
        SoundManager.STORAGE_ID = "Merge1_";

        this.setupPopups();
    }

    public build(): void {
        // 1. Backgrounds
        this.patternBackground = new PatternBackground({
            background: 0x26C6DA,
            patternAlpha: 0.2,
            patternPath: 'game4/images/non-preload/jiggy-pattern.png'
        });
        this.addChild(this.patternBackground);
        this.patternBackground.init();

        // 2. Gameplay
        this.addChild(this.gameplayContainer);

        // 3. HUD
        this.hud = new MergeHUD();
        this.addChild(this.hud);

        this.setupDevGui();
        this.setupAudio();

        this.updateScore(0);

        const gameBounds = new PIXI.Rectangle(
            100, 100,
            Game.DESIGN_WIDTH - 200,
            Game.DESIGN_HEIGHT - 300
        );

        const inputBounds = new PIXI.Rectangle(
            -Game.DESIGN_WIDTH / 2, -Game.DESIGN_WIDTH / 2,
            Game.DESIGN_WIDTH * 2,
            Game.DESIGN_HEIGHT * 2
        );


        // 4. Initialize Mediator
        this.mediator = new MergeMediator(
            this.gameplayContainer,
            inputBounds,
            gameBounds,
            this.hud
        );

        // Optional: Spawn a starting animal
        this.mediator.spawnAnimal(1, new PIXI.Point(Game.DESIGN_WIDTH / 2, Game.DESIGN_HEIGHT / 2));
    }

    private setupAudio(): void {
        SoundManager.instance.playBackgroundSound(MergeAssets.AmbientSound.AmbientSoundId, 0);
        SoundManager.instance.setMasterAmbientVolume(MergeAssets.AmbientSound.AmbientMasterVolume);
    }

    private setupDevGui(): void {
        DevGuiManager.instance.addButton('erase', () => { });
        DevGuiManager.instance.addButton('addCoins', () => { });
    }

    public update(delta: number): void {
        this.patternBackground.update(delta);
        this.layout();

        if (this.paused) return;

        if (this.mediator) {
            this.mediator.update(delta);
        }
    }

    private layout(): void {
        const centerX = Game.DESIGN_WIDTH / 2;
        const centerY = Game.DESIGN_HEIGHT / 2;

        this.patternBackground.position.set(centerX, centerY);
        //this.gameplayContainer.position.set(centerX, centerY);

        this.background.anchor.set(0.5);
        this.background.position.set(centerX, centerY);
        this.background.scale.set(ViewUtils.elementEvelop(this.background, Game.gameScreenData.width, Game.gameScreenData.height));

        // Let the HUD handle its own internal positioning
        this.hud.updateLayout();
    }

    // --- Logic & State ---

    private updateScore(points: number): void {
        if (points > this.highScore) {
            this.highScore = points;
        }
    }

    private setupPopups(): void {
        PopupManager.instance.onPopupEnd.add(this._onPopupEnd);
        PopupManager.instance.onPopupStart.add(this._onPopupStart);
    }

    private readonly _onPopupEnd = (popupId: string) => {
        if (popupId === "gameOver") {
            this.paused = false;
            this.updateScore(0);
        } else {
            this.quitGameScene();
        }
    };

    private readonly _onPopupStart = (popupId: string) => {
        if (popupId === "gameOver") this.paused = true;
    };

    private quitGameScene(): void {
        this.onQuit.dispatch();
        PlatformHandler.instance.platform.gameplayStop();
    }

    public destroy(): void {
        PopupManager.instance.onPopupEnd.remove(this._onPopupEnd);
        PopupManager.instance.onPopupStart.remove(this._onPopupStart);
    }
}