import { Game } from "@core/Game";
import { gsap } from "gsap"; // Ensure gsap is installed
import * as PIXI from "pixi.js";
import MergeAssets from "../MergeAssets";
import { TextureBaker } from "../vfx/TextureBaker";

export enum EntityState { IDLE, WALK, GRABBED }

export class BaseMergeEntity extends PIXI.Container {
    public state: EntityState = EntityState.IDLE;
    public level: number = 1;

    public coinOffset: PIXI.Point = new PIXI.Point();


    public breathIntensity: number = 0.05; // 0 is off, 0.05 is subtle (5% scale change)
    protected breathTimer: number = Math.random();
    protected breathSpeed: number = 4; // Frequency of the breath

    protected view: PIXI.Container = new PIXI.Container();
    protected sprite: PIXI.Sprite | PIXI.NineSlicePlane;
    protected highlight: PIXI.Sprite | PIXI.NineSlicePlane;
    protected spriteContainer: PIXI.Container = new PIXI.Container();
    protected shadowContainer: PIXI.Container = new PIXI.Container();
    protected levelText: PIXI.BitmapText;
    protected shadow: PIXI.Sprite | PIXI.NineSlicePlane;

    protected stateTimer: number = 0;
    protected moveDir: PIXI.Point = new PIXI.Point(0, 0);
    public walkSpeed: number = 80;
    protected walkAnimTime: number = 0;


    protected isLanding: boolean = false;
    protected landingTimeline?: gsap.core.Timeline;


    constructor() {
        super();
        this.addChild(this.view);


        this.view.addChild(this.shadowContainer);
        this.view.addChild(this.spriteContainer);

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

        // 2. Sprite (Anchor at Bottom-Center)
        this.sprite = PIXI.Sprite.from(`ResourceBar_Single_Icon_Monster`);
        this.sprite.anchor.set(0.5, 1);
        this.spriteContainer.addChild(this.sprite);

        this.highlight = PIXI.Sprite.from('BubbleFrame01_White')
        this.highlight.visible = false;
        this.highlight.anchor.set(0.5, 1)
        this.spriteContainer.addChildAt(this.highlight, 0); // Put it behind the shadow/sprite


        // 3. Level Text
        this.levelText = new PIXI.BitmapText(`Lv.1`, {
            fontName: MergeAssets.MainFont.fontFamily,
            fontSize: 22
        });
        this.levelText.anchor.set(0.5, 0.65);
        this.levelText.y = 0;
        this.sprite.addChild(this.levelText);
    }
    /**
        * Generic function to add facial features like eyes, ears, or mouths.
        */
    protected addFeature(
        targetContainer: PIXI.Container,
        textureIds: string[],
        config: {
            count: number,
            widthFactor: number,
            yOffset: number,
            spacing: number,
            tint?: number,
            randomize: boolean
        }
    ): void {
        targetContainer.removeChildren().forEach(child => child.destroy());

        const targetFeatureWidth = (this.sprite.width * config.widthFactor) / (config.count || 1);

        for (let i = 0; i < config.count; i++) {
            const tex = textureIds[i % textureIds.length];
            const feature = PIXI.Sprite.from(tex);
            feature.anchor.set(0.5);

            feature.tint = config.tint || 0xFFFFFF

            // Scale based on desired width
            const scaleBase = targetFeatureWidth / feature.texture.width;
            const variation = config.randomize ? (0.95 + Math.random() * 0.1) : 1;
            feature.scale.set(scaleBase * variation);

            // X Positioning
            let posX = 0;
            if (config.count > 1) {
                const totalSpacing = targetFeatureWidth * config.spacing;
                posX = (i === 0) ? -totalSpacing / 2 : totalSpacing / 2;
            }

            // Wonky randomness for juice
            const noiseX = config.randomize ? (Math.random() - 0.5) * 4 : 0;
            const noiseY = config.randomize ? (Math.random() - 0.5) * 4 : 0;

            feature.x = posX + noiseX;
            feature.y = config.yOffset + noiseY;

            if (config.randomize) {
                feature.rotation = (Math.random() - 0.5) * 0.2;
            }

            targetContainer.addChild(feature);
        }
    }
    public init(level: number, spriteId: string, animationId: string): void {
        this.visible = true;
        this.level = level;
        this.levelText.text = `${level}`;

        // Get the colors for this level (could be 1 or many)
        const levelColors = MergeAssets.CatColors[level - 1];

        this.sprite.texture = PIXI.Texture.from(spriteId);

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
        this.shadowContainer.alpha = 0;
        this.shadowContainer.y = 0//this.sprite.height / 2 * -this.sprite.anchor.y
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
            .to(this.shadowContainer, { alpha: 1, scale: 1, duration: 0.5, ease: "bounce.out" }, 0)
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
        this.highlight.visible = false;
        this.state = EntityState.IDLE;
        this.walkAnimTime = 0;
        this.spriteContainer.position.set(0, 0);
        this.spriteContainer.scale.set(1);
        this.spriteContainer.alpha = 1
        this.sprite.alpha = 1
        this.shadowContainer.alpha = 1;
        this.shadowContainer.scale.set(1);
        if (this.parent) this.parent.removeChild(this);
    }

