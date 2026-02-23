import '@core/style.css';
import * as PIXI from 'pixi.js';
import Stats from 'stats.js';

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
    public overlayContainer: PIXI.Container;
    public folderPath: string = '';
    static debugParams: Record<string, any> = {};
    private lastTime: number = performance.now();
    private stats?: Stats;

    private lastWindowWidth: number = 0;
    private lastWindowHeight: number = 0;

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
        const screenWidth = window.innerWidth / Game.renderer.resolution;
        const screenHeight = window.innerHeight / Game.renderer.resolution;

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