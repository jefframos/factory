// Mob: aim a cannon, multiply your crowd through gates, overrun the enemy base (see README.md).
// Boot: platform, the font and the UI atlas, then the main screen (HomeScene, as Ant's and UFO's); PLAY goes to the
// battle (MobScene), whose end card's HOME comes back, through the radial wipe (RadialTransition). Each switch builds
// the scene afresh. A new player, a level pinned by the URL (?level=, ?play=1) or the editor's preview goes straight
// to the battle.

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
import HomeScene from './game/scenes/HomeScene';
import { ARENAS_BY_ID } from './game/data/Arenas';
import { RadialTransition } from './game/ui/RadialTransition';
import { MobSave } from './game/data/MobSave';
import { areaProgress } from './game/data/MobLevels';

type PlatformConfigEntry = { gameId?: string; enableAds?: boolean; folderPath?: string };

const FONTS = ['Baloo2-ExtraBold'];
/** The longest the loading screen waits for the crowd's model (a stuck load still lets the player in). */
const MAX_SCENE_WAIT_MS = 20000;

export default class MobGame extends Game {
    private gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private loaderScene: HtmlLoader;
    private scenes = 0;
    /** A transition is under way (a second tap doesn't start another). */
    private travelling = false;
    /** The main screen's up (not a battle). */
    private atHome = false;

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
            // The cards' pictures (raw-assets/images/entities{tps}), if they've been made: else they're rendered (UnitIcons).
            await PIXI.Assets.load(`${this.folderPath}/images/entities.webp.json`).catch(() => undefined);
            // The debug panels: only with ?dev=1 / ?debug=1.
            DebugOverlay.instance.initialize(Boolean(Game.debugParams.dev || Game.debugParams.debug), 'mob');
            this.buildDebug();
            const query = new URLSearchParams(window.location.search);
            // ?home=1: the main screen whatever (the editor's world map preview).
            const straightIn = !query.has('home') && (MobSave.best === 0 || ['level', 'preview', 'play'].some((key) => query.has(key)));
            if (straightIn) {
                const scene = this.showBattle();
                await Promise.race([scene.ready, new Promise((resolve) => window.setTimeout(resolve, MAX_SCENE_WAIT_MS))]);
            } else {
                this.showHome();
            }
            PlatformHandler.instance.platform.loadFinished();
            this.loaderScene.hide();
        } catch (error) {
            console.error('Failed to start:', error);
        }
    }

    /**
     * The debug panel's data tools (?dev=1 / ?debug=1), there from the start: every level unlocked (to try every area
     * from the main screen's arrows and AREAS tab), coins, and a fresh start. The main screen shows each change at once.
     */
    private buildDebug(): void {
        const panel = DebugOverlay.instance.panel('Mob data', { id: 'mob.data' });
        const refresh = () => { if (this.atHome) this.showHome(); };
        panel.monitor('Levels', () => (MobSave.unlockAll ? 'all unlocked' : `up to ${MobSave.battle + 1}`));
        panel.buttons([
            { label: 'UNLOCK ALL', action: () => { MobSave.setUnlockAll(true); refresh(); } },
            { label: 'LOCK BACK', action: () => { MobSave.setUnlockAll(false); refresh(); } },
        ]);
        panel.buttons([
            { label: '+500 COINS', action: () => { MobSave.addCoins(500); refresh(); } },
            { label: 'RESET DATA', variant: 'danger', action: () => { MobSave.reset(); refresh(); } },
        ]);
    }

    /** The main screen. */
    private showHome(): void {
        this.atHome = true;
        const key = `mob-${this.scenes++}`;
        this.sceneManager.register<HomeScene>(key, HomeScene, this, (arena?: string) => this.play(arena));
        this.sceneManager.changeScene(key);
        this.sceneManager.resize();
    }

    /** The battle (the save's next one), its end card's HOME back to the main screen. */
    private showBattle(arena?: string): MobScene {
        this.atHome = false;
        const key = `mob-${this.scenes++}`;
        const scene = this.sceneManager.register<MobScene>(key, MobScene, this, () => this.travel('HOME', '', () => this.showHome()), arena);
        this.sceneManager.changeScene(key);
        this.sceneManager.resize();
        return scene;
    }

    /** PLAY: the wipe shows the level and its area, the battle's built under it (an arena's id: a match there). */
    private play(arena?: string): void {
        if (arena) {
            this.travel('ARENA', (ARENAS_BY_ID[arena]?.name ?? '').toUpperCase(), () => this.showBattle(arena));
            return;
        }
        const area = areaProgress(MobSave.selected);
        this.travel(`LEVEL ${MobSave.selected + 1}`, `AREA ${area.number} · ${area.zone.name.toUpperCase()}`, () => this.showBattle());
    }

    /** Covers the screen, swaps the scene underneath, opens on it. */
    private travel(title: string, subtitle: string, swap: () => void): void {
        if (this.travelling) return;
        this.travelling = true;
        void RadialTransition.go(this, title, subtitle, swap).then(() => {
            this.travelling = false;
        });
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
