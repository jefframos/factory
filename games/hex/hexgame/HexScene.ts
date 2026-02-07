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
import gsap from "gsap";
import { DevGuiManager } from "../game/utils/DevGuiManager";
import { ClusterManager } from "./cluster/ClusterManager";
import { HexGameMediator } from "./HexGameMediator";
import { HexGridView } from "./HexGridView";
import { Difficulty } from "./HexTypes";
import { LevelDataManager } from "./LevelDataManager";
import GameProgressionView from "./ui/GameProgressionView";
import { HexHUD } from "./ui/HexHud";

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
    private progressionView: GameProgressionView;

    static MAP_ID = 'Hex'

    private mediator?: HexGameMediator;
    private gridView?: HexGridView;
    private hexHUD?: HexHUD;
    private clusterManager: ClusterManager = new ClusterManager();

    constructor(game: Game) {
        super(game);
        SoundManager.STORAGE_ID = "Hex1_";

        this.setupPopups();
    }

    public build(): void {
        // 1. Backgrounds
        SoundLoadManager.instance.loadAllSoundsBackground();
        const levelsJson = PIXI.Assets.get('game/game-manifest.json') as any;
        LevelDataManager.initFromWorlds(levelsJson.worlds);

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

        // 1. Start the game by showing the Map immediately
        this.progressionView.show();

        // 2. Ensure mediator starts in a "waiting" state
        this.mediator.setInputEnabled(false);

        this.addChild(this.gameplayContainer);
        this.addChild(this.foregroundContainer);

        this.setupDevGui();
        this.setupAudio();

        this.updateScore(0);
    }




    private setupGameplay(): void {
        // 1. If containers don't exist, create them

        // 2. The Puzzle Matrix (This could be randomized later)

        this.gridView = new HexGridView();
        this.clusterManager = new ClusterManager();

        this.gridView = new HexGridView();
        this.gameplayContainer.addChild(this.gridView);

        // 4. Build Pieces
        this.clusterManager = new ClusterManager();
        this.gameplayContainer.addChild(this.clusterManager);

        // 5. Define Areas
        const gridRect = new PIXI.Rectangle(50, 100, Game.DESIGN_WIDTH - 100, Game.DESIGN_HEIGHT * 0.5);
        const piecesRect = new PIXI.Rectangle(50, Game.DESIGN_HEIGHT * 0.6, Game.DESIGN_WIDTH - 100, Game.DESIGN_HEIGHT * 0.4);

        this.hexHUD = new HexHUD();
        // 6. Setup HUD (Only once if possible, or clear it too)
        this.hexHUD.y = 20;
        this.hexHUD.x = (Game.DESIGN_WIDTH - (this.hexHUD.width || 0)) / 2;
        this.foregroundContainer.addChild(this.hexHUD);

        // 7. Initialize Mediator
        this.mediator = new HexGameMediator(
            gridRect,
            piecesRect,
            this.gridView,
            this.clusterManager,
            this.gameplayContainer,
            this.gameplayContainer,
            this.hexHUD
        );

        // 8. HOOK THE RESTART EVENT
        //this.mediator.onRestart.add(() => this.restartGame());
        this.mediator.onQuit.add(() => this.progressionView.show());

        // this.mediator.gameplayData.onLevelComplete.add((stats: LevelSessionStats) => {
        //     console.log(`Level Cleared in ${stats.moves} moves!`);
        //     // Example: show result popup or auto-load next level
        //     setTimeout(() => {
        //         this.restartGame();
        //     }, 500);
        // });

        //this.restartGame();
        this.mediator.layout();

    }


    private restartGame(): void {
        const level = LevelDataManager.getRandomLevel();
        console.log('new level', level)
        this.mediator?.startLevel(level.matrix, Difficulty.HARD, level.pieces);
        // this.mediator?.startLevel(level.matrix, level.difficulty || Difficulty.HARD, level.pieces);
    }

    private setupUI(): void {
        this.progressionView = new GameProgressionView(this.mediator);
        this.foregroundContainer.addChild(this.progressionView);

        // 3. Listen for Level Completion to bring the map back
        this.mediator.gameplayData.onLevelComplete.add((stats) => {
            console.log("Level Finished! Returning to map...");

            // Wait a brief moment so the player sees the completed board
            gsap.delayedCall(1.5, () => {
                this.progressionView.show();
            });
        });
    }


    private setupAudio(): void {
        // SoundManager.instance.playBackgroundSound(MergeAssets.AmbientSound.AmbientSoundId, 0);
        // SoundManager.instance.setMasterAmbientVolume(MergeAssets.AmbientSound.AmbientMasterVolume);
    }

    private setupDevGui(): void {
        DevGuiManager.instance.addButton('Reset Level', () => {
        });

        DevGuiManager.instance.addButton('Load Simple Level', () => {
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
        this.progressionView?.position?.set(centerX, centerY);

        // Center the gameplay container
        this.gameplayContainer.position.set(centerX, centerY);
        this.gameplayContainer.pivot.set(centerX, centerY);

        this.foregroundContainer.position.copyFrom(this.gameplayContainer.position)
        this.foregroundContainer.pivot.copyFrom(this.gameplayContainer.pivot)
        this.foregroundContainer.scale.copyFrom(this.gameplayContainer.scale)

        this.background.anchor.set(0.5);
        this.background.position.set(centerX, centerY);
        this.background.scale.set(ViewUtils.elementEvelop(this.background, Game.gameScreenData.width, Game.gameScreenData.height));

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
