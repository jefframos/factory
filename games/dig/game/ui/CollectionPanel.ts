// CollectionPanel.ts
//
// The artifact totem's panel (GDD §11 discovery): every find in the game in rows of 3 under their zone's name,
// ROWS_PER_PAGE rows a page (arrows to flip; it opens on the first page, or the one with something new). Found ones
// show their model, name and how many were dug up (a NEW! badge until the panel has been opened once
// since); missing ones are a dark silhouette and "???", so the player knows what's still out there and
// roughly where. A bar counts the collection, and the footer names the reward for completing it.
// Styles come from ui/uikit.json (screen "collection").

import * as PIXI from 'pixi.js';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { ModelIcons } from './ModelIcons';
import { DIG, FindDef, Rarity } from '../data/DigConfig';
import { DigProgress } from '../data/DigProgress';
import { t, names } from '../i18n/Localization';
import { DigAudio } from '../audio/DigAudio';

const WIDTH = 640;
const HEIGHT = 624;
/** Frame size, for the HUD to fit the panel on screen. */
export const COLLECTION_SIZE = { width: WIDTH, height: HEIGHT };
/** Cards are wide (filling the panel's width), so long names fit. */
const CARD = 150;
const CARD_W = 180;
const CARD_GAP = 20;
const ROW_HEIGHT = 192;
const BAR_WIDTH = 300;
const PER_ROW = 3;
const ROWS_PER_PAGE = 2;
/** Each zone's finds split into rows of PER_ROW (a zone with 6 finds takes two rows). */
const ROWS: { zone: number; finds: FindDef[] }[] = DIG.zones.flatMap((_, zone) => {
    const finds = DIG.finds.filter((find) => find.zone === zone);
    return Array.from({ length: Math.ceil(finds.length / PER_ROW) }, (__, i) => ({ zone, finds: finds.slice(i * PER_ROW, (i + 1) * PER_ROW) }));
});
const PAGES = Math.ceil(ROWS.length / ROWS_PER_PAGE);

/** Frame tint per rarity, on the kit's grey card. */
export const RARITY_COLORS: Record<Rarity, number> = {
    common: 0xffffff,
    rare: 0x6fb4ff,
    epic: 0xc77dff,
    legendary: 0xffd23f,
};

/** Kit frame per rarity, for found cards. */
const RARITY_FRAME: Record<Rarity, string> = {
    common: 'cardCommon',
    rare: 'cardRare',
    epic: 'cardEpic',
    legendary: 'cardLegendary',
};

export class CollectionPanel extends PIXI.Container {
    private readonly body = new PIXI.Container();
    private page = 0;
    private newIds: string[] = [];

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

    /** Opens on the first page, or the page with a new find; `newIds` get the NEW! badge. */
    public refresh(newIds: string[]): void {
        this.newIds = newIds;
        const newRow = ROWS.findIndex((row) => row.finds.some((find) => newIds.includes(find.id)));
        this.page = newRow >= 0 ? Math.floor(newRow / ROWS_PER_PAGE) : 0;
        this.renderPage();
    }

    private renderPage(): void {
        const newIds = this.newIds;
        // Stop the old cards' pulses first: a tween left running on a destroyed sprite throws every frame and stalls
        // every other animation in the game (the reward coins froze mid-air).
        UiAnim.kill(this.body);
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

        const top = -HEIGHT / 2 + 108;
        ROWS.slice(this.page * ROWS_PER_PAGE, (this.page + 1) * ROWS_PER_PAGE).forEach(({ zone: zoneIndex, finds }, row) => {
            const zone = DIG.zones[zoneIndex];
            const y = top + row * ROW_HEIGHT;
            const reached = zoneIndex <= DigProgress.deepestZone;
            const label = UiKit.text('collection', 'zoneLabel', { name: reached ? names.zone(zone).toUpperCase() : t('notReached', { name: names.zone(zone).toUpperCase() }) });
            label.anchor.set(0.5, 0);
            label.y = y;
            this.body.addChild(label);
            finds.forEach((find, i) => {
                const card = this.card(find.id, newIds.includes(find.id));
                card.position.set((i - (finds.length - 1) / 2) * (CARD_W + CARD_GAP), y + 36 + CARD / 2);
                this.body.addChild(card);
            });
        });

        if (PAGES > 1) {
            const y = HEIGHT / 2 - 80;
            const label = UiKit.text('collection', 'page', { page: this.page + 1, pages: PAGES });
            label.anchor.set(0.5);
            label.y = y;
            this.body.addChild(label, this.arrow('arrowLeft', -140, y, -1), this.arrow('arrowRight', 140, y, 1));
        }

        const reward = DIG.collectionReward;
        const footer = UiKit.text('collection', 'reward', {
            text: DigProgress.collectionDone
                ? t('collectionComplete', { hat: names.look(reward.hat) })
                : t('collectionGoal', { money: reward.money.toLocaleString('en-US'), hat: names.look(reward.hat) }),
        });
        footer.anchor.set(0.5);
        footer.y = HEIGHT / 2 - 36;
        UiKit.fit(footer, WIDTH - 40);
        this.body.addChild(footer);
    }

    private arrow(id: string, x: number, y: number, step: number): PIXI.Container {
        const arrow = UiKit.sprite('collection', id);
        arrow.scale.set(44 / Math.max(arrow.height, 1));
        arrow.position.set(x, y);
        arrow.eventMode = 'static';
        arrow.cursor = 'pointer';
        arrow.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        arrow.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            this.page = (this.page + step + PAGES) % PAGES;
            DigAudio.play('click');
            this.renderPage();
        });
        return arrow;
    }

    private card(id: string, isNew: boolean): PIXI.Container {
        const find = DIG.finds.find((f) => f.id === id)!;
        const count = DigProgress.found[id] ?? 0;
        const card = new PIXI.Container();
        // Found: a frame in its rarity's colour (common green, rare blue, epic purple, legendary gold), the rarity on
        // a tag; missing: a navy frame and a silhouette.
        const frame = UiKit.image('collection', count > 0 ? RARITY_FRAME[find.rarity] : 'cardMissing', CARD_W, CARD);
        const icon = ModelIcons.sprite(`./dig/models/${find.model}`, CARD * 0.6, count === 0);
        icon.y = -10;
        card.addChild(frame, icon);
        // The name sits inside the card's bottom edge (shrunk to fit), so rows can stack tightly.
        const name = count > 0 ? UiKit.text('collection', 'cardName', { name: names.find(find) }) : UiKit.text('collection', 'missing');
        name.anchor.set(0.5, 1);
        name.y = CARD / 2 - 6;
        UiKit.fit(name, CARD_W - 16);
        card.addChild(name);
        if (count > 0) {
            const rarity = UiKit.text('collection', 'rarity', { text: names.rarity(find.rarity) }, { fill: RARITY_COLORS[find.rarity] });
            // Just above the name: the NEW! badge takes the top-left corner and the count the top-right.
            rarity.anchor.set(0.5, 1);
            rarity.position.set(0, CARD / 2 - 26);
            card.addChild(rarity);
        }
        if (count > 0) {
            const amount = UiKit.text('collection', 'cardCount', { count });
            amount.anchor.set(1, 0);
            amount.position.set(CARD_W / 2 - 8, -CARD / 2 + 6);
            card.addChild(amount);
        }
        if (isNew) {
            const badge = new PIXI.Container();
            badge.position.set(-CARD_W / 2 + 18, -CARD / 2 + 14);
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
