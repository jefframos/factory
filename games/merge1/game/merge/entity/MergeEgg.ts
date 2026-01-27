import { Game } from "@core/Game";
import ViewUtils from "@core/utils/ViewUtils";
import { gsap } from "gsap";
import * as PIXI from "pixi.js";
import MergeAssets from "../MergeAssets";
import { TextureBaker } from "../vfx/TextureBaker";

export class MergeEgg extends PIXI.Container {
    public level: number = 1;
    public state: "JIGGLE" | "REST" = "REST";

    private sprite!: PIXI.Sprite;
    protected shadowContainer: PIXI.Container = new PIXI.Container();
    protected eyesContainer: PIXI.Container = new PIXI.Container();


    private timer: number = 0;
    private animElapsed: number = 0;

    private isLanding: boolean = false;
    private landingTimeline?: gsap.core.Timeline;

    protected shadow!: PIXI.Sprite | PIXI.NineSlicePlane;


    constructor(level: number = 1) {
        super();
        this.level = level;
        this.setupVisuals();
    }

    private setupVisuals(): void {

        this.addChild(this.shadowContainer);

        // 1. Shadow (Added first to stay behind)
        let tex = TextureBaker.getTexture('___shadow')
        if (!tex) {
            const shadowC = new PIXI.Container();

            const shadow = new PIXI.Graphics();
            shadow.beginFill(0x000000, 0.2);
            shadow.drawEllipse(120, 120, 120, 120);
            shadow.endFill();
            shadowC.addChild(shadow);
            tex = TextureBaker.bakeContainer('___shadow', shadowC, Game.renderer);
        }
        // 1. Shadow
        this.shadow = PIXI.Sprite.from(tex);
        this.shadowContainer.addChild(this.shadow);
        this.shadow.anchor.set(0.5)



        // 2. Sprite
        //this.sprite = PIXI.Sprite.from('BorderFrame_Round24');
        this.sprite = PIXI.Sprite.from(MergeAssets.Textures.Icons.Gift2);
        this.sprite.anchor.set(0.5, 0.9);

        //this.setupGooglyEyes(['eye', 'eye'])

        this.eyesContainer.x = 0;
        this.eyesContainer.y = -this.sprite.height * 0.7;

        this.addChild(this.sprite);
        this.sprite.addChild(this.eyesContainer);
    }

    public init(level: number = 1): void {
        this.level = level;
        this.visible = true;
        this.state = "REST";
        this.animElapsed = 0;
        this.timer = 1 + Math.random() * 2;

        // Reset any running tweens
        if (this.landingTimeline) this.landingTimeline.kill();

        // Start landing state
        this.isLanding = true;
        this.angle = 0;

        if (level > 2) {
            this.sprite.texture = PIXI.Texture.from(MergeAssets.Textures.Icons.ChestGold)
        } else {
            this.sprite.texture = PIXI.Texture.from(MergeAssets.Textures.Icons.Gift2)
        }
        // Setup initial "in-air" pose
        this.sprite.y = -120;
        this.sprite.scale.set(0.7, 1.3); // Stretched thin
        this.shadowContainer.alpha = 0;

        this.shadow.scale.set(ViewUtils.elementScaler(this.shadow, this.sprite.width, this.sprite.width))
        this.shadow.scale.y /= 2;

        // Landing Animation
        this.landingTimeline = gsap.timeline({
            onComplete: () => {
                this.isLanding = false;
            }
        });

        this.landingTimeline
            .to(this.sprite, { y: 0, duration: 0.25, ease: "power2.in" }, 0)
            .to(this.shadowContainer, { alpha: 1, duration: 0.25, ease: "power2.in" }, 0)
            .to(this.sprite.scale, { x: 1.3, y: 0.7, duration: 0.1, ease: "sine.out" })
            .to(this.sprite.scale, { x: 1, y: 1, duration: 0.6, ease: "bounce.out" });
    }

    protected setupGooglyEyes(textureIds: string[]): void {
        // 1. Clear existing eyes
        this.eyesContainer.removeChildren().forEach(child => child.destroy());

        // 2. Determine eye count (1 or 2)
        const eyeCount = 1

        // 3. Define scaling logic
        // We want the eyes to fit within the sprite width. 
        // If 2 eyes, they should each take up roughly 35-40% of the width.
        const padding = 10;
        const availableWidth = this.sprite.width - padding;

        // Calculate a consistent base size
        // If 1 eye, it can be large. If 2, they must be smaller to fit side-by-side.
        const targetEyeWidth = eyeCount === 1
            ? availableWidth * 0.6  // One big eye
            : availableWidth * 0.4; // Two medium eyes

        // 4. Position and Render
        for (let i = 0; i < eyeCount; i++) {
            const randomTex = textureIds[Math.floor(Math.random() * textureIds.length)];
            const eye = PIXI.Sprite.from(randomTex);
            eye.anchor.set(0.5);

            // --- SCALE ---
            // Scale = (Desired Pixel Size) / (Original Texture Pixel Size)
            const scaleBase = targetEyeWidth / eye.texture.width;
            const randomVariation = 0.8 + Math.random() * 0.4; // 80% to 120% size
            eye.scale.set(scaleBase * randomVariation);

            // --- POSITIONING ---
            let posX = 0;
            if (eyeCount === 2) {
                const spacing = targetEyeWidth * 1.1; // Distance between centers
                // This centers the group: eye 0 is left, eye 1 is right
                posX = (i === 0) ? -spacing / 2 : spacing / 2;
            }

            // Add a tiny bit of "wonky" randomness
            const noiseX = (Math.random() - 0.5) * 5;
            const noiseY = (Math.random() - 0.5) * 10;

            eye.x = posX + noiseX;
            eye.y = noiseY;
            eye.rotation = (Math.random() - 0.5) * 0.4;

            this.eyesContainer.addChild(eye);
        }
    }

    public reset(): void {
        if (this.landingTimeline) this.landingTimeline.kill();
        this.visible = false;
        this.isLanding = false;
        this.sprite.position.set(0, 0);
        this.sprite.scale.set(1);
        this.angle = 0;
        if (this.parent) this.parent.removeChild(this);
    }

    public update(delta: number, bounds: PIXI.Rectangle): void {
        // Block jiggle logic while falling

        if (this.isLanding) return;

        this.timer -= delta;

        if (this.state === "JIGGLE") {
            this.handleJiggle(delta);
        } else {
            this.handleRest(delta);
        }

        if (this.timer <= 0) {
            this.toggleState();
        }


    }

    private toggleState(): void {
        if (this.state === "REST") {
            this.state = "JIGGLE";
            this.timer = 1.5 + Math.random();
        } else {
            this.state = "REST";
            this.timer = 2 + Math.random() * 3;
        }
    }

    private handleJiggle(delta: number): void {
        this.animElapsed += delta * 15;
        this.angle = Math.sin(this.animElapsed) * 12;

        const scaleEffect = Math.cos(this.animElapsed * 1.5) * 0.1;
        this.sprite.scale.y = 1 + scaleEffect;
        this.sprite.scale.x = 1 - scaleEffect;

        // shadowContainer pulse with jiggle
        this.shadowContainer.scale.set(1 - Math.abs(scaleEffect));
    }

    private handleRest(delta: number): void {
        const lerpSpeed = 8 * delta;
        // Using manual lerp for the "settling" feel
        this.angle += (0 - this.angle) * lerpSpeed;
        this.sprite.scale.x += (1 - this.sprite.scale.x) * lerpSpeed;
        this.sprite.scale.y += (1 - this.sprite.scale.y) * lerpSpeed;
        this.shadowContainer.scale.set(1);
    }
}