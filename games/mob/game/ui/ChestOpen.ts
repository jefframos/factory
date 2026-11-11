// ChestOpen.ts
//
// A chest opening (Clash Royale's): the chest in the middle, a counter of what's left on it; each tap, it bursts and the
// next thing flies out over it — the coins (and what the player has now), the gems, each card's copies (its tile: its
// level and copies bar, UPGRADE READY when it's enough) — then YOU GOT: all of it in a grid. A tap there closes it.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { MobAudio } from '../audio/MobAudio';
import { ChestKind, Loot, REWARDS } from '../data/ArenaRewards';
import { MobSave } from '../data/MobSave';
import { CardKind } from '../data/Settings';
import { CARD_NAMES } from './CardFace';
import { TILE, TILE_HEIGHT, cardTile } from './CardTile';
import { Overlay } from './Overlay';
import { MOMENT_LOOK } from './Pattern';
import { framePlane, iconSprite, killTweensDeep, label } from './UiParts';

const SIZE = { width: 640, height: 980 };
const CHEST = { size: 300, y: 200 };
const ITEM = { y: -220, size: 170 };
/** YOU GOT: the chest's size (a share of its own) and place at the top, the title's, the first row's middle, each
 *  thing's size and the room between rows. */
const SUMMARY = { chest: 0.45, chestY: -330, titleY: -210, firstRow: -60, size: 140, rowGap: 34 };

/** One thing out of a chest. */
type Item = { kind: 'coins'; amount: number } | { kind: 'gems'; amount: number } | { kind: 'card'; card: CardKind; amount: number };

export class ChestOpen extends Overlay {
    private readonly items: Item[] = [];
    private next = 0;
    private readonly chest: PIXI.Sprite;
    private readonly glow: PIXI.Sprite;
    private readonly counter = new PIXI.Container();
    private readonly counterText = label(34);
    private readonly shown = new PIXI.Container();
    private readonly tapText = label(24, 0xc9d3ff);
    private done = false;
    private busy = false;

    /** `kind`'s chest with `loot` in it (already the player's: this only shows it). */
    public constructor(kind: ChestKind, loot: Loot, onClose: () => void) {
        super(SIZE, onClose, 0.94, false);
        this.backdrop(MOMENT_LOOK);
        if (loot.coins > 0) this.items.push({ kind: 'coins', amount: loot.coins });
        if (loot.gems > 0) this.items.push({ kind: 'gems', amount: loot.gems });
        for (const [card, amount] of Object.entries(loot.cards) as [CardKind, number][]) if (amount > 0) this.items.push({ kind: 'card', card, amount });
        this.dim.on('pointertap', () => this.tap());
        this.panel.eventMode = 'none';
        this.glow = iconSprite('Glow_Circle01', 460);
        this.glow.tint = 0xffd23f;
        this.glow.alpha = 0.3;
        this.glow.y = CHEST.y;
        this.chest = iconSprite(REWARDS.chests[kind].icon, CHEST.size);
        this.chest.y = CHEST.y;
        const name = label(40, 0xffd23f);
        name.text = REWARDS.chests[kind].name.toUpperCase();
        name.y = -SIZE.height / 2 + 50;
        const badge = new PIXI.Graphics().beginFill(0xff3b4e).lineStyle(4, 0xffffff).drawRoundedRect(-28, -28, 56, 56, 12).endFill();
        this.counter.addChild(badge, this.counterText);
        this.counter.position.set(CHEST.size * 0.42, CHEST.y - CHEST.size * 0.36);
        this.tapText.text = 'TAP TO OPEN';
        this.tapText.y = SIZE.height / 2 - 40;
        gsap.to(this.tapText, { alpha: 0.4, duration: 0.6, yoyo: true, repeat: -1 });
        this.panel.addChild(this.glow, this.chest, this.counter, name, this.shown, this.tapText);
        this.setCounter();
        gsap.fromTo(this.chest, { y: CHEST.y - 400 }, { y: CHEST.y, duration: 0.5, ease: 'bounce.out' });
    }

    private setCounter(): void {
        this.counterText.text = `${this.items.length - this.next}`;
        this.counter.visible = this.next < this.items.length;
    }

    private tap(): void {
        if (this.busy) return;
        if (this.done) {
            this.close();
            return;
        }
        if (this.next >= this.items.length) {
            this.summary();
            return;
        }
        this.reveal(this.items[this.next++]);
        this.setCounter();
    }

