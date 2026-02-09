import { Game } from "@core/Game";
import PlatformHandler from "@core/platforms/PlatformHandler";
import { PopupManager } from "@core/popup/PopupManager";
import { GameScene } from "@core/scene/GameScene";
import * as PIXI from "pixi.js";
import { Signal } from "signals";

import SoundLoadManager from "@core/audio/SoundLoaderManager";
import SoundManager from "@core/audio/SoundManager";
import PatternBackground from "@core/ui/PatternBackground";
import { DevGuiManager } from "../game/utils/DevGuiManager";
import { ClusterManager } from "./cluster/ClusterManager";
import { GameplayProgressStorage } from "./GameplayProgressStorage";
import HexAssets from "./HexAssets";
import { HexGameMediator } from "./HexGameMediator";
import { HexGridView } from "./HexGridView";
import { Difficulty, LevelData } from "./HexTypes";
import { LevelDataManager } from "./LevelDataManager";
import { HexHUD } from "./ui/HexHud";
import { WorldHUD } from "./ui/WorldHUD";
import { WorldMapPin } from "./ui/WorldMapPin";
import { WorldMapView } from "./ui/WorldMapView";

export default class HexScene extends GameScene {
    public readonly onQuit: Signal = new Signal();

    // Containers
    public readonly gameplayContainer: PIXI.Container = new PIXI.Container();
    public readonly floorContainer: PIXI.Container = new PIXI.Container();
    public readonly foregroundContainer: PIXI.Container = new PIXI.Container();

    // Backgrounds
    private background: PIXI.Sprite = new PIXI.Sprite();
    private patternBackground?: PatternBackground;
    private darkOverlay?: PIXI.Graphics;

    // Logic
    private mediator!: HexGameMediator;
    private gridView!: HexGridView;
    private clusterManager!: ClusterManager;
    private readonly worldViewContainer: PIXI.Container = new PIXI.Container();
    private worldMap!: WorldMapView;
    private worldHUD!: WorldHUD;
    private hexHUD!: HexHUD;

    private isMapActive: boolean = true;

    // State
    private highScore: number = 0;
    private paused: boolean = false;

    // Layout Config
    static readonly MAP_Y_OFFSET_PERCENT = 0.75; // Center level at 75% height

    constructor(game: Game) {
        super(game);
        SoundManager.STORAGE_ID = "Hex1_";
        this.setupPopups();
    }

    public build(): void {
        // 1. Data Initialization
        const levelsJson = PIXI.Assets.get('game/game-manifest.json') as any;
        LevelDataManager.initFromWorlds(levelsJson.worlds);

        // 2. Background Layer
        this.setupEnvironment();

        // 3. Gameplay Systems
        this.setupGameplay();

        // 4. World Map (Top UI Layer)
        // this.setupWorldMap();

        // 5. Final Assembly
        this.addChild(this.gameplayContainer);
        this.addChild(this.foregroundContainer);

        this.setupDevGui();
        this.setupAudio();

        this.setupWorldMapSystem();

        this.addChild(this.gameplayContainer);
        this.addChild(this.worldViewContainer); // Map and its HUD go here
        this.addChild(this.foregroundContainer); // HexHUD stays here
        // Initial State: Show map focused on progress
        this.showMap();
    }
    private setupWorldMapSystem(): void {
        const style = {
            levelButtonTexture: HexAssets.Textures.Buttons.Blue,
            levelButtonSize: 80,
            backButtonTexture: HexAssets.Textures.Icons.Back,
            backIconTexture: HexAssets.Textures.Icons.Back,
            splineColor: 0x2196F3,
            splineAlpha: 0.6,
            splineWidth: 8,
            titleFontSize: 36,
            titleColor: 0xffffff,
            titleY: 40
        };

        // 1. Create the panning map
        this.worldMap = new WorldMapView({
            parent: this.worldViewContainer,
            worlds: LevelDataManager.getWorlds(),
            mapData: PIXI.Assets.get('game/map-data.json'),
            style: style,
            onLevelSelected: (lvl, world) => {
                this.worldHUD.setTitle(world.name); // Sync title
                this.startLevel(lvl);
            }
        });
        // 2. Create the fixed HUD
        this.worldHUD = new WorldHUD(style, () => this.showMap());
        this.worldViewContainer.addChild(this.worldHUD);

        this.worldMap.onUpdateCurrentLevel.add((index) => {
            // Sync HUD title with current level's world
            const world = LevelDataManager.getWorldByLevelIndex(index);
            if (world) {
                this.worldHUD.setTitle(world.name);
            }
        });
        this.layoutMap();
        const savedIndex = GameplayProgressStorage.getLatestLevelIndex();
        this.worldMap.setCurrentLevelIndex(savedIndex);

        // Snap camera to the level (false = no animation)
        this.worldMap.centerOnLevel(savedIndex, false);



        const pin = new WorldMapPin(PIXI.Texture.from('toy-ball'));
        this.worldMap.setPin(pin);
        this.worldMap.onUpdatePinPosition.add((x, y) => {
            pin.position.set(x, y);
            pin.zIndex = y + 1000; // Ensure it stays on top of buttons/props
        });


    }
    private setupEnvironment(): void {
        // Patterned Background
        this.patternBackground = new PatternBackground({
            background: 0x5a7856,
            patternAlpha: 1,
            tileSpeedX: 0,
            tileSpeedY: 0
        });
        this.gameplayContainer.addChild(this.patternBackground);
        this.patternBackground.init();

        // Dark Overlay for contrast
        this.darkOverlay = new PIXI.Graphics();
        this.darkOverlay.beginFill(0x000000, 0.5);
        this.darkOverlay.drawRect(0, 0, Game.DESIGN_WIDTH, Game.DESIGN_HEIGHT);
        this.darkOverlay.endFill();
        this.gameplayContainer.addChild(this.darkOverlay);
    }

