import { Game } from "@core/Game";
import PlatformHandler from "@core/platforms/PlatformHandler";
import { PopupManager } from "@core/popup/PopupManager";
import { GameScene } from "@core/scene/GameScene";
import * as PIXI from "pixi.js";
import { Signal } from "signals";

import SoundLoadManager from "@core/audio/SoundLoaderManager";
import SoundManager from "@core/audio/SoundManager";
import PatternBackground from "@core/ui/PatternBackground";
import ViewUtils from "@core/utils/ViewUtils";
import { DevGuiManager } from "../game/utils/DevGuiManager";
import { ClusterManager } from "./cluster/ClusterManager";
import { HexGameMediator } from "./HexGameMediator";
import { HexGridBuilder } from "./HexGridBuilder";
import { HexGridView } from "./HexGridView";
import { Difficulty, GridMatrix } from "./HexTypes";

export default class HexScene extends GameScene {
    public readonly onQuit: Signal = new Signal();

    public readonly gameplayContainer: PIXI.Container = new PIXI.Container();
    public readonly floorContainer: PIXI.Container = new PIXI.Container();
    public readonly foregroundContainer: PIXI.Container = new PIXI.Container();

    private interactiveBackground?: PIXI.Graphics;
    private background: PIXI.Sprite = new PIXI.Sprite();
    private patternBackground?: PatternBackground;

    private highScore: number = 0;
    private paused: boolean = false;

    // UI Elements
    private scoreText?: PIXI.Text;
    private movesText?: PIXI.Text;
    private progressText?: PIXI.Text;

    static MAP_ID = 'Hex'

    private mediator?: HexGameMediator;
    private gridView?: HexGridView;
    private clusterManager: ClusterManager = new ClusterManager();

    constructor(game: Game) {
        super(game);
        SoundManager.STORAGE_ID = "Hex1_";

        this.setupPopups();
    }

    public build(): void {
        // 1. Backgrounds
        SoundLoadManager.instance.loadAllSoundsBackground();

        SoundManager.instance.setMasterSfxVolume(0.7)
        this.patternBackground = new PatternBackground({
            background: 0x5a7856,
            patternAlpha: 1,
            tileSpeedX: 0,
            tileSpeedY: 0
        });
        this.gameplayContainer.addChild(this.patternBackground);
        this.patternBackground?.init();
        if (this.patternBackground?.tiledTexture) {
            this.patternBackground.tiledTexture.alpha = 1
        }

        // Add a dark overlay
        const gr = new PIXI.Graphics();
        gr.beginFill(0x000000, 0.5);
        gr.drawRect(0, 0, Game.DESIGN_WIDTH, Game.DESIGN_HEIGHT);
        gr.endFill();
        this.gameplayContainer.addChild(gr);

        // Add interactive background for the game area
        this.interactiveBackground = new PIXI.Graphics();
        this.interactiveBackground.beginFill(0x000000, 0.01); // Almost transparent but interactive
        this.interactiveBackground.drawRect(-Game.DESIGN_WIDTH / 2, -Game.DESIGN_HEIGHT / 2, Game.DESIGN_WIDTH, Game.DESIGN_HEIGHT);
        this.interactiveBackground.endFill();
        this.interactiveBackground.eventMode = 'static';
        this.interactiveBackground.interactiveChildren = true;
        this.floorContainer.addChild(this.interactiveBackground);

        this.gameplayContainer.addChild(this.floorContainer);

        // 2. Setup Gameplay Mediator
        this.setupGameplay();

        // 3. UI
        this.setupUI();

        this.addChild(this.gameplayContainer);
        this.addChild(this.foregroundContainer);

        this.setupDevGui();
        this.setupAudio();

        this.updateScore(0);
    }

