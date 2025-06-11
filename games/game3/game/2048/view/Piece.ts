import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import { Fonts, PieceViewData } from '../../character/Types';
import { SpriteAnimation } from './SpriteAnimation';

export class Piece extends PIXI.Container {
    public value!: number;
    private background!: PIXI.NineSlicePlane;
    private label!: PIXI.BitmapText;
    private sprite: PIXI.Sprite = new PIXI.Sprite();
    private spriteContainer: PIXI.Container = new PIXI.Container();
    public merged: boolean = false;
    public animation!: SpriteAnimation;


    constructor() {
        super();
        const texture = PIXI.Texture.from("ItemFrame03_Single_Blue");
        this.background = new PIXI.NineSlicePlane(texture, 10, 10, 10, 10);

        // Label
        this.label = new PIXI.BitmapText('0', {
            fontName: Fonts.MainFamily,
            fontSize: Fonts.Main.fontSize as number,
            align: 'center',
            letterSpacing: 2
        });

    }
    public build(width: number, height: number) {
        // Nine-slice background
        this.background.width = width;
        this.background.height = height;

        // Sprite setup
        this.sprite.anchor.set(0.5, 0.8);
        //this.sprite.position.set(width / 2, height / 2);

        this.spriteContainer.position.set(width / 2, height / 2);

        // Label position
        this.label.anchor.set(0.5);
        this.label.position.set(width / 2, height / 2 + 22);

        this.addChild(this.background, this.spriteContainer, this.label);
        this.spriteContainer.addChild(this.sprite);

        //this.background.visible = false

        this.animation = new SpriteAnimation();

        this.merged = false;
    }
    public reset(value: number, character?: PieceViewData) {
        this.value = value;
        this.merged = false;

        if (value == -1) {
            this.background.texture = PIXI.Texture.from("ItemFrame03_Single_Gray");
            this.sprite.texture = PIXI.Texture.EMPTY
            this.label.text = String();
        }
        if (!character) {
            return;
        }

        this.label.text = String(value);

        this.animation.wipe();
        this.animation.register(character.idle);
        this.animation.register(character.walk);
        this.animation.play("idle");

        this.background.texture = PIXI.Texture.from(character.tile ? character.tile : "ItemFrame03_Single_Blue");


        this.sprite.texture = PIXI.Texture.from(this.animation.currentSpriteId);
    }
    public setDirection(direction: {
        x: number;
        y: number;
    }) {
        if (direction.x) {
            this.spriteContainer.scale.x = direction.x
        }
    }
    private draw() {
        this.label.text = String(this.value);
    }

    public async moveTo(x: number, y: number) {
        this.animation.play("walk");
        return new Promise<void>((resolve) => {
            gsap.to(this, {
                x, y, duration: 0.15, ease: 'power2.out',
                onComplete: () => {
                    setTimeout(() => {
                        this.animation.play("idle");
                    }, 500);
                    resolve()
                }
            });
        });
    }

    public async pop() {
        return new Promise<void>((resolve) => {
            gsap.fromTo(this.sprite.scale, { x: 0.6, y: 0.6 }, {
                x: 1, y: 1, duration: 0.15, ease: 'back.out(2)',
                onComplete: () => resolve()
            });
        });
    }

    public update(delta: number) {
        this.animation.update(delta);
        this.sprite.texture = PIXI.Texture.from(this.animation.currentSpriteId);
        this.zIndex = this.y
    }

    public upgrade() {
        this.draw();
        this.pop();
        this.merged = false;
    }
}
