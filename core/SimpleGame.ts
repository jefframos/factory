import '@core/style.css';
import * as PIXI from 'pixi.js';

const DESIGN_WIDTH = 720;
const DESIGN_HEIGHT = 1280;

export class SimpleGame {
    public app: PIXI.Application;
    public stageContainer: PIXI.Container;
    public overlayContainer: PIXI.Container;

    private lastTime: number = performance.now();

    // Screen data
    public gameScreenData: {
        center: PIXI.Point,
        topLeft: PIXI.Point,
        topRight: PIXI.Point,
        bottomLeft: PIXI.Point,
        bottomRight: PIXI.Point
    };

    public overlayScreenData: {
        center: PIXI.Point,
        topLeft: PIXI.Point,
        topRight: PIXI.Point,
        bottomLeft: PIXI.Point,
        bottomRight: PIXI.Point
    };

    constructor(options?: Partial<PIXI.IApplicationOptions>) {
        this.app = new PIXI.Application({
            backgroundColor: 0x1099bb,
            resizeTo: window,
            ...options,
        });

        document.body.appendChild(this.app.view);

        this.stageContainer = new PIXI.Container();
        this.overlayContainer = new PIXI.Container();

        this.app.stage.addChild(this.stageContainer);
        this.app.stage.addChild(this.overlayContainer);

        this.app.ticker.add(this.loop, this);

        window.addEventListener('resize', this.onResize.bind(this));
        this.onResize();
    }

    private loop() {
        const now = performance.now();
        const deltaMS = now - this.lastTime;
        this.lastTime = now;

        const deltaSeconds = deltaMS / 1000;
        this.update(deltaSeconds);
    }

    protected update(delta: number) {
        // override this
    }

    protected onResize() {
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        // Calculate scale factor
        const scaleX = screenWidth / DESIGN_WIDTH;
        const scaleY = screenHeight / DESIGN_HEIGHT;
        const scale = Math.min(scaleX, scaleY); // contain fit

        // Scale containers
        this.stageContainer.scale.set(scale);
        this.overlayContainer.scale.set(scale);

        // Center the stage
        this.stageContainer.x = (screenWidth - DESIGN_WIDTH * scale) / 2;
        this.stageContainer.y = (screenHeight - DESIGN_HEIGHT * scale) / 2;

        // Overlay container follows stageContainer's position
        this.overlayContainer.x = this.stageContainer.x;
        this.overlayContainer.y = this.stageContainer.y;

        // Resize renderer
        this.app.renderer.resize(screenWidth, screenHeight);

        // Set game screen data (based on logical DESIGN_WIDTH/HEIGHT)
        this.gameScreenData = {
            center: new PIXI.Point(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2),
            topLeft: new PIXI.Point(0, 0),
            topRight: new PIXI.Point(DESIGN_WIDTH, 0),
            bottomLeft: new PIXI.Point(0, DESIGN_HEIGHT),
            bottomRight: new PIXI.Point(DESIGN_WIDTH, DESIGN_HEIGHT),
        };

        // Set overlay screen data (based on real screen and reverse scale)
        const screenScaledWidth = screenWidth / scale;
        const screenScaledHeight = screenHeight / scale;

        this.overlayScreenData = {
            center: new PIXI.Point(screenScaledWidth / 2, screenScaledHeight / 2),
            topLeft: new PIXI.Point(0, 0),
            topRight: new PIXI.Point(screenScaledWidth, 0),
            bottomLeft: new PIXI.Point(0, screenScaledHeight),
            bottomRight: new PIXI.Point(screenScaledWidth, screenScaledHeight),
        };
    }
}
