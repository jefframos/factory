import { gsap } from "gsap";
import * as PIXI from "pixi.js";

export class MergeEgg extends PIXI.Container {
    public level: number = 1;
    public state: "JIGGLE" | "REST" = "REST";

    private sprite!: PIXI.Sprite;
    private shadow!: PIXI.Graphics;
    private timer: number = 0;
    private animElapsed: number = 0;

    private isLanding: boolean = false;
    private landingTimeline?: gsap.core.Timeline;

    constructor(level: number = 1) {
        super();
        this.level = level;
        this.setupVisuals();
    }

    private setupVisuals(): void {
        // 1. Shadow (Added first to stay behind)
        this.shadow = new PIXI.Graphics();
        this.shadow.beginFill(0x000000, 0.2);
        this.shadow.drawEllipse(0, 0, 15, 6);
        this.shadow.endFill();
        this.addChild(this.shadow);

        // 2. Sprite
        this.sprite = PIXI.Sprite.from('BorderFrame_Round24');
        this.sprite.anchor.set(0.5, 1);
        this.addChild(this.sprite);
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

        // Setup initial "in-air" pose
        this.sprite.y = -120;
        this.sprite.scale.set(0.7, 1.3); // Stretched thin
        this.shadow.alpha = 0;
        this.shadow.scale.set(0.2);

        // Landing Animation
        this.landingTimeline = gsap.timeline({
            onComplete: () => {
                this.isLanding = false;
            }
        });

        this.landingTimeline
            .to(this.sprite, { y: 0, duration: 0.25, ease: "power2.in" }, 0)
            .to(this.shadow, { alpha: 1, scale: 1, duration: 0.25, ease: "power2.in" }, 0)
            .to(this.sprite.scale, { x: 1.3, y: 0.7, duration: 0.1, ease: "sine.out" })
            .to(this.sprite.scale, { x: 1, y: 1, duration: 0.6, ease: "bounce.out" });
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

        // Shadow pulse with jiggle
        this.shadow.scale.set(1 - Math.abs(scaleEffect));
    }

    private handleRest(delta: number): void {
        const lerpSpeed = 8 * delta;
        // Using manual lerp for the "settling" feel
        this.angle += (0 - this.angle) * lerpSpeed;
        this.sprite.scale.x += (1 - this.sprite.scale.x) * lerpSpeed;
        this.sprite.scale.y += (1 - this.sprite.scale.y) * lerpSpeed;
        this.shadow.scale.set(1);
    }
}