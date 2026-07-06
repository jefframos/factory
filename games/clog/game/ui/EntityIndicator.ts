import * as PIXI from 'pixi.js';

const BAR_WIDTH = 46;
const BAR_HEIGHT = 7;
const BAR_Y_OFFSET = -14; // lift above the anchor point (already just above the entity's head) so it clears the direction triangle
const NAME_Y_OFFSET = -22; // stacked above the boost bar, whether or not the bar itself is currently shown

/** Small floating HUD that tracks one entity (player or NPC) in screen space: its name always shown above the head, plus a bar that fills while its tap-start speed boost is active. */
export class EntityIndicator extends PIXI.Container {
    private bg = new PIXI.Graphics();
    private fill = new PIXI.Graphics();
    private label = new PIXI.Text('', {
        fontFamily: 'sans-serif', fontSize: 12, fontWeight: 'bold', fill: 0xffffff,
        stroke: 0x000000, strokeThickness: 3,
    });

    constructor() {
        super();
        this.bg.beginFill(0x000000, 0.5);
        this.bg.lineStyle(1, 0xffffff, 0.4);
        this.bg.drawRoundedRect(-BAR_WIDTH / 2, -BAR_HEIGHT / 2, BAR_WIDTH, BAR_HEIGHT, 3);
        this.bg.endFill();
        this.bg.position.set(0, BAR_Y_OFFSET);
        this.fill.position.set(0, BAR_Y_OFFSET);

        this.label.anchor.set(0.5, 1);
        this.label.position.set(0, NAME_Y_OFFSET);

        this.addChild(this.bg, this.fill, this.label);
        this.visible = false;
    }

    /**
     * @param name Display name shown above the head — always visible whenever `anchor` is non-null, regardless of boost state.
     * @param boostT 0..1 fraction of boost remaining — 0 hides just the bar, not the name.
     * @param anchor Screen-space point (already converted into this container's parent space) to anchor above. Null hides the whole HUD (entity gone/off-screen/behind camera).
     */
    update(name: string, boostT: number, anchor: { x: number; y: number } | null): void {
        if (!anchor) {
            this.visible = false;
            return;
        }
        this.visible = true;
        this.position.set(anchor.x, anchor.y);

        if (this.label.text !== name) this.label.text = name;

        const showBar = boostT > 0;
        this.bg.visible = showBar;
        this.fill.visible = showBar;
        if (showBar) {
            this.fill.clear();
            this.fill.beginFill(0xffdd44, 0.95);
            this.fill.drawRoundedRect(-BAR_WIDTH / 2, -BAR_HEIGHT / 2, BAR_WIDTH * boostT, BAR_HEIGHT, 3);
            this.fill.endFill();
        }
    }
}