    private setupGameplay(): void {
        this.gridView = new HexGridView();
        this.clusterManager = new ClusterManager();
        this.hexHUD = new HexHUD();

        this.gameplayContainer.addChild(this.floorContainer);
        this.gameplayContainer.addChild(this.gridView);
        this.gameplayContainer.addChild(this.clusterManager);

        const gridRect = new PIXI.Rectangle(50, 100, Game.DESIGN_WIDTH - 100, Game.DESIGN_HEIGHT * 0.5);
        const piecesRect = new PIXI.Rectangle(50, Game.DESIGN_HEIGHT * 0.6, Game.DESIGN_WIDTH - 100, Game.DESIGN_HEIGHT * 0.4);

        this.hexHUD.y = 20;
        this.foregroundContainer.addChild(this.hexHUD);

        this.mediator = new HexGameMediator(
            gridRect, piecesRect, this.gridView, this.clusterManager,
            this.gameplayContainer, this.gameplayContainer, this.hexHUD
        );

        // Inside setupGameplay()
        this.mediator.gameplayData.onLevelComplete.add(() => {
            const currentIndex = this.worldMap.getCurrentIndex(); // You'll need a getter for this

            // 1. Save Progress
            GameplayProgressStorage.saveLevelComplete(currentIndex, 3);

            // 2. Return to map
            this.showMap();

            // 3. Update map visuals and animate to the next level
            const nextIndex = currentIndex + 1;
            // this.worldMap.setCurrentLevelIndex(nextIndex);
            // this.worldMap.centerOnLevel(nextIndex, true); // Animate the scroll

            this.worldMap.animateToLevel(nextIndex);
        });

        // Handle Return to Map
        this.mediator.onQuit.add(() => this.showMap());
    }


    // --- Scene Logic ---

    private showMap(): void {
        this.isMapActive = true;
        this.worldViewContainer.visible = true; // Hides/Shows both Map and WorldHUD
        this.hexHUD.visible = false;
        this.mediator.setInputEnabled(false);
    }

    private startLevel(level: LevelData): void {
        this.isMapActive = false;
        this.worldViewContainer.visible = false; // Completely cleans the screen
        this.hexHUD.visible = true;

        this.mediator.startLevel(level.matrix, level.difficulty || Difficulty.MEDIUM, level.pieces);
        this.mediator.setInputEnabled(true);
    }

    // --- Main Loop ---

    public update(delta: number): void {
        if (this.isMapActive) {
            this.worldMap.update(delta);
        }
        this.layout();
    }

    private layoutMap() {
        const centerX = Game.DESIGN_WIDTH / 2;
        const centerY = Game.DESIGN_HEIGHT / 2;
        if (this.worldMap) {
            const mapAnchorY = Game.DESIGN_HEIGHT * 0.65;
            this.worldMap.position.set(centerX, mapAnchorY);
            this.worldMap.setViewport(Game.DESIGN_WIDTH, Game.DESIGN_HEIGHT, centerX, mapAnchorY);
        }

        // Fixed HUD positioning
        this.worldHUD.layout();
    }
    private layout(): void {
        const centerX = Game.DESIGN_WIDTH / 2;
        const centerY = Game.DESIGN_HEIGHT / 2;

        // Gameplay positioning
        this.gameplayContainer.setTransform(centerX, centerY);
        this.gameplayContainer.pivot.set(centerX, centerY);

        // World View Container is 0,0 (Fullscreen HUD layer)
        this.worldViewContainer.position.set(0, 0);

        // Internal Map Panning logic
        this.layoutMap();

        // Game HUD
        if (this.hexHUD) {
            this.hexHUD.x = (Game.DESIGN_WIDTH - this.hexHUD.width) / 2;
        }
    }

    // --- Utilities & Cleanup ---

    private setupAudio(): void {
        SoundLoadManager.instance.loadAllSoundsBackground();
        SoundManager.instance.setMasterSfxVolume(0.7);
    }

    private setupPopups(): void {
        PopupManager.instance.onPopupEnd.add((id) => id === "gameOver" ? (this.paused = false) : this.quitGameScene());
        PopupManager.instance.onPopupStart.add((id) => id === "gameOver" && (this.paused = true));
    }

    private setupDevGui(): void {
        DevGuiManager.instance.addButton('Unlock All Levels', () => {
            // Assume 50 is the total levels, or get from sequence length
            GameplayProgressStorage.unlockAll(50);
            location.reload(); // Quickest way to refresh state
        });

        DevGuiManager.instance.addButton('Erase Progress', () => {
            GameplayProgressStorage.clearData();
            location.reload();
        });

        DevGuiManager.instance.addButton('Skip Current Level', () => {
            this.mediator.gameplayData.onLevelComplete.dispatch();
        });

        DevGuiManager.instance.addButton('MoveLevel', () => {
            let index = this.worldMap.getCurrentIndex(); // You'll need a getter for this
            this.worldMap.setCurrentLevelIndex(index + 1);

            console.log(index)
        });

        DevGuiManager.instance.addButton('Toggle Map', () => this.isMapActive ? this.startLevel(LevelDataManager.getRandomLevel()) : this.showMap());
    }

    private quitGameScene(): void {
        this.onQuit.dispatch();
        PlatformHandler.instance.platform.gameplayStop();
    }

    public destroy(): void {
        super.destroy();
        this.worldMap?.destroy();
    }
}