import { Game } from "@core/Game";
import PlatformHandler from "@core/platforms/PlatformHandler";
import { PopupManager } from "@core/popup/PopupManager";
import { GameScene } from "@core/scene/GameScene";
import * as PIXI from "pixi.js";
import { Signal } from "signals";

import SoundLoadManager from "@core/audio/SoundLoaderManager";
import SoundManager from "@core/audio/SoundManager";
import PromiseUtils from "@core/utils/PromiseUtils";
import ViewUtils from "@core/utils/ViewUtils";
import { DevGuiManager } from "../game/utils/DevGuiManager";
import { AvatarManager } from "./avatar/AvatarManager";
import { AvatarRegistry } from "./avatar/AvatarRegistry";
import { ClusterManager } from "./cluster/ClusterManager";
import { CurrencyType, EconomyStorage } from "./data/EconomyStorage";
import { GameplayProgressStorage } from "./data/GameplayProgressStorage";
import HexAssets from "./HexAssets";
import { HexGameMediator } from "./HexGameMediator";
import { HexGridView } from "./HexGridView";
import { Difficulty, LevelData } from "./HexTypes";
import { LevelDataManager } from "./LevelDataManager";
import { HexHUD, HUDMode } from "./ui/HexHud";
import { WorldHUD } from "./ui/WorldHUD";
import { WorldMapDragHandler } from "./ui/WorldMapDragHandler";
import { WorldMapPin } from "./ui/WorldMapPin";
import { WorldMapView } from "./ui/WorldMapView";
import { ScreenTransition } from "./view/background/ScreenTransition";

export default class HexScene extends GameScene {
    public readonly onQuit: Signal = new Signal();

    // Containers
    public readonly gameplayContainer: PIXI.Container = new PIXI.Container();
    public readonly floorContainer: PIXI.Container = new PIXI.Container();
    public readonly hudContainer: PIXI.Container = new PIXI.Container();


    // Logic
    private mediator!: HexGameMediator;
    private gridView!: HexGridView;
    private clusterManager!: ClusterManager;
    private readonly worldViewContainer: PIXI.Container = new PIXI.Container();
    private worldMap!: WorldMapView;
    private worldHUD!: WorldHUD;
    private hexHUD!: HexHUD;

    private levelBackground: PIXI.Sprite = new PIXI.Sprite()

    private isMapActive: boolean = true;

    private transition!: ScreenTransition;

    // Layout Config
    static readonly MAP_Y_OFFSET_PERCENT = 0.75; // Center level at 75% height

    constructor(game: Game) {
        super(game);
        SoundManager.STORAGE_ID = "Hex1_";
        this.setupPopups();
    }

    public async build(): Promise<void> {
        // 1. Data Initialization
        const levelsJson = PIXI.Assets.get('game/game-manifest.json') as any;
        LevelDataManager.initFromWorlds(levelsJson.worlds);


        await AvatarManager.instance.initialize();

        // 2. Background Layer

        // 3. Gameplay Systems
        this.setupGameplay();

        // 4. World Map (Top UI Layer)
        // this.setupWorldMap();

        // 5. Final Assembly
        this.addChild(this.levelBackground);
        this.levelBackground.texture = PIXI.Texture.from('puzzle-bg-2')
        this.levelBackground.tint = 0xaaaaff

        this.setupDevGui();
        this.setupAudio();


        this.addChild(this.gameplayContainer);
        this.addChild(this.worldViewContainer); // Map and its HUD go here
        this.addChild(this.hudContainer); // HexHUD stays here
        // Initial State: Show map focused on progress

        this.setupScreenTransitions();
        this.setupWorldMapSystem();


        setTimeout(() => {

            if (Game.debugParams.auto) {
                this.startLevel(LevelDataManager.getRandomLevel())
            }
        }, 500);
    }
    private async setupWorldMapSystem(): Promise<void> {


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

        this.transition.forceClose();
        const startTime = performance.now();
        this.transition.showLoading("");
        //this.transition.showLoading("Preparing Level...");
        // 1. Create the panning map
        this.worldMap = new WorldMapView();

        await this.worldMap.initialize({
            parent: this.worldViewContainer,
            worlds: LevelDataManager.getWorlds(),
            mapData: PIXI.Assets.get('game/map-data.json'),
            style: style,
            onLevelSelected: (lvl, world) => {
                this.worldHUD?.setTitle(world.name); // Sync title
                this.startLevel(lvl);
            }
        });

        const minDuration = 2000; // 2 seconds in ms
        const elapsed = performance.now() - startTime;
        const remaining = minDuration - elapsed;

        // 4. If we were too fast, wait for the difference
        if (remaining > 0) {
            // await PromiseUtils.await(remaining); // Assuming your util takes seconds
        }
        await this.showMap();
        this.transition.hideLoading();

        //this.backgroundManager.open();
        // 2. Create the fixed HUD
        // this.worldHUD = new WorldHUD(style, () => this.showMap());
        // this.worldViewContainer.addChild(this.worldHUD);

        const dragHandler = new WorldMapDragHandler(this.worldMap);

        this.worldMap.onUpdateCurrentLevel.add((index) => {
            // Sync HUD title with current level's world
            const world = LevelDataManager.getWorldByLevelIndex(index);
            if (world) {
                //this.worldHUD.setTitle(world.name);
            }
        });
        this.layoutMap();
        const savedIndex = await GameplayProgressStorage.getLatestLevelIndex();
        console.log(savedIndex)
        this.worldMap.setCurrentLevelIndex(savedIndex);

        // Snap camera to the level (false = no animation)
        this.worldMap.centerOnLevel(savedIndex, false);


        const pin = new WorldMapPin(PIXI.Texture.from('char-1'), PIXI.Texture.from('particle'));
        this.worldMap.setPin(pin);
        this.worldMap.onUpdatePinPosition.add((x, y) => {
            pin.position.set(x, y);
            pin.zIndex = y + 1000; // Ensure it stays on top of buttons/props
        });

        AvatarManager.instance.onAvatarChanged.add((data: any) => {
            const avatar = AvatarRegistry.getAvatar(data.id);
            pin.updateTexture(PIXI.Texture.from(avatar.texture));
        });

        const avatar = AvatarRegistry.getAvatar(AvatarManager.instance.currentAvatar.id);
        pin.updateTexture(PIXI.Texture.from(avatar.texture));


    }
    private setupScreenTransitions(): void {
        this.transition = new ScreenTransition();
        // Add it as the very first child so it stays behind everything
        this.addChild(this.transition);

        DevGuiManager.instance.addButton('OPEN', () => {
            this.transition.open()
        })

        DevGuiManager.instance.addButton('CLOSE', () => {
            this.transition.close()
        })
    }

