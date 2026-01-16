import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';

export default class DialogueBubble extends PIXI.Container {
    private background: PIXI.NineSlicePlane;
    private contentContainer: PIXI.Container;

    public padding = 20;
    private readonly contentSpacing = 4;
    private readonly maxWidth: number;
    private tweens: gsap.core.Tween[] = [];
    constructor(maxWidth: number = 500) {
        super();

        this.maxWidth = maxWidth;

        this.background = new PIXI.NineSlicePlane(
            PIXI.Texture.from('ItemFrame01_Single_Hologram1.png'),
            30, 30, 30, 30
        );
        this.background.width = maxWidth;
        this.background.height = 60;

        this.contentContainer = new PIXI.Container();
        this.addChild(this.background, this.contentContainer);
    }

    async showMessage(words: PIXI.Container[], speed: number = 0.05, delay: number = 0.05): Promise<void> {
        this.contentContainer.removeChildren();


        let offsetX = this.padding;
        let offsetY = this.padding;
        let lineMaxHeight = 0;

        const layout: { el: PIXI.Container; x: number; y: number }[] = [];


        //needs to precauculate the sizes here before get the correct background dimensions
        for (const word of words) {
            const wordWidth = word.width;
            const wordHeight = word.height;

            if (offsetX + wordWidth > this.maxWidth - this.padding) {
                offsetX = this.padding;
                offsetY += lineMaxHeight;
                lineMaxHeight = 0;
            }

            layout.push({
                el: word,
                x: offsetX,
                y: offsetY
            });

            offsetX += wordWidth + this.contentSpacing;
            lineMaxHeight = Math.max(lineMaxHeight, wordHeight);
        }

        offsetY += lineMaxHeight;
        this.background.width = this.maxWidth;
        this.background.height = offsetY + this.padding;

        for (const { el, x, y } of layout) {
            el.x = x;
            el.y = y - 10;
            el.alpha = 0;
            this.contentContainer.addChild(el);

            const tween = gsap.to(el, {
                alpha: 1,
                duration: speed,
                delay: delay,
                y,
                onComplete: () => {
                    const index = this.tweens.indexOf(tween);
                    if (index !== -1) this.tweens.splice(index, 1);
                }
            });
            this.tweens.push(tween);
            await tween.then();

        }
    }
    dispose(): void {
        this.tweens.forEach(t => t.kill());
        this.tweens.length = 0;
    }
}
