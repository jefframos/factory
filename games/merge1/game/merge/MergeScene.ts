import { Game } from "@core/Game";
import PlatformHandler from "@core/platforms/PlatformHandler";
import { PopupManager } from "@core/popup/PopupManager";
import { GameScene } from "@core/scene/GameScene";
import * as PIXI from "pixi.js";
import { Signal } from "signals";

import SoundManager from "@core/audio/SoundManager";
import PatternBackground from "@core/ui/PatternBackground";
import ViewUtils from "@core/utils/ViewUtils";
import { DevGuiManager } from "../utils/DevGuiManager";
import { StaticData } from "./data/StaticData";
import MergeAssets from "./MergeAssets";
import { MergeMediator } from "./MergeMediator";
import GameStorage from "./storage/GameStorage";
import MergeHUD from "./ui/MergeHUD"; // Import your new component
import { BakePreviewContainer } from "./vfx/BakePreviewContainer";
import { CoinEffectLayer } from "./vfx/CoinEffectLayer";
import { TextureBaker } from "./vfx/TextureBaker";

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

        const bked = new BakePreviewContainer()
        bked.generatePieces()

        this.setupPopups();
    }

    public build(): void {
        // 1. Backgrounds

        const monsters = PIXI.Assets.get('data/animals.json')
        StaticData.parseData(monsters)




        SoundManager.instance.setMasterSfxVolume(0.7)
        this.patternBackground = new PatternBackground({
            background: 0x26C6DA,
            patternAlpha: 1,
            patternPath: 'grass-patch-1',
            tileSpeedX: 0,
            tileSpeedY: 0
        });
        this.addChild(this.patternBackground);
        this.patternBackground.init();
        if (this.patternBackground.tiledTexture) {
            this.patternBackground.tiledTexture.alpha = 0.75
        }
        // 2. Gameplay
        this.addChild(this.gameplayContainer);


        TextureBaker.bakeEntityTextures()

        // 3. HUD
        this.hud = new MergeHUD();
        this.addChild(this.hud);

        this.setupDevGui();
        this.setupAudio();

        this.updateScore(0);

        const gameBounds = new PIXI.Rectangle(
            100, 300,
            Game.DESIGN_WIDTH - 200,
            Game.DESIGN_HEIGHT - 400
        );

        const inputBounds = new PIXI.Rectangle(
            -Game.DESIGN_WIDTH / 2, -Game.DESIGN_WIDTH / 2,
            Game.DESIGN_WIDTH * 2,
            Game.DESIGN_HEIGHT * 2
        );



        const effects = new CoinEffectLayer();
        this.hud.addEffects(effects)
        // 4. Initialize Mediator
        this.mediator = new MergeMediator(
            this.gameplayContainer,
            inputBounds,
            gameBounds,
            effects,
            this.hud
        );


        //this.addChild(bked)

        // Optional: Spawn a starting animal
        //this.mediator.spawnAnimal(1, new PIXI.Point(Game.DESIGN_WIDTH / 2, Game.DESIGN_HEIGHT / 2));
    }

    private setupAudio(): void {
        SoundManager.instance.playBackgroundSound(MergeAssets.AmbientSound.AmbientSoundId, 0);
        SoundManager.instance.setMasterAmbientVolume(MergeAssets.AmbientSound.AmbientMasterVolume);
    }

    private setupDevGui(): void {
        DevGuiManager.instance.addButton('erase', () => {
            GameStorage.instance.resetGameProgress(true)
        });
        DevGuiManager.instance.addButton('addCoins', () => { });
    }

    public update(delta: number): void {
        this.patternBackground.update(delta);
        this.layout();
        this.hud.update(delta);

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