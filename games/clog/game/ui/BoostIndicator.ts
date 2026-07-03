import * as PIXI from 'pixi.js';

const WIDTH = 46;
const HEIGHT = 7;
const Y_OFFSET = -14; // lift above the anchor point (already just above the player's head) so it clears the direction triangle

/** Small floating bar that tracks the player in screen space and fills while the tap-start speed boost is active. */
export class BoostIndicator extends PIXI.Container {
    private bg = new PIXI.Graphics();
    private fill = new PIXI.Graphics();

    constructor() {
        super();
        this.bg.beginFill(0x000000, 0.5);
        this.bg.lineStyle(1, 0xffffff, 0.4);
        this.bg.drawRoundedRect(-WIDTH / 2, -HEIGHT / 2, WIDTH, HEIGHT, 3);
        this.bg.endFill();
        this.addChild(this.bg);
        this.addChild(this.fill);
        this.visible = false;
    }

    /**
     * @param t 0..1 fraction of boost remaining — 0 hides the bar entirely.
     * @param anchor Screen-space point (already converted into this container's parent space) to center the bar above. Null also hides the bar (player off-screen/behind camera).
     */
    update(t: number, anchor: { x: number; y: number } | null): void {
        if (!anchor || t <= 0) {
            this.visible = false;
            return;
        }
        this.visible = true;
        this.position.set(anchor.x, anchor.y + Y_OFFSET);

        this.fill.clear();
        this.fill.beginFill(0xffdd44, 0.95);
        this.fill.drawRoundedRect(-WIDTH / 2, -HEIGHT / 2, WIDTH * t, HEIGHT, 3);
        this.fill.endFill();
    }
}
