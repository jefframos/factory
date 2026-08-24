import 'core/style.css';
import * as PIXI from 'pixi.js';
import Stats from 'stats.js';
import PlatformHandler from 'core/platforms/PlatformHandler';

export class Game {
    static DESIGN_WIDTH = 720;
    static DESIGN_HEIGHT = 1080;

    // --- Physics Timing Config ---
    private static _fixedFps = 60;
    private static _fixedDeltaTime = 1000 / 60;
    private accumulator: number = 0;

    /** * Adjust the Fixed Update frequency (e.g., 30, 60, 120)
     */
    public static setFPS(value: number) {
        this._fixedFps = value;
        this._fixedDeltaTime = 1000 / value;
    }

    public app: PIXI.Application;
    public stageContainer: PIXI.Container;
    /** The 2D UI root — everything a game's UI ever adds itself to ultimately lives under this (see onResize(), which is what actually scales/positions it to match the design resolution). Prefer uiLayer/notificationLayer/popupLayer below over adding directly here — those three are its own children, ordered so popups always draw over notifications, which always draw over the base UI, regardless of which order each one happens to get built/shown in. */
    public overlayContainer: PIXI.Container;
    /** Base in-game UI — HUD panels, world-anchored zone popups/nameplates (ScreenAnchorComponent), flying resource icons. The bottom of the three overlay tiers. */
    public uiLayer: PIXI.Container;
    /** Toast-style notifications (e.g. "Level Up!"/"New Tool!" banners) — always drawn over uiLayer, always drawn under popupLayer. */
    public notificationLayer: PIXI.Container;
    /** Modal-style popups/dialogs — always drawn over everything else. */
    public popupLayer: PIXI.Container;
    public folderPath: string = '';
    static debugParams: Record<string, any> = {};
    private lastTime: number = performance.now();
    private stats?: Stats;

    private lastWindowWidth: number = 0;
    private lastWindowHeight: number = 0;

    /** True while the browser tab itself is hidden (document.visibilitychange) — independent of platformPaused below, since a platform SDK's own pause (e.g. a rewarded-ad break) can happen with the tab still visible, and vice versa. The ticker only runs while BOTH are false — see updateTickerState(). */
    private tabHidden: boolean = false;
    /** True while the current platform SDK says the game is paused (PlatformHandler.instance.onPause/onResume — see IPlatformConnection's onPause?/onResume? hooks). Not every platform wrapper implements those hooks yet; this simply never flips for one that doesn't. */
    private platformPaused: boolean = false;

    // Screen data
    static renderer: PIXI.Renderer;
    static APP: PIXI.Application;

    static gameScreenData: {
        width: number,
        height: number,
        center: PIXI.Point,
        topLeft: PIXI.Point,
        topRight: PIXI.Point,
        bottomLeft: PIXI.Point,
        bottomRight: PIXI.Point
    };

    static overlayScreenData: {
        width: number,
        height: number,
        center: PIXI.Point,
        topLeft: PIXI.Point,
        topRight: PIXI.Point,
        bottomLeft: PIXI.Point,
        bottomRight: PIXI.Point
    };

    static deltaTime: number;
    static scale: number;

    private static extractDebugParams() {
        const urlParams = new URLSearchParams(window.location.search);
        urlParams.forEach((value, key) => {
            if (value) {
                this.debugParams[key] = isNaN(Number(value)) ? value : parseFloat(value);
            }
        });
    }

    public get view(): HTMLCanvasElement {
        return this.app.view as HTMLCanvasElement;
    }

