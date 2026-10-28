// Garage — run a car repair shop, upgrade your own car with the money, then race it for trophies.
// Built on the bandit-controller engine pieces (character, camera, UI kit, audio, platform wiring).
//
// Scenes: 'garage' (the shop) and 'race'. Scenes expose Signals; only this file changes scenes,
// always after the current tick has finished (see requestSceneChange()).

import { Game } from 'core/Game';
import HtmlLoader from 'core/loader/HtmlLoader';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { getPlatformInstance } from 'core/platforms/PlatformFactory';
import { SceneManager } from 'core/scene/SceneManager';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import SoundManager from 'core/audio/SoundManager';
import * as PIXI from 'pixi.js';

import loaderConfig from './loader.config';
import fontManifest from './manifests/fonts.json';
import platformConfig from './platforms.config.json';
import GarageScene from './game/scenes/GarageScene';
import RaceScene from './game/scenes/RaceScene';
import RadialTransition from './game/ui/RadialTransition';
import MoneyHud from './game/ui/MoneyHud';
import SoundToggleButton from './game/ui/SoundToggleButton';
import { GameState } from './game/data/GameState';
import { GameAudio } from './game/audio/GameAudio';

interface AsyncReadyScene {
    readonly ready: Promise<void>;
}

type PlatformConfigEntry = { className?: string; folder?: string; gameId?: string; enableAds?: boolean };

export default class GarageGame extends Game {
    private gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private loaderScene: HtmlLoader;
    private pendingSceneChange: { key: string; force: boolean } | null = null;
    private transitionInProgress = false;
    private transition!: RadialTransition;
    private scenesByKey: Record<string, AsyncReadyScene> = {};
    private moneyHud!: MoneyHud;
    private soundToggle?: SoundToggleButton;

    public constructor() {
        super({ resolution: Math.min(2, devicePixelRatio), backgroundAlpha: 0 }, false);
        this.loaderScene = new HtmlLoader(loaderConfig);
        PIXI.Ticker.shared.maxFPS = 60;
        this.folderPath = 'garage';
        this.initialize();
    }

    protected async initialize(): Promise<void> {
        const platformName = import.meta.env.VITE_PLATFORM || 'local';
        const config = (platformConfig as Record<string, PlatformConfigEntry>)[platformName];
        this.folderPath = config?.folder || this.folderPath;
        SoundManager.STORAGE_ID = 'garage.';

        try {
            this.setCanvasZIndex(8);
            PlatformHandler.GAME_ID = config?.gameId || '';
            PlatformHandler.ENABLE_VIDEO_ADS = config?.enableAds ?? true;
            const plat = await getPlatformInstance(platformName);
            await PlatformHandler.instance.initialize(plat);

            PlatformHandler.instance.platform.startLoad();
            this.stageContainer.addChild(this.gameContainer);
            this.sceneManager = new SceneManager(this.gameContainer);

            await this.loadFonts();
            await PIXI.Assets.load(`${this.folderPath}/images/ui.webp.json`);
            await GameAudio.initialize(this.folderPath);

            PlatformHandler.instance.platform.loadFinished();
            this.loaderScene.hide();
            this.startGame();
        } catch (error) {
            console.error('Failed to initialize platform:', error);
        }
    }

    private async loadFonts(): Promise<void> {
        const families = fontManifest.bundles[0].assets
            .flatMap((asset) => asset.alias)
            .filter((alias) => !alias.includes('.'));
        await Promise.all(families.map(async (family) => {
            const face = new FontFace(family, `url(./${this.folderPath}/fonts/${family}.woff2) format('woff2')`);
            document.fonts.add(await face.load());
        }));
    }

    private startGame(): void {
        this.soundToggle = new SoundToggleButton();
        this.uiLayer.eventMode = 'static';
        this.uiLayer.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            if (event.target !== this.uiLayer) {
                GameAudio.play('tap');
            }
        });
        DebugOverlay.instance.initialize(Boolean(Game.debugParams.dev || Game.debugParams.debug), 'garage');

        this.moneyHud = new MoneyHud(GameState.getMoney());
        this.uiLayer.addChild(this.moneyHud);

        const garage = this.sceneManager.register<GarageScene>('garage', GarageScene, this, this.moneyHud);
        garage.onRace.add(() => this.requestSceneChange('race', true));
        const race = this.sceneManager.register<RaceScene>('race', RaceScene, this);
        race.onBack.add(() => this.requestSceneChange('garage', true));
        this.scenesByKey = { garage, race };
        this.transition = new RadialTransition(this);

        const debug = DebugOverlay.instance.panel('Garage', { id: 'garage.debug' });
        debug.monitor('Cash', () => GameState.getMoney());
        debug.button('ADD $500', () => {
            GameState.addMoney(500);
            this.moneyHud.setResourceCount(GameState.getMoney());
        });

        const initialSceneKey = Game.debugParams.scene === 'race' ? 'race' : 'garage';
        this.sceneManager.changeScene(initialSceneKey);
        this.uiLayer.addChild(this.soundToggle);
        GameAudio.setScene(initialSceneKey);
        this.sceneManager.resize();
    }

    private requestSceneChange(sceneKey: string, force = false): void {
        this.pendingSceneChange = { key: sceneKey, force };
    }

    private applyPendingSceneChange(): void {
        if (!this.pendingSceneChange || this.transitionInProgress) {
            return;
        }
        const { key, force } = this.pendingSceneChange;
        this.pendingSceneChange = null;
        void this.playSceneTransition(key, force);
    }

    private async playSceneTransition(sceneKey: string, force = false): Promise<void> {
        this.transitionInProgress = true;
        try {
            await this.transition.cover();
            this.sceneManager.changeScene(sceneKey, force);
            await this.scenesByKey[sceneKey]?.ready;
            if (this.soundToggle) {
                this.uiLayer.addChild(this.soundToggle);
            }
            GameAudio.setScene(sceneKey);
            await this.transition.reveal();
        } finally {
            this.transitionInProgress = false;
        }
    }

    protected override update(delta: number): void {
        this.sceneManager?.update(delta);
        this.applyPendingSceneChange();
    }

    protected override fixedUpdate(delta: number): void {
        this.sceneManager?.fixedUpdate(delta);
        this.applyPendingSceneChange();
    }

    protected override onResize(): void {
        super.onResize();
        this.sceneManager?.resize();
        this.moneyHud?.reposition();
        this.soundToggle?.reposition();
    }
}

new GarageGame();
