// TractorPanel.ts
//
// The tractor's panel (the wardrobe's twin, in its place on the screen): its COLORS, PAINT and PARTS tabs over a paged 3x2 grid of
// cards (LookCard), each showing the tractor wearing it. Tapping one puts it on straight away, bought first if it has to be,
// or after its rewarded video. What there is and what it costs: ui/tractor.json (TractorSkins).

import * as PIXI from 'pixi.js';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { tabbedBlock } from './TabBar';
import { ModelIcons } from './ModelIcons';
import { LOOK_CARD, lookCard } from './LookCard';
import { DigProgress } from '../data/DigProgress';
import { NO_TRACTOR_LOOK, TRACTOR_ITEMS, TRACTOR_KINDS, TractorItem, TractorKind } from '../data/TractorSkins';
import { t, type StringId } from '../i18n/Localization';
import { DigAudio } from '../audio/DigAudio';
import { watchRewardedVideo } from '../ads/RewardedVideo';
import { GameAnalytics } from '../analytics/GameAnalytics';

const WIDTH = 700;
const HEIGHT = 744;
export const TRACTOR_PANEL_SIZE = { width: WIDTH, height: HEIGHT };
/** The content block under the tabs: its top edge and size, and the tabs'. */
const BLOCK = { top: -HEIGHT / 2 + 160, width: WIDTH - 44, height: HEIGHT - 180, tabWidth: 206, tabHeight: 84 };
const FIRST_ROW_Y = BLOCK.top + 16 + LOOK_CARD.height / 2;
const PER_PAGE = 6;
const ART = 150;
const TAB_ART = 72;
const TAB_LABELS: Record<TractorKind, StringId> = { colors: 'tabColors', paints: 'tabPaint', parts: 'tabParts' };
/** What the tabs show it wearing. */
const TAB_LOOKS: Record<TractorKind, string> = { colors: 'red', paints: 'flames', parts: 'eyes' };

export class TractorPanel extends PIXI.Container {
    private readonly body = new PIXI.Container();
    private tab: TractorKind = 'colors';
    private page = 0;
    private watching = false;

    /** `say` for short messages. */
    public constructor(private readonly say: (text: string, color: number) => void) {
        super();
        const frame = UiKit.image('wardrobe', 'panel', WIDTH, HEIGHT);
        const ribbon = UiKit.sprite('wardrobe', 'ribbon', 0.55);
        ribbon.y = -HEIGHT / 2;
        const title = UiKit.text('wardrobe', 'title');
        title.text = t('titleTractor');
        title.anchor.set(0.5);
        title.y = -HEIGHT / 2 - 5;
        // Taps on the panel must not fall through to the movement joystick underneath.
        frame.eventMode = 'static';
        frame.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.addChild(frame, ribbon, title, this.body);
        this.visible = false;
    }

    /** What's affordable or worn has changed since it was drawn. */
    public get stale(): boolean {
        return this.key() !== this.drawn;
    }

    private drawn = '';

    private key(): string {
        const { colors, paints, parts } = DigProgress.tractorLook;
        return `${colors}|${paints}|${parts}|${TRACTOR_ITEMS[this.tab].map((item) => (DigProgress.ownsTractor(this.tab, item) ? 'o' : DigProgress.money >= item.price ? '+' : '-')).join('')}`;
    }

