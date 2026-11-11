// RankingPanel.ts
//
// The competition's screen (as the UFO game's, laid out like the UI pack's Leaderboard), over the main screen: the
// gems, the DAILY, WEEKLY and QUESTS tabs, the top five and the player's own place by crowns (Ranking.ts), when it
// starts over, BACK and PLAY (an arena match). QUESTS lists the day's and the week's quests, with how far along each is,
// to claim their gems. The list scrolls (drag, or the wheel) when it's taller than the room over the buttons.

import * as PIXI from 'pixi.js';
import { MobEvents } from '../data/MobEvents';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { Quest, RankingPeriod, RankingRow, anyClaimable, claimQuest, endsIn, questClaimable, questClaimed, questDone, questProgress, questShare, questTitle, quests, topRows, yourRow } from '../data/Ranking';
import { MobSave } from '../data/MobSave';
import { MobAudio } from '../audio/MobAudio';
import { COIN_BAR, fillGemBar, framePlane, glossyButton, iconSprite, label, makeAvatar, tappable } from './UiParts';

const BACK = 0x12305e;
const HEADER = { strip: 96, stripColor: 0x8a3dff, title: 34, titleY: 48, coinX: 30, coinY: 48 };
const TABS = { zone: 96, zoneColor: 0x34365a, zoneScale: 0.7, width: 640, height: 62, trackColor: 0x1c1d33, trackY: 48, button: 72, words: 26, slide: 0.18, badge: 34, badgeX: 74, badgeY: -26 };
const LIST = { top: 16, ends: 22, width: 672, rowHeight: 86, rowGap: 8, dots: 40, avatar: 62, rankX: 44, avatarX: 112, nameX: 158, nameWidth: 330, crownX: -118, crownsX: -92, crown: 44, medal: 62 };
const QUEST = { rowHeight: 100, rowGap: 8, iconX: 50, icon: 56, titleX: 92, titleY: -20, titleSize: 21, barY: 18, barWidth: 260, barHeight: 20, buttonWidth: 158, buttonHeight: 66, buttonX: -92, coin: 34, check: 56, section: 34 };
const BOTTOM = { y: 62, back: 170, play: 450, height: 84, gap: 16 };
const MEDALS = ['ItemIcon_Medal_Gold_1', 'ItemIcon_Medal_Silver_1', 'ItemIcon_Medal_Bronze_1'];
const TIMER_EVERY = 20;
/** Scrolling: under this much of a drag a tap's a tap; the wheel's pace; the room kept over the buttons and under the
 *  list's end; the scroll bar. */
const SCROLL = { tap: 10, wheel: 0.8, above: 26, end: 24, bar: 10, barInset: 12, minThumb: 48, track: 0x0a1a3a, trackAlpha: 0.7, thumb: 0x6f9bff };
/** Each quest's icon, by what it counts. */
const QUEST_ICONS: Record<Quest['type'], string> = { crowns: 'Icon_Crown', arenaWins: 'ItemIcon_Battle', levels: 'Icon_Castle', towers: 'ItemIcon_Trophy_Gold', rank: 'ItemIcon_Medal_Gold_1' };

type Tab = RankingPeriod | 'quests';

/** A baked bar texture (48 px tall, white: tinted) at (x, y), `width` x `height`, its ends scaled to the height. */
function bakedBar(frame: string, slice: number, x: number, y: number, width: number, height: number): PIXI.NineSlicePlane {
    const plane = new PIXI.NineSlicePlane(PIXI.Texture.from(frame), slice, slice, slice, slice);
    const scale = height / 48;
    plane.scale.set(scale);
    plane.width = width / scale;
    plane.height = 48;
    plane.position.set(x, y);
    return plane;
}
const TAB_ORDER: { tab: Tab; words: string }[] = [{ tab: 'daily', words: 'DAILY' }, { tab: 'weekly', words: 'WEEKLY' }, { tab: 'quests', words: 'QUESTS' }];

