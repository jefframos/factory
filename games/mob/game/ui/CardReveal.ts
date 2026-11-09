// CardReveal.ts
//
// A new card, revealed over the end card (the first time a unit's card is won): the screen goes dark, rays in the card's
// colour turn in behind a breathing glow, the card's back spins in and grows, flips with a white flash and a burst of
// confetti to show its face, NEW CARD! pops over it, its name under it; then TAP TO CONTINUE (the next new card, or
// back to the end card).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { MobAudio } from '../audio/MobAudio';
import { CardKind } from '../data/Settings';
import { CARD_NAMES, cardColour, cardFace } from './CardFace';
import { framePlane, iconSprite, label } from './UiParts';

/** The card's size, the rays', the confetti's colours. */
const CARD = { width: 250, height: 320 };
const RAYS = { size: 900, spin: 0.35 };
const CONFETTI = { count: 46, colours: [0xffd23f, 0xffffff, 0x4cdc6a, 0xff6b9e, 0x7ad7ff] };

export class CardReveal extends PIXI.Container {
    private readonly dim = new PIXI.Graphics();
    private readonly stage = new PIXI.Container();
    private queue: CardKind[] = [];
    private onDone: () => void = () => undefined;
    private rays: PIXI.Sprite | null = null;
    private canClose = false;
    /** Every tween of the card being shown (stopped before its pieces go: a tween left on a destroyed one throws). */
    private tweens: gsap.core.Animation[] = [];

    /** Its tween, kept to be stopped. */
    private keep<T extends gsap.core.Animation>(tween: T): T {
        this.tweens.push(tween);
        return tween;
    }

    /** Stops every tween of the card shown, then takes its pieces away. */
    private clear(): void {
        this.tweens.forEach((tween) => tween.kill());
        this.tweens = [];
        this.rays = null;
        this.stage.removeChildren().forEach((child) => child.destroy({ children: true }));
    }

    public constructor() {
        super();
        this.visible = false;
        this.dim.eventMode = 'static';
        this.dim.cursor = 'pointer';
        this.dim.on('pointertap', () => this.close());
        this.addChild(this.dim, this.stage);
    }

    /** Reveals each of `kinds` in turn, then `onDone`. */
    public play(kinds: readonly CardKind[], onDone: () => void = () => undefined): void {
        if (!kinds.length) {
            onDone();
            return;
        }
        this.queue = [...kinds];
        this.onDone = onDone;
        this.visible = true;
        this.layout();
        this.alpha = 0;
        gsap.to(this, { alpha: 1, duration: 0.25 });
        this.next();
    }

    public layout(): void {
        const screen = Game.gameScreenData;
        if (!screen) return;
        this.dim.clear().beginFill(0x05081c, 0.86).drawRect(screen.topLeft.x, screen.topLeft.y, screen.width, screen.height).endFill();
        this.stage.position.set(screen.center.x, screen.center.y - 30);
    }

