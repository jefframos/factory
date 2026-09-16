import { Game } from 'core/Game';
import HtmlLoader from 'core/loader/HtmlLoader';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { getPlatformInstance } from 'core/platforms/PlatformFactory';
import { SceneManager } from 'core/scene/SceneManager';
import { DevGuiManager } from 'core/utils/DevGuiManager';
import * as PIXI from 'pixi.js';

import loaderConfig from './loader.config';
import platformConfig from './platforms.config.json';
import ControllerScene from './game/scenes/ControllerScene';

type PlatformConfigEntry = { className?: string; folder?: string; gameId?: string; enableAds?: boolean };

export default class MyGame extends Game {
    private gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private loaderScene: HtmlLoader;

    public constructor() {
        super({ resolution: Math.min(2, devicePixelRatio), backgroundAlpha: 0 }, false);
        this.loaderScene = new HtmlLoader(loaderConfig);
        PIXI.Ticker.shared.maxFPS = 60;

        this.folderPath = 'bandit-controller';
        this.initialize();
    }

    protected async initialize(): Promise<void> {
        const platformName = import.meta.env.VITE_PLATFORM || 'local';
        const config = (platformConfig as Record<string, PlatformConfigEntry>)[platformName];

        this.folderPath = config?.folder || this.folderPath;

        try {
            this.setCanvasZIndex(8);
            PlatformHandler.GAME_ID = config?.gameId || '';
            PlatformHandler.ENABLE_VIDEO_ADS = config?.enableAds ?? true;

            const plat = await getPlatformInstance(platformName);
            await PlatformHandler.instance.initialize(plat);

            PlatformHandler.instance.platform.startLoad();
            this.stageContainer.addChild(this.gameContainer);
            this.sceneManager = new SceneManager(this.gameContainer);

            PlatformHandler.instance.platform.loadFinished();
            this.loaderScene.hide();
            this.startGame();
        } catch (error) {
            console.error('Failed to initialize platform:', error);
        }
    }

    private startGame(): void {
        // Dev-only tuning panel (dat.GUI) — visible with ?dev in the URL (see Game.extractDebugParams()).
        // Must run before the scene builds so ControllerScene's camera sliders have a GUI to attach to.
        DevGuiManager.instance.initialize(Game.debugParams.dev);
        this.sceneManager.register<ControllerScene>('game', ControllerScene, this);
        this.sceneManager.changeScene('game');
        this.sceneManager.resize();
    }

    protected override update(delta: number): void {
        this.sceneManager?.update(delta);
    }

    protected override fixedUpdate(delta: number): void {
        this.sceneManager?.fixedUpdate(delta);
    }

    protected override onResize(): void {
        super.onResize();
        this.sceneManager?.resize();
    }
}

// bootstrap
new MyGame();