export class RankingPanel extends PIXI.Container {
    private readonly back = new PIXI.Sprite(PIXI.Texture.WHITE);
    private readonly strip = new PIXI.Sprite(PIXI.Texture.WHITE);
    private readonly title = label(HEADER.title);
    private readonly coinBar = new PIXI.Container();
    private readonly coins = label(COIN_BAR.textSize);
    private readonly zone = framePlane('PanelFrame03_Bg', 720, TABS.zone, TABS.zoneScale);
    private readonly tabs = new PIXI.Container();
    private readonly chosen = new PIXI.Container();
    private readonly badge = new PIXI.Container();
    private readonly ends = label(22);
    private readonly list = new PIXI.Container();
    private readonly backButton = glossyButton(BOTTOM.back, BOTTOM.height, 'BACK', 'Button01_l_Gray');
    private readonly playButton = glossyButton(BOTTOM.play, BOTTOM.height, 'PLAY ARENA', 'Button01_l_Green');
    private tab: Tab = 'daily';
    private timer = 0;
    /** Scrolling: the room the list shows in (its mask), the scroll bar, how far down it is, the most it can go, the
     *  list's top unscrolled, a drag going on, the room the bar runs down. */
    private readonly view = new PIXI.Graphics();
    private readonly scrollBar = new PIXI.Graphics();
    private scroll = 0;
    private maxScroll = 0;
    private listTop = 0;
    private drag: { y: number; scroll: number; moved: boolean } | null = null;
    private barRoom = { x: 0, top: 0, height: 0 };

