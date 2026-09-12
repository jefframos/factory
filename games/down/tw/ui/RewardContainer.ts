// RewardContainer.ts

import SoundManager from 'core/audio/SoundManager';
import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import Assets from '../../Assets';
import { LocalConfettiBurst } from './LocalConfettiBurst';

/**
 * A treasure chest that jiggles, bursts open with confetti, and reveals
 * whatever's inside — used by LevelUpNotification to show the granted
 * powerup. Self-contained: this used to extend games/merge1's
 * BaseMergeEntity (walk/idle/breathing/shadow-baking entity FSM this chest
 * never actually used, and cross-game imports like that aren't valid here
 * anyway — each game folder is independent, see CLAUDE.md), which left
 * several undefined properties (this.sprite/spriteContainer/levelText/etc)
 * that would have thrown the moment this ran. The animation timeline/
 * positions in open()/initContainer() are otherwise unchanged.
 */
export class RewardContainer extends PIXI.Container {
    private readonly shine: PIXI.Sprite;
    private readonly spriteContainer = new PIXI.Container();
    private readonly frontChest = PIXI.Sprite.from(PIXI.Texture.WHITE);
    private readonly backChest = PIXI.Sprite.from(PIXI.Texture.WHITE);
    private readonly lidOpen = PIXI.Sprite.from(PIXI.Texture.WHITE);
    private readonly lidClose = PIXI.Sprite.from(PIXI.Texture.WHITE);
    private readonly confetti: LocalConfettiBurst;

    private isOpening = false;

    public constructor() {
        super();

        // Rotating shine, placed behind everything else.
        this.shine = PIXI.Sprite.from('Image_Effect_Rotate');
        this.shine.anchor.set(0.5);
        this.shine.alpha = 0.5;
        this.shine.blendMode = PIXI.BLEND_MODES.ADD;
        this.shine.scale.set(0.8);
        this.addChildAt(this.shine, 0);

        this.confetti = new LocalConfettiBurst(PIXI.Texture.WHITE, 40);

        this.addChild(this.spriteContainer);
        this.spriteContainer.addChild(this.backChest);
        this.backChest.addChild(this.confetti);
        this.backChest.addChild(this.frontChest);
        this.backChest.addChild(this.lidOpen);
        this.backChest.addChild(this.lidClose);
    }

    /** Resets to the closed, un-opened look — call every time the chest is (re)shown. */
    public initContainer(): void {
        this.isOpening = false;
        this.shine.visible = true;

        this.frontChest.texture = PIXI.Texture.from('chest-front');
        this.backChest.texture = PIXI.Texture.from('chest-inner');
        this.lidOpen.texture = PIXI.Texture.from('chest-lid-open');
        this.lidClose.texture = PIXI.Texture.from('chest-lid');

        this.backChest.anchor.set(0.5);
        this.frontChest.anchor.set(0.5, 0.1);
        this.lidOpen.anchor.set(0.5, 1);
        this.lidOpen.alpha = 0;
        this.lidClose.anchor.set(0.5, 0.8);
        this.lidClose.alpha = 1;
        this.lidClose.visible = true;

        this.backChest.y = -this.frontChest.height * 0.9;

        this.spriteContainer.alpha = 1;
        this.spriteContainer.scale.set(1);
        this.spriteContainer.position.set(0, 70);
    }

    /** Jiggle → explode (confetti) → lid pops open → settle → fade out. `onComplete` fires the instant the lid actually opens (see LevelUpNotification, which reveals the powerup icon/name at that point, well before the chest itself has finished fading). */
    public open(onComplete: () => void): void {
        if (this.isOpening) return;
        this.isOpening = true;
        this.shine.visible = false;

        SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.GateOpen);

        const tl = gsap.timeline({});

        // 1. Jiggle and Shrink (Anticipation) — builds for close to a full
        // second before anything actually happens, so the burst reads as a
        // payoff instead of firing the instant the popup appears.
        tl.to(this.spriteContainer, { x: -5, duration: 0.07, repeat: 7, yoyo: true, ease: 'sine.inOut' })
            .to(this.spriteContainer.scale, { x: 1.15, y: 0.75, duration: 0.22, ease: 'power1.out' })
            .to(this.spriteContainer.scale, { x: 1.08, y: 0.85, duration: 0.18, ease: 'sine.inOut' })

            // 2. Explode
            .add(() => {
                this.confetti.burst();
                SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Drop);
            })
            .to(this.lidOpen, {
                onStart: () => {
                    this.lidClose.visible = false;
                    this.lidOpen.visible = true;
                    this.lidOpen.alpha = 1;
                    onComplete?.();
                },
                y: -2,
                x: 8,
                rotation: 0,

                duration: 0.1,
                ease: 'power2.out',
            }, '-=0.05')
            .to(this.spriteContainer.scale, { x: 1, y: 1, duration: 0.55, ease: 'elastic.out' })
            // 3. Disappear
            .to(this.spriteContainer, {
                y: -20,
                alpha: 0,
                duration: 0.4,
                ease: 'power2.in',
            }, '+=0.5'); // Short delay so player sees the open chest
    }

    public update(delta: number): void {
        if (this.shine.visible) {
            this.shine.rotation += delta * 0.75;
            this.shine.y = this.backChest.y - (this.frontChest.height / 2);
        }

        this.confetti.update(delta * 50);
    }

    public reset(): void {
        this.isOpening = false;
        this.spriteContainer.alpha = 1;
        this.shine.visible = true;
        this.confetti.visible = false;
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        gsap.killTweensOf(this.spriteContainer);
        gsap.killTweensOf(this.spriteContainer.scale);
        gsap.killTweensOf(this.lidOpen);
        super.destroy(options ?? { children: true });
    }
}