    constructor(options?: Partial<PIXI.IApplicationOptions>, showStats?: boolean) {
        Game.extractDebugParams();
        this.app = new PIXI.Application({
            backgroundColor: 0x1099bb,
            resizeTo: window,
            // Keeps the canvas's CSS box pinned to the viewport size while its
            // backing buffer scales with `resolution` — without this, the
            // buffer would render at `resolution`x the viewport but display at
            // 1x CSS pixels (a giant, cropped canvas) instead of the intended
            // "same on-screen size, sharper on high-DPI" result.
            autoDensity: true,
            ...options,
        });
        Game.renderer = this.app.renderer;
        Game.APP = this.app;

        this.view.style.position = 'absolute';
        this.view.style.top = '0';
        this.view.style.left = '0';

        document.body.appendChild(this.app.view as HTMLCanvasElement);

        this.stageContainer = new PIXI.Container();
        this.overlayContainer = new PIXI.Container();

        // Plain PIXI list order, not zIndex/sortableChildren — added in this exact order so
        // popupLayer always renders in front of notificationLayer, which always renders in
        // front of uiLayer, no matter what order the UI built on top of each one happens to
        // get constructed/shown in later.
        this.uiLayer = new PIXI.Container();
        this.notificationLayer = new PIXI.Container();
        this.popupLayer = new PIXI.Container();
        this.overlayContainer.addChild(this.uiLayer, this.notificationLayer, this.popupLayer);

        this.app.stage.addChild(this.stageContainer);
        this.app.stage.addChild(this.overlayContainer);

        if (showStats) {
            this.stats = new Stats();
            this.stats.showPanel(0); // 0 = FPS
            Object.assign(this.stats.dom.style, {
                position: 'absolute',
                top: '0px',
                right: '0px',
                left: 'unset',
                zIndex: '1000',
            });
            document.body.appendChild(this.stats.dom);
        }

        this.lastWindowWidth = window.innerWidth;
        this.lastWindowHeight = window.innerHeight;

        this.app.ticker.add(this.loop, this);

        window.addEventListener('resize', this.onResize.bind(this));
        window.addEventListener('orientationchange', () => this.handleResizeDebounced());
        this.onResize();

        // Skipped when the active platform opts out (e.g. YouTube Playables,
        // which requires pause/resume to come exclusively from
        // ytgame.system.onPause/onResume — see IPlatformConnection.usesPageVisibilityApi).
        if (PlatformHandler.instance.platform?.usesPageVisibilityApi !== false) {
            document.addEventListener('visibilitychange', () => {
                this.tabHidden = document.hidden;
                this.updateTickerState();
            });
        }

        // PlatformHandler is a global singleton set up once via PlatformHandler.instance.initialize()
        // in each game's own index.ts — subscribing here rather than waiting for that call is safe:
        // Signal.add() just registers the listener, it doesn't require onPause/onResume to have
        // fired (or even exist) yet, so this works whether that initialize() call has already
        // happened, hasn't happened yet, or never happens at all (a platform with no onPause/onResume
        // hooks implemented just never dispatches these signals — see IPlatformConnection).
        PlatformHandler.instance.onPause.add(() => {
            this.platformPaused = true;
            this.updateTickerState();
        });
        PlatformHandler.instance.onResume.add(() => {
            this.platformPaused = false;
            this.updateTickerState();
        });
    }

    /** Ticker only runs while NEITHER pause reason is active — see tabHidden/platformPaused's own docs. Stopping the ticker (rather than just gating loop()'s own body) also stops PIXI's own internal rendering, not just this class's update/fixedUpdate calls. */
    private updateTickerState(): void {
        const shouldRun = !this.tabHidden && !this.platformPaused;
        if (shouldRun && !this.app.ticker.started) {
            this.app.ticker.start();
        } else if (!shouldRun && this.app.ticker.started) {
            this.app.ticker.stop();
        }
    }
    public setCanvasZIndex(value: number) {
        this.view.style.zIndex = value.toString();
    }
    private loop() {
        this.stats?.begin();

        if (window.innerWidth !== this.lastWindowWidth || window.innerHeight !== this.lastWindowHeight) {
            this.lastWindowWidth = window.innerWidth;
            this.lastWindowHeight = window.innerHeight;
            this.onResize();
        }

        const now = performance.now();
        const deltaMS = now - this.lastTime;
        this.lastTime = now;

        const deltaSeconds = deltaMS / 1000;
        Game.deltaTime = deltaSeconds;

        // --- Fixed Update Accumulator Logic ---
        this.accumulator += deltaMS;

        // Run as many fixed updates as needed to "catch up" to real time
        // We pass the fixed step in seconds (e.g., 0.01666 for 60fps)
        while (this.accumulator >= Game._fixedDeltaTime) {
            this.fixedUpdate(Game._fixedDeltaTime / 1000);
            this.accumulator -= Game._fixedDeltaTime;
        }

        // Standard variable update for visuals/animations
        this.update(deltaSeconds);

        this.stats?.end();
    }

