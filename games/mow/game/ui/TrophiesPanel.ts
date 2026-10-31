// TrophiesPanel.ts
//
// The treasures found in the grass (Dig's collection panel, kept on the UI instead of in a room): every treasure in rows
// of 3 under its area's name (the town's sections, in unlock order; one not open yet says so), ROWS_PER_PAGE rows a
// page. Found ones show their model, name and rarity; missing ones a dark silhouette and "???", so the player knows how
// many are still hidden in each area. A bar counts them all.
//
// Rewards are claimed here: a found treasure whose reward waits has a pulsing CLAIM button and a "!" on its card (the
// panel opens on the page with one), and an area whose treasures are all found pays its bonus from a CLAIM button in
// the footer. Tapping one hands it to the HUD (onClaim), which pays it and flies the coins in.
// Styles come from ui/uikit.json (screen "collection"); the claim buttons from "achievements".

import * as PIXI from 'pixi.js';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { ModelIcons } from './ModelIcons';
import { MOW, Rarity, TreasureDef } from '../data/MowConfig';
import { MowProgress, areaBonusKey } from '../data/MowProgress';
import { t, names } from '../i18n/Localization';
import { MowAudio } from '../audio/MowAudio';

const WIDTH = 640;
const HEIGHT = 624;
/** Frame size, for the HUD to fit the panel on screen. */
export const TROPHIES_SIZE = { width: WIDTH, height: HEIGHT };
const CARD = 150;
const CARD_W = 180;
const CARD_GAP = 20;
const ROW_HEIGHT = 192;
const BAR_WIDTH = 300;
const PER_ROW = 3;
const ROWS_PER_PAGE = 2;
/** Each area's treasures split into rows of PER_ROW (an area with 5 takes two rows). */
const ROWS: { area: number; items: TreasureDef[] }[] = MOW.districts.flatMap((district, area) => {
    const items = MOW.treasures.items.filter((item) => item.area === district.id);
    return Array.from({ length: Math.ceil(items.length / PER_ROW) }, (_, i) => ({ area, items: items.slice(i * PER_ROW, (i + 1) * PER_ROW) }));
});
const PAGES = Math.max(1, Math.ceil(ROWS.length / ROWS_PER_PAGE));
const CLAIM_HEIGHT = 46;
const FOOTER_BUTTON_WIDTH = 300;

/** Kit frame per rarity, for found cards (and the rarity's colour on its tag). */
const RARITY_FRAME: Record<Rarity, string> = { common: 'cardCommon', rare: 'cardRare', epic: 'cardEpic', legendary: 'cardLegendary' };
const RARITY_COLORS: Record<Rarity, number> = { common: 0xffffff, rare: 0x6fb4ff, epic: 0xc77dff, legendary: 0xffd23f };

export class TrophiesPanel extends PIXI.Container {
    private readonly body = new PIXI.Container();
    private page = 0;

    /**
     * `onClaim` with a waiting reward's key (a treasure id, or an area's bonus) and where its button is on screen;
     * `isOpen(area)`: whether that area (a district index) is open yet.
     */
    public constructor(private readonly onClaim: (key: string, from: PIXI.Point) => void, private readonly isOpen: (area: number) => boolean) {
        super();
        const frame = UiKit.image('collection', 'panel', WIDTH, HEIGHT);
        const ribbon = UiKit.sprite('collection', 'ribbon', 0.55);
        ribbon.y = -HEIGHT / 2;
        const title = UiKit.text('collection', 'title');
        title.text = t('titleTrophies');
        title.anchor.set(0.5);
        title.y = -HEIGHT / 2 - 5;
        // Taps on the panel must not fall through to the movement joystick underneath.
        frame.eventMode = 'static';
        frame.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.addChild(frame, ribbon, title, this.body);
        this.visible = false;
    }

    /** Opens on the page with a reward waiting, else the first. */
    public refresh(): void {
        const row = ROWS.findIndex((r) => r.items.some((item) => MowProgress.unclaimedFor(item.id) > 0));
        this.page = row >= 0 ? Math.floor(row / ROWS_PER_PAGE) : Math.min(this.page, PAGES - 1);
        this.renderPage();
    }