    /** The chest bursts, `item` flies out over it, with its words beside. */
    private reveal(item: Item): void {
        this.busy = true;
        this.tapText.text = 'TAP';
        MobAudio.play(item.kind === 'card' ? 'confirm' : 'coins', 1 + Math.random() * 0.2);
        gsap.fromTo(this.chest.scale, { x: this.chest.scale.x * 1.15, y: this.chest.scale.y * 0.85 }, { x: this.chest.scale.x, y: this.chest.scale.y, duration: 0.3, ease: 'back.out(3)' });
        gsap.fromTo(this.glow, { alpha: 0.9 }, { alpha: 0.3, duration: 0.5 });
        killTweensDeep(this.shown);
        this.shown.removeChildren().forEach((child) => child.destroy({ children: true }));
        const picture = this.itemPicture(item, ITEM.size);
        const words = new PIXI.Container();
        const title = label(36);
        const sub = label(22, 0x9fd8ff);
        if (item.kind === 'card') {
            title.text = CARD_NAMES[item.card];
            const need = MobSave.copiesNeeded(item.card);
            sub.text = MobSave.upgradeReady(item.card) ? 'UPGRADE READY!' : need === null ? 'MAX LEVEL' : `${MobSave.copies(item.card)}/${need} CARDS`;
            if (MobSave.upgradeReady(item.card)) sub.tint = 0x6dff8f;
        } else {
            title.text = item.kind === 'coins' ? 'COINS' : 'GEMS';
            sub.text = `YOU HAVE ${item.kind === 'coins' ? MobSave.coins : MobSave.gems}`;
        }
        title.y = 140;
        sub.y = 184;
        words.addChild(title, sub);
        picture.y = ITEM.y;
        words.y = ITEM.y;
        this.shown.addChild(picture, words);
        gsap.fromTo(picture, { y: CHEST.y }, { y: ITEM.y, duration: 0.35, ease: 'back.out(1.6)' });
        gsap.fromTo(picture.scale, { x: 0.2, y: 0.2 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(1.6)', onComplete: () => { this.busy = false; } });
        words.alpha = 0;
        gsap.to(words, { alpha: 1, duration: 0.25, delay: 0.2 });
    }

    /** A thing's picture: coins / gems on a light card with the amount, or the card's tile with ×N. */
    private itemPicture(item: Item, size: number): PIXI.Container {
        const holder = new PIXI.Container();
        if (item.kind === 'card') {
            const tile = cardTile(item.card, size / 150);
            const count = label(size * 0.2, 0xffffff);
            count.text = `×${item.amount}`;
            count.position.set(0, -size * 0.18);
            holder.addChild(tile, count);
            return holder;
        }
        const back = framePlane('BorderFrame_Round24', size * 0.78, size, 0.8);
        back.tint = 0xf4f7ff;
        back.position.set(-size * 0.39, -size / 2);
        const icon = iconSprite(item.kind === 'coins' ? 'ItemIcon_Money_Coin' : 'ItemIcon_Gem_Diamond_Purple', size * 0.55);
        icon.y = -size * 0.08;
        const amount = label(size * 0.2);
        amount.text = `+${item.amount}`;
        amount.y = size * 0.32;
        holder.addChild(back, icon, amount);
        return holder;
    }

    /** YOU GOT: everything, in a grid under the chest. */
    private summary(): void {
        this.done = true;
        killTweensDeep(this.shown);
        this.shown.removeChildren().forEach((child) => child.destroy({ children: true }));
        // The chest goes small at the top (out of the grid's way), YOU GOT under it, the grid under that: each row as
        // tall as a card with its copies bar (taller than the coins' and gems').
        gsap.killTweensOf([this.chest, this.chest.scale, this.glow]);
        const small = this.chest.scale.x * SUMMARY.chest;
        gsap.to(this.chest, { y: SUMMARY.chestY, duration: 0.3, ease: 'power2.out' });
        gsap.to(this.chest.scale, { x: small, y: small, duration: 0.3, ease: 'power2.out' });
        gsap.to(this.glow, { y: SUMMARY.chestY, alpha: 0.2, duration: 0.3 });
        const title = label(40, 0x9fd8ff);
        title.text = 'YOU GOT:';
        title.y = SUMMARY.titleY;
        this.shown.addChild(title);
        const per = 3;
        const size = SUMMARY.size;
        const rowStep = size * (TILE_HEIGHT / TILE.height) + SUMMARY.rowGap;
        this.items.forEach((item, i) => {
            const picture = this.itemPicture(item, size);
            const row = Math.floor(i / per);
            const inRow = Math.min(per, this.items.length - row * per);
            picture.position.set((i % per - (inRow - 1) / 2) * (size * 0.95 + 16), SUMMARY.firstRow + row * rowStep);
            this.shown.addChild(picture);
            gsap.fromTo(picture.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.3, delay: i * 0.08, ease: 'back.out(2.5)' });
        });
        this.tapText.text = 'TAP TO CONTINUE';
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        gsap.killTweensOf([this.tapText, this.chest, this.chest.scale, this.glow]);
        this.shown.children.forEach((child) => {
            gsap.killTweensOf(child);
            gsap.killTweensOf(child.scale);
        });
        super.destroy(options);
    }
}
