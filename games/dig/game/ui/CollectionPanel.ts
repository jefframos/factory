// CollectionPanel.ts
//
// The artifact totem's panel (GDD §11 discovery): every find in the game, a row per zone. Found ones
// show their model, name and how many were dug up (a NEW! badge until the panel has been opened once
// since); missing ones are a dark silhouette and "???", so the player knows what's still out there and
// roughly where. A bar counts the collection, and the footer names the reward for completing it.
// Styles come from ui/uikit.json (screen "collection").

import * as PIXI from 'pixi.js';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { ModelIcons } from './ModelIcons';
import { DIG, Rarity } from '../data/DigConfig';
import { DigProgress } from '../data/DigProgress';

const WIDTH = 500;
const HEIGHT = 790;
const CARD = 94;
const ROW_HEIGHT = 124;
const BAR_WIDTH = 300;

/** Frame tint per rarity, on the kit's grey card. */
export const RARITY_COLORS: Record<Rarity, number> = {
    common: 0xffffff,
    rare: 0x6fb4ff,
    epic: 0xc77dff,
    legendary: 0xffd23f,
};

export class CollectionPanel extends PIXI.Container {
    private readonly body = new PIXI.Container();

    public constructor() {
        super();
        const frame = UiKit.image('collection', 'panel', WIDTH, HEIGHT);
        const ribbon = UiKit.sprite('collection', 'ribbon', 0.55);
        ribbon.y = -HEIGHT / 2;
        const title = UiKit.text('collection', 'title');
        title.anchor.set(0.5);
        title.y = -HEIGHT / 2 - 5;
        // Taps on the panel must not fall through to the movement joystick underneath.
        frame.eventMode = 'static';
        frame.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.addChild(frame, ribbon, title, this.body);
        this.visible = false;
    }

    /** Builds the cards from the current progress; `newIds` get the NEW! badge. */
    public refresh(newIds: string[]): void {
        this.body.removeChildren().forEach((child) => child.destroy({ children: true }));
        const found = DigProgress.collectedCount;
        const total = DIG.finds.length;

        const progress = UiKit.text('collection', 'progress', { found, total });
        progress.anchor.set(0.5);
        progress.y = -HEIGHT / 2 + 62;
        const bar = new PIXI.Container();
        bar.y = -HEIGHT / 2 + 94;
        bar.addChild(UiKit.image('collection', 'barBack', BAR_WIDTH, 18));
        if (found > 0) {
            const width = Math.max(14, (BAR_WIDTH - 4) * (found / total));
            const fill = UiKit.image('collection', 'barFill', width, 14);
            fill.x = -(BAR_WIDTH - 4) / 2 + width / 2;
            bar.addChild(fill);
        }
        this.body.addChild(progress, bar);

        const top = -HEIGHT / 2 + 118;
        DIG.zones.forEach((zone, zoneIndex) => {
            const y = top + zoneIndex * ROW_HEIGHT;
            const reached = zoneIndex <= DigProgress.deepestZone;
            const label = UiKit.text('collection', 'zoneLabel', { name: reached ? zone.name.toUpperCase() : `${zone.name.toUpperCase()} (not reached)` });
            label.anchor.set(0.5, 0);
            label.y = y;
            this.body.addChild(label);
            const finds = DIG.finds.filter((find) => find.zone === zoneIndex);
            finds.forEach((find, i) => {
                const card = this.card(find.id, newIds.includes(find.id));
                card.position.set((i - (finds.length - 1) / 2) * (CARD + 40), y + 24 + CARD / 2);
                this.body.addChild(card);
            });
        });

        const reward = DIG.collectionReward;
        const footer = UiKit.text('collection', 'reward', {
            text: DigProgress.collectionDone
                ? 'COLLECTION COMPLETE! The Crown is yours (Wardrobe)'
                : `Find them all: $${reward.money.toLocaleString('en-US')} + the ${reward.hat} hat`,
        });
        footer.anchor.set(0.5);
        footer.y = HEIGHT / 2 - 26;
        this.body.addChild(footer);
    }

    private card(id: string, isNew: boolean): PIXI.Container {
        const find = DIG.finds.find((f) => f.id === id)!;
        const count = DigProgress.found[id] ?? 0;
        const card = new PIXI.Container();
        const frame = UiKit.image('collection', 'card', CARD, CARD);
        if (count > 0) {
            (frame.children[0] as PIXI.NineSlicePlane).tint = RARITY_COLORS[find.rarity];
        }
        const icon = ModelIcons.sprite(`./dig/models/${find.model}`, CARD * 0.66, count === 0);
        icon.y = -10;
        card.addChild(frame, icon);
        // The name sits inside the card's bottom edge, so rows can stack tightly.
        const name = count > 0 ? UiKit.text('collection', 'cardName', { name: find.name }) : UiKit.text('collection', 'missing');
        name.anchor.set(0.5, 1);
        name.y = CARD / 2 - 4;
        card.addChild(name);
        if (count > 0) {
            const amount = UiKit.text('collection', 'cardCount', { count });
            amount.anchor.set(1, 0);
            amount.position.set(CARD / 2 - 6, -CARD / 2 + 4);
            card.addChild(amount);
        }
        if (isNew) {
            const badge = new PIXI.Container();
            badge.position.set(-CARD / 2 + 14, -CARD / 2 + 4);
            badge.rotation = -0.25;
            const back = UiKit.sprite('collection', 'newBadge');
            back.scale.set(58 / Math.max(back.width, 1));
            const text = UiKit.text('collection', 'newLabel');
            text.anchor.set(0.5);
            badge.addChild(back, text);
            card.addChild(badge);
            UiAnim.pulse(badge, 0.12, 0.5);
        }
        return card;
    }
}
