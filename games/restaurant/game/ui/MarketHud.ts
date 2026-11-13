// MarketHud.ts
//
// The supermarket's 2D layer: the title, the shopping list (a strip of cards across the bottom: a picture of each
// item to buy, ticked once it's in the basket), a name tag under each crate (the scene hands their screen points), a
// pointing hand (the first visit), a hint line (over the list), the "wrong item" card (TRY AGAIN) and the "all set" banner.
// The list sits at the bottom so it never covers the cashier at the back of the shop; it shrinks to fit a narrow screen.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { WARM, framePlane, glossyButton, iconSprite, label, plainLabel, tappable } from './UiParts';
import { modelIcon } from './Icons';
import { MarketItem } from '../data/Settings';
import { RestaurantAudio } from '../audio/RestaurantAudio';

const MARGIN = 28;
/** The list's cards; its frame reaches `above` over its middle and `below` under it (its heading's on top). */
const LIST = { card: 112, height: 120, gap: 10, icon: 76, above: 102, below: 74 };
/** Of the screen's height: what the list (and the hint over it) takes at the bottom, the title at the top (the camera
 *  frames the shop in between: MarketScene). */
export const MARKET_HUD_SHARE = { top: 0.1, bottom: 0.27 };

type Point = { x: number; y: number };

export class MarketHud extends PIXI.Container {
    private readonly title = label(46);
    private readonly list = new PIXI.Container();
    private readonly cards = new Map<string, { holder: PIXI.Container; check: PIXI.Sprite; icon: PIXI.Sprite }>();
    private readonly tags = new PIXI.Container();
    private readonly hint = label(30);
    private hintTimer: gsap.core.Tween | null = null;
    private readonly hand = iconSprite('tutorial_hand_3', 110);
    private handBase: Point | null = null;
    private card: PIXI.Container | null = null;
    /** The list's frame width (it's scaled down to fit the screen). */
    private listWidth = 0;

    public constructor() {
        super();
        this.title.text = 'SUPERMARKET';
        this.hint.visible = this.hand.visible = false;
        this.addChild(this.tags, this.title, this.list, this.hint, this.hand);
        this.reposition();
    }

    private get screen() {
        return Game.overlayScreenData;
    }

    public reposition(): void {
        const screen = this.screen;
        if (!screen) return;
        this.title.position.set(screen.center.x, screen.topLeft.y + MARGIN + 20);
        const scale = this.listWidth ? Math.min(1, (screen.width - MARGIN * 2) / this.listWidth) : 1;
        this.list.scale.set(scale);
        const listY = screen.topLeft.y + screen.height - MARGIN - LIST.below * scale;
        this.list.position.set(screen.center.x, listY);
        this.hint.position.set(screen.center.x, listY - LIST.above * scale - 34);
        if (this.card) this.card.position.set(screen.center.x, screen.center.y);
    }

    /** The shopping list's cards. */
    public showList(items: readonly MarketItem[]): void {
        this.list.removeChildren().forEach((c) => c.destroy({ children: true }));
        this.cards.clear();
        const total = items.length * LIST.card + (items.length - 1) * LIST.gap;
        const back = framePlane('BasicFrame_Round20', total + 28, LIST.above + LIST.below);
        back.position.set(-total / 2 - 14, -LIST.above);
        const heading = label(26, WARM.cream);
        heading.text = 'SHOPPING LIST';
        heading.y = -LIST.height / 2 - 20;
        this.list.addChild(back, heading);
        items.forEach((item, i) => {
            const holder = new PIXI.Container();
            holder.x = -total / 2 + LIST.card / 2 + i * (LIST.card + LIST.gap);
            holder.y = 12;
            const card = new PIXI.Graphics().beginFill(WARM.cream).drawRoundedRect(-LIST.card / 2, -LIST.height / 2 + 8, LIST.card, LIST.height - 16, 18).endFill();
            const icon = modelIcon(item.icon, LIST.icon);
            const check = iconSprite('Icon_Check03_l', 48);
            check.position.set(LIST.card / 2 - 16, LIST.height / 2 - 26);
            holder.addChild(card, icon, check);
            this.list.addChild(holder);
            this.cards.set(item.id, { holder, check, icon });
        });
        this.tickList(new Set());
        this.listWidth = total + 28;
        this.reposition();
    }

