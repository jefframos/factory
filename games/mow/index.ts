// Mow Town — a casual mowing / city-restoration game: walk to cut the overgrown town back to life (see README.md).
// Boot: platform, language, audio, fonts and the UI atlas, then the scene (the loading screen waits until it's playable).

import { Game } from 'core/Game';
import HtmlLoader from 'core/loader/HtmlLoader';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { SaveStorage } from 'core/platforms/SaveStorage';
import { getPlatformInstance } from 'core/platforms/PlatformFactory';
import { SceneManager } from 'core/scene/SceneManager';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import SoundManager from 'core/audio/SoundManager';
import * as PIXI from 'pixi.js';

import loaderConfig from './loader.config';
import platformConfig from './platforms.config.json';
import fontManifest from './manifests/fonts.json';
import MowScene from './game/scenes/MowScene';
import { MOW_CAMERA } from './game/config/CameraConfig';
import { COLOR_GRADE, ColorGrade } from 'core/scene/ColorGrade';
import TownSnapshotScene, { SNAPSHOT_PARAM } from './game/debug/TownSnapshotScene';
import { Localization } from './game/i18n/Localization';
import { MowAudio } from './game/audio/MowAudio';
import { MowProgress } from './game/data/MowProgress';
import { markStarted } from './game/utils/AfterStart';
import { applyQuality, buildQualityPanel, capFrames } from './game/config/Quality';
import SetupThree from 'core/scene/SetupThree';

type PlatformConfigEntry = { className?: string; folder?: string; gameId?: string; enableAds?: boolean };

/** The longest the loading screen waits for the scene to be playable (a stuck model load still lets the player in). */
const MAX_SCENE_WAIT_MS = 20000;

export default class MowGame extends Game {
    private gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private loaderScene: HtmlLoader;
    /** Scenes built so far (each city change registers a fresh one: restart()). */
    private scenes = 0;

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
            // The save, from the platform's own storage, before anything's built on it.
            await SaveStorage.load(MowProgress.saveKeys);
            MowProgress.begin();

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
            capFrames(this);
            // The game is up: the sound effects come down behind it (kept out of the initial download), then the models
            // the first seconds don't need.
            MowAudio.loadInBackground();
            void MowAudio.essentials().then(markStarted);
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

    private startGame(): { ready: Promise<void> } {
        ColorGrade.install();
        // The editor's "Map snapshots": bake the town map's miniatures instead of playing (TownSnapshotScene).
        if (new URLSearchParams(window.location.search).has(SNAPSHOT_PARAM)) {
            const snapshots = this.sceneManager.register<TownSnapshotScene>('mapshots', TownSnapshotScene, this);
            this.sceneManager.changeScene('mapshots');
            return snapshots;
        }
        SetupThree.OPAQUE = true;
        applyQuality();
        DebugOverlay.instance.initialize(Boolean(Game.debugParams.dev || Game.debugParams.debug), 'mow');
        const camera = DebugOverlay.instance.panel('Camera', { id: 'mow.camera' });
        camera.slider(MOW_CAMERA, 'yawDeg', -180, 180, 1, 'Yaw');
        camera.slider(MOW_CAMERA, 'pitchDeg', 20, 89, 1, 'Pitch');
        camera.slider(MOW_CAMERA, 'distance', 6, 40, 0.5, 'Distance');
        camera.slider(MOW_CAMERA, 'fovDeg', 15, 100, 1, 'Field of View');
        camera.toggle(MOW_CAMERA, 'keepFraming', { label: 'FOV Keeps Framing' });
        camera.slider(MOW_CAMERA, 'followSpeed', 1, 20, 0.5, 'Follow Speed');
        buildQualityPanel();
        const look = DebugOverlay.instance.panel('Look', { id: 'mow.look', persist: false });
        look.slider(COLOR_GRADE.vibrance, 'value', 0, 1.2, 0.05, 'Vibrance');

        return this.buildScene();
    }

    /** A fresh MowScene (the old one torn down): at boot, and on a city change (behind the transition). */
    private buildScene(): MowScene {
        const key = `mow-${this.scenes++}`;
        const scene = this.sceneManager.register<MowScene>(key, MowScene, this, () => this.restart());
        this.sceneManager.changeScene(key);
        this.sceneManager.resize();
        return scene;
    }

    /** Another city: its scene built in place of this one; resolves once it's playable (capped like the boot). */
    private async restart(): Promise<void> {
        const scene = this.buildScene();
        await Promise.race([scene.ready, new Promise((resolve) => window.setTimeout(resolve, MAX_SCENE_WAIT_MS))]);
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
