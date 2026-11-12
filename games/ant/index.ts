// Ant — a chill pixel-picture puzzle: tap coloured tiles into the slots, and their ants carry the picture away, pixel by
// pixel, into the anthill. Getting the order right is the whole game (see README.md).
// Boot: platform, the font and the UI atlas (the Layer Lab pack's sprites, raw-assets/images/ui{tps}), then the main
// screen (HomeScene); PLAY goes to the game (AntScene), whose pause popup's HOME comes back. Each switch builds the scene
// afresh (the old one is torn down), as the UFO game does.

import { Game } from 'core/Game';
import SoundManager from 'core/audio/SoundManager';
import HtmlLoader from 'core/loader/HtmlLoader';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { getPlatformInstance } from 'core/platforms/PlatformFactory';
import { SceneManager } from 'core/scene/SceneManager';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import * as PIXI from 'pixi.js';

import loaderConfig from './loader.config';
import platformConfig from './platforms.config.json';
import AntScene from './game/scenes/AntScene';
import HomeScene from './game/scenes/HomeScene';
import { AntAudio } from './game/audio/AntAudio';
import { RadialTransition } from './game/ui/RadialTransition';
import { AntSave } from './game/data/AntSave';
import { LEVELS } from './game/data/Levels';
import { AntAds } from './game/data/AntAds';

type PlatformConfigEntry = { gameId?: string; enableAds?: boolean };

const FONTS = ['Baloo2-ExtraBold'];
/** The debug panel's coins. */
const DEBUG_COINS = 500;

export default class AntGame extends Game {
    private readonly gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private readonly loaderScene: HtmlLoader;
    private scenes = 0;
    /** A transition is under way (a second tap doesn't start another). */
    private travelling = false;
    /** The main screen's up (not the game). */
    private atHome = false;

    public constructor() {
        super({ resolution: Math.min(2, devicePixelRatio), backgroundAlpha: 0 }, false);
        this.loaderScene = new HtmlLoader(loaderConfig);
        PIXI.Ticker.shared.maxFPS = 60;
        this.folderPath = 'ant';
        // The saved mute is Ant's own (not shared with the other games on the same site).
        SoundManager.STORAGE_ID = 'ant.';
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
            // The player's progress from the platform (YouTube Playables keeps only its own save).
            await AntSave.init();
            PlatformHandler.instance.platform.startLoad();
            // The debug panels: only with ?dev=1 / ?debug=1 (as UFO's), not just for being on the dev server.
            DebugOverlay.instance.initialize(Boolean(Game.debugParams.dev || Game.debugParams.debug), 'ant');
            this.stageContainer.addChild(this.gameContainer);
            this.sceneManager = new SceneManager(this.gameContainer);
            await Promise.all(FONTS.map(async (family) => {
                const face = new FontFace(family, `url(./${this.folderPath}/fonts/${family}.woff2) format('woff2')`);
                document.fonts.add(await face.load());
            }));
            await PIXI.Assets.load(`${this.folderPath}/images/ui.webp.json`);
            AntAudio.initialize(this.folderPath);
            // Browsers only start audio after an input: the music begins on the first one.
            const unlock = () => {
                window.removeEventListener('pointerdown', unlock, true);
                window.removeEventListener('keydown', unlock, true);
                AntAudio.unlock();
            };
            window.addEventListener('pointerdown', unlock, true);
            window.addEventListener('keydown', unlock, true);
            this.buildDebug();
            // A new player goes straight into the tutorial (the first level); ?play=1 goes straight to the game (testing).
            if (!AntSave.tutorialDone || new URLSearchParams(window.location.search).has('play')) this.showGame();
            else this.showHome();
            PlatformHandler.instance.platform.loadFinished();
            this.loaderScene.hide();
        } catch (error) {
            console.error('Failed to initialize:', error);
        }
    }

    /** Covers the screen (RadialTransition: where it's going), swaps the scene underneath, opens on it. */
    private travel(title: string, subtitle: string, withPicture: boolean, swap: () => void, during?: () => Promise<void>): void {
        if (this.travelling) return;
        this.travelling = true;
        const level = LEVELS[Math.max(0, Math.min(AntSave.selected, LEVELS.length - 1))];
        void RadialTransition.go(this, title, subtitle, withPicture ? level ?? null : null, swap, during).then(() => {
            this.travelling = false;
        });
    }

    /** To the game, at the level the main screen shows (the transition shows its picture). */
    private playLevel(): void {
        const index = Math.max(0, Math.min(AntSave.selected, LEVELS.length - 1));
        // A commercial break on the way in too (the screen covered), as between levels (AntAds: its pacing).
        this.travel(`LEVEL ${index + 1}`, (LEVELS[index]?.name ?? '').toUpperCase(), true, () => this.showGame(), () => AntAds.between());
    }

    /** The debug panel's data tools (dev server, or ?dev=1): coins to spend, and a fresh start. */
    private buildDebug(): void {
        const panel = DebugOverlay.instance.panel('Ant data', { id: 'ant.data' });
        panel.button(`+${DEBUG_COINS} COINS`, () => {
            AntSave.addCoins(DEBUG_COINS);
            // The main screen shows them at once (built again).
            if (this.atHome) this.showHome();
        });
        panel.button('RESET DATA', () => {
            AntSave.erase();
            try {
                window.localStorage.removeItem('ant.music');
            } catch {
                // No storage: nothing to erase.
            }
            window.location.reload();
        });
    }

    /** The main screen. */
    private showHome(): void {
        this.atHome = true;
        const key = `ant-${this.scenes++}`;
        this.sceneManager.register<HomeScene>(key, HomeScene, this, () => this.playLevel());
        this.sceneManager.changeScene(key);
        this.sceneManager.resize();
    }

    /** The game, at the level the player is on. */
    private showGame(): void {
        this.atHome = false;
        const key = `ant-${this.scenes++}`;
        this.sceneManager.register<AntScene>(key, AntScene, this, () => this.travel('HOME', '', false, () => this.showHome()));
        this.sceneManager.changeScene(key);
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

new AntGame();
