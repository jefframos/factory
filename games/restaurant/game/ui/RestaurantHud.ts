// RestaurantHud.ts
//
// The 2D layer over the restaurant: the coins and the day (top), the customer's order (a speech bubble over their head:
// the burger and what goes in it), the ticket while cooking (the order again, each part ticked once it's on the plate),
// the pan's cooking bar, a pointing hand (the first day: what to tap next), TRASH and SERVE, the customer's reaction
// (an emoji and the coins it paid), the restaurant's upgrade bar (StageBar) and the day's end (DayEnd: the chest).
// The coins at the top left are the day's tips so far. Where something follows a 3D point, the scene hands its
// screen position (CSS pixels) and the HUD puts it there.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { COIN_BAR, DARK, WARM, fillCoinBar, framePlane, glossyButton, iconSprite, label, plainLabel, tappable } from './UiParts';
import { foodIcon, modelIcon } from './Icons';
import { DayEnd } from './DayEnd';
import { StageBar } from './StageBar';
import { CONE_MODEL, ICE_CREAM_MODELS, Order, PART_MODELS, Part, SWIRL_MODELS } from '../data/Recipes';
import { RestaurantAudio } from '../audio/RestaurantAudio';

const MARGIN = 28;
const BUBBLE = { icon: 110, small: 74, gap: 10, pad: 22, lift: 40 };
const TICKET = { icon: 70, gap: 12, pad: 16, y: 120 };
const BUTTONS = { width: 230, height: 96, bottom: 90, apart: 140 };
const COOK_BAR = { width: 120, height: 22 };

type Point = { x: number; y: number };

export class RestaurantHud extends PIXI.Container {
    private readonly coins = new PIXI.Container();
    private readonly coinText = label(COIN_BAR.textSize);
    private readonly dayText = label(40);
    private readonly pips = new PIXI.Container();
    private readonly bubble = new PIXI.Container();
    private readonly ticket = new PIXI.Container();
    private ticketMarks = new Map<string, PIXI.Sprite>();
    private readonly hint = label(30);
    private hintTimer: gsap.core.Tween | null = null;
    private readonly cookBar = new PIXI.Container();
    private readonly cookFill = new PIXI.Graphics();
    /** Over a finished dish: done, tap it. */
    private readonly readyBadge = new PIXI.Container();
    private readonly hand = iconSprite('tutorial_hand_3', 110);
    private readonly trashButton = glossyButton(BUTTONS.width * 0.75, BUTTONS.height, 'TRASH', 'Button01_l_Gray');
    private readonly serveButton = glossyButton(BUTTONS.width, BUTTONS.height, 'SERVE', 'Button01_l_Green');
    private card: DayEnd | null = null;
    /** The restaurant's upgrade bar (top right). */
    public readonly stageBar = new StageBar(200, 30);
    private shownCoins = 0;
    /** Where the hand's bob starts (null: not pointing). */
    private handBase: { x: number; y: number } | null = null;

    public constructor(private readonly onTrash: () => void, private readonly onServe: () => void) {
        super();
        fillCoinBar(this.coins, this.coinText);
        this.addChild(this.stageBar, this.coins, this.dayText, this.pips, this.bubble, this.ticket, this.cookBar, this.readyBadge, this.hint, this.trashButton, this.serveButton, this.hand);
        this.buildCookBar();
        this.buildReadyBadge();
        tappable(this.trashButton, () => {
            RestaurantAudio.play('click');
            this.onTrash();
        });
        tappable(this.serveButton, () => {
            RestaurantAudio.play('click');
            this.onServe();
        });
        this.bubble.visible = this.ticket.visible = this.cookBar.visible = this.hand.visible = this.hint.visible = false;
        this.setButtons(false);
        this.reposition();
    }

    private buildCookBar(): void {
        const back = framePlane('ResourceBar_Single_Bg', COOK_BAR.width, COOK_BAR.height);
        back.tint = 0x3a2416;
        back.position.set(-COOK_BAR.width / 2, -COOK_BAR.height / 2);
        this.cookBar.addChild(back, this.cookFill);
    }

    /** The screen's corners in this layer. */
    private get screen() {
        return Game.overlayScreenData;
    }

