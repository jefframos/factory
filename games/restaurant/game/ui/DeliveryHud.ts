// DeliveryHud.ts
//
// The pizza delivery's 2D layer: the title and the deliveries (a pizza box each, ticked once it's there), the coins
// made, a hint line, the joystick (where the drag began, and the knob where the finger is), a banner across the middle,
// and the end card (the coins, CONTINUE).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { COIN_BAR, WARM, fillCoinBar, glossyButton, iconSprite, label, panel, popupPanel, tappable } from './UiParts';
import { modelIcon } from './Icons';
import { RestaurantAudio } from '../audio/RestaurantAudio';

const MARGIN = 28;
const PIPS = { size: 64, gap: 14, y: 96 };
/** The joystick: its ring's radius, the knob's. */
export const STICK = { radius: 90, knob: 38 };

type Point = { x: number; y: number };

export class DeliveryHud extends PIXI.Container {
    private readonly title = label(40);
    private readonly pips = new PIXI.Container();
    private readonly checks: PIXI.Sprite[] = [];
    private readonly coins = new PIXI.Container();
    private readonly coinText = label(COIN_BAR.textSize);
    private readonly hint = label(30);
    private hintTimer: gsap.core.Tween | null = null;
    private readonly stick = new PIXI.Container();
    private readonly knob = new PIXI.Graphics();
    private card: PIXI.Container | null = null;

    public constructor(deliveries: number) {
        super();
        this.title.text = 'PIZZA DELIVERY';
        fillCoinBar(this.coins, this.coinText);
        this.coinText.text = '0';
        for (let i = 0; i < deliveries; i++) {
            const holder = new PIXI.Container();
            holder.x = (i - (deliveries - 1) / 2) * (PIPS.size + PIPS.gap);
            const back = panel(PIPS.size, PIPS.size, 16, WARM.cream, 0.9);
            back.position.set(-PIPS.size / 2, -PIPS.size / 2);
            const icon = modelIcon('pizzabox_closed', PIPS.size - 10);
            const check = iconSprite('Icon_Check03_l', 34);
            check.position.set(PIPS.size / 2 - 8, PIPS.size / 2 - 8);
            check.visible = false;
            this.checks.push(check);
            holder.addChild(back, icon, check);
            this.pips.addChild(holder);
        }
        const ring = new PIXI.Graphics().lineStyle(6, 0xffffff, 0.55).beginFill(0x000000, 0.18).drawCircle(0, 0, STICK.radius).endFill();
        this.knob.beginFill(0xffffff, 0.85).drawCircle(0, 0, STICK.knob).endFill();
        this.stick.addChild(ring, this.knob);
        this.stick.visible = false;
        this.hint.visible = false;
        this.addChild(this.stick, this.title, this.pips, this.coins, this.hint);
        this.reposition();
    }

    private get screen() {
        return Game.overlayScreenData;
    }

    public reposition(): void {
        const screen = this.screen;
        if (!screen) return;
        this.title.position.set(screen.center.x, screen.topLeft.y + MARGIN + 18);
        this.pips.position.set(screen.center.x, screen.topLeft.y + MARGIN + PIPS.y);
        this.coins.position.set(screen.topLeft.x + MARGIN + COIN_BAR.icon / 2, screen.topLeft.y + MARGIN + 22);
        this.hint.position.set(screen.center.x, screen.topLeft.y + screen.height - MARGIN - 60);
        if (this.card) this.card.position.set(screen.center.x, screen.center.y);
    }