    private next(): void {
        const kind = this.queue.shift();
        if (!kind) {
            gsap.to(this, { alpha: 0, duration: 0.25, onComplete: () => { this.clear(); this.visible = false; this.onDone(); } });
            return;
        }
        this.canClose = false;
        this.clear();
        const colour = cardColour(kind);
        // Behind it: rays in its colour, turning, and a glow breathing.
        const rays = iconSprite('Image_Effect_Rotate', RAYS.size);
        rays.tint = colour;
        rays.alpha = 0;
        this.rays = rays;
        const glow = iconSprite('Glow_Circle01', CARD.width * 2.6);
        glow.tint = colour;
        glow.alpha = 0;
        // The card: its back first (dark, a gold ?), its face after the flip.
        const card = new PIXI.Container();
        const back = new PIXI.Container();
        const backFrame = framePlane('CardFrame03_n_Bg', CARD.width, CARD.height, 1);
        backFrame.tint = 0x23285a;
        backFrame.position.set(-CARD.width / 2, -CARD.height / 2);
        const mark = label(150, 0xffd23f);
        mark.text = '?';
        back.addChild(backFrame, mark);
        const face = cardFace(kind, CARD.width, CARD.height, 0, 1);
        face.visible = false;
        const flash = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(-CARD.width / 2, -CARD.height / 2, CARD.width, CARD.height, 30).endFill();
        flash.alpha = 0;
        card.addChild(back, face, flash);
        const title = label(58, 0xffd23f);
        title.text = 'NEW CARD!';
        title.y = -CARD.height / 2 - 70;
        title.scale.set(0);
        const name = label(46);
        name.text = CARD_NAMES[kind];
        name.y = CARD.height / 2 + 46;
        name.alpha = 0;
        const hint = label(24, 0xc9d3ff);
        hint.text = 'Tap it in battle to send one out!';
        hint.y = CARD.height / 2 + 92;
        hint.alpha = 0;
        const tap = label(28);
        tap.text = 'TAP TO CONTINUE';
        tap.y = CARD.height / 2 + 150;
        tap.alpha = 0;
        const confetti = new PIXI.Container();
        this.stage.addChild(rays, glow, confetti, card, title, name, hint, tap);

        MobAudio.play('whoosh');
        card.scale.set(0.1);
        card.rotation = -Math.PI;
        const flip = this.keep(gsap.timeline());
        flip.to(rays, { alpha: 0.75, duration: 0.5 }, 0)
            .to(glow, { alpha: 0.6, duration: 0.5 }, 0)
            .to(card, { rotation: 0, duration: 0.6, ease: 'power2.out' }, 0)
            .to(card.scale, { x: 1, y: 1, duration: 0.6, ease: 'back.out(1.6)' }, 0)
            // The flip: edge on, the face swapped in, back round.
            .to(card.scale, { x: 0, duration: 0.18, ease: 'power2.in' }, 0.85)
            .call(() => {
                back.visible = false;
                face.visible = true;
                flash.alpha = 1;
                MobAudio.play('win');
                this.burst(confetti);
            })
            .to(card.scale, { x: 1.12, y: 1.12, duration: 0.3, ease: 'back.out(3)' })
            .to(flash, { alpha: 0, duration: 0.45 }, '<')
            .to(card.scale, { x: 1, y: 1, duration: 0.25 })
            .to(title.scale, { x: 1, y: 1, duration: 0.45, ease: 'back.out(3)' }, '<-0.2')
            .to([name, hint], { alpha: 1, duration: 0.3 }, '<')
            .call(() => { this.canClose = true; }, [], '+=0.35')
            .to(tap, { alpha: 1, duration: 0.3 });
        this.keep(gsap.to(glow.scale, { x: glow.scale.x * 1.12, y: glow.scale.y * 1.12, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
        this.keep(gsap.to(tap, { alpha: 0.35, duration: 0.6, yoyo: true, repeat: -1, delay: 2.4 }));
        this.keep(gsap.to(card, { y: -8, duration: 1.1, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 1.6 }));
    }

    /** Confetti bursting out from the card, falling and turning. */
    private burst(into: PIXI.Container): void {
        for (let n = 0; n < CONFETTI.count; n++) {
            const bit = new PIXI.Graphics().beginFill(CONFETTI.colours[n % CONFETTI.colours.length]).drawRect(-6, -3, 12, 6).endFill();
            const angle = (n / CONFETTI.count) * Math.PI * 2 + Math.random() * 0.3;
            const reach = 180 + Math.random() * 220;
            bit.rotation = Math.random() * Math.PI;
            into.addChild(bit);
            this.keep(gsap.to(bit, { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach * 0.8 + 120, rotation: bit.rotation + 6 + Math.random() * 6, duration: 1.4 + Math.random() * 0.6, ease: 'power2.out' }));
            this.keep(gsap.to(bit, { alpha: 0, duration: 0.5, delay: 1.2 + Math.random() * 0.5 }));
        }
    }

    private close(): void {
        if (!this.canClose) return;
        this.canClose = false;
        this.next();
    }

    public update(dt: number): void {
        if (this.visible && this.rays) this.rays.rotation += dt * RAYS.spin;
    }
}
