import { Game } from 'core/Game';
import HtmlLoader from 'core/loader/HtmlLoader';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { getPlatformInstance } from 'core/platforms/PlatformFactory';
import { SceneManager } from 'core/scene/SceneManager';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import { setPhysicsDebugFlags } from 'core/physics/PhysicsConstants';
import * as PIXI from 'pixi.js';

import loaderConfig from './loader.config';
import fontManifest from './manifests/fonts.json';
import platformConfig from './platforms.config.json';
import HubScene from './game/scenes/HubScene';
import RunnerMinigameScene from './game/scenes/RunnerMinigameScene';
import SwipeMinigameScene from './game/scenes/SwipeMinigameScene';
import HomeScene from './game/scenes/HomeScene';
import PathLevelScene from './game/scenes/PathLevelScene';
import RadialTransition from './game/ui/RadialTransition';
import { applyDebugPhysicsCookie, saveDebugPhysicsCookie } from './game/utils/DebugPhysicsCookie';
import { RunnerBendService } from 'core/services/RunnerBendService';
import { RUNNER_MINIGAME_SETTINGS, SWIPE_MINIGAME_SETTINGS } from './game/data/MinigameSettings';
import { PLAYER_SETTINGS } from './game/data/PlayerSettings';
import { WORLD_SETTINGS } from './game/data/WorldSettings';
import MoneyHud from './game/ui/MoneyHud';
import { GameState } from './game/data/GameState';

/** What every scene exposes for the transition below to wait on — see HubScene.ready's own doc. */
interface AsyncReadyScene {
    readonly ready: Promise<void>;
}

/** ?minigame=runner / ?minigame=swipe (see Game.extractDebugParams()) — shorthand for the two registered scene keys below, so a tester can jump straight into a minigame without walking through the hub. Any other/missing value falls back to the hub. */
const MINIGAME_QUERY_SHORTHAND: Record<string, string> = {
    runner: 'runner-minigame',
    swipe: 'swipe-minigame',
    path: 'path-level',
};

type PlatformConfigEntry = { className?: string; folder?: string; gameId?: string; enableAds?: boolean };

export default class MyGame extends Game {
    private gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private loaderScene: HtmlLoader;
    /**
     * A scene's own Signal (HubScene.onEnterMinigame, *MinigameScene.onComplete)
     * can fire from INSIDE this.sceneManager.fixedUpdate()/update() — e.g. a
     * gate's RigidBody.onTriggerEnter dispatches synchronously from within
     * PhysicsWorld.updateContacts(), itself called from HubScene.fixedUpdate().
     * Calling sceneManager.changeScene() immediately from that handler would
     * destroy (and null out) the CURRENTLY-EXECUTING scene's own state (its
     * WorldEnvironment, its player's RigidBody, ...) while that same scene's
     * fixedUpdate()/update() is still mid-call-stack, further down which
     * still expects to read it — e.g. HubScene.fixedUpdate()'s own
     * `this.env.updateCamera(...)` call, right after `this.env.fixedUpdate()`
     * is what fires the gate trigger in the first place. So every scene
     * change request is only ever recorded here, then actually applied once
     * this tick's sceneManager.fixedUpdate()/update() call has FULLY
     * returned (see applyPendingSceneChange()) — never nested inside it.
     */
    private pendingSceneChange: { key: string; force: boolean } | null = null;
    /** Guards against a SECOND scene-change request (e.g. the outgoing scene's own physics still ticking during the radial cover, briefly overlapping another gate) starting a new transition while one is already mid-flight. */
    private transitionInProgress = false;
    private transition!: RadialTransition;
    private scenesByKey: Record<string, AsyncReadyScene> = {};
    /** The one top-left money counter every scene shares — see MoneyHud.ts's own doc for why this lives here (outliving every scene rebuild) instead of inside any one of them. */
    private moneyHud!: MoneyHud;

    public constructor() {
        super({ resolution: Math.min(2, devicePixelRatio), backgroundAlpha: 0 }, false);
        this.loaderScene = new HtmlLoader(loaderConfig);
        PIXI.Ticker.shared.maxFPS = 60;

        this.folderPath = 'bandit-controller';
        this.initialize();
    }