    private renderPage(): void {
        // Stop the old cards' pulses first: a tween left running on a destroyed sprite throws every frame.
        UiAnim.kill(this.body);
        this.body.removeChildren().forEach((child) => child.destroy({ children: true }));
        const total = MOW.treasures.items.length;
        const found = MOW.treasures.items.filter((item) => MowProgress.treasureFound(item.id)).length;

        const progress = UiKit.text('collection', 'progress', { found, total });
        progress.anchor.set(0.5);
        progress.y = -HEIGHT / 2 + 62;
        const bar = new PIXI.Container();
        bar.y = -HEIGHT / 2 + 94;
        bar.addChild(UiKit.image('collection', 'barBack', BAR_WIDTH, 18));
        if (found > 0) {
            const width = Math.max(14, (BAR_WIDTH - 4) * (found / Math.max(1, total)));
            const fill = UiKit.image('collection', 'barFill', width, 14);
            fill.x = -(BAR_WIDTH - 4) / 2 + width / 2;
            bar.addChild(fill);
        }
        this.body.addChild(progress, bar);

        const top = -HEIGHT / 2 + 108;
        ROWS.slice(this.page * ROWS_PER_PAGE, (this.page + 1) * ROWS_PER_PAGE).forEach(({ area, items }, row) => {
            const district = MOW.districts[area];
            const y = top + row * ROW_HEIGHT;
            const name = names.district(district).toUpperCase();
            const { found: areaFound, total: areaTotal } = MowProgress.areaTreasures(district.id);
            const label = UiKit.text('collection', 'zoneLabel', {
                name: this.isOpen(area) ? t('trophyArea', { name, found: areaFound, total: areaTotal }) : t('trophyAreaLocked', { name }),
            });
            label.anchor.set(0.5, 0);
            label.y = y;
            this.body.addChild(label);
            items.forEach((item, i) => {
                const card = this.card(item);
                card.position.set((i - (items.length - 1) / 2) * (CARD_W + CARD_GAP), y + 36 + CARD / 2);
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

        // An area with all its treasures found: its bonus is the footer's CLAIM button.
        const bonusArea = MOW.districts.find((d) => MowProgress.unclaimedFor(areaBonusKey(d.id)) > 0);
        if (bonusArea) {
            const key = areaBonusKey(bonusArea.id);
            const claim = this.claimButton(key, MowProgress.unclaimedFor(key), FOOTER_BUTTON_WIDTH);
            claim.y = HEIGHT / 2 - 40;
            this.body.addChild(claim);
            return;
        }
        const footer = UiKit.text('collection', 'reward', { text: found === total ? t('trophiesComplete') : t('trophiesGoal') });
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
            MowAudio.play('click');
            this.renderPage();
        });
        return arrow;
    }

    private card(item: TreasureDef): PIXI.Container {
        const found = MowProgress.treasureFound(item.id);
        const card = new PIXI.Container();
        // Found: a frame in its rarity's colour; missing: a navy frame and a silhouette.
        const frame = UiKit.image('collection', found ? RARITY_FRAME[item.rarity] : 'cardMissing', CARD_W, CARD);
        const icon = ModelIcons.sprite(`./mow/models/${item.model}`, CARD * 0.6, !found);
        icon.y = -10;
        card.addChild(frame, icon);
        const name = found ? UiKit.text('collection', 'cardName', { name: names.treasure(item) }) : UiKit.text('collection', 'missing');
        name.anchor.set(0.5, 1);
        name.y = CARD / 2 - 6;
        UiKit.fit(name, CARD_W - 16);
        card.addChild(name);
        if (found) {
            const rarity = UiKit.text('collection', 'rarity', { text: names.rarity(item.rarity) }, { fill: RARITY_COLORS[item.rarity] });
            rarity.anchor.set(0.5, 1);
            rarity.position.set(0, CARD / 2 - 26);
            card.addChild(rarity);
        }
        const waiting = MowProgress.unclaimedFor(item.id);
        if (waiting > 0) {
            // Its reward waits here: a CLAIM button over the card's lower half and a "!" on its corner.
            const claim = this.claimButton(item.id, waiting, CARD_W - 24);
            claim.y = CARD / 2 - 24;
            card.addChild(claim);
            const alert = UiKit.sprite('hud', 'alert');
            alert.scale.set(34 / Math.max(alert.height, 1));
            alert.position.set(CARD_W / 2 - 2, -CARD / 2 - 12);
            card.addChild(alert);
            UiAnim.pulse(alert, 0.15, 0.4);
        }
        return card;
    }

    /** A pulsing "CLAIM $X" button for a waiting reward. */
    private claimButton(key: string, amount: number, width: number): PIXI.Container {
        const button = new PIXI.Container();
        button.addChild(UiKit.image('achievements', 'buttonClaim', width, CLAIM_HEIGHT));
        const label = UiKit.text('achievements', 'buttonLabel', { text: t('claimAmount', { amount: amount.toLocaleString('en-US') }) });
        UiKit.fit(label, width - 16);
        button.addChild(label);
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        button.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            this.onClaim(key, button.getGlobalPosition());
            this.renderPage();
        });
        UiAnim.pulse(button, 0.06, 0.5);
        return button;
    }
}
