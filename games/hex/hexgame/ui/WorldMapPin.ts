import * as PIXI from "pixi.js";

export enum PinState {
    IDLE = "idle",
    MOVING = "moving",
    REACHED = "reached",
    LEVEL_COMPLETE = "level_complete"
}


// ... PinState Enum ...

export class WorldMapPin extends PIXI.Container {
    // Values from your BaseMergeEntity
    private readonly WALK_ANIM_SPEED = 10;
    private readonly HOP_MAX_HEIGHT = 10;
    private readonly SCALE_STRETCH_Y = 0.1;
    private readonly SCALE_SQUASH_X = 0.05;
    private readonly SHADOW_MIN_SCALE = 0.3;

    // Breath settings from your source
    private readonly breathIntensity = 0.035;
    private readonly breathSpeed = 1;
    private breathTimer = Math.random();

    private readonly shadowContainer: PIXI.Container = new PIXI.Container();
    private readonly spriteContainer: PIXI.Container = new PIXI.Container();
    private shadow: PIXI.Sprite;
    private sprite: PIXI.Sprite;

    private state: PinState = PinState.IDLE;
    private lastX: number = 0;
    private walkAnimTime: number = 0;
    private isFacingRight: boolean = true;

    constructor(texture: PIXI.Texture, shadowTexture: PIXI.Texture) {
        super();
        // Setup shadow
        this.shadow = new PIXI.Sprite(shadowTexture);
        this.shadow.anchor.set(0.5);
        this.shadow.alpha = 0.2;
        this.shadow.tint = 0;
        this.shadowContainer.addChild(this.shadow);
        this.addChild(this.shadowContainer);

        // Setup sprite
        this.sprite = new PIXI.Sprite(texture);
        this.sprite.anchor.set(0.5, 1);
        this.spriteContainer.addChild(this.sprite);
        this.addChild(this.spriteContainer);

        this.lastX = this.x;
    }

    public setState(state: PinState): void {
        if (this.state === state) return; // Important: prevents resetting walkAnimTime every frame
        this.state = state;

        if (state !== PinState.MOVING) {
            this.walkAnimTime = 0;
        }
    }

    public update(delta: number): void {
        const safeDelta = Math.max(delta, 1 / 120);

        // Directional Flip Logic (Source of truth is world position change)
        const dx = this.x - this.lastX;
        if (Math.abs(dx) > 0.01) {
            this.isFacingRight = dx > 0;
        }

        // Animation State Machine
        if (this.state === PinState.MOVING) {
            this.walkAnimTime += safeDelta * this.WALK_ANIM_SPEED;
            const hop = Math.abs(Math.sin(this.walkAnimTime));
            this.updateHop(hop);
        } else {
            this.animateIdleBreathing(safeDelta);
        }

        // Apply facing direction
        const side = this.isFacingRight ? 1 : -1;
        this.updateDirectionScale(side);

        this.lastX = this.x;
    }

    /**
     * Ported from handleIdleState in BaseMergeEntity
     */
    private animateIdleBreathing(delta: number): void {
        this.breathTimer += delta * this.breathSpeed;

        // Volume preservation: when height expands, width contracts
        const breathY = Math.sin(this.breathTimer) * this.breathIntensity;
        const breathX = -Math.sin(this.breathTimer) * (this.breathIntensity * 0.5);

        this.spriteContainer.y = 0;
        this.spriteContainer.scale.y = 1 + breathY;

        // Maintain direction flip while applying breath
        const side = this.isFacingRight ? 1 : -1;
        this.spriteContainer.scale.x = side * (1 + breathX);

        this.shadowContainer.scale.set(1 + breathX * 0.5);
    }

    protected updateHop(hop: number) {
        this.spriteContainer.y = -hop * this.HOP_MAX_HEIGHT;
        this.spriteContainer.scale.y = 1 + hop * this.SCALE_STRETCH_Y;

        const side = this.isFacingRight ? 1 : -1;
        this.spriteContainer.scale.x = side * (1 - hop * this.SCALE_SQUASH_X);

        this.shadowContainer.scale.set(1 - hop * this.SHADOW_MIN_SCALE);
    }

    protected updateDirectionScale(side: number) {
        this.spriteContainer.scale.x = Math.abs(this.spriteContainer.scale.x) * side;
    }
}