    protected async initialize(): Promise<void> {
        const platformName = import.meta.env.VITE_PLATFORM || 'local';
        const config = (platformConfig as Record<string, PlatformConfigEntry>)[platformName];

        this.folderPath = config?.folder || this.folderPath;

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

            PlatformHandler.instance.platform.loadFinished();
            this.loaderScene.hide();
            this.startGame();
        } catch (error) {
            console.error('Failed to initialize platform:', error);
        }
    }

    /** Registers every packed font (games/bandit-controller/raw-assets/fonts) so PIXI.Text can use it by family name. */
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
        DebugOverlay.instance.initialize(Boolean(Game.debugParams.dev || Game.debugParams.debug), 'bandit-controller');

        // Physics debug wireframes (player + obstacle colliders/triggers) — three sources,
        // most to least specific: ?colliders=1 in the URL, then whatever was last saved via
        // the ?dev=1 panel's own checkboxes below (DebugPhysicsCookie.ts), then off. Must run
        // before any scene builds its entities (see setPhysicsDebugFlags's own doc —
        // RigidBody.awake() only reads these once, at construction time). The cookie itself
        // is dev-only — applyDebugPhysicsCookie() is never called outside ?dev=1, so a
        // production build never even reads it.
        const isDev = !!Game.debugParams.dev;
        const savedPhysicsDebug = isDev ? applyDebugPhysicsCookie() : {};
        const urlColliders = Game.debugParams.colliders !== undefined ? !!Game.debugParams.colliders : undefined;
        const showColliders = urlColliders ?? !!savedPhysicsDebug.collider;
        const showTriggers = urlColliders ?? !!savedPhysicsDebug.trigger;
        setPhysicsDebugFlags({ collider: showColliders, trigger: showTriggers });

        const physicsDebugPanel = DebugOverlay.instance.panel('Physics Debug', { id: 'bandit-controller.physics' });
        const physicsDebugSettings = { showColliders, showTriggers };
        physicsDebugPanel.toggle(physicsDebugSettings, 'showColliders').onChange((value) => {
            setPhysicsDebugFlags({ collider: value });
            saveDebugPhysicsCookie({ collider: value });
        });
        physicsDebugPanel.toggle(physicsDebugSettings, 'showTriggers').onChange((value) => {
            setPhysicsDebugFlags({ trigger: value });
            saveDebugPhysicsCookie({ trigger: value });
        });

        // The one shared top-left money counter — see MoneyHud.ts's own doc. Constructed here
        // (once, ever) and added straight to uiLayer rather than any scene's own display
        // list, so it's never destroyed/rebuilt on a scene change; GameState.getMoney() seeds
        // its starting digits so a hub<->minigame round trip never visibly resets the count.
        this.moneyHud = new MoneyHud(GameState.getMoney());
        this.uiLayer.addChild(this.moneyHud);

        // Every multi-scene game in this repo follows the same shape: a scene exposes a plain
        // `Signal` for whatever navigation event it needs (never touches SceneManager itself),
        // and index.ts's startGame() is the only thing that actually calls changeScene() — see
        // HubScene.ts's own doc.
        const hub = this.sceneManager.register<HubScene>('hub', HubScene, this, this.moneyHud);
        hub.onEnterMinigame.add((sceneKey: string) => this.requestSceneChange(sceneKey));

        const runnerMinigame = this.sceneManager.register<RunnerMinigameScene>('runner-minigame', RunnerMinigameScene, this, this.moneyHud);
        runnerMinigame.onComplete.add(() => this.requestSceneChange('hub'));
        // RestartButton (see RunnerMinigameScene.onHitObstacle()) — same key, forced, so
        // SceneManager.changeScene() rebuilds this scene from scratch instead of no-opping
        // on "already the current scene."
        runnerMinigame.onRestart.add(() => this.requestSceneChange('runner-minigame', true));

        const swipeMinigame = this.sceneManager.register<SwipeMinigameScene>('swipe-minigame', SwipeMinigameScene, this, this.moneyHud);
        swipeMinigame.onComplete.add(() => this.requestSceneChange('hub'));
        swipeMinigame.onRestart.add(() => this.requestSceneChange('swipe-minigame', true));

        const pathLevel = this.sceneManager.register<PathLevelScene>('path-level', PathLevelScene, this, this.moneyHud);
        pathLevel.onRestart.add(() => this.requestSceneChange('path-level', true));

        pathLevel.onHome.add(() => this.requestSceneChange('home', true));
        const home = this.sceneManager.register<HomeScene>('home', HomeScene, this, this.moneyHud);
        home.onPlayLevel.add(() => this.requestSceneChange('path-level', true));

        this.scenesByKey = { 'home': home, 'hub': hub, 'runner-minigame': runnerMinigame, 'swipe-minigame': swipeMinigame, 'path-level': pathLevel };
        this.transition = new RadialTransition(this);

        const runnerPanel = DebugOverlay.instance.panel('Runner', { id: 'bandit-controller.runner' });
        runnerPanel.slider(RunnerBendService.uniforms.uBendYAmplitude, 'value', 0, 15, 0.1, 'Bend Y Amplitude');
        runnerPanel.slider(RunnerBendService.uniforms.uBendXAmplitude, 'value', 0, 15, 0.1, 'Bend X Amplitude');
        runnerPanel.slider(RunnerBendService.uniforms.uBendYFrequency, 'value', 0, 0.3, 0.001, 'Bend Y Frequency');
        runnerPanel.slider(RunnerBendService.uniforms.uBendXFrequency, 'value', 0, 0.3, 0.001, 'Bend X Frequency');
        runnerPanel.slider(RunnerBendService.uniforms.uBendYDescendFraction, 'value', 0.01, 1, 0.01, 'Bend Descend Fraction');
        runnerPanel.slider(RunnerBendService.uniforms.uBendStartDistance, 'value', 0, 100, 1, 'Bend Start Distance');
        runnerPanel.slider(RUNNER_MINIGAME_SETTINGS, 'forwardSpeed', 1, 25, 0.1, 'Runner Speed');
        runnerPanel.slider(SWIPE_MINIGAME_SETTINGS, 'forwardSpeed', 1, 25, 0.1, 'Swipe Speed');

        const gameplayPanel = DebugOverlay.instance.panel('Gameplay', { id: 'bandit-controller.gameplay' });
        gameplayPanel.toggle(PLAYER_SETTINGS, 'clickToMoveEnabled').name('Walk to Click Release');

        const worldPanel = DebugOverlay.instance.panel('Player & World', { id: 'bandit-controller.world' });
        worldPanel.slider(PLAYER_SETTINGS, 'walkSpeed', 1, 15, 0.1, 'Walk Speed');
        worldPanel.slider(PLAYER_SETTINGS, 'runSpeedMultiplier', 1, 4, 0.1, 'Run Multiplier');
        worldPanel.slider(PLAYER_SETTINGS, 'jumpSpeed', 2, 25, 0.1, 'Jump Speed');
        worldPanel.slider(PLAYER_SETTINGS, 'rollDuration', 0.1, 2, 0.01, 'Roll Duration');
        worldPanel.slider(PLAYER_SETTINGS, 'slideDuration', 0.1, 2, 0.01, 'Slide Duration');
        worldPanel.slider(PLAYER_SETTINGS, 'standHalfHeight', 0.3, 1.5, 0.01, 'Stand Half Height');
        worldPanel.slider(PLAYER_SETTINGS, 'slideHalfHeight', 0.1, 1, 0.01, 'Slide Half Height');
        worldPanel.slider(PLAYER_SETTINGS, 'hitKickbackSpeed', 0, 20, 0.1, 'Hit Kickback Speed');
        worldPanel.slider(PLAYER_SETTINGS, 'hitKickbackDuration', 0.05, 1.5, 0.01, 'Hit Kickback Duration');
        worldPanel.slider(WORLD_SETTINGS, 'gravity', -60, -2, 0.1, 'Gravity');
        worldPanel.slider(WORLD_SETTINGS, 'maxPhysicsDelta', 0.01, 0.1, 0.001, 'Max Physics Delta');

        // The very first scene load already has its own cover (HtmlLoader, hidden just above)
        // — the radial transition is only for LATER hub<->minigame changes, so this goes
        // straight through sceneManager rather than requestSceneChange()/playSceneTransition().
        // ?minigame=runner/swipe/path or ?scene=hub keeps every existing mode directly reachable.
        const initialSceneKey = MINIGAME_QUERY_SHORTHAND[Game.debugParams.minigame]
            ?? Game.debugParams.scene
            ?? (new URLSearchParams(window.location.search).has('level') ? 'path-level' : 'home');
        this.sceneManager.changeScene(initialSceneKey);
        this.sceneManager.resize();
    }

    /**
     * Records a scene-change request — see pendingSceneChange's own doc on why this can't
     * just call sceneManager.changeScene() directly. `force` rebuilds even a
     * currently-active scene (see SceneManager.changeScene()'s own doc) — used by
     * RestartButton to replay the SAME minigame from scratch rather than round-tripping
     * through the hub.
     */
    private requestSceneChange(sceneKey: string, force: boolean = false): void {
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

    /** Cover -> swap (invisible behind the fully-covered screen) -> wait for the new scene's own async load (its character's FBX + animation clips) -> reveal. See RadialTransition.ts's own doc for why the cover/reveal are shaped as they are. */
    private async playSceneTransition(sceneKey: string, force: boolean = false): Promise<void> {
        this.transitionInProgress = true;
        try {
            await this.transition.cover();
            this.sceneManager.changeScene(sceneKey, force);
            await this.scenesByKey[sceneKey]?.ready;
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
    }
}

// bootstrap
new MyGame();
