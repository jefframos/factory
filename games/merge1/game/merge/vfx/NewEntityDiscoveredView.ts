import PromiseUtils from '@core/utils/PromiseUtils';
import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import MergeAssets from '../MergeAssets';
import { TextureBaker } from './TextureBaker';

export class NewEntityDiscoveredView extends PIXI.Container {
    private shine: PIXI.Sprite;
    private portrait: PIXI.Sprite;
    private titleText: PIXI.Text;
    private nameText: PIXI.Text;
    private isAnimating: boolean = false;

    constructor() {
        super();

        // 1. Setup Background Shine
        this.shine = PIXI.Sprite.from(MergeAssets.Textures.UI.Shine);
        this.shine.anchor.set(0.5);
        this.shine.alpha = 0;
        this.addChild(this.shine);

        // 2. Setup Portrait
        this.portrait = new PIXI.Sprite();
        this.portrait.anchor.set(0.5);
        this.portrait.scale.set(0);
        this.addChild(this.portrait);

        // 3. Setup Title Text ("You Discovered")
        this.titleText = new PIXI.Text('YOU DISCOVERED', {
            ...MergeAssets.MainFontTitle,
            fontSize: 24,
            fill: 0xffffff,
            align: 'center',
        });
        this.titleText.anchor.set(0.5, 1);
        this.titleText.y = -70; // Kept your original position
        this.titleText.alpha = 0;
        this.addChild(this.titleText);

        // 4. Setup Name Text (The Entity Name)
        this.nameText = new PIXI.Text('', {
            ...MergeAssets.MainFontTitle,
            fontSize: 32,
            align: 'center',
        });
        this.nameText.anchor.set(0.5, 0);
        this.nameText.y = 80; // Positioned below the portrait
        this.nameText.alpha = 0;
        this.addChild(this.nameText);

        this.visible = false;
    }

    public update(delta: number): void {
        if (this.visible && this.shine) {
            this.shine.rotation += 0.01 * delta;
        }
    }

    public async playNew(entityId: number, entityName: string, entityColor: number, targetContainer: PIXI.Container) {
        if (this.isAnimating) return;
        this.isAnimating = true;

        // Reset and Prepare
        const texture = TextureBaker.getTexture(`ENTITY_${entityId}`);
        this.portrait.texture = texture;

        this.nameText.text = entityName.toUpperCase();
        this.nameText.style.fill = entityColor;

        this.visible = true;

        // 1. POP APPEARANCE
        gsap.set([this.shine, this.titleText, this.nameText], { alpha: 0 });
        gsap.set(this.portrait.scale, { x: 0, y: 0 });

        const timeline = gsap.timeline();

        timeline.to(this.shine, { alpha: 0.6, duration: 0.5 });
        timeline.to(this.portrait.scale, { x: 1.2, y: 1.2, duration: 0.4, ease: "back.out(2)" }, 0);

        // Stagger the text appearance slightly
        timeline.to(this.titleText, { alpha: 1, duration: 0.3 }, "-=0.2");
        timeline.to(this.nameText, { alpha: 1, duration: 0.3 }, "-=0.1");

        // 2. WAIT
        await PromiseUtils.await(1500);

        // 3. FLY TO TARGET
        const globalTarget = targetContainer.getGlobalPosition();
        const localTarget = this.parent.toLocal(globalTarget);

        // Hide text and shine before flying
        gsap.to([this.titleText, this.nameText, this.shine], { alpha: 0, duration: 0.2 });

        timeline.to(this, {
            x: localTarget.x,
            y: localTarget.y,
            duration: 0.8,
            ease: "power2.inOut",
            onComplete: () => {
                this.hitTarget(targetContainer);
            }
        });
    }

    private hitTarget(targetContainer: PIXI.Container) {
        gsap.to(this.portrait.scale, {
            x: 0,
            y: 0,
            duration: 0.3,
            ease: "back.in(2)",
            onComplete: () => {
                this.visible = false;
                this.isAnimating = false;

                gsap.fromTo(targetContainer.scale,
                    { x: 1, y: 1 },
                    { x: 1.4, y: 1.4, duration: 0.1, yoyo: true, repeat: 1 }
                );
            }
        });
    }
}