    private setupGameplay(): void {
        const matrix: GridMatrix = [
            [1, 1, 1, 1, 1, 1],
            [1, 1, 1, 1, 1, 1],
            [1, 1, 1, 1, 1, 1],
            [1, 1, 1, 1, 1, 1],
            [1, 1, 1, 1, 0, 1]
        ];

        const { data, totalSize } = HexGridBuilder.buildFromMatrix(matrix);
        this.gridView = new HexGridView(data, totalSize);
        this.gameplayContainer.addChild(this.gridView);

        this.clusterManager = new ClusterManager();
        this.gameplayContainer.addChild(this.clusterManager);
        this.clusterManager.initPuzzle(matrix, Difficulty.MEDIUM);

        // Define Areas (Top 60% for Grid, Bottom 40% for Pieces)
        const gridRect = new PIXI.Rectangle(50, 100, Game.DESIGN_WIDTH - 100, Game.DESIGN_HEIGHT * 0.5);
        const piecesRect = new PIXI.Rectangle(50, Game.DESIGN_HEIGHT * 0.6, Game.DESIGN_WIDTH - 100, Game.DESIGN_HEIGHT * 0.4);

        this.mediator = new HexGameMediator(
            gridRect,
            piecesRect,
            this.gridView,
            this.clusterManager,
            this.gameplayContainer,
            this.gameplayContainer,
        );

        this.mediator.layout();
        this.mediator.drawDebugZones(); // Toggle this for debugging


    }

    private setupUI(): void {
        const textStyle = new PIXI.TextStyle({
            fontFamily: 'Arial',
            fontSize: 32,
            fill: 0xFFFFFF,
            stroke: 0x000000,
            strokeThickness: 4,
            dropShadow: true,
            dropShadowDistance: 2,
            dropShadowBlur: 2,
        });

        // Score text
        this.scoreText = new PIXI.Text('Score: 0', textStyle);
        this.scoreText.anchor.set(0, 0);
        this.foregroundContainer.addChild(this.scoreText);

        // Moves text
        this.movesText = new PIXI.Text('Moves: 0', textStyle);
        this.movesText.anchor.set(0, 0);
        this.foregroundContainer.addChild(this.movesText);

        // Progress text
        this.progressText = new PIXI.Text('Progress: 0%', textStyle);
        this.progressText.anchor.set(1, 0);
        this.foregroundContainer.addChild(this.progressText);
    }

    private onLevelComplete = (data: { score: number; moves: number; stars: number }): void => {
        console.log(`🎉 Level Complete! Score: ${data.score}, Moves: ${data.moves}, Stars: ${data.stars}`);


    };

    private onScoreChanged = (score: number, moves: number): void => {
        if (this.scoreText) {
            this.scoreText.text = `Score: ${score}`;
        }
        if (this.movesText) {
            this.movesText.text = `Moves: ${moves}`;
        }

    };

    private setupAudio(): void {
        // SoundManager.instance.playBackgroundSound(MergeAssets.AmbientSound.AmbientSoundId, 0);
        // SoundManager.instance.setMasterAmbientVolume(MergeAssets.AmbientSound.AmbientMasterVolume);
    }

    private setupDevGui(): void {
        DevGuiManager.instance.addButton('Reset Level', () => {
        });

        DevGuiManager.instance.addButton('Load Simple Level', () => {
        });

        DevGuiManager.instance.addButton('erase', () => {
            // CollectionDataManager.instance.wipeCollectionData()
            // GameStorage.instance.resetGameProgress(true)
        });

        DevGuiManager.instance.addButton('addCoins', () => {
            // InGameEconomy.instance.add(CurrencyType.MONEY, 1000000)
            // InGameEconomy.instance.add(CurrencyType.GEMS, 1000)
        });
    }

    public update(delta: number): void {
        this.patternBackground?.update(delta);

        this.patternBackground?.scale?.set(2, 2);

        this.layout();

        if (this.paused) return;

    }

    private layout(): void {
        const centerX = Game.DESIGN_WIDTH / 2;
        const centerY = Game.DESIGN_HEIGHT / 2;

        //this.mediator?.layout();

        this.patternBackground?.position?.set(centerX, centerY);

        // Center the gameplay container
        this.gameplayContainer.position.set(centerX, centerY);
        this.gameplayContainer.pivot.set(centerX, centerY);

        this.foregroundContainer.position.copyFrom(this.gameplayContainer.position)
        this.foregroundContainer.pivot.copyFrom(this.gameplayContainer.pivot)
        this.foregroundContainer.scale.copyFrom(this.gameplayContainer.scale)

        this.background.anchor.set(0.5);
        this.background.position.set(centerX, centerY);
        this.background.scale.set(ViewUtils.elementEvelop(this.background, Game.gameScreenData.width, Game.gameScreenData.height));

        // Position UI elements
        if (this.scoreText) {
            this.scoreText.position.set(20, 20);
        }
        if (this.movesText) {
            this.movesText.position.set(20, 60);
        }
        if (this.progressText) {
            this.progressText.position.set(Game.DESIGN_WIDTH - 20, 20);
        }
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