    public refresh(): void {
        this.drawn = this.key();
        // (The old cards' tweens first: one left on a destroyed sprite stalls every other animation.)
        UiAnim.kill(this.body);
        this.body.removeChildren().forEach((child) => child.destroy({ children: true }));
        this.body.addChild(this.tabs());
        const items = TRACTOR_ITEMS[this.tab];
        const pages = Math.ceil(items.length / PER_PAGE);
        this.page = Math.min(this.page, pages - 1);
        items.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE).forEach((item, i) => {
            const card = this.card(item);
            card.position.set(((i % 3) - 1) * (LOOK_CARD.width + LOOK_CARD.gap), FIRST_ROW_Y + Math.floor(i / 3) * (LOOK_CARD.height + LOOK_CARD.gap));
            this.body.addChild(card);
        });
        if (pages <= 1) return;
        const y = BLOCK.top + BLOCK.height - 44;
        const label = UiKit.text('wardrobe', 'page', { page: this.page + 1, pages }, { fontSize: 28, strokeThickness: 6 });
        label.anchor.set(0.5);
        label.y = y;
        this.body.addChild(label, this.arrow('arrowLeft', -150, y, -1, pages), this.arrow('arrowRight', 150, y, 1, pages));
    }

    private tabs(): PIXI.Container {
        const block = tabbedBlock({
            width: BLOCK.width,
            height: BLOCK.height,
            tabWidth: BLOCK.tabWidth,
            tabHeight: BLOCK.tabHeight,
            tabs: TRACTOR_KINDS.map((kind) => ({
                id: kind,
                label: t(TAB_LABELS[kind]),
                icon: () => ModelIcons.tractorSprite(DigProgress.tool, { ...NOTHING, [kind]: TAB_LOOKS[kind] }, TAB_ART),
            })),
            active: this.tab,
            onSelect: (id) => {
                this.tab = id as TractorKind;
                this.page = 0;
                GameAnalytics.tabOpened('tractor', id);
                DigAudio.play('tab');
                this.refresh();
            },
        });
        block.y = BLOCK.top;
        return block;
    }

    private arrow(id: string, x: number, y: number, step: number, pages: number): PIXI.Container {
        const arrow = UiKit.sprite('wardrobe', id);
        // (Its touch area much bigger than it: a thumb's.)
        const height = Math.max(arrow.height, 1);
        arrow.hitArea = new PIXI.Rectangle(-height, -height * 0.7, height * 2, height * 1.4);
        arrow.scale.set(58 / height);
        arrow.position.set(x, y);
        this.tappable(arrow, () => {
            this.page = (this.page + step + pages) % pages;
            DigAudio.play('click');
            this.refresh();
        });
        return arrow;
    }

    private card(item: TractorItem): PIXI.Container {
        const owned = DigProgress.ownsTractor(this.tab, item);
        const card = lookCard({
            art: ModelIcons.tractorSprite(DigProgress.tool, { ...NOTHING, [this.tab]: item.id }, ART),
            name: item.name.toUpperCase(),
            worn: this.worn(this.tab, item),
            owned,
            affordable: !!item.free || !!item.video || DigProgress.money >= item.price,
            price: item.price,
            free: item.free,
            video: item.video && PlatformHandler.ENABLE_VIDEO_ADS,
        });
        if (!owned && item.free) UiAnim.pulse(card, 0.05, 0.6);
        this.tappable(card, () => void this.choose(item, card));
        return card;
    }

    /** It's on (a plain colour isn't, under a pattern). */
    private worn(kind: TractorKind, item: TractorItem): boolean {
        const look = DigProgress.tractorLook;
        return look[kind] === item.id && !(kind === 'colors' && look.paints);
    }

    private async choose(item: TractorItem, card: PIXI.Container): Promise<void> {
        const kind = this.tab;
        if (this.watching || this.worn(kind, item)) return;
        if (DigProgress.ownsTractor(kind, item)) {
            DigProgress.wearTractor(kind, item);
            GameAnalytics.tractor(kind, item.id, 'equip');
            DigAudio.play('item');
            this.refresh();
            return;
        }
        if (item.video) {
            this.watching = true;
            const watched = await watchRewardedVideo(`tractor ${item.id}`);
            this.watching = false;
            if (this.destroyed) return;
            if (!watched) {
                GameAnalytics.tractor(kind, item.id, 'no-video');
                this.say('NO VIDEO RIGHT NOW', 0xff9a8a);
                if (!card.destroyed) UiAnim.shake(card, 8, 0.35);
                return;
            }
            DigProgress.unlockTractor(kind, item);
        } else if (!DigProgress.wearTractor(kind, item)) {
            this.say(t('notEnoughCash'), 0xff8a7a);
            DigAudio.play('error');
            UiAnim.shake(card, 8, 0.35);
            return;
        }
        GameAnalytics.tractor(kind, item.id, item.video ? 'unlocked' : item.free ? 'gift' : 'bought');
        this.say(t('tractorUnlocked', { name: item.name.toUpperCase() }), 0x9cff9c);
        DigAudio.play('buyCash');
        DigAudio.play('buyStar');
        this.refresh();
    }

    private tappable(target: PIXI.Container, action: () => void): void {
        target.eventMode = 'static';
        target.cursor = 'pointer';
        target.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        target.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            action();
        });
    }
}

const NOTHING = NO_TRACTOR_LOOK;
