// Mob: aim a cannon, multiply your crowd through gates, overrun the enemy base (see README.md).

import SoundManager from 'core/audio/SoundManager';
import { Game } from 'core/Game';
import HtmlLoader from 'core/loader/HtmlLoader';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { getPlatformInstance } from 'core/platforms/PlatformFactory';
import { SceneManager } from 'core/scene/SceneManager';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import * as PIXI from 'pixi.js';

import loaderConfig from './loader.config';
import platformConfig from './platforms.config.json';
import MobScene from './game/scenes/MobScene';
import { MobAudio } from './game/audio/MobAudio';

type PlatformConfigEntry = { gameId?: string; enableAds?: boolean; folderPath?: string };

const FONTS = ['Baloo2-ExtraBold'];
/** The longest the loading screen waits for the crowd's model (a stuck load still lets the player in). */
const MAX_SCENE_WAIT_MS = 20000;

export default class MobGame extends Game {
    private gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private loaderScene: HtmlLoader;

    public constructor() {
        super({ resolution: Math.min(2, devicePixelRatio), backgroundAlpha: 0 }, false);
        this.loaderScene = new HtmlLoader(loaderConfig);
        PIXI.Ticker.shared.maxFPS = 60;
        this.folderPath = 'mob';
        SoundManager.STORAGE_ID = 'mob.';
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
            MobAudio.initialize(this.folderPath);
            this.stageContainer.addChild(this.gameContainer);
            this.sceneManager = new SceneManager(this.gameContainer);
            await Promise.all(FONTS.map(async (family) => {
                const face = new FontFace(family, `url(./${this.folderPath}/fonts/${family}.woff2) format('woff2')`);
                document.fonts.add(await face.load());
            }));
            // The UI's sprites (picked from library3d/2d's pack: raw-assets/images/ui{tps}, `npm run image`).
            await PIXI.Assets.load(`${this.folderPath}/images/ui.webp.json`);
            // The debug panels: only with ?dev=1 / ?debug=1.
            DebugOverlay.instance.initialize(Boolean(Game.debugParams.dev || Game.debugParams.debug), 'mob');
            const scene = this.sceneManager.register<MobScene>('battle', MobScene, this);
            this.sceneManager.changeScene('battle');
            this.sceneManager.resize();
            await Promise.race([scene.ready, new Promise((resolve) => window.setTimeout(resolve, MAX_SCENE_WAIT_MS))]);
            PlatformHandler.instance.platform.loadFinished();
            this.loaderScene.hide();
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

new MobGame();
