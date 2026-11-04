// UFO: fly a saucer over a town and eat it, growing as you go (see README.md).

import { Game } from 'core/Game';
import HtmlLoader from 'core/loader/HtmlLoader';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { getPlatformInstance } from 'core/platforms/PlatformFactory';
import { SceneManager } from 'core/scene/SceneManager';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import * as PIXI from 'pixi.js';

import loaderConfig from './loader.config';
import platformConfig from './platforms.config.json';
import UfoScene from './game/scenes/UfoScene';

type PlatformConfigEntry = { gameId?: string; enableAds?: boolean; folderPath?: string };

const FONTS = ['Baloo2-ExtraBold'];
/** The longest the loading screen waits for the town's models (a stuck load still lets the player in). */
const MAX_SCENE_WAIT_MS = 20000;

export default class UfoGame extends Game {
    private gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private loaderScene: HtmlLoader;
    private scenes = 0;

    public constructor() {
        super({ resolution: Math.min(2, devicePixelRatio), backgroundAlpha: 0 }, false);
        this.loaderScene = new HtmlLoader(loaderConfig);
        PIXI.Ticker.shared.maxFPS = 60;
        this.folderPath = 'ufo';
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
            await PlatformHandler.instance.initialize(await getPlatformInstance(platformName));
            PlatformHandler.instance.platform.startLoad();
            this.stageContainer.addChild(this.gameContainer);
            this.sceneManager = new SceneManager(this.gameContainer);
            await Promise.all(FONTS.map(async (family) => {
                const face = new FontFace(family, `url(./${this.folderPath}/fonts/${family}.woff2) format('woff2')`);
                document.fonts.add(await face.load());
            }));
            DebugOverlay.instance.initialize(Boolean(Game.debugParams.dev || Game.debugParams.debug), 'ufo');
            const scene = this.buildScene();
            await Promise.race([scene.ready, new Promise((resolve) => window.setTimeout(resolve, MAX_SCENE_WAIT_MS))]);
            PlatformHandler.instance.platform.loadFinished();
            this.loaderScene.hide();
        } catch (error) {
            console.error('Failed to start:', error);
        }
    }

    /** A fresh scene (the old one torn down): at boot, and on PLAY AGAIN. */
    private buildScene(): UfoScene {
        const key = `ufo-${this.scenes++}`;
        const scene = this.sceneManager.register<UfoScene>(key, UfoScene, this, () => this.buildScene());
        this.sceneManager.changeScene(key);
        this.sceneManager.resize();
        return scene;
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

new UfoGame();
