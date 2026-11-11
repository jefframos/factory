// CardPopup.ts
//
// A card's details (the CARDS tab, a card tapped): its face big, its name and level, its copies bar, each stat now and
// after the next level, and its buttons: UPGRADE (its gems; grey with "N MORE CARDS" while its copies are short, or
// with too few gems), and USE (into the arena deck) or REMOVE (out of it). The upgrade itself is UpgradeShow's moment.

import * as PIXI from 'pixi.js';
import { DECK_SIZE, MobSave } from '../data/MobSave';
import { CardKind, CardStat, cardMaxLevel, cardStat } from '../data/Settings';
import { CARD_NAMES, cardColour } from './CardFace';
import { TILE, cardTile } from './CardTile';
import { Overlay } from './Overlay';
import { glossyButton, iconSprite, label, plainLabel, tappable } from './UiParts';

export const STAT_NAMES: Record<CardStat, string> = { hp: 'HITS', damage: 'DAMAGE', seconds: 'CHARGE' };
/** Each stat's icon: a heart for its hits, a burst for its damage, the timer for its charge. */
export const STAT_ICONS: Record<CardStat, string> = { hp: 'ItemIcon_Heart_Red', damage: 'ItemIcon_Damage', seconds: 'Icon_Timer' };
/** A stat as shown: hits of 0 can't be destroyed (∞), the charge in seconds. */
export const shownStat = (stat: CardStat, value: number): string => (stat === 'hp' && value <= 0 ? '∞' : stat === 'seconds' ? `${value}s` : `${value}`);

const SIZE = { width: 560, height: 800 };
/** The stat rows: where the first sits, how far apart, how wide and tall. */
const STATS = { top: 140, step: 54, width: 420, height: 46 };

export interface CardActions {
    /** UPGRADE tapped (and it can be bought). */
    upgrade(kind: CardKind): void;
    /** USE (`instead`: the deck's card it replaces when the deck's full) or REMOVE. */
    use(kind: CardKind, instead?: CardKind): void;
    remove(kind: CardKind): void;
}

export class CardPopup extends Overlay {
    public constructor(private readonly kind: CardKind, private readonly actions: CardActions, onClose: () => void) {
        super(SIZE, onClose);
        MobSave.markSeen(kind);
        this.build();
    }

    private build(): void {
        const { kind } = this;
        const level = MobSave.cardLevel(kind);
        const max = cardMaxLevel(kind);
        this.panel.addChild(this.back(SIZE.width, SIZE.height, 0x1b2a5a));
        const header = new PIXI.Graphics().beginFill(cardColour(kind)).drawRoundedRect(-SIZE.width / 2 + 10, -SIZE.height / 2 + 10, SIZE.width - 20, 76, 18).endFill();
        const name = label(40);
        name.text = CARD_NAMES[kind];
        name.y = -SIZE.height / 2 + 46;
        this.panel.addChild(header, name, this.closeButton(SIZE.width, SIZE.height));
        const tile = cardTile(kind, 1.5);
        tile.y = -SIZE.height / 2 + 110 + TILE.height * 0.75;
        this.panel.addChild(tile);
        const levelText = label(26, 0xffd23f);
        levelText.text = level >= max ? `LEVEL ${level} · MAX` : `LEVEL ${level} → ${level + 1}`;
        levelText.y = 90;
        this.panel.addChild(levelText);
        // Its stats: now, and after the next level (green).
        let y = STATS.top;
        const next = level < max ? level + 1 : level;
        for (const stat of ['hp', 'damage', 'seconds'] as CardStat[]) {
            const now = cardStat(kind, stat, level);
            // (Hits of 0: it can't be destroyed: no row.)
            if (now === undefined || (stat === 'hp' && now <= 0)) continue;
            const after = cardStat(kind, stat, next)!;
            const half = STATS.width / 2;
            const row = new PIXI.Graphics().beginFill(0x10123a, 0.6).drawRoundedRect(-half, y - STATS.height / 2, STATS.width, STATS.height, 12).endFill();
            const icon = iconSprite(STAT_ICONS[stat], 38);
            icon.position.set(-half + 30, y);
            const statName = plainLabel(22, 0x9fb4ff);
            statName.anchor.set(0, 0.5);
            statName.text = STAT_NAMES[stat];
            statName.position.set(-half + 58, y);
            const value = label(24);
            value.anchor.set(1, 0.5);
            value.text = shownStat(stat, now);
            value.position.set(after !== now ? 90 : half - 16, y);
            this.panel.addChild(row, icon, statName, value);
            if (after !== now) {
                const change = label(24, 0x6dff8f);
                change.anchor.set(1, 0.5);
                const delta = Math.round((after - now) * 10) / 10;
                change.text = stat === 'seconds' ? `${delta}s` : `+${delta}`;
                change.position.set(half - 16, y);
                this.panel.addChild(change);
            }
            y += STATS.step;
        }
        this.buttons();
    }

    private buttons(): void {
        const { kind } = this;
        const cost = MobSave.cardCost(kind);
        const need = MobSave.copiesNeeded(kind);
        const short = need === null ? 0 : Math.max(0, need - MobSave.copies(kind));
        const can = MobSave.canUpgrade(kind);
        const y = SIZE.height / 2 - 70;
        const upgrade = glossyButton(250, 84, '', can ? 'Button01_l_Green' : 'Button01_l_Gray');
        if (cost === null) upgrade.words.text = 'MAX LEVEL';
        else if (short > 0) {
            upgrade.words.text = `${short} MORE CARD${short === 1 ? '' : 'S'}`;
            upgrade.words.scale.set(0.62);
        } else {
            upgrade.words.text = 'UPGRADE';
            upgrade.words.scale.set(0.6);
            upgrade.words.y = -18;
            const gem = iconSprite('ItemIcon_Gem_Diamond_Purple', 34);
            const price = label(26, MobSave.gems >= cost ? 0xffffff : 0xff8a96);
            price.anchor.set(0, 0.5);
            price.text = `${cost}`;
            const total = 30 + 6 + price.width;
            gem.position.set(-total / 2 + 15, 14);
            price.position.set(gem.x + 21, 13);
            upgrade.addChild(gem, price);
        }
        tappable(upgrade, () => {
            if (!MobSave.canUpgrade(kind)) return;
            this.actions.upgrade(kind);
        });
        // USE / REMOVE: into the arena deck or out of it.
        const inDeck = MobSave.deck.includes(kind);
        const swap = glossyButton(190, 84, inDeck ? 'REMOVE' : 'USE', inDeck ? 'Button01_l_Red' : 'Button01_l_Sky');
        swap.words.scale.set(0.8);
        const lone = inDeck && MobSave.deck.length <= 1;
        if (lone) swap.alpha = 0.45;
        tappable(swap, () => {
            if (inDeck) {
                if (!lone) this.actions.remove(kind);
                return;
            }
            const deck = MobSave.deck;
            // A full deck (no empty slot): the weakest card there makes way.
            const instead = deck.length >= DECK_SIZE ? [...deck].sort((a, b) => MobSave.cardLevel(a) - MobSave.cardLevel(b))[0] : undefined;
            this.actions.use(kind, instead);
        });
        upgrade.position.set(-110, y);
        swap.position.set(140, y);
        this.panel.addChild(upgrade, swap);
    }
}