    /** `done` deliveries made (their boxes ticked). */
    public setDelivered(done: number): void {
        this.checks.forEach((check, i) => {
            const on = i < done;
            if (on && !check.visible) gsap.fromTo(check.parent!.scale, { x: 1.3, y: 1.3 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(3)' });
            check.visible = on;
        });
    }

    public setCoins(coins: number): void {
        this.coinText.text = String(coins);
        gsap.fromTo(this.coins.scale, { x: 1.2, y: 1.2 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(3)' });
    }

    /** The joystick at `from` (where the drag began: null hides it), its knob toward `at` (screen points). */
    public setStick(from: Point | null, at: Point | null): void {
        this.stick.visible = Boolean(from);
        if (!from) return;
        this.stick.position.copyFrom(this.toLocal(new PIXI.Point(from.x, from.y)));
        if (!at) {
            this.knob.position.set(0, 0);
            return;
        }
        const local = this.toLocal(new PIXI.Point(at.x, at.y));
        const dx = local.x - this.stick.x;
        const dy = local.y - this.stick.y;
        const length = Math.hypot(dx, dy);
        const reach = Math.min(length, STICK.radius) / Math.max(length, 1e-3);
        this.knob.position.set(dx * reach, dy * reach);
    }

    public showHint(text: string | null, seconds = 2.6): void {
        this.hintTimer?.kill();
        this.hint.visible = Boolean(text);
        if (!text) return;
        this.hint.text = text;
        gsap.fromTo(this.hint.scale, { x: 0.7, y: 0.7 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)' });
        this.hintTimer = gsap.delayedCall(seconds, () => {
            this.hint.visible = false;
        });
    }

    /** A big message across the middle, briefly. */
    public banner(text: string, sub: string): void {
        const screen = this.screen;
        const holder = new PIXI.Container();
        const big = label(72);
        big.text = text;
        const small = label(34);
        small.text = sub;
        small.y = 64;
        holder.addChild(big, small);
        holder.position.set(screen.center.x, screen.center.y - 120);
        this.addChild(holder);
        gsap.timeline({ onComplete: () => holder.destroy({ children: true }) })
            .from(holder.scale, { x: 0.3, y: 0.3, duration: 0.4, ease: 'back.out(2)' })
            .to(holder, { alpha: 0, duration: 0.35 }, 2.0);
    }

    /** "+coins" rising from `at` (a screen point). */
    public popCoins(coins: number, at: Point): void {
        const text = label(48, 0xffe066);
        text.text = `+${coins}`;
        text.position.copyFrom(this.toLocal(new PIXI.Point(at.x, at.y)));
        this.addChild(text);
        gsap.timeline({ onComplete: () => text.destroy() })
            .from(text.scale, { x: 0.3, y: 0.3, duration: 0.3, ease: 'back.out(3)' })
            .to(text, { y: text.y - 90, alpha: 0, duration: 0.9, ease: 'power1.in' }, 0.3);
    }

    /** All delivered: the card — the coins made, CONTINUE (`onContinue`). */
    public showDone(delivered: number, coins: number, onContinue: () => void): void {
        const card = new PIXI.Container();
        const shade = new PIXI.Graphics().beginFill(0x000000, 0.45).drawRect(-2000, -2000, 4000, 4000).endFill();
        shade.eventMode = 'static';
        const width = 520;
        const height = 500;
        const back = popupPanel(width, height, 'ALL DELIVERED!');
        const box = modelIcon('pizzabox_stacked', 140);
        box.y = -60;
        const words = label(34, WARM.cream);
        words.text = `${delivered} ${delivered === 1 ? 'pizza' : 'pizzas'} · +${coins} coins`;
        // (Its own row between the picture and the button: they used to overlap.)
        words.y = 55;
        const button = glossyButton(300, 100, 'CONTINUE', 'Button01_l_Green');
        button.y = height / 2 - 85;
        tappable(button, () => {
            RestaurantAudio.play('pick');
            gsap.to(card, { alpha: 0, duration: 0.2, onComplete: () => { card.destroy({ children: true }); this.card = null; onContinue(); } });
        });
        card.addChild(shade, back, box, words, button);
        this.card = card;
        this.addChild(card);
        this.reposition();
        gsap.from(card.scale, { x: 0.4, y: 0.4, duration: 0.4, ease: 'back.out(2)' });
    }

    public destroy(): void {
        this.hintTimer?.kill();
        gsap.killTweensOf([this.coins.scale]);
        super.destroy({ children: true });
    }
}