    public startGrab() {
        this.state = EntityState.GRABBED;
    }
    public stopGrab() {
        this.state = EntityState.IDLE;
    }
    public update(delta: number, bounds: PIXI.Rectangle): void {
        // If landing, let GSAP handle the sprite. We just block logic.
        this.levelText.scale.x = this.spriteContainer.scale.x < 0 ? -1 : 1;

        if (this.isLanding) return;

        if (this.breathIntensity > 0) {
            this.breathTimer += delta * this.breathSpeed;
        }

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

    protected enterIdle(): void {
        this.state = EntityState.IDLE;
        this.stateTimer = 4 + Math.random() * 5;
    }

    protected enterWalk(): void {



        this.state = EntityState.WALK;
        this.stateTimer = 2 + Math.random() * 3;
        const angle = Math.random() * Math.PI * 2;
        this.moveDir.set(Math.cos(angle), Math.sin(angle));
    }

    protected handleIdleState(delta: number): void {

        if (this.highlight.visible) {
            this.setHighlight(false);
        }


        const lerpSpeed = 10 * delta;
        const targetSide = this.moveDir.x >= 0 ? 1 : -1;

        // Calculate Breath Offset
        // sin(timer) gives us -1 to 1. We map it to a positive expansion/contraction.
        let breathX = 0;
        let breathY = 0;

        if (this.breathIntensity > 0 && !this.isLanding) {
            // Standard breathing: When height expands, width slightly contracts (volume preservation)
            breathY = Math.sin(this.breathTimer) * this.breathIntensity;
            breathX = -Math.sin(this.breathTimer) * (this.breathIntensity * 0.5);
        }

        // Apply Lerp with Breath added to the target (1.0)
        const targetScaleX = targetSide * (1 + breathX);
        const targetScaleY = 1 + breathY;

        this.spriteContainer.scale.x += (targetScaleX - this.spriteContainer.scale.x) * lerpSpeed;
        this.spriteContainer.scale.y += (targetScaleY - this.spriteContainer.scale.y) * lerpSpeed;

        if (this.spriteContainer.scale.x < 0) {
            this.spriteContainer.scale.x = Math.max(-1.5, this.spriteContainer.scale.x)
        } else {
            this.spriteContainer.scale.x = Math.min(1.5, this.spriteContainer.scale.x)
        }
        this.spriteContainer.scale.y = Math.min(1.5, this.spriteContainer.scale.y)

        this.spriteContainer.y += (0 - this.spriteContainer.y) * lerpSpeed;
        this.shadowContainer.scale.set(1 + breathX * 0.5); // Shadow reacts slightly to breath
        this.walkAnimTime = 0;
    }

    protected handleWalkState(delta: number, bounds: PIXI.Rectangle): void {
        if (this.highlight.visible) {
            this.setHighlight(false);
        }
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


        this.updateHop(hop);
        this.updateDirectionScale(side);
    }
    protected updateHop(hop: number) {
        this.spriteContainer.y = -hop * 15;
        this.spriteContainer.scale.y = 1 + hop * 0.15;
        this.spriteContainer.scale.x = (1 - hop * 0.1);
        this.shadowContainer.scale.set(1 - hop * 0.3);
    }
    protected updateDirectionScale(side: number) {
        this.spriteContainer.scale.x = Math.abs(this.spriteContainer.scale.x) * side
    }

    protected handleGrabbedState(delta: number): void {

        if (!this.highlight.visible) {
            this.setHighlight(true);
        }
        const lerpSpeed = 15 * delta; // Faster lerp for responsive feel

        // 1. Determine target horizontal scale based on current facing
        const targetSide = this.spriteContainer.scale.x > 0 ? 1 : -1;

        // 2. Smoothly lerp scale to exactly 1 (or -1)
        this.spriteContainer.scale.x += (targetSide - this.spriteContainer.scale.x) * lerpSpeed;
        this.spriteContainer.scale.y += (1 - this.spriteContainer.scale.y) * lerpSpeed;

        // 3. Lift the sprite and shadowContainer logic
        // We lift the sprite relative to the container to show it's "in the air"
        this.spriteContainer.y += (-15 - this.spriteContainer.y) * lerpSpeed;

        // shadowContainer becomes faint and small while lifted
        //this.shadowContainer.alpha += (0.1 - this.shadowContainer.alpha) * lerpSpeed;
        this.shadowContainer.scale.x += (0.85 - this.shadowContainer.scale.x) * lerpSpeed;
        this.shadowContainer.scale.y += (0.85 - this.shadowContainer.scale.y) * lerpSpeed;
    }
}