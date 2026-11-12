// CardDeck.ts
//
// The CARDS tab's page: BATTLE DECK in two rows — STORY (the story cards: story battles bring this row alone) and VERSUS
// ONLY (the rest: versus brings both rows, 4 in hand, the rest coming in turn), each its own colour and tag; an empty
// slot says so — each card with its level and copies bar (CardTile). Under it the COLLECTION: the cards the player has
// out of the deck, then the ones not found yet. A tap on a card opens its details (CardPopup: upgrade, use, remove).

import * as PIXI from 'pixi.js';
import { DECK_SIZE, MobSave, STORY_ROW } from '../data/MobSave';
import { CARD_KINDS, CardKind } from '../data/Settings';
import { TILE, TILE_HEIGHT, cardTile, lockedTile } from './CardTile';
import { framePlane, killTweensDeep, label, tappable } from './UiParts';

const GRID = { gap: 12, rowGap: 22, headY: 0, deckY: 64, frame: 0x0d2147, framePad: 16 };
const PER_ROW = 6;
/** The deck's two rows: each one's tag (over its frame, on the left), its frame's tint, and the room between them. */
const DECK_ROWS = [
    { tag: 'STORY · STORY AND VERSUS', colour: 0x2fd35c, frame: 0x0f3a2a },
    { tag: 'VERSUS ONLY', colour: 0xa86bff, frame: 0x24164a },
];
const ROW_TAG = { height: 34, size: 20, gap: 8 };

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
        const deckTitle = label(30);
        deckTitle.text = 'BATTLE DECK';
        deckTitle.y = GRID.headY;
        this.addChild(deckTitle);
        // The deck's two rows, each on its own tinted frame under its tag: the story's, then versus'.
        const slots = MobSave.deckSlots;
        const deckWidth = STORY_ROW * TILE.width + (STORY_ROW - 1) * GRID.gap;
        const deckX = (k: number) => -deckWidth / 2 + TILE.width / 2 + k * (TILE.width + GRID.gap);
        const frameHeight = TILE_HEIGHT + GRID.framePad * 2;
        let y = GRID.deckY - 24;
        DECK_ROWS.forEach((row, r) => {
            const tag = label(ROW_TAG.size, row.colour);
            tag.anchor.set(0, 0.5);
            tag.text = row.tag;
            tag.position.set(-deckWidth / 2 - GRID.framePad + 4, y + ROW_TAG.height / 2);
            y += ROW_TAG.height + ROW_TAG.gap;
            const frame = framePlane('BorderFrame_Round24', deckWidth + GRID.framePad * 2, frameHeight, 0.8);
            frame.tint = row.frame;
            frame.position.set(-deckWidth / 2 - GRID.framePad, y);
            this.addChild(tag, frame);
            for (let k = 0; k < STORY_ROW; k++) {
                const i = r * STORY_ROW + k;
                if (i >= DECK_SIZE) break;
                const kind = slots[i];
                // An empty slot says what goes there.
                const tile = kind ? cardTile(kind) : lockedTile(1, r === 0 ? 'STORY\nCARD' : 'EMPTY', false);
                tile.position.set(deckX(k), y + GRID.framePad + TILE.height / 2);
                if (kind) tappable(tile, () => this.onCard(kind));
                this.addChild(tile);
            }
            y += frameHeight + 14;
        });
        const hint = label(18, 0x9fb4ff);
        hint.text = 'Story battles bring the top row · Versus brings both (4 in hand, the rest come in turn)';
        hint.y = y + 6;
        hint.scale.set(Math.min(1, (rowWidth + 20) / Math.max(1, hint.width)));
        this.addChild(hint);
        y += 58;
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
