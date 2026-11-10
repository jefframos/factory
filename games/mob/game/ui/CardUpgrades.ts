// CardUpgrades.ts
//
// The unit cards' levels, in the main screen's UPGRADES tab (under the cannon's): a tile for each card. One the player
// has: its face (CardFace), its name, its level (LV 3/10 and a segmented bar), what its next level does to each of its
// stats (HITS 26 → 29, DAMAGE, CHARGE), and the price button in gems (green with the gems, grey without, MAX at the top): a tap
// buys the next level. One not won yet: dark, a padlock, and how to win it.

import * as PIXI from 'pixi.js';
import { MobSave } from '../data/MobSave';
import { CARD_KINDS, CardKind, CardStat, cardMaxLevel, cardStat } from '../data/Settings';
import { CARD_NAMES, cardColour, cardFace } from './CardFace';
import { GlossyButton, framePlane, glossyButton, iconSprite, label, plainLabel, tappable } from './UiParts';

/** A tile's size and the gap between them (two to a row), the face's size, the price button's. */
export const CARD_TILE = { width: 324, height: 240, gap: 14, face: { width: 112, height: 160 }, price: { width: 170, height: 54 } };
const STAT_NAMES: Record<CardStat, string> = { hp: 'HITS', damage: 'DAMAGE', seconds: 'CHARGE' };
const SEGMENT = { on: 0xffd23f, off: 0x1c2c5c, edge: 0x10123a, height: 12, gap: 2 };

/** A stat as shown: hits of 0 can't be destroyed (∞), the charge in seconds. */
const shown = (stat: CardStat, value: number): string => (stat === 'hp' && value <= 0 ? '∞' : stat === 'seconds' ? `${value}s` : `${value}`);

export class CardUpgrades extends PIXI.Container {
    /** `onBuy`: a card's next level tapped (bought if there are the gems). */
    public constructor(private readonly onBuy: (kind: CardKind) => void) {
        super();
        this.refresh();
    }

    /** The tiles, as the save has it now. */
    public refresh(): void {
        this.removeChildren().forEach((child) => child.destroy({ children: true }));
        CARD_KINDS.forEach((kind, i) => {
            const tile = MobSave.hasCard(kind) ? this.ownedTile(kind) : this.lockedTile(kind);
            tile.position.set((i % 2 === 0 ? -1 : 1) * (CARD_TILE.width + CARD_TILE.gap) / 2, Math.floor(i / 2) * (CARD_TILE.height + CARD_TILE.gap) + CARD_TILE.height / 2);
            this.addChild(tile);
        });
    }

    /** How tall the tiles are, all of them. */
    public get tilesHeight(): number {
        return Math.ceil(CARD_KINDS.length / 2) * (CARD_TILE.height + CARD_TILE.gap);
    }

    private back(colour: number, inner: number): PIXI.Container {
        const holder = new PIXI.Container();
        const outer = framePlane('CardFrame03_n_Bg', CARD_TILE.width, CARD_TILE.height, 0.6);
        outer.tint = colour;
        outer.position.set(-CARD_TILE.width / 2, -CARD_TILE.height / 2);
        const panel = framePlane('CardFrame03_n_InnerBg', CARD_TILE.width - 20, CARD_TILE.height - 20, 0.6);
        panel.tint = inner;
        panel.position.set(-CARD_TILE.width / 2 + 10, -CARD_TILE.height / 2 + 10);
        holder.addChild(outer, panel);
        return holder;
    }

