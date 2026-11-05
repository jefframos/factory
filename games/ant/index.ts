// Ant — a chill pixel-picture puzzle: tap coloured tiles into the slots, and their ants carry the picture away, pixel by
// pixel, into the anthill. Getting the order right is the whole game (see README.md).
// Boot: platform, then the scene (no fonts or atlas yet: the first version draws its UI itself).

import { Game } from 'core/Game';
import HtmlLoader from 'core/loader/HtmlLoader';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { getPlatformInstance } from 'core/platforms/PlatformFactory';
import { SceneManager } from 'core/scene/SceneManager';
import * as PIXI from 'pixi.js';

import loaderConfig from './loader.config';
import platformConfig from './platforms.config.json';
import AntScene from './game/scenes/AntScene';

type PlatformConfigEntry = { gameId?: string; enableAds?: boolean };

export default class AntGame extends Game {
    private readonly gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private readonly loaderScene: HtmlLoader;

    public constructor() {
        super({ resolution: Math.min(2, devicePixelRatio), backgroundAlpha: 0 }, false);
        this.loaderScene = new HtmlLoader(loaderConfig);
        PIXI.Ticker.shared.maxFPS = 60;
        this.folderPath = 'ant';
        void this.initialize();
    }

    protected async initialize(): Promise<void> {
        const platformName = import.meta.env.VITE_PLATFORM || 'local';
        const config = (platformConfig as Record<string, PlatformConfigEntry>)[platformName];
        try {
            this.setCanvasZIndex(8);
            PlatformHandler.GAME_ID = config?.gameId || '';
            PlatformHandler.ENABLE_VIDEO_ADS = config?.enableAds ?? true;
            await PlatformHandler.instance.initialize(await getPlatformInstance(platformName));
            PlatformHandler.instance.platform.startLoad();
            this.stageContainer.addChild(this.gameContainer);
            this.sceneManager = new SceneManager(this.gameContainer);
            this.sceneManager.register<AntScene>('ant', AntScene, this);
            this.sceneManager.changeScene('ant');
            this.sceneManager.resize();
            PlatformHandler.instance.platform.loadFinished();
            this.loaderScene.hide();
        } catch (error) {
            console.error('Failed to initialize:', error);
        }
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

new AntGame();
