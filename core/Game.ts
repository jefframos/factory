import '@core/style.css';
import * as PIXI from 'pixi.js';
import Stats from 'stats.js';

export class Game {
    static DESIGN_WIDTH = 720;
    static DESIGN_HEIGHT = 1080;
    public app: PIXI.Application;
    public stageContainer: PIXI.Container;
    public overlayContainer: PIXI.Container;

    private lastTime: number = performance.now();
    private stats?: Stats;
    // Screen data
    static gameScreenData: {
        center: PIXI.Point,
        topLeft: PIXI.Point,
        topRight: PIXI.Point,
        bottomLeft: PIXI.Point,
        bottomRight: PIXI.Point
    };

    static overlayScreenData: {
        center: PIXI.Point,
        topLeft: PIXI.Point,
        topRight: PIXI.Point,
        bottomLeft: PIXI.Point,
        bottomRight: PIXI.Point
    };
    static deltaTime: number;

    constructor(options?: Partial<PIXI.IApplicationOptions>, showStats?: boolean) {
        this.app = new PIXI.Application({
            backgroundColor: 0x1099bb,
            resizeTo: window,
            ...options,
        });

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

    protected onResize() {
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        // Calculate scale factor
        const scaleX = screenWidth / Game.DESIGN_WIDTH;
        const scaleY = screenHeight / Game.DESIGN_HEIGHT;
        const scale = Math.min(scaleX, scaleY); // contain fit

        // Scale containers
        this.stageContainer.scale.set(scale);
        this.overlayContainer.scale.set(scale);

        // Center the stage
        this.stageContainer.x = (screenWidth - Game.DESIGN_WIDTH * scale) / 2;
        this.stageContainer.y = (screenHeight - Game.DESIGN_HEIGHT * scale) / 2;

        // Overlay container follows stageContainer's position
        this.overlayContainer.x = this.stageContainer.x;
        this.overlayContainer.y = this.stageContainer.y;

        // Resize renderer
        this.app.renderer.resize(screenWidth, screenHeight);

        // Set game screen data (based on logical Game.DESIGN_WIDTH/HEIGHT)
        Game.gameScreenData = {
            center: new PIXI.Point(Game.DESIGN_WIDTH / 2, Game.DESIGN_HEIGHT / 2),
            topLeft: new PIXI.Point(0, 0),
            topRight: new PIXI.Point(Game.DESIGN_WIDTH, 0),
            bottomLeft: new PIXI.Point(0, Game.DESIGN_HEIGHT),
            bottomRight: new PIXI.Point(Game.DESIGN_WIDTH, Game.DESIGN_HEIGHT),
        };

        // Set overlay screen data (based on real screen and reverse scale)
        const screenScaledWidth = screenWidth / scale;
        const screenScaledHeight = screenHeight / scale;

        Game.overlayScreenData = {
            center: new PIXI.Point(screenScaledWidth / 2, screenScaledHeight / 2),
            topLeft: new PIXI.Point(0, 0),
            topRight: new PIXI.Point(screenScaledWidth, 0),
            bottomLeft: new PIXI.Point(0, screenScaledHeight),
            bottomRight: new PIXI.Point(screenScaledWidth, screenScaledHeight),
        };
    }
}
