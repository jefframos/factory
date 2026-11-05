// UFO: fly a saucer over a town and eat it, growing as you go (see README.md).

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
import { UfoAudio } from './game/audio/UfoAudio';
import HomeScene from './game/scenes/HomeScene';
import UfoScene, { Travel } from './game/scenes/UfoScene';
import { UfoProgress } from './game/data/UfoProgress';
import { competitionName, currentMission, goToCompetition, goToTutorial, levelInAddress, levelTitle } from './game/data/UfoConfig';
import { RadialTransition } from './game/ui/RadialTransition';

type PlatformConfigEntry = { gameId?: string; enableAds?: boolean; folderPath?: string };

const FONTS = ['Baloo2-ExtraBold'];
/** The longest the loading screen waits for the town's models (a stuck load still lets the player in). */
const MAX_SCENE_WAIT_MS = 20000;

export default class UfoGame extends Game {
    private gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private loaderScene: HtmlLoader;
    private scenes = 0;
    /** A transition to another level is under way (a second tap doesn't start another). */
    private travelling = false;

    public constructor() {
        super({ resolution: Math.min(2, devicePixelRatio), backgroundAlpha: 0 }, false);
        this.loaderScene = new HtmlLoader(loaderConfig);
        PIXI.Ticker.shared.maxFPS = 60;
        this.folderPath = 'ufo';
        SoundManager.STORAGE_ID = 'ufo.';
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
            UfoAudio.initialize(this.folderPath);
            this.stageContainer.addChild(this.gameContainer);
            this.sceneManager = new SceneManager(this.gameContainer);
            await Promise.all(FONTS.map(async (family) => {
                const face = new FontFace(family, `url(./${this.folderPath}/fonts/${family}.woff2) format('woff2')`);
                document.fonts.add(await face.load());
            }));
            await PIXI.Assets.load(`${this.folderPath}/images/ui.webp.json`);
            DebugOverlay.instance.initialize(Boolean(Game.debugParams.dev || Game.debugParams.debug), 'ufo');
            const playFirst = levelInAddress() || !UfoProgress.tutorialDone;
            if (!levelInAddress() && !UfoProgress.tutorialDone) goToTutorial();
            const scene = playFirst ? this.buildScene() : this.buildHome();
            await Promise.race([scene.ready, new Promise((resolve) => window.setTimeout(resolve, MAX_SCENE_WAIT_MS))]);
            PlatformHandler.instance.platform.loadFinished();
            this.loaderScene.hide();
        } catch (error) {
            console.error('Failed to start:', error);
        }
    }

    /** A fresh scene (the old one torn down): at boot, and on to the next level (behind the transition). */
    private buildScene(): UfoScene {
        const key = `ufo-${this.scenes++}`;
        const scene = this.sceneManager.register<UfoScene>(key, UfoScene, this, (travel: Travel) => void this.nextLevel(travel));
        this.sceneManager.changeScene(key);
        this.sceneManager.resize();
        return scene;
    }

    /** The main screen. */
    private buildHome(): HomeScene {
        const key = `ufo-${this.scenes++}`;
        const scene = this.sceneManager.register<HomeScene>(key, HomeScene, this,
            () => {
                const mission = currentMission();
                void this.nextLevel({ title: mission?.name ?? '', subtitle: mission ? levelTitle(mission.level).toUpperCase() : '', apply: () => undefined });
            },
            () => void this.nextLevel({ title: competitionName(), subtitle: 'COMPETITION', apply: () => goToCompetition() }));
        this.sceneManager.changeScene(key);
        this.sceneManager.resize();
        return scene;
    }

    /** The screen covers over, showing where it's going; the next level's built behind that; the cover opens on it. */
    private async nextLevel(travel: Travel): Promise<void> {
        if (this.travelling) return;
        this.travelling = true;
        UfoAudio.whoosh();
        const transition = new RadialTransition(this);
        await transition.cover(travel.title.toUpperCase(), travel.subtitle);
        travel.apply();
        const scene = travel.home ? this.buildHome() : this.buildScene();
        await Promise.race([scene.ready, new Promise((resolve) => window.setTimeout(resolve, MAX_SCENE_WAIT_MS))]);
        await transition.reveal();
        transition.destroy();
        this.travelling = false;
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
