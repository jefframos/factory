import gsap from "gsap";
import * as PIXI from "pixi.js";

export class PuzzlePreview extends PIXI.Container {
    private blackout: PIXI.Graphics;
    private frame: PIXI.NineSlicePlane;
    private previewSprite: PIXI.Sprite;
    private contentContainer: PIXI.Container;

    constructor(sourceSprite: PIXI.Sprite) {
        super();

        // 1. Massive Blackout Background to block all input
        this.blackout = new PIXI.Graphics()
            .beginFill(0x000000, 0.8)
            .drawRect(-5000, -5000, 10000, 10000)
            .endFill();
        this.interactive = true;
        this.cursor = 'pointer';
        this.on("pointertap", () => this.hide());
        this.addChild(this.blackout);

        // 2. Content Container (Anchored at 0,0 which will be screen center)
        this.contentContainer = new PIXI.Container();
        this.addChild(this.contentContainer);

        // 3. Nine-Slice Frame (Using 'popup_frame' asset)
        const frameTex = PIXI.Texture.from("ItemFrame01_Single_Navy");
        this.frame = new PIXI.NineSlicePlane(frameTex, 20, 20, 20, 20);
        this.contentContainer.addChild(this.frame);

        // 4. The Sprite (Cloned from source to maintain its size/scale)
        this.previewSprite = new PIXI.Sprite(sourceSprite.texture);
        // Use the actual dimensions of the source sprite
        this.previewSprite.width = sourceSprite.width;
        this.previewSprite.height = sourceSprite.height;
        this.previewSprite.anchor.set(0.5);
        this.contentContainer.addChild(this.previewSprite);

        // Setup Frame size based on sprite size + padding
        const padding = 60;
        this.frame.width = this.previewSprite.width + padding;
        this.frame.height = this.previewSprite.height + padding;
        this.frame.pivot.set(this.frame.width / 2, this.frame.height / 2);

        this.visible = false;
    }

    public show() {
        this.visible = true;
        this.alpha = 1;
        this.contentContainer.alpha = 1;
        this.contentContainer.y = 0;

        gsap.from(this.contentContainer, {
            y: 150,
            alpha: 0,
            duration: 0.25
        })
    }

    public hide() {

        gsap.to(this, {
            alpha: 0,
            duration: 0.25,
            onComplete: () => {
                this.visible = false;
                this.contentContainer.y = 0;
            }
        })
    }
}