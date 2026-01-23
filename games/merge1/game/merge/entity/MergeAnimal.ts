import { Game } from "@core/Game";
import { gsap } from "gsap"; // Ensure gsap is installed
import * as PIXI from "pixi.js";
import MergeAssets from "../../MergeAssets";
import { BakeDirection, TextureBaker } from "../vfx/TextureBaker";

export enum EntityState { IDLE, WALK, GRABBED }

export class MergeAnimal extends PIXI.Container {
    public state: EntityState = EntityState.IDLE;
    public level: number = 1;

    private view: PIXI.Container = new PIXI.Container();
    private sprite: PIXI.Sprite;
    private spriteContainer: PIXI.Container = new PIXI.Container();
    private levelText: PIXI.Text;
    private shadow: PIXI.Graphics;

    private stateTimer: number = 0;
    private moveDir: PIXI.Point = new PIXI.Point(0, 0);
    private walkSpeed: number = 80;
    private walkAnimTime: number = 0;


    private isLanding: boolean = false;
    private landingTimeline?: gsap.core.Timeline;

    private highlight: PIXI.Sprite;

    constructor() {
        super();
        this.addChild(this.view);


        this.view.addChild(this.spriteContainer);

        // 1. Shadow
        this.shadow = new PIXI.Graphics();
        this.shadow.beginFill(0x000000, 0.2);
        this.shadow.drawEllipse(0, 0, 20, 8);
        this.shadow.endFill();
        this.view.addChild(this.shadow);

        // 2. Sprite (Anchor at Bottom-Center)
        this.sprite = PIXI.Sprite.from(`ResourceBar_Single_Icon_Monster`);
        this.sprite.anchor.set(0.5, 1);
        this.spriteContainer.addChild(this.sprite);

        this.highlight = PIXI.Sprite.from('BubbleFrame01_White')
        this.highlight.visible = false;
        this.highlight.anchor.set(0.5, 1)
        this.spriteContainer.addChildAt(this.highlight, 0); // Put it behind the shadow/sprite


        // 3. Level Text
        this.levelText = new PIXI.Text(`Lv.1`, {
            ...MergeAssets.MainFont, fontSize: 18
        });
        this.levelText.anchor.set(0.5, 0.5);
        this.levelText.y = 0;
        this.sprite.addChild(this.levelText);
    }

    public init(level: number, spriteId: string, animationId: string): void {
        this.visible = true;
        this.level = level;
        this.levelText.text = `${level}`;

        // Get the colors for this level (could be 1 or many)
        const levelColors = MergeAssets.Colors[level - 1];

        // Fetch or Bake the texture
        const bakedTexture = TextureBaker.getTexture(
            level,
            'BubbleFrame01_Bg', // Base texture
            levelColors,
            Game.renderer, BakeDirection.HORIZONTAL
        );

        this.sprite.texture = bakedTexture;

        // IMPORTANT: Reset the tint to white because the color is now part of the texture pixels!
        this.sprite.tint = 0xFFFFFF;


        this.highlight.y = (this.highlight.height / 2 - this.sprite.height / 2)

        this.levelText.y = -this.sprite.height / 2;

        //this.sprite.texture = PIXI.Texture.from(spriteId)
        this.walkSpeed = Math.random() * 50 + 20

        // Reset any existing animations
        if (this.landingTimeline) this.landingTimeline.kill();

        this.isLanding = true;

        // 1. Setup Starting Pose
        this.spriteContainer.y = -50; // High in the sky
        this.spriteContainer.scale.set(0.6, 1.4); // Stretched thin while falling
        this.shadow.alpha = 0;
        this.shadow.y = 0//this.sprite.height / 2 * -this.sprite.anchor.y
        // this.shadow.scale.set(0.2);

        // 2. GSAP Landing Timeline
        this.landingTimeline = gsap.timeline({
            onComplete: () => {
                this.isLanding = false;
                this.enterIdle();
            }
        });

        this.landingTimeline
            // Fall down
            .to(this.spriteContainer, { y: 0, duration: 0.5, ease: "bounce.out" }, 0)
            .to(this.shadow, { alpha: 1, scale: 1, duration: 0.5, ease: "bounce.out" }, 0)
            // Squash on impact
            .to(this.spriteContainer.scale, { x: 0.6, y: 1.4, duration: 0.1, ease: "sine.out" }, 0)
            // Bounce back up slightly and normalize
            .to(this.spriteContainer.scale, { delay: 0.1, x: 1, y: 1, duration: 0.6, ease: "elastic.out" }, 0);
    }
    public setHighlight(visible: boolean): void {
        this.highlight.visible = visible;
        if (visible) {
            // Optional: slight "breathing" effect or scale up
            gsap.to(this.view.scale, { x: 1.1, y: 1.1, duration: 0.2 });
        } else {
            gsap.to(this.view.scale, { x: 1, y: 1, duration: 0.2 });
        }
    }
    public reset(): void {
        if (this.landingTimeline) this.landingTimeline.kill();
        this.visible = false;
        this.isLanding = false;
        this.state = EntityState.IDLE;
        this.walkAnimTime = 0;
        this.spriteContainer.position.set(0, 0);
        this.spriteContainer.scale.set(1);
        this.spriteContainer.alpha = 1
        this.sprite.alpha = 1
        this.shadow.alpha = 1;
        this.shadow.scale.set(1);
        if (this.parent) this.parent.removeChild(this);
    }

