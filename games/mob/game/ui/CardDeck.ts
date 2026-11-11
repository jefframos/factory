// CardDeck.ts
//
// The CARDS tab's page: BATTLE DECK — the arena deck's slots (DECK_SIZE; one with no card: a padlock, SOON), each card
// with its level and copies bar (CardTile) — and under it the COLLECTION: the cards the player has out of the deck,
// then the ones not found yet. A tap on a card opens its details (CardPopup: upgrade, use, remove). The deck goes to
// every battle, story and arena (HAND of it in hand, the rest coming in turn).

import * as PIXI from 'pixi.js';
import { DECK_SIZE, MobSave } from '../data/MobSave';
import { CARD_KINDS, CardKind } from '../data/Settings';
import { TILE, TILE_HEIGHT, cardTile, lockedTile } from './CardTile';
import { framePlane, killTweensDeep, label, tappable } from './UiParts';

const GRID = { gap: 12, rowGap: 22, headY: 0, deckY: 64, frame: 0x0d2147, framePad: 16 };
const PER_ROW = 6;

export class CardDeck extends PIXI.Container {
    private tall = 0;

    /** `onCard`: a card tapped (its details). */
    public constructor(private readonly onCard: (kind: CardKind) => void) {
        super();
        this.refresh();
    }

    public get contentHeight(): number {
        return this.tall;
    }

    public refresh(): void {
        killTweensDeep(this);
        this.removeChildren().forEach((child) => child.destroy({ children: true }));
        const rowWidth = PER_ROW * TILE.width + (PER_ROW - 1) * GRID.gap;
        const x = (i: number) => -rowWidth / 2 + TILE.width / 2 + (i % PER_ROW) * (TILE.width + GRID.gap);
        // The deck, on a darker frame.
        const deckTitle = label(30);
        deckTitle.text = 'BATTLE DECK';
        deckTitle.y = GRID.headY;
        const frameHeight = TILE_HEIGHT + GRID.framePad * 2;
        const frame = framePlane('BorderFrame_Round24', rowWidth + GRID.framePad * 2, frameHeight, 0.8);
        frame.tint = GRID.frame;
        frame.position.set(-rowWidth / 2 - GRID.framePad, GRID.deckY - GRID.framePad);
        this.addChild(deckTitle, frame);
        // Each slot: its card, or empty (a card's USE fills it).
        const slots = MobSave.deckSlots;
        const cardY = GRID.deckY + TILE.height / 2;
        for (let i = 0; i < DECK_SIZE; i++) {
            const kind = slots[i];
            const tile = kind ? cardTile(kind) : lockedTile(1, 'EMPTY', false);
            tile.position.set(x(i), cardY);
            if (kind) tappable(tile, () => this.onCard(kind));
            this.addChild(tile);
        }
        let y = GRID.deckY + frameHeight + 8;
        const hint = label(18, 0x9fb4ff);
        hint.text = 'Your deck goes to every battle · 4 in hand, the rest come in turn';
        hint.y = y + 12;
        this.addChild(hint);
        y += 64;
        // The collection: the rest the player has, then the ones to find.
        const bench = MobSave.bench;
        const missing = CARD_KINDS.filter((kind) => !MobSave.hasCard(kind));
        const owned = CARD_KINDS.length - missing.length;
        const collection = label(30);
        collection.text = 'COLLECTION';
        collection.y = y;
        const found = label(20, 0xffd23f);
        found.text = `FOUND ${owned}/${CARD_KINDS.length}`;
        found.y = y + 34;
        this.addChild(collection, found);
        y += 70;
        const rest: (CardKind | null)[] = [...bench, ...missing.map(() => null)];
        if (!rest.length) {
            const all = label(20, 0x9fb4ff);
            all.text = 'Every card you have is in your deck';
            all.y = y + 16;
            this.addChild(all);
            y += 40;
        }
        rest.forEach((kind, i) => {
            const tile = kind ? cardTile(kind) : lockedTile();
            tile.position.set(x(i), y + Math.floor(i / PER_ROW) * (TILE_HEIGHT + GRID.rowGap) + TILE.height / 2);
            if (kind) tappable(tile, () => this.onCard(kind));
            this.addChild(tile);
        });
        if (rest.length) y += Math.ceil(rest.length / PER_ROW) * (TILE_HEIGHT + GRID.rowGap);
        this.tall = y;
    }
}
