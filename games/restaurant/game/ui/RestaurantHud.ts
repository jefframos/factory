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
import { COIN_BAR, DARK, WARM, TexBar, dot, fillCoinBar, panel, framePlane, glossyButton, iconSprite, label, pill, plainLabel, shape, sizePill, tappable } from './UiParts';
import { foodIcon, modelIcon, pizzaIcon, pizzaLayerIcon, sauceIcon, scoopIcon, sundaeIcon, sundaeToppingIcon } from './Icons';
import { DayEnd } from './DayEnd';
import { StageBar } from './StageBar';
import { CONE_MODEL, ICE_CREAM_MODELS, Order, PART_MODELS, PIZZA_LAYER_MODELS, PIZZA_OVEN_MODEL, PIZZA_SOURCE_MODELS, Part, SWIRL_MODELS, pizzaRecipe } from '../data/Recipes';

/** The ticket's picture of the pizza ordered (not a step: never ticked). */
const PREVIEW = 'preview';
import { RestaurantAudio } from '../audio/RestaurantAudio';

const MARGIN = 28;
/** How far down the HUD's top rows reach (the coins and day, then the dots and the upgrade bar): nothing goes over them. */
const TOP_ROWS = 120;
/** Room at the top right for the mute button (index.ts: always there), and the coins' size there. */
const MUTE_ROOM = 100;
const COINS_SCALE = 0.8;
const BUBBLE = { icon: 110, small: 74, gap: 10, pad: 22, lift: 40 };
/** The ticket: its pictures, the gaps, its padding, how far down (under the day's dots and the upgrade bar: never over them). */
const TICKET = { icon: 70, gap: 12, pad: 16, y: 168 };
const BUTTONS = { width: 230, height: 96, bottom: 90, apart: 140 };
const COOK_BAR = { width: 130, height: 28 };

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
    private readonly cookFill = new TexBar(COOK_BAR.width, COOK_BAR.height);
    /** Over a finished dish: done, tap it. */
    private readonly readyBadge = new PIXI.Container();
    /** The ready badge's arrow (pointing down at the dish). */
    private readyArrow: PIXI.Container | null = null;
    /** Over the pan when its patty's cooked: take it (the same yellow arrow, bouncing). */
    private readonly panArrow = new PIXI.Container();
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
        this.addChild(this.stageBar, this.coins, this.dayText, this.pips, this.bubble, this.ticket, this.cookBar, this.hint, this.trashButton, this.serveButton, this.readyBadge, this.hand);
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
        this.cookBar.addChild(this.cookFill);
    }

    /** The screen's corners in this layer. */
    private get screen() {
        return Game.overlayScreenData;
    }

    public reposition(): void {
        const screen = this.screen;
        if (!screen) return;
        // The coins at the top right, smaller, just left of the mute button (index.ts's: MUTE_ROOM); the upgrade bar at the
        // top left; the day in the middle.
        this.coins.scale.set(COINS_SCALE);
        this.coins.position.set(screen.topLeft.x + screen.width - MUTE_ROOM - (COIN_BAR.width + COIN_BAR.icon / 2) * COINS_SCALE, screen.topLeft.y + MARGIN + 22);
        this.dayText.position.set(screen.center.x, screen.topLeft.y + MARGIN + 18);
        this.pips.position.set(screen.center.x, screen.topLeft.y + MARGIN + 62);
        this.ticket.position.set(screen.center.x, screen.topLeft.y + TICKET.y);
        // A long ticket (a big sundae: up to eight pictures) shrinks to fit the screen's width.
        this.ticket.scale.set(1);
        if (this.ticket.width > screen.width - MARGIN * 2) this.ticket.scale.set((screen.width - MARGIN * 2) / this.ticket.width);
        const bottom = screen.topLeft.y + screen.height - BUTTONS.bottom;
        this.hint.position.set(screen.center.x, bottom - BUTTONS.height / 2 - 40);
        this.trashButton.position.set(screen.center.x - BUTTONS.apart - 10, bottom);
        this.serveButton.position.set(screen.center.x + BUTTONS.apart - 30, bottom);
        this.stageBar.position.set(screen.topLeft.x + MARGIN + 18 + 100, screen.topLeft.y + MARGIN + 34);
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
        gsap.fromTo(this.coins.scale, { x: COINS_SCALE * 1.15, y: COINS_SCALE * 1.15 }, { x: COINS_SCALE, y: COINS_SCALE, duration: 0.4, ease: 'back.out(3)' });
    }

    /** "DAY n" and a pip per customer of the day: done ones green (served right) or red, the current one bigger. */
    public setDay(day: number, results: boolean[], total: number): void {
        this.setPips(`DAY ${day + 1}`, results, total);
    }

    /** The top's words and its pips: one per `total`, the first `results` filled (green: right, red: wrong). */
    public setPips(title: string, results: readonly boolean[], total: number): void {
        this.dayText.text = title;
        this.pips.removeChildren().forEach((c) => c.destroy());
        const gap = 34;
        for (let i = 0; i < total; i++) {
            const done = i < results.length;
            const pip = dot(i === results.length ? 12 : 10, done ? (results[i] ? WARM.green : WARM.tomato) : WARM.cream, DARK, 4);
            pip.x = (i - (total - 1) / 2) * gap;
            this.pips.addChild(pip);
        }
    }

    // ---------------------------------------------------------------- the order

    /** The order as a row: the burger (big), then + and each topping; or the ice cream cone (its flavour's). */
    private orderRow(order: Order, big: number, small: number): PIXI.Container {
        const row = new PIXI.Container();
        // A pizza: the pizza they want (its picture, toppings and all), then each topping on its own.
        // A sundae: the one they want (its picture), then each scoop's flavour on its own (mint and vanilla look alike small).
        const items: PIXI.DisplayObject[] = [
            order.iceCream ? modelIcon(ICE_CREAM_MODELS[order.iceCream], big)
                : order.pizza ? pizzaIcon(order.pizza, big)
                    : order.sundae ? sundaeIcon(order.sundae, big)
                        : foodIcon('burger', big),
        ];
        for (const topping of order.toppings) items.push(foodIcon(topping, small));
        for (const topping of order.pizza ?? []) items.push(pizzaLayerIcon(topping, small));
        for (const flavor of order.sundae?.scoops ?? []) items.push(scoopIcon(flavor, small));
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
    public showOrder(order: Order, at: Point, caller: PIXI.Sprite | null = null): void {
        this.bubble.removeChildren().forEach((c) => c.destroy({ children: true }));
        let row: PIXI.Container = this.orderRow(order, BUBBLE.icon, BUBBLE.small);
        // A phone order: who's calling, at the bubble's start (the row's middle stays the bubble's).
        if (caller) {
            const content = new PIXI.Container();
            caller.width = caller.height = BUBBLE.icon;
            caller.x = -row.width / 2 - BUBBLE.gap - BUBBLE.icon / 2;
            content.addChild(caller, row);
            content.pivot.x = -(BUBBLE.icon + BUBBLE.gap) / 2;
            row = content;
        }
        const width = row.width + BUBBLE.pad * 2;
        const height = BUBBLE.icon + BUBBLE.pad;
        const back = framePlane('BasicFrame_Round20', width, height);
        back.position.set(-width / 2, -height - BUBBLE.lift);
        const tail = shape('bubbleTail', [-18, -BUBBLE.lift - 4, 18, -BUBBLE.lift - 4, 0, -BUBBLE.lift + 26], 0xffffff);
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
        // And under the top rows (the coins, the day's dots, the upgrade bar): its top no higher than TOP_ROWS.
        const above = BUBBLE.icon + BUBBLE.pad + BUBBLE.lift;
        local.y = Math.max(screen.topLeft.y + TOP_ROWS + above, local.y);
        this.bubble.position.copyFrom(local);
    }

    public hideOrder(): void {
        this.bubble.visible = false;
    }

    /**
     * The ticket at the top while cooking: the buns, the patty and the toppings, each ticked when it's on the plate (an ice
     * cream: the cone, then its flavour's swirl, ticked as they're done).
     */
    public showTicket(order: Order, fresh: readonly string[] = []): void {
        this.ticket.removeChildren().forEach((c) => c.destroy({ children: true }));
        this.ticketMarks = new Map();
        // Each: its key (what tickTicket ticks), and its picture (a model's, or `icon`).
        const sundae = order.sundae;
        const items: { key: string; model: string; icon?: (size: number) => PIXI.Sprite }[] = order.iceCream
            ? [{ key: 'cone', model: CONE_MODEL }, { key: order.iceCream, model: SWIRL_MODELS[order.iceCream] }]
            : order.pizza
                // A pizza: the pizza it should be (a picture, never ticked), its layers, then the oven (ticked when baked).
                ? [{ key: PREVIEW, model: '' }, ...pizzaRecipe(order.pizza).map((layer) => ({ key: layer, model: '', icon: (size: number) => pizzaLayerIcon(layer, size) })), { key: 'baked', model: PIZZA_OVEN_MODEL }]
                : sundae
                    // A sundae: its picture (never ticked), its cone or bowl, each scoop, its sauce, its toppings.
                    ? [
                        { key: PREVIEW, model: '', icon: (size) => sundaeIcon(sundae, size) },
                        { key: 'base', model: sundae.base === 'cone' ? 'icecream_cone' : 'icecream_bowl' },
                        ...sundae.scoops.map((flavor, i) => ({ key: `scoop${i}`, model: '', icon: (size: number) => scoopIcon(flavor, size) })),
                        ...(sundae.sauce ? [{ key: 'sauce', model: '', icon: (size: number) => sauceIcon(sundae.sauce!, size) }] : []),
                        ...sundae.toppings.map((topping) => ({ key: `topping:${topping}`, model: '', icon: (size: number) => sundaeToppingIcon(topping, size) })),
                    ]
                    : (['bunBottom', 'patty', ...order.toppings, 'bunTop'] as Part[]).map((part) => ({ key: part, model: PART_MODELS[part] }));
        const width = items.length * TICKET.icon + (items.length - 1) * TICKET.gap + TICKET.pad * 2;
        const height = TICKET.icon + TICKET.pad * 2;
        const back = framePlane('BasicFrame_Round20', width, height);
        back.position.set(-width / 2, -height / 2);
        this.ticket.addChild(back);
        items.forEach(({ key, model, icon: picture }, i) => {
            const x = -width / 2 + TICKET.pad + TICKET.icon / 2 + i * (TICKET.icon + TICKET.gap);
            const icon = picture ? picture(TICKET.icon) : key === PREVIEW && order.pizza ? pizzaIcon(order.pizza, TICKET.icon) : modelIcon(model, TICKET.icon);
            icon.x = x;
            this.ticket.addChild(icon);
            if (key === PREVIEW) return;
            const mark = iconSprite('Icon_Check03_l', 40);
            mark.position.set(x + TICKET.icon / 2 - 10, TICKET.icon / 2 - 10);
            mark.visible = false;
            this.ticketMarks.set(key, mark);
            this.ticket.addChild(mark);
            // Something the player hasn't had before: a NEW! tag over it, pulsing.
            if (fresh.includes(key)) {
                const tag = new PIXI.Container();
                const back = panel(64, 28, 12, WARM.tomato);
                back.position.set(-32, -14);
                const words = label(18);
                words.text = 'NEW!';
                tag.addChild(back, words);
                tag.position.set(x, -TICKET.icon / 2 - 14);
                this.ticket.addChild(tag);
                gsap.to(tag.scale, { x: 1.15, y: 1.15, duration: 0.4, yoyo: true, repeat: 7, ease: 'sine.inOut' });
            }
        });
        this.ticket.visible = true;
        this.reposition();
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
        const glow = iconSprite('Glow_Circle01', 190);
        glow.tint = 0x7dff8a;
        glow.alpha = 0.8;
        const check = iconSprite('Icon_Check03_l', 96);
        const words = label(26);
        words.text = 'TAP TO SERVE';
        words.y = -70;
        // A big arrow over it all, pointing down at the dish (bouncing: see setReady).
        const arrow = new PIXI.Container();
        arrow.addChild(shape('readyArrow', [-20, -80, 20, -80, 20, -32, 44, -32, 0, 10, -44, -32, -20, -32], 0xffd23f, 0x3a2408, 6));
        arrow.y = -112;
        this.readyArrow = arrow;
        this.readyBadge.addChild(glow, check, words, arrow);
        this.readyBadge.visible = false;
    }

    /** The phone orders minigame: no coins or upgrade bar (the pips count its boxes; the bubble, the ticket, the buttons and the rest stay). */
    public phoneMode(): void {
        // (The day's words and pips stay: they count the boxes — setPips.)
        this.stageBar.visible = this.coins.visible = false;
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
            const time = performance.now();
            this.readyBadge.position.set(local.x, local.y + Math.sin(time / 180) * 8);
            // The arrow bounces down at it, more than the badge does.
            if (this.readyArrow) this.readyArrow.y = -112 + Math.abs(Math.sin(time / 160)) * -22;
        }
    }

    /** The arrow over the pan (at `at`; null: hidden): its patty's cooked, take it. */
    public setPanReady(at: Point | null): void {
        if (!this.panArrow.children.length) {
            this.panArrow.addChild(shape('readyArrow', [-20, -80, 20, -80, 20, -32, 44, -32, 0, 10, -44, -32, -20, -32], 0xffd23f, 0x3a2408, 6));
            this.addChild(this.panArrow);
        }
        const on = Boolean(at);
        if (on && !this.panArrow.visible) gsap.fromTo(this.panArrow.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(3)' });
        this.panArrow.visible = on;
        if (!at) return;
        const local = this.toLocal(new PIXI.Point(at.x, at.y));
        this.panArrow.position.set(local.x, local.y - 40 + Math.abs(Math.sin(performance.now() / 160)) * -22);
    }

    /** The pan's cooking bar over `at` (null: hidden). */
    public setCooking(progress: number | null, at: Point | null): void {
        this.cookBar.visible = progress !== null && Boolean(at);
        if (!this.cookBar.visible || !at) return;
        this.cookBar.position.copyFrom(this.toLocal(new PIXI.Point(at.x, at.y)));
        this.cookFill.setShare(progress!);
    }

    /**
     * The hand pointing at `at` (null: hidden): from below, pointing up (the benches), or `above` it pointing down (a
     * customer, a plate on a table: so it doesn't cover them).
     */
    public pointAt(at: Point | null, above = false): void {
        this.hand.visible = Boolean(at);
        if (!at) {
            this.handBase = null;
            return;
        }
        const local = this.toLocal(new PIXI.Point(at.x, at.y));
        // Its fingertip (the sprite's top-left part) by the spot. From above: mirrored and turned a quarter (a hand coming
        // down from the upper left, its fingertip at its lower right) — not flipped upside down — clear of the "!" on the
        // right.
        const base = above ? { x: local.x - 50, y: local.y - 30 } : { x: local.x + 30, y: local.y + 50 };
        this.handBase = base;
        this.hand.scale.x = Math.abs(this.hand.scale.x) * (above ? -1 : 1);
        this.hand.scale.y = Math.abs(this.hand.scale.y);
        this.hand.rotation = above ? Math.PI / 2 : 0;
        // Followed every frame (the spot moves: the camera, a bobbing head), bobbing away from it and back.
        const bob = (Math.sin(performance.now() / 140) * 0.5 + 0.5) * 18;
        if (above) this.hand.position.set(base.x - bob * 0.6, base.y - bob * 0.6);
        else this.hand.position.set(base.x, base.y + bob);
    }

    // ---------------------------------------------------------------- reactions

    /** The customer's face over their head (happy or sad), and the coins it paid flying up. */
    /**
     * The customer's face over them: green (sunglasses) for a right dish served fast, blue for right, red for wrong; the
     * coins it paid flying up (a fast one: FAST! +bonus over the face).
     */
    public react(mood: 'fast' | 'right' | 'wrong', at: Point, coins: number, bonus = 0): void {
        const local = this.toLocal(new PIXI.Point(at.x, at.y));
        const face = iconSprite(mood === 'fast' ? 'Emoji_Sample_6' : mood === 'right' ? 'Emoji_Sample_1' : 'Emoji_Sample_7', 130);
        face.position.set(local.x, local.y - 60);
        this.addChild(face);
        if (mood === 'fast' && bonus > 0) {
            const fast = label(40, 0x7dff8a);
            fast.text = `FAST! +${bonus}`;
            fast.position.set(local.x, local.y - 150);
            this.addChild(fast);
            gsap.timeline({ onComplete: () => fast.destroy() })
                .from(fast.scale, { x: 0.2, y: 0.2, duration: 0.3, ease: 'back.out(3)' })
                .to(fast, { y: fast.y - 50, duration: 1.2, ease: 'power1.out' }, 0)
                .to(fast, { alpha: 0, duration: 0.3 }, 1.2);
        }
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
            .to(holder, { alpha: 0, duration: 0.3 }, 1.25);
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
    public showDayEnd(day: number, happy: number, total: number, pays: number[], from: { stage: number; progress: number }, onNext: () => void, next = 'SUPERMARKET', doubleTips?: () => Promise<boolean>): void {
        this.card?.destroy();
        const card = new DayEnd(day, happy, total, pays, from, onNext, next, doubleTips);
        this.addChild(card);
        this.card = card;
    }

    public override destroy(): void {
        gsap.killTweensOf([this.serveButton.scale, this.readyBadge.scale]);
        gsap.killTweensOf(this.hand);
        super.destroy({ children: true });
    }
}
