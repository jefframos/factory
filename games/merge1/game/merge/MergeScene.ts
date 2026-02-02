import { Game } from "@core/Game";
import PlatformHandler from "@core/platforms/PlatformHandler";
import { PopupManager } from "@core/popup/PopupManager";
import { GameScene } from "@core/scene/GameScene";
import * as PIXI from "pixi.js";
import { Signal } from "signals";

import SoundLoadManager from "@core/audio/SoundLoaderManager";
import SoundManager from "@core/audio/SoundManager";
import { ExtractTiledFile } from "@core/tiled/ExtractTiledFile";
import TiledContainer from "@core/tiled/TiledContainer";
import PatternBackground from "@core/ui/PatternBackground";
import ViewUtils from "@core/utils/ViewUtils";
import { DevGuiManager } from "../utils/DevGuiManager";
import { CollectionDataManager } from "./collections/CollectionDataManager";
import { CurrencyType, InGameEconomy } from "./data/InGameEconomy";
import { StaticData } from "./data/StaticData";
import MergeAssets from "./MergeAssets";
import { MergeMediator } from "./MergeMediator";
import { EnvironmentManager } from "./rooms/EnvironmentManager";
import GameStorage from "./storage/GameStorage";
import MergeHUD from "./ui/hud/MergeHUD"; // Import your new component
import { BakePreviewContainer } from "./vfx/BakePreviewContainer";
import { CoinEffectLayer } from "./vfx/CoinEffectLayer";
import { TextureBaker } from "./vfx/TextureBaker";

export default class MergeScene extends GameScene {
    public readonly onQuit: Signal = new Signal();

    public readonly gameplayContainer: PIXI.Container = new PIXI.Container();
    public readonly floorContainer: PIXI.Container = new PIXI.Container();
    public readonly foregroundContainer: PIXI.Container = new PIXI.Container();
    public hud!: MergeHUD;

    private background: PIXI.Sprite = PIXI.Sprite.from('main-bg');
    private patternBackground?: PatternBackground;

    private highScore: number = 0;
    private paused: boolean = false;
    private mediator!: MergeMediator;
    private envManager!: EnvironmentManager;
    static MAP_ID = 'Garden'

    constructor(game: Game) {
        super(game);
        SoundManager.STORAGE_ID = "Merge1_";

        const monsters = PIXI.Assets.get('data/animals.json')
        StaticData.parseData(monsters)



        setTimeout(() => {
            const bked = new BakePreviewContainer()
            bked.generatePieces()
            bked.generateFramesGrid([
                'frame-1',
                'frame-3',
                'frame-1',
                'frame-2',
                'frame-2',
                'frame-3',
            ], [
                'portrait-1',
                'portrait-2',
                'portrait-3',
                'portrait-4',
                'portrait-5',
                'portrait-6',
                'portrait-7',
                'portrait-8'
            ])

            //this.addChild(bked)
            // bked.scale.set(2)
        }, 10);


        this.setupPopups();
    }

    public build(): void {
        // 1. Backgrounds



        SoundLoadManager.instance.loadAllSoundsBackground();


        SoundManager.instance.setMasterSfxVolume(0.7)
        this.patternBackground = new PatternBackground({
            background: 0x5a7856,
            patternAlpha: 1,
            //patternPath: 'grass-patch-1',
            //patternPath: 'tiles',
            tileSpeedX: 0,
            tileSpeedY: 0
        });
        this.gameplayContainer.addChild(this.patternBackground);
        this.patternBackground?.init();
        if (this.patternBackground?.tiledTexture) {
            this.patternBackground.tiledTexture.alpha = 1
        }





        const floor = new TiledContainer(ExtractTiledFile.getTiledFrom('garden'), ['Floor-' + MergeScene.MAP_ID]);
        this.floorContainer.addChild(floor);
        const foreground = new TiledContainer(ExtractTiledFile.getTiledFrom('garden'), ['Foreground-' + MergeScene.MAP_ID]);

        this.foregroundContainer.addChild(foreground);
        this.gameplayContainer.addChild(this.floorContainer);
        // 2. Gameplay
        this.addChild(this.gameplayContainer);
        this.addChild(this.foregroundContainer);

        TextureBaker.bakeEntityTextures()
        // 3. HUD
        const effects = new CoinEffectLayer();
        this.hud = new MergeHUD(effects);
        this.addChild(this.hud);
        this.hud.addEffects(effects)

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

        const settings = ExtractTiledFile.getTiledFrom('garden')
        const walkArea = settings?.settings?.objects?.find(v => v.name == 'WalkArea')

        this.envManager = new EnvironmentManager(
            this.floorContainer,
            this.foregroundContainer,
            (bg) => this.mediator?.setupBackground(bg) // Use your existing method
        );

        if (walkArea) {
            gameBounds.x = walkArea.x
            gameBounds.y = walkArea.y
            gameBounds.width = walkArea.width
            gameBounds.height = walkArea.height
        }
        // 4. Initialize Mediator
        this.mediator = new MergeMediator(
            this.gameplayContainer,
            inputBounds,
            gameBounds,
            effects,
            this.hud,
            this.envManager,
            "Free"
        );

        this.mediator.updateRoom();
        //this.mediator.setupBackground(new TiledContainer(ExtractTiledFile.getTiledFrom('garden'), ['Background-' + MergeScene.MAP_ID]))


        // Optional: Spawn a starting animal
        //this.mediator.spawnAnimal(1, new PIXI.Point(Game.DESIGN_WIDTH / 2, Game.DESIGN_HEIGHT / 2));


    }



    private setupAudio(): void {
        SoundManager.instance.playBackgroundSound(MergeAssets.AmbientSound.AmbientSoundId, 0);
        SoundManager.instance.setMasterAmbientVolume(MergeAssets.AmbientSound.AmbientMasterVolume);
    }

    private setupDevGui(): void {
        DevGuiManager.instance.addButton('erase', () => {
            CollectionDataManager.instance.wipeCollectionData()
            GameStorage.instance.resetGameProgress(true)
        });
        DevGuiManager.instance.addButton('addCoins', () => {
            InGameEconomy.instance.add(CurrencyType.MONEY, 1000000)
            InGameEconomy.instance.add(CurrencyType.GEMS, 1000)
        });
    }

    public update(delta: number): void {
        this.patternBackground?.update(delta);

        // Calculate the inverse scale
        const containerScale = this.gameplayContainer.scale;

        // We use 1 / scale to get the inverse. 
        // Added a small check to prevent division by zero just in case.
        this.patternBackground?.scale?.set(
            2, 2
        );
        // this.patternBackground.scale.set(
        //     containerScale.x !== 0 ? 1 / containerScale.x : 1 + 0.1,
        //     containerScale.y !== 0 ? 1 / containerScale.y : 1 + 0.1
        // );

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

        this.patternBackground?.position?.set(centerX, centerY);


        this.gameplayContainer.position.set(centerX, centerY);
        this.gameplayContainer.pivot.set(centerX, centerY);

        this.foregroundContainer.position.copyFrom(this.gameplayContainer.position)
        this.foregroundContainer.pivot.copyFrom(this.gameplayContainer.pivot)
        this.foregroundContainer.scale.copyFrom(this.gameplayContainer.scale)

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