    public update(delta: number, bounds: PIXI.Rectangle): void {
        // If landing, let GSAP handle the sprite. We just block logic.
        this.levelText.scale.x = this.spriteContainer.scale.x < 0 ? -1 : 1;

        if (this.isLanding) return;

        if (this.state === EntityState.GRABBED) {
            this.handleGrabbedState(delta);
            return;
        }


        this.stateTimer -= delta;

        if (this.state === EntityState.IDLE) {
            this.handleIdleState(delta);
        } else if (this.state === EntityState.WALK) {
            this.handleWalkState(delta, bounds);
        }

        if (this.stateTimer <= 0) {
            this.state === EntityState.IDLE ? this.enterWalk() : this.enterIdle();
        }

    }

    private enterIdle(): void {
        this.state = EntityState.IDLE;
        this.stateTimer = 4 + Math.random() * 5;
    }

    private enterWalk(): void {
        this.state = EntityState.WALK;
        this.stateTimer = 2 + Math.random() * 3;
        const angle = Math.random() * Math.PI * 2;
        this.moveDir.set(Math.cos(angle), Math.sin(angle));
    }

    private handleIdleState(delta: number): void {
        const lerpSpeed = 10 * delta;
        const targetSide = this.moveDir.x >= 0 ? 1 : -1;

        this.spriteContainer.scale.x += (targetSide - this.spriteContainer.scale.x) * lerpSpeed;
        this.spriteContainer.scale.y += (1 - this.spriteContainer.scale.y) * lerpSpeed;
        this.spriteContainer.y += (0 - this.spriteContainer.y) * lerpSpeed;
        this.shadow.scale.set(1);
        this.walkAnimTime = 0;
    }

    private handleWalkState(delta: number, bounds: PIXI.Rectangle): void {
        // 1. Calculate movement
        this.x += this.moveDir.x * this.walkSpeed * delta;
        this.y += this.moveDir.y * this.walkSpeed * delta;

        // 2. BOUNCE LOGIC (Direction flip)
        // We check if it's PAST the edge and flip the movement vector
        if (this.x < bounds.left) {
            this.x = bounds.left;
            this.moveDir.x *= -1;
        } else if (this.x > bounds.right) {
            this.x = bounds.right;
            this.moveDir.x *= -1;
        }

        if (this.y < bounds.top) {
            this.y = bounds.top;
            this.moveDir.y *= -1;
        } else if (this.y > bounds.bottom) {
            this.y = bounds.bottom;
            this.moveDir.y *= -1;
        }

        // 3. HARD CLAMP (Safety Net)
        // This prevents the "not in focus" teleportation
        this.x = Math.max(bounds.left, Math.min(this.x, bounds.right));
        this.y = Math.max(bounds.top, Math.min(this.y, bounds.bottom));

        // 4. Animation logic (Keep this as is)
        this.walkAnimTime += delta * 12;
        const hop = Math.abs(Math.sin(this.walkAnimTime));
        const side = this.moveDir.x > 0 ? 1 : -1;

        this.spriteContainer.y = -hop * 15;
        this.spriteContainer.scale.y = 1 + hop * 0.15;
        this.spriteContainer.scale.x = side * (1 - hop * 0.1);
        this.shadow.scale.set(1 - hop * 0.3);
    }

    private handleGrabbedState(delta: number): void {
        const lerpSpeed = 15 * delta; // Faster lerp for responsive feel

        // 1. Determine target horizontal scale based on current facing
        const targetSide = this.spriteContainer.scale.x > 0 ? 1 : -1;

        // 2. Smoothly lerp scale to exactly 1 (or -1)
        this.spriteContainer.scale.x += (targetSide - this.spriteContainer.scale.x) * lerpSpeed;
        this.spriteContainer.scale.y += (1 - this.spriteContainer.scale.y) * lerpSpeed;

        // 3. Lift the sprite and shadow logic
        // We lift the sprite relative to the container to show it's "in the air"
        this.spriteContainer.y += (-15 - this.spriteContainer.y) * lerpSpeed;

        // Shadow becomes faint and small while lifted
        this.shadow.alpha += (0.1 - this.shadow.alpha) * lerpSpeed;
        this.shadow.scale.x += (0.5 - this.shadow.scale.x) * lerpSpeed;
        this.shadow.scale.y += (0.5 - this.shadow.scale.y) * lerpSpeed;
    }
}