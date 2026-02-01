import PromiseUtils from '@core/utils/PromiseUtils';
import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import { TextureBaker } from './TextureBaker';

export class NewEntityDiscoveredView extends PIXI.Container {
    private shine: PIXI.Sprite;
    private portrait: PIXI.Sprite;
    private messageText: PIXI.Text;
    private isAnimating: boolean = false;

    constructor() {
        super();

        // 1. Setup Background Shine
        this.shine = PIXI.Sprite.from('shine_effect'); // Replace with your shine asset key
        this.shine.anchor.set(0.5);
        this.shine.alpha = 0;
        this.addChild(this.shine);

        // 2. Setup Portrait
        this.portrait = new PIXI.Sprite();
        this.portrait.anchor.set(0.5);
        this.portrait.scale.set(0);
        this.addChild(this.portrait);

        // 3. Setup Text
        this.messageText = new PIXI.Text('', {
            fontFamily: 'Arial',
            fontSize: 24,
            fill: 0xffffff,
            align: 'center',
            stroke: 0x000000,
            strokeThickness: 4
        });
        this.messageText.anchor.set(0.5, -2); // Position below the portrait
        this.messageText.alpha = 0;
        this.addChild(this.messageText);

        this.visible = false;
    }

    /**
     * Call this from your main loop: discoveryView.update(delta)
     */
    public update(delta: number): void {
        if (this.visible && this.shine) {
            this.shine.rotation += 0.01 * delta;
        }
    }

    public async playNew(entityId: number, entityName: string, targetContainer: PIXI.Container) {
        if (this.isAnimating) return; // Prevent overlapping plays
        this.isAnimating = true;

        // Reset and Prepare
        const texture = TextureBaker.getTexture(`Entity_${entityId}_Frame`);
        this.portrait.texture = texture;
        this.messageText.text = `You Discovered\n${entityName}`;
        this.visible = true;

        // 1. POP APPEARANCE
        gsap.set([this.shine, this.messageText], { alpha: 0 });
        gsap.set(this.portrait.scale, { x: 0, y: 0 });

        const timeline = gsap.timeline();

        // Animation: Shine and Portrait Pop
        timeline.to(this.shine, { alpha: 0.6, duration: 0.5 });
        timeline.to(this.portrait.scale, { x: 1.2, y: 1.2, duration: 0.4, ease: "back.out(2)" }, 0);
        timeline.to(this.messageText, { alpha: 1, duration: 0.3 }, "-=0.2");

        // 2. WAIT
        await PromiseUtils.await(1500);

        // 3. FLY TO TARGET
        // Convert the target container's global position to our parent's local space
        const globalTarget = targetContainer.getGlobalPosition();
        const localTarget = this.parent.toLocal(globalTarget);

        // Hide text and shine before flying
        gsap.to([this.messageText, this.shine], { alpha: 0, duration: 0.2 });

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
        // 4. ARRIVE EFFECT
        gsap.to(this.portrait.scale, {
            x: 0,
            y: 0,
            duration: 0.3,
            ease: "back.in(2)",
            onComplete: () => {
                this.visible = false;
                this.isAnimating = false;

                // Pop the target (the HUD icon)
                gsap.fromTo(targetContainer.scale,
                    { x: 1, y: 1 },
                    { x: 1.4, y: 1.4, duration: 0.1, yoyo: true, repeat: 1 }
                );
            }
        });
    }
}