    private setupGameplay(): void {
        this.gridView = new HexGridView();
        this.clusterManager = new ClusterManager();
        this.hexHUD = new HexHUD(new Signal(), new Signal());

        this.gameplayContainer.addChild(this.floorContainer);
        this.gameplayContainer.addChild(this.gridView);
        this.gameplayContainer.addChild(this.clusterManager);

        const gridRect = new PIXI.Rectangle(50, 0, Game.DESIGN_WIDTH - 100, Game.DESIGN_HEIGHT * 0.5);
        const piecesRect = new PIXI.Rectangle(20, Game.DESIGN_HEIGHT * 0.6 - 100, Game.DESIGN_WIDTH - 40, Game.DESIGN_HEIGHT * 0.4);


        this.hudContainer.addChild(this.hexHUD);

        this.hexHUD.onCenterMap.add(() => {
            this.worldMap.recenter()
        })

        this.mediator = new HexGameMediator(
            gridRect, piecesRect, this.gridView, this.clusterManager,
            this.gameplayContainer, this.gameplayContainer, this.hexHUD
        );
        // this.mediator.drawDebugZones()
        // Inside setupGameplay()
        this.mediator.gameplayData.onLevelComplete.add(async () => {
            const currentIndex = this.worldMap.getCurrentIndex(); // You'll need a getter for this

            // 1. Save Progress
            await EconomyStorage.addCurrency(CurrencyType.STARS, 3)
            await GameplayProgressStorage.saveLevelComplete(currentIndex, 3);

            // 2. Return to map
            await this.showMap();

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

    private async showMap(): Promise<void> {
        await this.transition.close();
        await PromiseUtils.await(500)

        this.hexHUD.setMode(HUDMode.WORLDMAP)
        this.transition.setTargetWidth(Game.overlayScreenData.width)

        this.isMapActive = true;
        this.worldViewContainer.visible = true; // Hides/Shows both Map and WorldHUD
        this.mediator.setInputEnabled(false);
        this.transition.open();
    }

    private async startLevel(level: LevelData): Promise<void> {
        await this.transition.close();
        await PromiseUtils.await(500)
        this.transition.setTargetWidth(Game.DESIGN_WIDTH)
        this.isMapActive = false;
        this.worldViewContainer.visible = false; // Completely cleans the screen
        this.hexHUD.setMode(HUDMode.GAMEPLAY)

        this.mediator.startLevel(level.matrix, level.difficulty || Difficulty.MEDIUM, level.pieces);
        this.mediator.setInputEnabled(true);
        this.transition.open();
    }

    // --- Main Loop ---

    public update(delta: number): void {
        if (this.isMapActive) {
            this.worldMap.update(delta);
        }
        this.transition.update(delta);


        //this.hexHUD?.update(delta);
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
        this.worldHUD?.layout();
    }
    private layout(): void {
        const centerX = Game.DESIGN_WIDTH / 2;
        const centerY = Game.DESIGN_HEIGHT / 2;

        // 1. Gameplay positioning
        this.gameplayContainer.setTransform(centerX, centerY);
        this.gameplayContainer.pivot.set(centerX, centerY);

        // 2. Background positioning
        this.levelBackground.setTransform(centerX, centerY);
        this.levelBackground.anchor.set(0.5);
        this.levelBackground.scale.set(
            ViewUtils.elementEvelop(this.levelBackground, Game.overlayScreenData.width, Game.overlayScreenData.height)
        );

        // 3. World View Container (Fullscreen HUD layer)
        this.worldViewContainer.position.set(0, 0);

        // 4. Internal Map Panning logic
        this.layoutMap();

        // 5. HUD positioning
        this.hexHUD.layout();

        // 6. DYNAMIC RESOLUTION ADAPTATION FOR TRANSITION
        // We update this every layout pass to ensure that if the window resizes, 
        // the clouds know their new "edge of screen" target.
        if (this.transition) {
            if (this.isMapActive) {
                // In Map mode, we use the actual screen width (Overlay)
                this.transition.setTargetWidth(Game.overlayScreenData.width);
            } else {
                // In Gameplay mode, we lock it to the DESIGN_WIDTH
                this.transition.setTargetWidth(Game.DESIGN_WIDTH);
            }
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