    public reposition(): void {
        const screen = this.screen;
        if (!screen) return;
        this.coins.position.set(screen.topLeft.x + MARGIN + COIN_BAR.icon / 2, screen.topLeft.y + MARGIN + 22);
        this.dayText.position.set(screen.center.x, screen.topLeft.y + MARGIN + 18);
        this.pips.position.set(screen.center.x, screen.topLeft.y + MARGIN + 62);
        this.ticket.position.set(screen.center.x, screen.topLeft.y + TICKET.y);
        const bottom = screen.topLeft.y + screen.height - BUTTONS.bottom;
        this.hint.position.set(screen.center.x, bottom - BUTTONS.height / 2 - 40);
        this.trashButton.position.set(screen.center.x - BUTTONS.apart - 10, bottom);
        this.serveButton.position.set(screen.center.x + BUTTONS.apart - 30, bottom);
        this.stageBar.position.set(screen.topLeft.x + screen.width - MARGIN - 100, screen.topLeft.y + MARGIN + 34);
        this.card?.reposition();
    }

    // ---------------------------------------------------------------- top

    public setCoins(amount: number, animate = false): void {
        if (!animate) {
            this.shownCoins = amount;
            this.coinText.text = String(amount);
            return;
        }
        const state = { value: this.shownCoins };
        this.shownCoins = amount;
        gsap.to(state, { value: amount, duration: 0.6, ease: 'power1.out', onUpdate: () => { this.coinText.text = String(Math.round(state.value)); } });
        gsap.fromTo(this.coins.scale, { x: 1.15, y: 1.15 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(3)' });
    }

    /** "DAY n" and a pip per customer of the day: done ones green (served right) or red, the current one bigger. */
    public setDay(day: number, results: boolean[], total: number): void {
        this.dayText.text = `DAY ${day + 1}`;
        this.pips.removeChildren().forEach((c) => c.destroy());
        const gap = 34;
        for (let i = 0; i < total; i++) {
            const done = i < results.length;
            const pip = new PIXI.Graphics()
                .lineStyle(4, DARK)
                .beginFill(done ? (results[i] ? WARM.green : WARM.tomato) : WARM.cream)
                .drawCircle(0, 0, i === results.length ? 12 : 10)
                .endFill();
            pip.x = (i - (total - 1) / 2) * gap;
            this.pips.addChild(pip);
        }
    }

    // ---------------------------------------------------------------- the order

    /** The order as a row: the burger (big), then + and each topping; or the ice cream cone (its flavour's). */
    private orderRow(order: Order, big: number, small: number): PIXI.Container {
        const row = new PIXI.Container();
        const items: PIXI.DisplayObject[] = [order.iceCream ? modelIcon(ICE_CREAM_MODELS[order.iceCream], big) : foodIcon('burger', big)];
        for (const topping of order.toppings) items.push(foodIcon(topping, small));
        let x = 0;
        const widths = items.map((item, i) => (i === 0 ? big : small));
        const total = widths.reduce((a, b) => a + b, 0) + BUBBLE.gap * (items.length - 1);
        items.forEach((item, i) => {
            (item as PIXI.Sprite).position.set(-total / 2 + x + widths[i] / 2, 0);
            x += widths[i] + BUBBLE.gap;
            row.addChild(item);
        });
        return row;
    }

    /** The customer's speech bubble (over `at`: their head on screen). */
    public showOrder(order: Order, at: Point): void {
        this.bubble.removeChildren().forEach((c) => c.destroy({ children: true }));
        const row = this.orderRow(order, BUBBLE.icon, BUBBLE.small);
        const width = row.width + BUBBLE.pad * 2;
        const height = BUBBLE.icon + BUBBLE.pad;
        const back = framePlane('BasicFrame_Round20', width, height);
        back.position.set(-width / 2, -height - BUBBLE.lift);
        const tail = new PIXI.Graphics().beginFill(0xffffff).moveTo(-18, -BUBBLE.lift - 4).lineTo(18, -BUBBLE.lift - 4).lineTo(0, -BUBBLE.lift + 26).closePath().endFill();
        row.position.set(0, -BUBBLE.lift - height / 2);
        this.bubble.addChild(tail, back, row);
        this.bubble.visible = true;
        this.placeOrder(at);
        gsap.fromTo(this.bubble.scale, { x: 0.2, y: 0.2 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2.5)' });
    }

    public placeOrder(at: Point | null): void {
        if (!at) return;
        const local = this.toLocal(new PIXI.Point(at.x, at.y));
        const screen = this.screen;
        // Kept on screen.
        const half = this.bubble.width / 2 + 10;
        local.x = Math.max(screen.topLeft.x + half, Math.min(screen.topLeft.x + screen.width - half, local.x));
        this.bubble.position.copyFrom(local);
    }

    public hideOrder(): void {
        this.bubble.visible = false;
    }

    /**
     * The ticket at the top while cooking: the buns, the patty and the toppings, each ticked when it's on the plate (an ice
     * cream: the cone, then its flavour's swirl, ticked as they're done).
     */
    public showTicket(order: Order): void {
        this.ticket.removeChildren().forEach((c) => c.destroy({ children: true }));
        this.ticketMarks = new Map();
        const items: { key: string; model: string }[] = order.iceCream
            ? [{ key: 'cone', model: CONE_MODEL }, { key: order.iceCream, model: SWIRL_MODELS[order.iceCream] }]
            : (['bunBottom', 'patty', ...order.toppings, 'bunTop'] as Part[]).map((part) => ({ key: part, model: PART_MODELS[part] }));
        const width = items.length * TICKET.icon + (items.length - 1) * TICKET.gap + TICKET.pad * 2;
        const height = TICKET.icon + TICKET.pad * 2;
        const back = framePlane('BasicFrame_Round20', width, height);
        back.position.set(-width / 2, -height / 2);
        this.ticket.addChild(back);
        items.forEach(({ key, model }, i) => {
            const x = -width / 2 + TICKET.pad + TICKET.icon / 2 + i * (TICKET.icon + TICKET.gap);
            const icon = modelIcon(model, TICKET.icon);
            icon.x = x;
            const mark = iconSprite('Icon_Check03_l', 40);
            mark.position.set(x + TICKET.icon / 2 - 10, TICKET.icon / 2 - 10);
            mark.visible = false;
            this.ticketMarks.set(key, mark);
            this.ticket.addChild(icon, mark);
        });
        this.ticket.visible = true;
        gsap.fromTo(this.ticket, { alpha: 0 }, { alpha: 1, duration: 0.25 });
    }

    /** Ticks what's done (what's on the plate; an ice cream's cone and swirl). */
    public tickTicket(done: readonly string[]): void {
        for (const [key, mark] of this.ticketMarks) {
            const on = done.includes(key);
            if (on && !mark.visible) gsap.fromTo(mark.scale, { x: 0.1, y: 0.1 }, { x: mark.scale.x || 1, y: mark.scale.y || 1, duration: 0.3, ease: 'back.out(3)' });
            mark.visible = on;
        }
    }

    public hideTicket(): void {
        this.ticket.visible = false;
    }

    // ---------------------------------------------------------------- the bench

    private buildReadyBadge(): void {
        const glow = iconSprite('Glow_Circle01', 150);
        glow.tint = 0x7dff8a;
        glow.alpha = 0.8;
        const check = iconSprite('Icon_Check03_l', 72);
        const words = label(26);
        words.text = 'TAP TO SERVE';
        words.y = -58;
        this.readyBadge.addChild(glow, check, words);
        this.readyBadge.visible = false;
    }

    public setButtons(on: boolean): void {
        this.trashButton.visible = this.serveButton.visible = on;
    }

    /** The dish is done: the green check over it (at `at`; null: none), and SERVE pulsing. */
    public setReady(at: Point | null): void {
        const on = Boolean(at);
        if (on !== this.readyBadge.visible) {
            this.readyBadge.visible = on;
            gsap.killTweensOf(this.serveButton.scale);
            this.serveButton.scale.set(1);
            if (on) {
                gsap.fromTo(this.readyBadge.scale, { x: 0.2, y: 0.2 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(3)' });
                gsap.to(this.serveButton.scale, { x: 1.1, y: 1.1, duration: 0.4, yoyo: true, repeat: -1, ease: 'sine.inOut' });
            }
        }
        if (at) {
            const local = this.toLocal(new PIXI.Point(at.x, at.y));
            this.readyBadge.position.set(local.x, local.y + Math.sin(performance.now() / 180) * 8);
        }
    }

    /** The pan's cooking bar over `at` (null: hidden). */
    public setCooking(progress: number | null, at: Point | null): void {
        this.cookBar.visible = progress !== null && Boolean(at);
        if (!this.cookBar.visible || !at) return;
        this.cookBar.position.copyFrom(this.toLocal(new PIXI.Point(at.x, at.y)));
        const inner = COOK_BAR.width - 8;
        this.cookFill.clear().beginFill(0xf5a33a).drawRoundedRect(-inner / 2, -COOK_BAR.height / 2 + 4, Math.max(6, inner * progress!), COOK_BAR.height - 8, 6).endFill();
    }

    /** The hand pointing at `at` (null: hidden). */
    public pointAt(at: Point | null): void {
        this.hand.visible = Boolean(at);
        if (!at) {
            this.handBase = null;
            gsap.killTweensOf(this.hand);
            return;
        }
        const local = this.toLocal(new PIXI.Point(at.x, at.y));
        // Its fingertip (the sprite's top-left part) just below the spot; it bobs from there.
        const base = { x: local.x + 30, y: local.y + 50 };
        if (this.handBase && Math.hypot(this.handBase.x - base.x, this.handBase.y - base.y) < 2) return;
        this.handBase = base;
        gsap.killTweensOf(this.hand);
        this.hand.position.set(base.x, base.y);
        gsap.to(this.hand, { y: base.y + 18, duration: 0.45, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }

    // ---------------------------------------------------------------- reactions

    /** The customer's face over their head (happy or sad), and the coins it paid flying up. */
    public react(happy: boolean, at: Point, coins: number): void {
        const local = this.toLocal(new PIXI.Point(at.x, at.y));
        const face = iconSprite(happy ? 'Emoji_Sample_1' : 'Emoji_Sample_2', 130);
        face.position.set(local.x, local.y - 60);
        this.addChild(face);
        gsap.timeline({ onComplete: () => face.destroy() })
            .from(face.scale, { x: 0.1, y: 0.1, duration: 0.35, ease: 'back.out(3)' })
            .to(face, { y: face.y - 40, duration: 1.2, ease: 'power1.out' }, 0)
            .to(face, { alpha: 0, duration: 0.3 }, 1.3);
        if (coins <= 0) return;
        const pay = new PIXI.Container();
        const coin = iconSprite('ItemIcon_Money_Bill', 54);
        const text = label(44, 0xffe27a);
        text.text = `+${coins}`;
        text.anchor.set(0, 0.5);
        text.x = 32;
        pay.addChild(coin, text);
        pay.position.set(local.x - 40, local.y + 20);
        this.addChild(pay);
        gsap.timeline({ onComplete: () => pay.destroy({ children: true }) })
            .from(pay.scale, { x: 0.2, y: 0.2, duration: 0.3, ease: 'back.out(3)' })
            .to(pay, { y: pay.y - 70, duration: 1, ease: 'power1.out' }, 0)
            .to(pay, { alpha: 0, duration: 0.3 }, 1.1);
    }

    /** A big "DAY n" across the middle, briefly. */
    public banner(text: string, sub: string): void {
        const screen = this.screen;
        const holder = new PIXI.Container();
        const big = label(96);
        big.text = text;
        const small = label(38);
        small.text = sub;
        small.y = 74;
        holder.addChild(big, small);
        holder.position.set(screen.center.x, screen.center.y - 160);
        this.addChild(holder);
        gsap.timeline({ onComplete: () => holder.destroy({ children: true }) })
            .from(holder.scale, { x: 0.3, y: 0.3, duration: 0.4, ease: 'back.out(2)' })
            .to(holder, { alpha: 0, duration: 0.35 }, 1.6);
    }

    // ---------------------------------------------------------------- the day's end

    /** A line over the buttons for a moment (null: gone). */
    public showHint(text: string | null, seconds = 2): void {
        this.hintTimer?.kill();
        this.hint.visible = Boolean(text);
        if (!text) return;
        this.hint.text = text;
        gsap.fromTo(this.hint.scale, { x: 0.7, y: 0.7 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)' });
        this.hintTimer = gsap.delayedCall(seconds, () => {
            this.hint.visible = false;
        });
    }

    /** The day's end (DayEnd: the chest of tips into the bar, then the supermarket). */
    public showDayEnd(day: number, happy: number, total: number, pays: number[], from: { stage: number; progress: number }, onNext: () => void): void {
        this.card?.destroy();
        const card = new DayEnd(day, happy, total, pays, from, onNext);
        this.addChild(card);
        this.card = card;
    }

    public override destroy(): void {
        gsap.killTweensOf([this.serveButton.scale, this.readyBadge.scale]);
        gsap.killTweensOf(this.hand);
        super.destroy({ children: true });
    }
}