    private ownedTile(kind: CardKind): PIXI.Container {
        const level = MobSave.cardLevel(kind);
        const max = cardMaxLevel(kind);
        const cost = MobSave.cardCost(kind);
        const canBuy = cost !== null && MobSave.gems >= cost;
        const tile = new PIXI.Container();
        tile.addChild(this.back(cardColour(kind), 0x93c2ff));
        const faceX = -CARD_TILE.width / 2 + 14 + CARD_TILE.face.width / 2;
        const face = cardFace(kind, CARD_TILE.face.width, CARD_TILE.face.height);
        face.x = faceX;
        tile.addChild(face);
        const left = faceX + CARD_TILE.face.width / 2 + 14;
        const name = plainLabel(26, 0x10123a);
        name.anchor.set(0, 0.5);
        name.text = CARD_NAMES[kind];
        name.position.set(left, -CARD_TILE.height / 2 + 30);
        const levelText = plainLabel(18, 0x23306a);
        levelText.anchor.set(1, 0.5);
        levelText.text = `LV ${level}/${max}`;
        levelText.position.set(CARD_TILE.width / 2 - 18, -CARD_TILE.height / 2 + 32);
        // Its levels as segments.
        const bar = new PIXI.Graphics();
        const barWidth = CARD_TILE.width / 2 - 18 - left;
        const segment = (barWidth - SEGMENT.gap * (max - 1)) / max;
        bar.beginFill(SEGMENT.edge).drawRoundedRect(left - 2, -CARD_TILE.height / 2 + 50, barWidth + 4, SEGMENT.height + 4, 6).endFill();
        for (let k = 0; k < max; k++) bar.beginFill(k < level ? SEGMENT.on : SEGMENT.off).drawRoundedRect(left + k * (segment + SEGMENT.gap), -CARD_TILE.height / 2 + 52, segment, SEGMENT.height, 3).endFill();
        tile.addChild(name, levelText, bar);
        // Each stat now, and after the next level.
        let y = -CARD_TILE.height / 2 + 86;
        for (const stat of ['hp', 'damage', 'seconds'] as CardStat[]) {
            const now = cardStat(kind, stat, level);
            if (now === undefined) continue;
            const next = cost !== null ? cardStat(kind, stat, level + 1)! : now;
            const line = plainLabel(18, 0x10123a);
            line.anchor.set(0, 0.5);
            line.text = `${STAT_NAMES[stat]}  ${shown(stat, now)}${next !== now ? `  →  ${shown(stat, next)}` : ''}`;
            line.position.set(left, y);
            tile.addChild(line);
            y += 24;
        }
        // The price.
        const price: GlossyButton = glossyButton(CARD_TILE.price.width, CARD_TILE.price.height, cost === null ? 'MAX' : '', cost === null ? 'Button01_l_Sky' : canBuy ? 'Button01_l_Green' : 'Button01_l_Gray');
        price.position.set(CARD_TILE.width / 2 - 14 - CARD_TILE.price.width / 2, CARD_TILE.height / 2 - 14 - CARD_TILE.price.height / 2);
        if (cost !== null) {
            const coin = iconSprite('Icon_Gem', 30);
            const amount = label(24);
            amount.anchor.set(0, 0.5);
            amount.text = `${cost}`;
            const total = 30 + 6 + amount.width;
            coin.x = -total / 2 + 15;
            amount.position.set(coin.x + 21, -3);
            price.addChild(coin, amount);
        }
        tile.addChild(price);
        tile.hitArea = new PIXI.Rectangle(-CARD_TILE.width / 2, -CARD_TILE.height / 2, CARD_TILE.width, CARD_TILE.height);
        tappable(tile, () => this.onBuy(kind), null);
        return tile;
    }

    /** A card not won yet: a mystery (which unit it is isn't told), its padlock and the words centred. */
    private lockedTile(_kind: CardKind): PIXI.Container {
        const tile = new PIXI.Container();
        tile.addChild(this.back(0x1c2c5c, 0x2c4380));
        const lock = iconSprite('Icon_Lock03', 78);
        lock.y = -36;
        const name = plainLabel(34, 0xc3cdea);
        name.text = '???';
        name.y = 34;
        const hint = plainLabel(18, 0x9aa6d6);
        hint.text = 'Keep playing to find it';
        hint.y = 70;
        tile.addChild(lock, name, hint);
        return tile;
    }
}
