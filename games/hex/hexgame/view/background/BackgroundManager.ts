import { Game } from "@core/Game";
import ViewUtils from "@core/utils/ViewUtils";
import * as PIXI from "pixi.js";
import { CloudBelt } from "./CloudBelt";

export class BackgroundManager extends PIXI.Container {
    private bgLayer: PIXI.Container;
    private fgLayer: PIXI.Container;
    private bgImage: PIXI.Sprite;

    private leftCloudBelt!: CloudBelt;
    private rightCloudBelt!: CloudBelt;

    constructor() {
        super();

        this.bgLayer = new PIXI.Container();
        this.addChild(this.bgLayer);

        this.bgImage = PIXI.Sprite.from('puzzle-bg-1');
        this.bgImage.anchor.set(0.5);
        this.bgLayer.addChild(this.bgImage);

        this.fgLayer = new PIXI.Container();
        this.addChild(this.fgLayer);

        this.setupForeground();
    }

    private setupForeground(): void {
        const cloudTextures = [PIXI.Texture.from('cloud-1'), PIXI.Texture.from('cloud-2')];
        const gradientTexture = PIXI.Texture.from('cloud-overlay'); // Fade from Alpha 0 to Alpha 1

        const cloudSettings = {
            count: 30,
            textures: cloudTextures,
            scaleRange: { min: 1, max: 1.1 },
            speedRange: { min: 0.4, max: 1.2 },
            xNoise: 100,
            circularRadius: 20,
            circularSpeed: 0.02,
            overlapPercent: 0.4,
            yRange: { start: -Game.DESIGN_HEIGHT / 2, end: Game.DESIGN_HEIGHT / 2 }
        };

        // 1. Cloud Belts
        this.leftCloudBelt = new CloudBelt({ ...cloudSettings, side: 'left' });
        this.leftCloudBelt.x = -Game.DESIGN_WIDTH / 2;

        this.rightCloudBelt = new CloudBelt({ ...cloudSettings, side: 'right' });
        this.rightCloudBelt.x = Game.DESIGN_WIDTH / 2;

        // 2. Gradient Overlays (500px wide)
        // Left Gradient: Flipped to face inward
        const leftGradient = new PIXI.Sprite(gradientTexture);
        leftGradient.width = 600;
        leftGradient.height = Game.DESIGN_HEIGHT * 2;
        leftGradient.anchor.set(0.5, 0.5); // Anchor to the right edge of the sprite
        leftGradient.x = -Game.DESIGN_WIDTH / 2 - leftGradient.width / 2;

        // Right Gradient
        const rightGradient = new PIXI.Sprite(gradientTexture);
        rightGradient.width = leftGradient.width;
        rightGradient.height = Game.DESIGN_HEIGHT * 2;
        rightGradient.anchor.set(0.5, 0.5); // Anchor to the left edge of the sprite
        rightGradient.x = Game.DESIGN_WIDTH / 2 + leftGradient.width / 2;
        rightGradient.scale.x *= -1; // Flip so the transparent side faces the center

        // 3. White "Blow-out" Textures (positioned after the 500px gradient)
        const leftWhite = new PIXI.Sprite(PIXI.Texture.WHITE);
        leftWhite.width = 3000;
        leftWhite.height = Game.DESIGN_HEIGHT * 2;
        leftWhite.anchor.set(1, 0.5);
        leftWhite.x = -Game.DESIGN_WIDTH / 2 - leftGradient.width / 3; // Offset by gradient width

        const rightWhite = new PIXI.Sprite(PIXI.Texture.WHITE);
        rightWhite.width = 3000;
        rightWhite.height = Game.DESIGN_HEIGHT * 2;
        rightWhite.anchor.set(0, 0.5);
        rightWhite.x = Game.DESIGN_WIDTH / 2 + leftGradient.width / 3; // Offset by gradient width

        // Order matters for stacking: Belts -> Gradients -> White blocks
        this.fgLayer.addChild(
            leftWhite,
            rightWhite,
            this.leftCloudBelt,
            this.rightCloudBelt,
            leftGradient,
            rightGradient,
        );
    }

    public update(delta: number): void {
        this.position.set(Game.DESIGN_WIDTH / 2, Game.DESIGN_HEIGHT / 2);
        this.bgImage.scale.set(ViewUtils.elementEvelop(this.bgImage, Game.gameScreenData.width, Game.gameScreenData.height));

        this.leftCloudBelt.update(delta);
        this.rightCloudBelt.update(delta);
    }
}