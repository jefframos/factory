import { CharacterAnimationData } from "../character/Types";

export class SpriteAnimation {
    private animations: Record<string, CharacterAnimationData> = {};
    private currentAnimation!: CharacterAnimationData;
    private currentFrameIndex = 0;
    private elapsedTime = 0;
    private _currentSpriteId = "";

    constructor() {

    }

    public register(animation: CharacterAnimationData) {
        this.animations[animation.name] = animation;
        this.play(animation.name)
    }

    public wipe() {
        this.animations = {};
        this.currentAnimation = undefined as any;
        this.currentFrameIndex = 0;
        this.elapsedTime = 0;
        this._currentSpriteId = "";
    }

    public play(name: string) {
        const anim = this.animations[name];
        if (!anim) return;
        this.currentAnimation = anim;
        this.currentFrameIndex = 0;
        this.elapsedTime = 0;
        this._currentSpriteId = anim.frame[0];
    }

    public update(delta: number) {
        if (!this.currentAnimation) return;

        this.elapsedTime += delta;

        const frameDuration = 1 / this.currentAnimation.frameRate;
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
