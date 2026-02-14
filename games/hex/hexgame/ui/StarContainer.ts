import ViewUtils from "@core/utils/ViewUtils";
import * as PIXI from "pixi.js";

export class StarContainer extends PIXI.Container {
    private stars: PIXI.Sprite[] = [];

    constructor() {
        super();
        for (let i = 0; i < 3; i++) {
            const star = new PIXI.Sprite();
            star.anchor.set(0.5);
            star.x = (i - 1) * 28; // Increased spacing slightly for the arc look

            // ARC LOGIC: If it's the middle star (index 1), move it lower
            if (i === 1) {
                //star.y = 8;
            } else {
                star.y = 0;
            }

            this.addChild(star);
            this.stars.push(star);
        }
    }

    public setStars(count: number) {
        if (count <= 0) {
            this.visible = false;
            return
        }
        this.visible = true;
        // Star config mapping: [Texture, Tint]
        const config = [
            { tex: 'ItemIcon_Star_Red', tint: 0xffffff },  // 0 stars
            { tex: 'ItemIcon_Star_Bronze', tint: 0xffffff },       // 1 star (Bronze)
            { tex: 'ItemIcon_Star_Silver', tint: 0xffffff },       // 2 stars (Silver)
            { tex: 'ItemIcon_Star_Gold', tint: 0xffffff }        // 3 stars (Gold)
        ];

        this.stars.forEach((star, i) => {
            if (count === 0) {
                star.texture = PIXI.Texture.from(config[0].tex);
                star.tint = config[0].tint;
            } else {
                // If level is 1 star: index 0 gets bronze, index 1 & 2 get blank
                const isEarned = i < count;
                star.texture = PIXI.Texture.from(isEarned ? config[count].tex : config[0].tex);
                star.tint = isEarned ? config[count].tint : config[0].tint;
                star.scale.set(ViewUtils.elementScaler(star, 30))

            }
        });
    }
}