import '@core/style.css';
import * as PIXI from 'pixi.js';
import Stats from 'stats.js';

export class Game {
    static DESIGN_WIDTH = 720;
    static DESIGN_HEIGHT = 1080;
    public app: PIXI.Application;
    public stageContainer: PIXI.Container;
    public overlayContainer: PIXI.Container;
    public folderPath: string = '';
    static debugParams: Record<string, any> = {};
    private lastTime: number = performance.now();
    private stats?: Stats;
    // Screen data
    static renderer: PIXI.Renderer;

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
    constructor(options?: Partial<PIXI.IApplicationOptions>, showStats?: boolean) {
        Game.extractDebugParams();
        this.app = new PIXI.Application({
            backgroundColor: 0x1099bb,
            resizeTo: window,
            ...options,
        });
        Game.renderer = this.app.renderer
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

        this.app.ticker.add(this.loop, this);

        window.addEventListener('resize', this.onResize.bind(this));
        window.addEventListener('orientationchange', () => this.handleResizeDebounced());
        this.onResize();
    }

    private loop() {
        this.stats?.begin();
        const now = performance.now();
        const deltaMS = now - this.lastTime;
        this.lastTime = now;

        const deltaSeconds = deltaMS / 1000;
        Game.deltaTime = deltaSeconds;
        this.update(deltaSeconds);
        this.stats?.end();
    }

    protected update(delta: number) {
        // override this
    }
    private handleResizeDebounced() {
        // A small delay (100-200ms) ensures the browser has finished 
        // updating layout dimensions after rotation.
        this.onResize();
        setTimeout(() => {
            this.onResize();
        }, 50);
        setTimeout(() => {
            this.onResize();
        }, 200);
        setTimeout(() => {
            this.onResize();
        }, 500);
    }
    protected onResize() {
        const screenWidth = window.innerWidth / Game.renderer.resolution;
        const screenHeight = window.innerHeight / Game.renderer.resolution;

        // Calculate scale factor to contain the design resolution
        const scaleX = screenWidth / Game.DESIGN_WIDTH;
        const scaleY = screenHeight / Game.DESIGN_HEIGHT;
        const scale = Math.min(scaleX, scaleY);

        // Scale containers
        this.stageContainer.scale.set(scale);
        this.overlayContainer.scale.set(scale);

        Game.scale = scale;

        // Center the containers
        const offsetX = (screenWidth - Game.DESIGN_WIDTH * scale) / 2;
        const offsetY = (screenHeight - Game.DESIGN_HEIGHT * scale) / 2;
        this.stageContainer.x = offsetX;
        this.stageContainer.y = offsetY;
        this.overlayContainer.x = offsetX;
        this.overlayContainer.y = offsetY;

        // Resize the renderer
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

        // Convert screen corners into overlayContainer space
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
