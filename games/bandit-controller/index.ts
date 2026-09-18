import { Game } from 'core/Game';
import HtmlLoader from 'core/loader/HtmlLoader';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { getPlatformInstance } from 'core/platforms/PlatformFactory';
import { SceneManager } from 'core/scene/SceneManager';
import { DevGuiManager } from 'core/utils/DevGuiManager';
import * as PIXI from 'pixi.js';

import loaderConfig from './loader.config';
import platformConfig from './platforms.config.json';
import HubScene from './game/scenes/HubScene';
import RunnerMinigameScene from './game/scenes/RunnerMinigameScene';
import SwipeMinigameScene from './game/scenes/SwipeMinigameScene';
import RadialTransition from './game/ui/RadialTransition';
import { RunnerBendService } from './game/services/RunnerBendService';
import { RUNNER_MINIGAME_SETTINGS, SWIPE_MINIGAME_SETTINGS } from './game/data/MinigameSettings';

/** What every scene exposes for the transition below to wait on — see HubScene.ready's own doc. */
interface AsyncReadyScene {
    readonly ready: Promise<void>;
}

/** ?minigame=runner / ?minigame=swipe (see Game.extractDebugParams()) — shorthand for the two registered scene keys below, so a tester can jump straight into a minigame without walking through the hub. Any other/missing value falls back to the hub. */
const MINIGAME_QUERY_SHORTHAND: Record<string, string> = {
    runner: 'runner-minigame',
    swipe: 'swipe-minigame',
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
    private pendingSceneChange: string | null = null;
    /** Guards against a SECOND scene-change request (e.g. the outgoing scene's own physics still ticking during the radial cover, briefly overlapping another gate) starting a new transition while one is already mid-flight. */
    private transitionInProgress = false;
    private transition!: RadialTransition;
    private scenesByKey: Record<string, AsyncReadyScene> = {};

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

            PlatformHandler.instance.platform.loadFinished();
            this.loaderScene.hide();
            this.startGame();
        } catch (error) {
            console.error('Failed to initialize platform:', error);
        }
    }

    private startGame(): void {
        // Dev-only tuning panel (dat.GUI) — visible with ?dev in the URL (see Game.extractDebugParams()).
        // Must run before the scene builds so HubScene's camera sliders have a GUI to attach to.
        DevGuiManager.instance.initialize(Game.debugParams.dev);

        // Every multi-scene game in this repo follows the same shape: a scene exposes a plain
        // `Signal` for whatever navigation event it needs (never touches SceneManager itself),
        // and index.ts's startGame() is the only thing that actually calls changeScene() — see
        // HubScene.ts's own doc.
        const hub = this.sceneManager.register<HubScene>('hub', HubScene, this);
        hub.onEnterMinigame.add((sceneKey: string) => this.requestSceneChange(sceneKey));

        const runnerMinigame = this.sceneManager.register<RunnerMinigameScene>('runner-minigame', RunnerMinigameScene, this);
        runnerMinigame.onComplete.add(() => this.requestSceneChange('hub'));

        const swipeMinigame = this.sceneManager.register<SwipeMinigameScene>('swipe-minigame', SwipeMinigameScene, this);
        swipeMinigame.onComplete.add(() => this.requestSceneChange('hub'));

        this.scenesByKey = { 'hub': hub, 'runner-minigame': runnerMinigame, 'swipe-minigame': swipeMinigame };
        this.transition = new RadialTransition(this);

        // RunnerBendService.uniforms is a static, page-lifetime singleton (never replaced on
        // scene rebuild, unlike HubScene's own per-instance camera settings) — safe to wire
        // exactly once here rather than needing a per-rebuild guard. uBendGrowth isn't wired
        // here — DevGuiManager.addProperties() hardcodes a 0.01 slider step, far too coarse
        // for that uniform's useful 0-0.001 range — it stays a plain hand-edited constant in
        // RunnerBendService.ts (see its own doc), same "editable by hand or dev-GUI" fallback
        // every *Settings.ts data file in this project already follows.
        DevGuiManager.instance.addProperties(RunnerBendService.uniforms.uBendYAmplitude, ['value'], [0, 15], 'Runner Bend: up/down intensity', 'Runner Bend');
        DevGuiManager.instance.addProperties(RunnerBendService.uniforms.uBendXAmplitude, ['value'], [0, 15], 'Runner Bend: left/right intensity', 'Runner Bend');
        DevGuiManager.instance.addProperties(RunnerBendService.uniforms.uBendYFrequency, ['value'], [0, 0.3], 'Runner Bend: up/down frequency', 'Runner Bend');
        DevGuiManager.instance.addProperties(RunnerBendService.uniforms.uBendXFrequency, ['value'], [0, 0.3], 'Runner Bend: left/right frequency', 'Runner Bend');
        DevGuiManager.instance.addProperties(RunnerBendService.uniforms.uBendYDescendFraction, ['value'], [0.01, 1], 'Runner Bend: descend portion of each step', 'Runner Bend');
        DevGuiManager.instance.addProperties(RunnerBendService.uniforms.uBendStartDistance, ['value'], [0, 100], 'Runner Bend: distance before bend starts', 'Runner Bend');

        // Each minigame's own constant forward pace (MinigameSettings.ts) — deliberately
        // separate sliders from the hub's PlayerSettings, same "editable by hand or dev-GUI"
        // convention as the bend uniforms just above.
        DevGuiManager.instance.addProperties(RUNNER_MINIGAME_SETTINGS, ['forwardSpeed'], [1, 25], 'Runner minigame: forward speed', 'Minigame Speed');
        DevGuiManager.instance.addProperties(SWIPE_MINIGAME_SETTINGS, ['forwardSpeed'], [1, 25], 'Swipe minigame: forward speed', 'Minigame Speed');

        // The very first scene load already has its own cover (HtmlLoader, hidden just above)
        // — the radial transition is only for LATER hub<->minigame changes, so this goes
        // straight through sceneManager rather than requestSceneChange()/playSceneTransition().
        // ?minigame=runner/swipe (see MINIGAME_QUERY_SHORTHAND's own doc) skips the hub
        // entirely and drops straight into that minigame instead, for quick testing.
        const initialSceneKey = MINIGAME_QUERY_SHORTHAND[Game.debugParams.minigame] ?? 'hub';
        this.sceneManager.changeScene(initialSceneKey);
        this.sceneManager.resize();
    }

    /** Records a scene-change request — see pendingSceneChange's own doc on why this can't just call sceneManager.changeScene() directly. */
    private requestSceneChange(sceneKey: string): void {
        this.pendingSceneChange = sceneKey;
    }

    private applyPendingSceneChange(): void {
        if (!this.pendingSceneChange || this.transitionInProgress) {
            return;
        }
        const sceneKey = this.pendingSceneChange;
        this.pendingSceneChange = null;
        void this.playSceneTransition(sceneKey);
    }

    /** Cover -> swap (invisible behind the fully-covered screen) -> wait for the new scene's own async load (its character's FBX + animation clips) -> reveal. See RadialTransition.ts's own doc for why the cover/reveal are shaped as they are. */
    private async playSceneTransition(sceneKey: string): Promise<void> {
        this.transitionInProgress = true;
        try {
            await this.transition.cover();
            this.sceneManager.changeScene(sceneKey);
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
    }
}

// bootstrap
new MyGame();