    /**
     * Override this for Physics calculations (Matter.js)
     */
    protected fixedUpdate(delta: number) {
        // To be overridden in NetScene
    }

    /**
     * Override this for visual updates and PIXI sync
     */
    protected update(delta: number) {
        // To be overridden in NetScene
    }

    private handleResizeDebounced() {
        this.onResize();
        setTimeout(() => this.onResize(), 50);
        setTimeout(() => this.onResize(), 200);
        setTimeout(() => this.onResize(), 500);
    }

    protected onResize() {
        // CSS pixels already, NOT physical device pixels — renderer.resize()
        // multiplies by resolution internally to size the backing buffer, so
        // dividing by resolution here would cancel that scaling straight back
        // out (see autoDensity below for why the canvas doesn't then balloon
        // to resolution× the viewport).
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        const scaleX = screenWidth / Game.DESIGN_WIDTH;
        const scaleY = screenHeight / Game.DESIGN_HEIGHT;
        const scale = Math.min(scaleX, scaleY);

        this.stageContainer.scale.set(scale);
        this.overlayContainer.scale.set(scale);

        Game.scale = scale;

        const offsetX = (screenWidth - Game.DESIGN_WIDTH * scale) / 2;
        const offsetY = (screenHeight - Game.DESIGN_HEIGHT * scale) / 2;
        this.stageContainer.x = offsetX;
        this.stageContainer.y = offsetY;
        this.overlayContainer.x = offsetX;
        this.overlayContainer.y = offsetY;

        this.app.renderer.resize(screenWidth, screenHeight);

        const gameTopLeft = this.stageContainer.toLocal(new PIXI.Point(0, 0), this.app.stage);
        const gameBottomRight = this.stageContainer.toLocal(new PIXI.Point(screenWidth, screenHeight), this.app.stage);

        Game.gameScreenData = {
            topLeft: gameTopLeft,
            topRight: this.stageContainer.toLocal(new PIXI.Point(screenWidth, 0), this.app.stage),
            bottomLeft: this.stageContainer.toLocal(new PIXI.Point(0, screenHeight), this.app.stage),
            bottomRight: gameBottomRight,
            center: this.stageContainer.toLocal(new PIXI.Point(screenWidth / 2, screenHeight / 2), this.app.stage),
            width: gameBottomRight.x - gameTopLeft.x,
            height: gameBottomRight.y - gameTopLeft.y,
        };

        const overlayTopLeft = this.overlayContainer.toLocal(new PIXI.Point(0, 0), this.app.stage);
        const overlayBottomRight = this.overlayContainer.toLocal(new PIXI.Point(screenWidth, screenHeight), this.app.stage);

        Game.overlayScreenData = {
            topLeft: overlayTopLeft,
            topRight: this.overlayContainer.toLocal(new PIXI.Point(screenWidth, 0), this.app.stage),
            bottomLeft: this.overlayContainer.toLocal(new PIXI.Point(0, screenHeight), this.app.stage),
            bottomRight: overlayBottomRight,
            center: this.overlayContainer.toLocal(new PIXI.Point(screenWidth / 2, screenHeight / 2), this.app.stage),
            width: overlayBottomRight.x - overlayTopLeft.x,
            height: overlayBottomRight.y - overlayTopLeft.y,
        };
    }
}