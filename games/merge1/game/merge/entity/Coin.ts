import { Game } from "@core/Game";
import ViewUtils from "@core/utils/ViewUtils";
import * as PIXI from "pixi.js";
import { CurrencyType } from "../data/InGameEconomy";
import MergeAssets from "../MergeAssets";

export class Coin extends PIXI.Container {
    public value: number = 0;
    public isCollected: boolean = false;
    public coinSprite!: PIXI.Sprite;

    // --- Animation Constants ---
    private MIN_SCALE = 0.9;
    private MAX_SCALE = 1;
    private readonly PULSE_SPEED = 6.0;   // Radians per second
    private readonly BOB_SPEED = 3.0;     // Radians per second
    private readonly BOB_DISTANCE = 8;   // Pixels to move up/down
    private readonly APPEAR_SPEED = 10.0; // Higher = faster snap

    private _startY: number = 0;
    private _bobTimer: number = 0;
    private _state: 'none' | 'appearing' | 'idle' | 'collecting' = 'none';
    private _onCompleteCallback?: () => void;

    constructor() {
        super();
        this.coinSprite = PIXI.Sprite.from('ResourceBar_Single_Icon_Coin - Copy');
        this.coinSprite.anchor.set(0.5);
        this.addChild(this.coinSprite);
    }

    public init(x: number, y: number, value: number): void {
        this.position.set(x, y);
        this._startY = y;
        this.value = value;
        this.isCollected = false;
        this.coinSprite.scale.set(ViewUtils.elementScaler(this.coinSprite, 60));
        this.MAX_SCALE = this.coinSprite.scale.x
        this.MIN_SCALE = this.coinSprite.scale.x * 0.9
        this.alpha = 1;
        this.visible = true;
        this._bobTimer = 0;
        this._state = 'appearing';
    }

    public override updateTransform(): void {
        super.updateTransform();

        const dt = Game.deltaTime || 0.016;

        if (this._state === 'appearing') {
            // Lerp towards MAX_SCALE for a punchy entrance
            this.coinSprite.scale.x += (this.MAX_SCALE - this.coinSprite.scale.x) * this.APPEAR_SPEED * dt;
            this.coinSprite.scale.y = this.coinSprite.scale.x;

            if (this.coinSprite.scale.x > (this.MAX_SCALE - 0.05)) {
                this._state = 'idle';
            }
        }

        if (this._state === 'idle') {
            this._bobTimer += dt;

            // 1. Vertical Bobbing
            this.y = this._startY + Math.sin(this._bobTimer * this.BOB_SPEED) * this.BOB_DISTANCE;

            // 2. Scale Pulsing (Mapping Sine -1..1 to Min..Max)
            // Formula: lerp(min, max, (sin + 1) / 2)
            const sinNormalized = (Math.sin(this._bobTimer * this.PULSE_SPEED) + 1) / 2;
            const currentScale = this.MIN_SCALE + (this.MAX_SCALE - this.MIN_SCALE) * sinNormalized;

            this.coinSprite.scale.set(currentScale);
        }

        if (this._state === 'collecting') {
            this.y -= 400 * dt;    // Pixels per second upwards
            this.alpha -= 3.0 * dt; // Fade out in ~0.33s

            // Shrink quickly
            const shrinkSpeed = 4.0 * dt;
            this.coinSprite.scale.x = Math.max(0, this.coinSprite.scale.x - shrinkSpeed);
            this.coinSprite.scale.y = this.coinSprite.scale.x;

            if (this.alpha <= 0) {
                this.visible = false;
                this._state = 'none';
                this._onCompleteCallback?.();
            }
        }
    }
    public setCurrencySprite(type: CurrencyType): void {
        const textureName = type === CurrencyType.GEMS
            ? MergeAssets.Textures.Icons.Gem // Ensure this matches your asset key
            : MergeAssets.Textures.Icons.Coin;

        this.coinSprite.texture = PIXI.Texture.from(textureName);
    }
    public collect(onComplete: () => void): void {
        if (this.isCollected) return;
        this.isCollected = true;
        this._state = 'collecting';
        this._onCompleteCallback = onComplete;
    }

    public reset(): void {
        this._state = 'none';
        this.visible = false;
        if (this.parent) this.parent.removeChild(this);
    }
}