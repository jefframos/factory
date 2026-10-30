// Mow Town — a casual mowing / city-restoration game: walk to cut the overgrown town back to life (see README.md).
// Boot: platform, language, audio, fonts and the UI atlas, then the scene (the loading screen waits until it's playable).

import { Game } from 'core/Game';
import HtmlLoader from 'core/loader/HtmlLoader';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { getPlatformInstance } from 'core/platforms/PlatformFactory';
import { SceneManager } from 'core/scene/SceneManager';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import SoundManager from 'core/audio/SoundManager';
import * as PIXI from 'pixi.js';

import loaderConfig from './loader.config';
import platformConfig from './platforms.config.json';
import fontManifest from './manifests/fonts.json';
import MowScene, { MOW_CAMERA } from './game/scenes/MowScene';
import { Localization } from './game/i18n/Localization';
import { MowAudio } from './game/audio/MowAudio';

type PlatformConfigEntry = { className?: string; folder?: string; gameId?: string; enableAds?: boolean };

/** The longest the loading screen waits for the scene to be playable (a stuck model load still lets the player in). */
const MAX_SCENE_WAIT_MS = 20000;

export default class MowGame extends Game {
    private gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private loaderScene: HtmlLoader;

    public constructor() {
        super({ resolution: Math.min(2, devicePixelRatio), backgroundAlpha: 0 }, false);
        this.loaderScene = new HtmlLoader(loaderConfig);
        PIXI.Ticker.shared.maxFPS = 60;
        this.folderPath = 'mow';
        this.initialize();
    }

    protected async initialize(): Promise<void> {
        const platformName = import.meta.env.VITE_PLATFORM || 'local';
        const config = (platformConfig as Record<string, PlatformConfigEntry>)[platformName];
        this.folderPath = config?.folder || this.folderPath;
        SoundManager.STORAGE_ID = 'mow.';

        try {
            this.setCanvasZIndex(8);
            PlatformHandler.GAME_ID = config?.gameId || '';
            PlatformHandler.ENABLE_VIDEO_ADS = config?.enableAds ?? true;
            const plat = await getPlatformInstance(platformName);
            await PlatformHandler.instance.initialize(plat);

            PlatformHandler.instance.platform.startLoad();
            // The language (saved choice, else the browser's) before any UI is built.
            await Localization.load();
            await MowAudio.initialize(this.folderPath);
            this.stageContainer.addChild(this.gameContainer);
            this.sceneManager = new SceneManager(this.gameContainer);

            await this.loadFonts();
            await PIXI.Assets.load(`${this.folderPath}/images/ui.webp.json`);

            // The loading screen stays up until the scene is playable (the character loaded), capped so a stuck load
            // still lets the player in.
            const scene = this.startGame();
            await Promise.race([scene.ready, new Promise((resolve) => window.setTimeout(resolve, MAX_SCENE_WAIT_MS))]);
            PlatformHandler.instance.platform.loadFinished();
            this.loaderScene.hide();
        } catch (error) {
            console.error('Failed to initialize platform:', error);
        }
    }

    /** Registers every packed font (raw-assets/fonts) so PIXI.Text can use it by family name. */
    private async loadFonts(): Promise<void> {
        const families = fontManifest.bundles[0].assets
            .flatMap((asset) => asset.alias)
            .filter((alias) => !alias.includes('.'));
        await Promise.all(families.map(async (family) => {
            const face = new FontFace(family, `url(./${this.folderPath}/fonts/${family}.woff2) format('woff2')`);
            document.fonts.add(await face.load());
        }));
    }

    private startGame(): MowScene {
        DebugOverlay.instance.initialize(Boolean(Game.debugParams.dev || Game.debugParams.debug), 'mow');
        const camera = DebugOverlay.instance.panel('Camera', { id: 'mow.camera' });
        camera.slider(MOW_CAMERA, 'yawDeg', -180, 180, 1, 'Yaw');
        camera.slider(MOW_CAMERA, 'pitchDeg', 20, 89, 1, 'Pitch');
        camera.slider(MOW_CAMERA, 'distance', 6, 40, 0.5, 'Distance');
        camera.slider(MOW_CAMERA, 'followSpeed', 1, 20, 0.5, 'Follow Speed');

        const scene = this.sceneManager.register<MowScene>('mow', MowScene, this);
        this.sceneManager.changeScene('mow');
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

new MowGame();
