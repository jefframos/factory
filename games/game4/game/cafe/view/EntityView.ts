import * as PIXI from 'pixi.js';
import { SpriteAnimation } from '../../2048/view/SpriteAnimation';
import { Fonts, PieceViewData } from '../../character/Types';
export default class EntityView extends PIXI.Container {
    private animation!: SpriteAnimation;
    private label!: PIXI.BitmapText;
    private sprite: PIXI.Sprite = new PIXI.Sprite();
    private spriteContainer: PIXI.Container = new PIXI.Container();
    constructor(character?: PieceViewData) {
        super()

        if (character) {
            this.build();
            this.resetCharacter(character)
        }
    }
    build() {

        this.label = new PIXI.BitmapText('0', {
            fontName: Fonts.MainFamily,
            fontSize: Fonts.Main.fontSize as number,
            align: 'center',
            letterSpacing: 2
        });

        // Sprite setup
        this.sprite.anchor.set(0.5, 0.8);
        // Label position
        this.label.anchor.set(0.5);

        this.addChild(this.spriteContainer);
        //this.addChild(this.label);
        this.spriteContainer.addChild(this.sprite);

        this.animation = new SpriteAnimation();
        this.animation.globalSpeedMultiplier = 1.5

    }
    resetCharacter(character: PieceViewData) {
        this.animation.wipe();
        this.animation.register(character.idle);
        this.animation.register(character.walk);
        this.animation.play("idle");

        this.sprite.texture = PIXI.Texture.from(this.animation.currentSpriteId);
    }
    update(delta: number) {
        this.animation.update(delta);
        this.sprite.texture = PIXI.Texture.from(this.animation.currentSpriteId);
        this.zIndex = this.y
    }
    public setIdleState(isIdle: boolean): void {
        if (isIdle) {
            this.animation.play("idle");
        } else {
            this.animation.play("walk");
        }
    }
    public setDirection(direction: {
        x: number;
        y: number;
    }) {
        if (direction.x) {
            this.spriteContainer.scale.x = direction.x
        }
    }
}