    /** Ticks the items in the basket. */
    public tickList(inBasket: ReadonlySet<string>): void {
        for (const [id, { holder, check, icon }] of this.cards) {
            const ticked = inBasket.has(id);
            if (ticked && !check.visible) gsap.fromTo(holder.scale, { x: 1.25, y: 1.25 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(3)' });
            check.visible = ticked;
            icon.alpha = ticked ? 0.55 : 1;
        }
    }

    /** A bought item's picture flying from `from` (screen) to its list card. */
    public flyBought(item: MarketItem, from: Point, done: () => void): void {
        const start = this.toLocal(new PIXI.Point(from.x, from.y));
        const card = this.cards.get(item.id);
        const end = card ? this.toLocal(card.holder.getGlobalPosition()) : start;
        const icon = modelIcon(item.icon, 90);
        icon.position.copyFrom(start);
        this.addChild(icon);
        gsap.timeline({ onComplete: () => { icon.destroy(); done(); } })
            .to(icon, { y: start.y - 60, duration: 0.15, ease: 'power2.out' })
            .to(icon, { x: end.x, y: end.y, duration: 0.35, ease: 'power2.in' })
            .to(icon.scale, { x: icon.scale.x * 0.7, y: icon.scale.y * 0.7, duration: 0.35, ease: 'power2.in' }, '<');
    }

    /** A name tag under each crate (screen points; null: off screen); each shrinks to fit `column` (screen px across). */
    public setTags(tags: { item: MarketItem; at: Point | null }[], column = Infinity): void {
        if (this.tags.children.length !== tags.length) {
            this.tags.removeChildren().forEach((c) => c.destroy({ children: true }));
            for (const { item } of tags) {
                const name = label(24);
                name.text = item.name.toUpperCase();
                this.tags.addChild(name);
            }
        }
        tags.forEach(({ at }, i) => {
            const tag = this.tags.children[i] as PIXI.Container;
            tag.visible = Boolean(at);
            if (!at) return;
            tag.position.copyFrom(this.toLocal(new PIXI.Point(at.x, at.y)));
            // Its width at full size (in this layer), against the column's (screen px into this layer's units).
            const room = column * 0.94 / (this.worldTransform.a || 1);
            const full = tag.width / (tag.scale.x || 1);
            tag.scale.set(Math.min(1, room / Math.max(1, full)));
        });
    }

    public showHint(text: string | null, seconds = 2.2): void {
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
        holder.position.set(screen.center.x, screen.center.y);
        this.addChild(holder);
        gsap.timeline({ onComplete: () => holder.destroy({ children: true }) })
            .from(holder.scale, { x: 0.3, y: 0.3, duration: 0.4, ease: 'back.out(2)' })
            .to(holder, { alpha: 0, duration: 0.35 }, 2.2);
    }

    /** The wrong item went in the basket: the card, and TRY AGAIN. */
    public showWrong(item: MarketItem, onRetry: () => void): void {
        const screen = this.screen;
        const card = new PIXI.Container();
        const shade = new PIXI.Graphics().beginFill(0x000000, 0.45).drawRect(-2000, -2000, 4000, 4000).endFill();
        shade.eventMode = 'static';
        const width = 500;
        const height = 470;
        const back = framePlane('BasicFrame_Round20', width, height);
        back.position.set(-width / 2, -height / 2);
        const title = label(58, 0xff7a66);
        title.text = 'WRONG ITEM!';
        title.y = -height / 2 + 62;
        const face = iconSprite('Emoji_Sample_2', 110);
        face.position.set(70, -30);
        const picture = modelIcon(item.icon, 120);
        picture.position.set(-70, -30);
        const cross = iconSprite('Icon_Close02', 60);
        cross.position.set(-30, 10);
        const words = plainLabel(32, WARM.ink);
        words.text = `${item.name} aren't on the list`;
        words.y = 80;
        const retry = glossyButton(300, 100, 'TRY AGAIN', 'Button01_l_Yellow');
        retry.y = height / 2 - 76;
        tappable(retry, () => {
            RestaurantAudio.play('click');
            this.card?.destroy({ children: true });
            this.card = null;
            onRetry();
        });
        card.addChild(shade, back, title, picture, cross, face, words, retry);
        card.position.set(screen.center.x, screen.center.y);
        this.addChild(card);
        this.card = card;
        gsap.from(card.scale, { x: 0.5, y: 0.5, duration: 0.35, ease: 'back.out(2)' });
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
        const base = { x: local.x + 30, y: local.y + 50 };
        if (this.handBase && Math.hypot(this.handBase.x - base.x, this.handBase.y - base.y) < 2) return;
        this.handBase = base;
        gsap.killTweensOf(this.hand);
        this.hand.position.set(base.x, base.y);
        gsap.to(this.hand, { y: base.y + 18, duration: 0.45, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }

    public override destroy(): void {
        gsap.killTweensOf(this.hand);
        this.hintTimer?.kill();
        super.destroy({ children: true });
    }
}
