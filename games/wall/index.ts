// WALLBREAK: punch a wall to pieces, one after another (see README.md and wallbreak-design-readme.md).

import { Game } from 'core/Game';
import HtmlLoader from 'core/loader/HtmlLoader';
import PlatformHandler, { type AdMobConfig } from 'core/platforms/PlatformHandler';
import { SaveStorage } from 'core/platforms/SaveStorage';
import { getPlatformInstance } from 'core/platforms/PlatformFactory';
import { SceneManager } from 'core/scene/SceneManager';
import SetupThree from 'core/scene/SetupThree';
import { AdaptiveResolution, PHONE_START } from 'core/scene/AdaptiveResolution';
import { CheapLights } from 'core/scene/CheapLights';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import * as PIXI from 'pixi.js';

import loaderConfig from './loader.config';
import platformConfig from './platforms.config.json';
import { WallAnalytics } from './game/analytics/WallAnalytics';
import { WallAudio } from './game/audio/WallAudio';
import { WallProgress } from './game/data/WallProgress';
import WallScene from './game/scenes/WallScene';

type PlatformConfigEntry = { gameId?: string; enableAds?: boolean; folderPath?: string; admob?: AdMobConfig };

const FONTS = ['Baloo2-ExtraBold'];
/** The longest the loading screen waits for the hands (the wall's there without them). */
const MAX_SCENE_WAIT_MS = 8000;

export default class WallGame extends Game {
    private gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private loaderScene: HtmlLoader;

    public constructor() {
        super({ resolution: Math.min(2, devicePixelRatio), backgroundAlpha: 0 }, false);
        this.loaderScene = new HtmlLoader(loaderConfig);
        PIXI.Ticker.shared.maxFPS = 60;
        this.folderPath = 'wall';
        this.initialize();
    }

    protected async initialize(): Promise<void> {
        const platformName = import.meta.env.VITE_PLATFORM || 'local';
        const config = (platformConfig as Record<string, PlatformConfigEntry>)[platformName];
        this.folderPath = config?.folderPath || this.folderPath;
        try {
            this.setCanvasZIndex(8);
            PlatformHandler.GAME_ID = config?.gameId || '';
            PlatformHandler.ENABLE_VIDEO_ADS = config?.enableAds ?? true;
            PlatformHandler.ADMOB = config?.admob;
            await PlatformHandler.instance.initialize(await getPlatformInstance(platformName));
            await SaveStorage.load([...WallProgress.saveKeys, ...WallAudio.saveKeys]);
            WallProgress.begin();
            PlatformHandler.instance.platform.startLoad();
            WallAudio.initialize(this.folderPath);
            this.stageContainer.addChild(this.gameContainer);
            this.sceneManager = new SceneManager(this.gameContainer);
            // (None waits on another.)
            WallScene.preload();
            await Promise.all([
                ...FONTS.map(async (family) => {
                    const face = new FontFace(family, `url(./${this.folderPath}/fonts/${family}.woff2) format('woff2')`);
                    document.fonts.add(await face.load());
                }),
                PIXI.Assets.load(`${this.folderPath}/images/ui.webp.json`),
            ]);
            DebugOverlay.instance.initialize(Boolean(Game.debugParams.dev || Game.debugParams.debug), 'wall');
            // Phones: lighting without shine, and a resolution that starts lower and climbs if it can.
            const phone = !!window.matchMedia?.('(pointer: coarse)').matches;
            SetupThree.OPAQUE = true;
            if (phone) CheapLights.install();
            SetupThree.adaptive ??= new AdaptiveResolution(phone ? PHONE_START : 0);
            const scene = this.sceneManager.register<WallScene>('wall', WallScene, this);
            this.sceneManager.changeScene('wall');
            this.sceneManager.resize();
            await Promise.race([scene.ready, new Promise((resolve) => window.setTimeout(resolve, MAX_SCENE_WAIT_MS))]);
            PlatformHandler.instance.platform.loadFinished();
            this.loaderScene.hide();
            WallAnalytics.loaded(performance.now() / 1000);
            // The sounds, behind it.
            WallAudio.loadInBackground();
        } catch (error) {
            console.error('Failed to start:', error);
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

new WallGame();
