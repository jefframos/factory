import { CharacterAnimationData } from "../../character/Types";

export class SpriteAnimation {
    private animations: Record<string, CharacterAnimationData> = {};
    private currentAnimation!: CharacterAnimationData;
    private currentFrameIndex = 0;
    private elapsedTime = 0;
    private _currentSpriteId = "";

    private frameRateOverrides: Map<string, number> = new Map();
    public globalSpeedMultiplier: number = 1;

    constructor() { }

    public register(animation: CharacterAnimationData) {
        this.animations[animation.name] = animation;
        this.play(animation.name);
    }

    public wipe() {
        this.animations = {};
        this.currentAnimation = undefined as any;
        this.currentFrameIndex = 0;
        this.elapsedTime = 0;
        this._currentSpriteId = "";
        this.frameRateOverrides.clear();
    }

    public play(name: string, overrideIfSame: boolean = false) {
        if (this.currentAnimation?.name === name && !overrideIfSame) {
            return;
        }

        const anim = this.animations[name];
        if (!anim) return;

        this.currentAnimation = anim;
        this.currentFrameIndex = 0;
        this.elapsedTime = 0;
        this._currentSpriteId = anim.frame[0];
    }

    public overrideFrameRate(name: string, frameRate: number) {
        this.frameRateOverrides.set(name, frameRate);
    }

    public update(delta: number) {
        if (!this.currentAnimation) return;

        const animationName = this.currentAnimation.name;
        const overriddenRate = this.frameRateOverrides.get(animationName);
        const frameRate = overriddenRate ?? this.currentAnimation.frameRate;

        const frameDuration = (1 / frameRate) / this.globalSpeedMultiplier;
        this.elapsedTime += delta;

        if (this.elapsedTime >= frameDuration) {
            const frames = this.currentAnimation.frame;
            this.currentFrameIndex++;

            if (this.currentFrameIndex >= frames.length) {
                if (this.currentAnimation.loop) {
                    this.currentFrameIndex = 0;
                } else {
                    this.currentFrameIndex = frames.length - 1;
                }
            }

            this._currentSpriteId = frames[this.currentFrameIndex];
            this.elapsedTime = 0;
        }
    }

    public get currentSpriteId() {
        return this._currentSpriteId;
    }
}