    /** `onClose`: back to the main screen (null: it's a tab's page, the tab bar's over it: no BACK). `onPlay`: an arena
     *  match (null: no PLAY). `onCoins`: the currencies changed (a quest claimed). `bottom`: room kept at the bottom (the
     *  tab bar's) over which it ends. */
    public constructor(private readonly onClose: (() => void) | null, onPlay: (() => void) | null, private readonly onCoins: () => void = () => undefined, private readonly bottom = 0) {
        super();
        this.back.tint = BACK;
        this.back.anchor.set(0.5);
        this.back.eventMode = 'static';
        this.strip.tint = HEADER.stripColor;
        this.zone.tint = TABS.zoneColor;
        this.title.text = 'RANKING';
        fillGemBar(this.coinBar, this.coins);
        // The list scrolls under the tabs, cut to the room over the buttons.
        this.list.mask = this.view;
        this.eventMode = 'static';
        this.addEventListener('pointerdown', (event) => this.startDrag(event as PIXI.FederatedPointerEvent), { capture: true });
        this.on('globalpointermove', (event: PIXI.FederatedPointerEvent) => this.moveDrag(event));
        this.on('pointerup', () => this.endDrag());
        this.on('pointerupoutside', () => this.endDrag());
        window.addEventListener('wheel', this.onWheel);
        this.buildTabs();
        tappable(this.backButton, () => this.onClose?.());
        this.backButton.visible = !!onClose;
        this.playButton.visible = !!onPlay;
        // A tab's page: the main screen's coins and gems are over its strip (its own gems and title go).
        if (!onClose) this.coinBar.visible = this.title.visible = false;
        if (onPlay) tappable(this.playButton, onPlay);
        gsap.to(this.playButton.scale, { x: 1.03, y: 1.03, duration: 0.7, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        this.addChild(this.back, this.view, this.list, this.scrollBar, this.strip, this.title, this.coinBar, this.zone, this.tabs, this.ends, this.backButton, this.playButton);
        this.show(anyClaimable() ? 'quests' : 'daily');
    }

    private buildTabs(): void {
        const each = TABS.width / TAB_ORDER.length;
        const track = framePlane('BasicFrame_Round20', TABS.width, TABS.height);
        track.tint = TABS.trackColor;
        track.position.set(-TABS.width / 2, -TABS.height / 2);
        const chosen = glossyButton(each + 8, TABS.button, '', 'Button01_l_Sky');
        this.chosen.addChild(chosen);
        this.tabs.addChild(track, this.chosen);
        TAB_ORDER.forEach(({ tab, words }, i) => {
            const holder = new PIXI.Container();
            holder.x = (i - 1) * each;
            holder.hitArea = new PIXI.Rectangle(-each / 2, -TABS.button / 2, each, TABS.button);
            const text = label(TABS.words);
            text.text = words;
            text.y = -2;
            holder.addChild(text);
            tappable(holder, () => this.show(tab));
            this.tabs.addChild(holder);
        });
        // A quest's waiting to be claimed.
        const circle = iconSprite('Alert_Circle_l_Bg', TABS.badge);
        circle.tint = 0xff3b4e;
        this.badge.addChild(circle, iconSprite('Alert_Circle_Icon_Exclamation', TABS.badge * 0.55));
        this.badge.position.set(each + TABS.badgeX, TABS.badgeY);
        this.tabs.addChild(this.badge);
    }

    private show(tab: Tab): void {
        // Another tab: from its top.
        if (tab !== this.tab) this.scroll = 0;
        this.tab = tab;
        const each = TABS.width / TAB_ORDER.length;
        const index = TAB_ORDER.findIndex((entry) => entry.tab === tab);
        gsap.to(this.chosen, { x: (index - 1) * each, duration: TABS.slide, ease: 'power2.out' });
        this.refresh();
    }

    /** Everything as it now is. */
    public refresh(): void {
        this.coins.text = String(MobSave.gems);
        this.badge.visible = anyClaimable();
        this.list.removeChildren().forEach((child) => child.destroy({ children: true }));
        if (this.tab === 'quests') this.showQuests();
        else this.showRanking(this.tab);
        this.showEnds();
        this.reposition();
    }

    private showEnds(): void {
        this.ends.visible = this.tab !== 'quests';
        if (this.tab !== 'quests') this.ends.text = `ENDS IN ${endsIn(this.tab)}`;
    }

    private showRanking(period: RankingPeriod): void {
        const rows = topRows(5, period);
        let y = LIST.ends + LIST.top;
        rows.forEach((row) => {
            this.list.addChild(this.rankRow(row, y));
            y += LIST.rowHeight + LIST.rowGap;
        });
        if (rows.some((row) => row.you)) return;
        const dots = label(30);
        dots.text = '. . .';
        dots.y = y + LIST.dots / 2 - LIST.rowGap;
        this.list.addChild(dots);
        y += LIST.dots;
        this.list.addChild(this.rankRow(yourRow(period), y));
    }

    private rankRow(row: RankingRow, y: number): PIXI.Container {
        const holder = new PIXI.Container();
        holder.y = y + LIST.rowHeight / 2;
        const half = LIST.width / 2;
        const frame = framePlane(row.you ? 'ListFrame04_Single_f_Yellow' : 'ListFrame04_Single_f_Blue', LIST.width, LIST.rowHeight);
        frame.position.set(-half, -LIST.rowHeight / 2);
        holder.addChild(frame);
        if (row.rank <= MEDALS.length) {
            const medal = iconSprite(MEDALS[row.rank - 1], LIST.medal);
            medal.x = -half + LIST.rankX;
            holder.addChild(medal);
        } else {
            const rank = label(row.rank > 999 ? 22 : 30);
            rank.text = String(row.rank);
            rank.x = -half + LIST.rankX;
            holder.addChild(rank);
        }
        const avatar = makeAvatar({ face: row.face, color: row.color }, LIST.avatar);
        avatar.x = -half + LIST.avatarX;
        const name = label(28);
        name.text = row.name;
        name.anchor.set(0, 0.5);
        name.x = -half + LIST.nameX;
        name.scale.set(Math.min(1, LIST.nameWidth / Math.max(name.width, 1)));
        const crown = iconSprite('Icon_Crown', LIST.crown);
        crown.x = half + LIST.crownX;
        const crowns = label(30);
        crowns.text = String(row.crowns);
        crowns.anchor.set(0, 0.5);
        crowns.x = half + LIST.crownsX;
        holder.addChild(avatar, name, crown, crowns);
        return holder;
    }

    /** The day's quests, then the week's, each under its heading. */
    private showQuests(): void {
        let y = LIST.top;
        for (const period of ['daily', 'weekly'] as RankingPeriod[]) {
            const heading = label(24, 0xffe066);
            heading.text = `${period === 'daily' ? 'DAILY' : 'WEEKLY'} QUESTS · ${endsIn(period)}`;
            heading.y = y + QUEST.section / 2;
            this.list.addChild(heading);
            y += QUEST.section;
            for (const quest of quests().filter((q) => q.period === period)) {
                this.list.addChild(this.questRow(quest, y));
                y += QUEST.rowHeight + QUEST.rowGap;
            }
        }
    }

    private questRow(quest: Quest, y: number): PIXI.Container {
        const holder = new PIXI.Container();
        holder.y = y + QUEST.rowHeight / 2;
        const half = LIST.width / 2;
        const ready = questClaimable(quest);
        const frame = framePlane(ready ? 'ListFrame04_Single_f_Yellow' : 'ListFrame04_Single_f_Blue', LIST.width, QUEST.rowHeight);
        frame.position.set(-half, -QUEST.rowHeight / 2);
        const icon = iconSprite(QUEST_ICONS[quest.type], QUEST.icon);
        icon.x = -half + QUEST.iconX;
        const title = label(QUEST.titleSize);
        title.text = questTitle(quest);
        title.anchor.set(0, 0.5);
        title.position.set(-half + QUEST.titleX, QUEST.titleY);
        title.scale.set(Math.min(1, (LIST.width - QUEST.titleX - QUEST.buttonWidth - 30) / Math.max(1, title.width)));
        // How far along: a bar with the count on it.
        const bar = new PIXI.Container();
        bar.position.set(-half + QUEST.titleX, QUEST.barY);
        // (The baked bar textures, as the battle's bars: crisp at any size.)
        const trough = bakedBar('Bar_Trough', 16, 0, -QUEST.barHeight / 2, QUEST.barWidth, QUEST.barHeight);
        trough.tint = 0x1c1d33;
        const inner = QUEST.barHeight - 6;
        const fill = bakedBar('Bar_Segment', 12, 3, -inner / 2, Math.max(inner, (QUEST.barWidth - 6) * questShare(quest)), inner);
        fill.tint = questDone(quest) ? 0x5fe87a : 0x6fc3ff;
        fill.visible = questShare(quest) > 0;
        const progress = label(18);
        progress.text = questProgress(quest);
        progress.position.set(QUEST.barWidth / 2, -1);
        bar.addChild(trough, fill, progress);
        holder.addChild(frame, icon, title, bar);
        const buttonX = half + QUEST.buttonX;
        if (questClaimed(quest)) {
            const check = iconSprite('Icon_Check03_l', QUEST.check);
            check.x = buttonX;
            holder.addChild(check);
            return holder;
        }
        const button = glossyButton(QUEST.buttonWidth, QUEST.buttonHeight, String(quest.reward), questDone(quest) ? 'Button01_l_Green' : 'Button01_l_Gray');
        button.x = buttonX;
        button.words.x = 18;
        const coin = iconSprite('Icon_Gem', QUEST.coin);
        coin.x = -46;
        button.addChild(coin);
        if (ready) {
            tappable(button, () => {
                claimQuest(quest);
                MobEvents.questClaim(quest.id);
                MobAudio.play('coins');
                this.onCoins();
                this.refresh();
            });
            gsap.to(button.scale, { x: 1.06, y: 1.06, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        }
        holder.addChild(button);
        return holder;
    }

    private startDrag(event: PIXI.FederatedPointerEvent): void {
        this.drag = { y: event.global.y, scroll: this.scroll, moved: false };
    }

    private moveDrag(event: PIXI.FederatedPointerEvent): void {
        if (!this.drag) return;
        const dy = event.global.y - this.drag.y;
        // Past a few pixels it's a drag, not a tap: the rows' buttons don't take it.
        if (!this.drag.moved && Math.abs(dy) > SCROLL.tap) {
            this.drag.moved = true;
            this.list.eventMode = 'none';
        }
        if (this.drag.moved) this.scrollTo(this.drag.scroll - dy / Math.max(0.01, this.list.scale.y));
    }

    private endDrag(): void {
        this.drag = null;
        this.list.eventMode = 'passive';
    }

    private readonly onWheel = (event: WheelEvent): void => {
        if (this.maxScroll <= 0) return;
        this.scrollTo(this.scroll + event.deltaY * SCROLL.wheel);
    };

    /** To `scroll` (list units), kept within it. */
    private scrollTo(scroll: number): void {
        this.scroll = Math.max(0, Math.min(this.maxScroll, scroll));
        this.list.y = this.listTop - this.scroll * this.list.scale.y;
        this.drawScrollBar();
    }

    /** The track down the right side and its thumb (as tall as the share showing, where that share is); none if it fits. */
    private drawScrollBar(): void {
        const bar = this.scrollBar.clear();
        if (this.maxScroll <= 0) return;
        const { x, top, height } = this.barRoom;
        const w = SCROLL.bar;
        const shown = height / (height + this.maxScroll * this.list.scale.y);
        const thumb = Math.max(SCROLL.minThumb, height * shown);
        const y = top + (height - thumb) * (this.scroll / this.maxScroll);
        bar.beginFill(SCROLL.track, SCROLL.trackAlpha).drawRoundedRect(x - w / 2, top, w, height, w / 2).endFill();
        bar.beginFill(SCROLL.thumb).drawRoundedRect(x - w / 2, y, w, thumb, w / 2).endFill();
    }

    /** Keeps "ends in" up to date. */
    public update(delta: number): void {
        this.timer += delta;
        if (this.timer < TIMER_EVERY) return;
        this.timer = 0;
        this.showEnds();
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const { x: left, y: top } = screen.topLeft;
        this.back.position.copyFrom(screen.center);
        this.back.width = screen.width + 4;
        this.back.height = screen.height + 4;
        this.strip.position.set(left, top);
        this.strip.width = screen.width;
        this.strip.height = HEADER.strip;
        this.title.position.set(screen.center.x + 70, top + HEADER.titleY);
        this.coinBar.position.set(left + HEADER.coinX + COIN_BAR.icon / 2, top + HEADER.coinY);
        const zoneY = top + HEADER.strip;
        this.zone.position.set(left, zoneY);
        this.zone.width = screen.width / TABS.zoneScale;
        this.tabs.position.set(screen.center.x, zoneY + TABS.trackY);
        this.ends.position.set(screen.center.x, zoneY + TABS.zone + LIST.ends);
        // Narrower screens: the list and the rows scaled to fit.
        this.list.scale.set(Math.min(1, (screen.width - 24) / LIST.width));
        const bottomY = top + screen.height - this.bottom - BOTTOM.y;
        // The room the list shows in: under the tabs, over the buttons (or the tab bar); how far it can scroll in it.
        this.listTop = zoneY + TABS.zone + LIST.top;
        const buttons = this.backButton.visible || this.playButton.visible;
        const roomBottom = buttons ? bottomY - BOTTOM.height / 2 - SCROLL.above : top + screen.height - this.bottom - SCROLL.above;
        const room = Math.max(1, roomBottom - this.listTop);
        this.view.clear().beginFill(0xffffff).drawRect(left, this.listTop, screen.width, room).endFill();
        const bounds = this.list.getLocalBounds();
        this.maxScroll = Math.max(0, bounds.y + bounds.height + SCROLL.end - room / Math.max(0.01, this.list.scale.y));
        this.barRoom = { x: left + screen.width - SCROLL.barInset, top: this.listTop + 6, height: room - 12 };
        this.list.x = screen.center.x;
        this.scrollTo(this.scroll);
        const total = BOTTOM.back + BOTTOM.gap + BOTTOM.play;
        const both = this.playButton.visible;
        this.backButton.position.set(both ? screen.center.x - total / 2 + BOTTOM.back / 2 : screen.center.x, bottomY);
        this.playButton.position.set(screen.center.x + total / 2 - BOTTOM.play / 2, bottomY);
    }

    public override destroy(): void {
        window.removeEventListener('wheel', this.onWheel);
        gsap.killTweensOf(this.chosen);
        gsap.killTweensOf(this.playButton.scale);
        this.list.children.forEach((row) => (row as PIXI.Container).children.forEach((child) => gsap.killTweensOf((child as PIXI.Container).scale)));
        super.destroy({ children: true });
    }
}
