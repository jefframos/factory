// UpgradeCard.ts
//
// One of the cannon's upgrades (fire rate, energy, recharge) as a card, on the end card and in the main screen's
// UPGRADES tab: a blue shop card (CardFrame03, as Ant's and UFO's shops) with the upgrade's name, its icon, a segmented
// bar of its levels (gold up to the one it's at), and a price button under it: green with the coin and the price when
// it can be bought, grey when there aren't the coins, MAX at the top. One that can be bought asks for the tap: it bobs,
// a green arrow bounces on its corner, and the bar's next segment blinks green.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UPGRADES, UpgradeKind } from '../data/MobConfig';
import { GlossyButton, framePlane, glossyButton, iconSprite, label, tappable } from './UiParts';

/** The card's size, its frames' tints, and where its parts sit (from its middle). */
export const UPGRADE_CARD = { width: 212, height: 236, outer: 0x3f8cff, inner: 0x93c2ff, frameScale: 0.7 };
const PARTS = { nameY: -88, nameSize: 22, iconY: -28, icon: 78, barY: 30, barHeight: 16, barGap: 3, barInset: 20, priceY: 80, priceHeight: 56, priceInset: 14 };
/** The bar's segments: reached, not yet, the next one blinking when it can be bought; and its outline. */
const SEGMENT = { on: 0xffd23f, off: 0x1c2c5c, next: 0x4cff7a, edge: 0x10123a };
/** The price: the coin's size and the gap to the number. */
const PRICE = { coin: 34, gap: 6, size: 28 };

export const UPGRADE_ICONS: Record<UpgradeKind, string> = { fire: 'Icon_Fire01', capacity: 'ItemIcon_Energy_Blue', recharge: 'Icon_Timer' };

/** An upgrade's state, as a card shows it: its level, and the next one's price (null at the top). */
export interface UpgradeState { level: number; cost: number | null }

export class UpgradeCard extends PIXI.Container {
    private readonly body = new PIXI.Container();
    private readonly bar = new PIXI.Graphics();
    private readonly price: GlossyButton;
    private readonly priceGroup = new PIXI.Container();
    private readonly coin = iconSprite('Image_Demo_Coin', PRICE.coin);
    private readonly cost = label(PRICE.size);
    private readonly arrow = iconSprite('Slider_Level02_Icon_Up_Green', 46);
    private level = 1;
    private canBuy = false;
    private time = Math.random() * 3;

    public constructor(public readonly kind: UpgradeKind, onBuy: (kind: UpgradeKind) => void) {
        super();
        const { width, height } = UPGRADE_CARD;
        const outer = framePlane('CardFrame03_n_Bg', width, height, UPGRADE_CARD.frameScale);
        outer.tint = UPGRADE_CARD.outer;
        outer.position.set(-width / 2, -height / 2);
        const inner = framePlane('CardFrame03_n_InnerBg', width - 24, height - 92, UPGRADE_CARD.frameScale);
        inner.tint = UPGRADE_CARD.inner;
        inner.position.set(-width / 2 + 12, -height / 2 + 46);
        const name = label(PARTS.nameSize);
        name.text = UPGRADES[kind].name;
        name.y = PARTS.nameY;
        const icon = iconSprite(UPGRADE_ICONS[kind], PARTS.icon);
        icon.y = PARTS.iconY;
        this.bar.y = PARTS.barY;
        this.price = glossyButton(width - PARTS.priceInset * 2, PARTS.priceHeight, '', 'Button01_l_Green');
        this.price.y = PARTS.priceY;
        this.coin.x = 0;
        this.cost.anchor.set(0, 0.5);
        this.cost.y = -3;
        this.priceGroup.addChild(this.coin, this.cost);
        this.price.addChild(this.priceGroup);
        this.arrow.position.set(width / 2 - 16, -height / 2 + 12);
        this.body.addChild(outer, inner, name, icon, this.bar, this.price, this.arrow);
        this.addChild(this.body);
        // The whole card is the button.
        this.body.hitArea = new PIXI.Rectangle(-width / 2, -height / 2, width, height);
        tappable(this.body, () => {
            if (!this.canBuy) {
                gsap.fromTo(this.body, { x: -6 }, { x: 0, duration: 0.3, ease: 'elastic.out(1.2, 0.3)' });
                return;
            }
            onBuy(kind);
        }, null);
    }

    /** Its level and price now, and whether there are the coins for it. */
    public set(state: UpgradeState, coins: number): void {
        const max = state.cost === null;
        const levelUp = state.level > this.level;
        this.level = state.level;
        this.canBuy = !max && coins >= (state.cost ?? Infinity);
        this.price.setFrame(max ? 'Button01_l_Sky' : this.canBuy ? 'Button01_l_Green' : 'Button01_l_Gray');
        this.coin.visible = !max;
        this.cost.text = max ? 'MAX' : `${state.cost}`;
        if (max) {
            this.cost.anchor.set(0.5, 0.5);
            this.cost.x = 0;
        } else {
            // The coin and the price, centred together.
            this.cost.anchor.set(0, 0.5);
            const total = PRICE.coin + PRICE.gap + this.cost.width;
            this.coin.x = -total / 2 + PRICE.coin / 2;
            this.cost.x = this.coin.x + PRICE.coin / 2 + PRICE.gap;
        }
        this.body.cursor = this.canBuy ? 'pointer' : 'default';
        this.arrow.visible = this.canBuy;
        this.drawBar(this.canBuy);
        if (levelUp) gsap.fromTo(this.body.scale, { x: 1.12, y: 1.12 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(3)' });
    }

    /** The levels as segments: gold up to the level, dark after; the next green (blinking) when it can be bought. */
    private drawBar(next: boolean, blink = 1): void {
        const max = UPGRADES[this.kind].max;
        const inner = UPGRADE_CARD.width - PARTS.barInset * 2;
        const width = (inner - PARTS.barGap * (max - 1)) / max;
        const h = PARTS.barHeight;
        const g = this.bar.clear();
        g.beginFill(SEGMENT.edge).drawRoundedRect(-inner / 2 - 3, -h / 2 - 3, inner + 6, h + 6, 7).endFill();
        for (let k = 0; k < max; k++) {
            const x = -inner / 2 + k * (width + PARTS.barGap);
            const reached = k < this.level;
            const upNext = next && k === this.level;
            g.beginFill(reached ? SEGMENT.on : upNext ? SEGMENT.next : SEGMENT.off, upNext ? 0.35 + 0.65 * blink : 1);
            g.drawRoundedRect(x, -h / 2, width, h, 3).endFill();
            // A little shine on the reached ones.
            if (reached) g.beginFill(0xffffff, 0.35).drawRoundedRect(x + 1, -h / 2 + 1, width - 2, h * 0.35, 2).endFill();
        }
    }

    /** Each frame: one that can be bought bobs, its arrow bounces, its next segment blinks. */
    public update(dt: number): void {
        this.time += dt;
        if (!this.canBuy) {
            this.body.y = 0;
            this.body.rotation = 0;
            return;
        }
        this.body.y = Math.sin(this.time * 4) * 3;
        this.body.rotation = Math.sin(this.time * 2.2) * 0.012;
        this.arrow.y = -UPGRADE_CARD.height / 2 + 12 - Math.abs(Math.sin(this.time * 5)) * 8;
        this.drawBar(true, 0.5 + 0.5 * Math.sin(this.time * 8));
    }
}
