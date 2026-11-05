// RankingPanel.ts
//
// The competition's screen, over everything on the home screen, laid out like the UI pack's Leaderboard: your coins, the
// Daily, Weekly and Rewards tabs, the top five and your own place (Ranking.ts), when it starts over, and the button to play.
// Rewards lists the goals to claim coins from.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { RankingGoal, RankingPeriod, RankingRow, anyClaimable, claimGoal, endsIn, goalClaimable, goalClaimed, goalDone, goalProgress, goalTitle, goals, topRows, yourRow } from '../data/Ranking';
import { UfoProgress } from '../data/UfoProgress';
import { UfoAudio } from '../audio/UfoAudio';
import { COIN_BAR, buttonParts, fillCoinBar, framePlane, iconSprite, label, makeAvatar, tappable } from './UiParts';

const BACK = 0x12305e;
const HEADER = { strip: 96, stripColor: 0x3f6bf5, title: 34, titleY: 48 };
const TABS = { zone: 96, zoneColor: 0x34365a, zoneScale: 0.7, width: 640, height: 62, trackColor: 0x1c1d33, trackY: 48, button: 72, words: 26, slide: 0.18, badge: 34, badgeX: 74, badgeY: -26 };
const LIST = { top: 16, ends: 22, width: 672, rowHeight: 88, rowGap: 8, dots: 40, avatar: 62, rankX: 44, avatarX: 112, nameX: 158, nameWidth: 340, starX: -118, starsX: -92, star: 40, medal: 62 };
const REWARD = { rowHeight: 104, rowGap: 8, iconX: 56, icon: 64, titleX: 104, titleY: -18, titleSize: 22, progressY: 18, buttonWidth: 158, buttonHeight: 68, buttonX: -92, coin: 30, check: 56 };
const BOTTOM = { y: 62, back: 170, play: 450, height: 84, gap: 16 };
const MEDALS = ['ItemIcon_Medal_Gold_1', 'ItemIcon_Medal_Silver_1', 'ItemIcon_Medal_Bronze_1'];
const TIMER_EVERY = 20;

type Tab = RankingPeriod | 'rewards';
const TAB_ORDER: { tab: Tab; words: string }[] = [{ tab: 'daily', words: 'DAILY' }, { tab: 'weekly', words: 'WEEKLY' }, { tab: 'rewards', words: 'REWARDS' }];

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
    private readonly backButton = new PIXI.Container();
    private readonly playButton = new PIXI.Container();
    private tab: Tab = 'daily';
    private timer = 0;

    /** `onClose`: back to the home screen. `onPlay`: into a round. */
    public constructor(private readonly onClose: () => void, private readonly onPlay: () => void) {
        super();
        this.back.tint = BACK;
        this.back.anchor.set(0.5);
        this.back.eventMode = 'static';
        this.strip.tint = HEADER.stripColor;
        this.zone.tint = TABS.zoneColor;
        this.title.text = 'RANKING';
        fillCoinBar(this.coinBar, this.coins);
        this.buildTabs();
        this.backButton.addChild(...buttonParts(BOTTOM.back, BOTTOM.height, 'BACK', 'Button01_l_Gray'));
        tappable(this.backButton, () => this.onClose());
        this.playButton.addChild(...buttonParts(BOTTOM.play, BOTTOM.height, 'PLAY', 'Button01_l_Green'));
        tappable(this.playButton, () => this.onPlay());
        gsap.to(this.playButton.scale, { x: 1.03, y: 1.03, duration: 0.7, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        this.addChild(this.back, this.strip, this.title, this.coinBar, this.zone, this.tabs, this.ends, this.list, this.backButton, this.playButton);
        this.show('daily');
    }

    private buildTabs(): void {
        const each = TABS.width / TAB_ORDER.length;
        const track = framePlane('BasicFrame_Round20', TABS.width, TABS.height);
        track.tint = TABS.trackColor;
        track.position.set(-TABS.width / 2, -TABS.height / 2);
        this.chosen.addChild(...buttonParts(each + 8, TABS.button, '', 'Button01_l_Sky'));
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
        // A goal's waiting to be claimed.
        const circle = iconSprite('Alert_Circle_l_Bg', TABS.badge);
        circle.tint = 0xff3b4e;
        this.badge.addChild(circle, iconSprite('Alert_Circle_Icon_Exclamation', TABS.badge * 0.55));
        this.badge.position.set(each + TABS.badgeX, TABS.badgeY);
        this.tabs.addChild(this.badge);
    }

    private show(tab: Tab): void {
        this.tab = tab;
        const each = TABS.width / TAB_ORDER.length;
        const index = TAB_ORDER.findIndex((entry) => entry.tab === tab);
        gsap.to(this.chosen, { x: (index - 1) * each, duration: TABS.slide, ease: 'power2.out' });
        this.refresh();
    }

    /** Everything as it now is. */
    public refresh(): void {
        this.coins.text = String(UfoProgress.coins);
        this.badge.visible = anyClaimable();
        this.list.removeChildren().forEach((child) => child.destroy({ children: true }));
        if (this.tab === 'rewards') this.showRewards();
        else this.showRanking(this.tab);
        this.showEnds();
        this.reposition();
    }

    private showEnds(): void {
        this.ends.visible = this.tab !== 'rewards';
        if (this.tab !== 'rewards') this.ends.text = `ENDS IN ${endsIn(this.tab)}`;
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
        const avatar = makeAvatar({ name: row.name, face: row.face, color: row.color }, LIST.avatar);
        avatar.x = -half + LIST.avatarX;
        const name = label(28);
        name.text = row.name;
        name.anchor.set(0, 0.5);
        name.x = -half + LIST.nameX;
        name.scale.set(Math.min(1, LIST.nameWidth / Math.max(name.width, 1)));
        const star = iconSprite('Icon_Star_On', LIST.star);
        star.x = half + LIST.starX;
        const stars = label(30);
        stars.text = String(row.stars);
        stars.anchor.set(0, 0.5);
        stars.x = half + LIST.starsX;
        holder.addChild(avatar, name, star, stars);
        return holder;
    }

    private showRewards(): void {
        let y = LIST.top;
        for (const goal of goals()) {
            this.list.addChild(this.rewardRow(goal, y));
            y += REWARD.rowHeight + REWARD.rowGap;
        }
    }

    private rewardRow(goal: RankingGoal, y: number): PIXI.Container {
        const holder = new PIXI.Container();
        holder.y = y + REWARD.rowHeight / 2;
        const half = LIST.width / 2;
        const ready = goalClaimable(goal);
        const frame = framePlane(ready ? 'ListFrame04_Single_f_Yellow' : 'ListFrame04_Single_f_Blue', LIST.width, REWARD.rowHeight);
        frame.position.set(-half, -REWARD.rowHeight / 2);
        const icon = iconSprite(goal.type === 'stars' ? 'Icon_Star_On' : 'ItemIcon_Trophy_Gold', REWARD.icon);
        icon.x = -half + REWARD.iconX;
        const title = label(REWARD.titleSize);
        title.text = goalTitle(goal);
        title.anchor.set(0, 0.5);
        title.position.set(-half + REWARD.titleX, REWARD.titleY);
        const progress = label(REWARD.titleSize);
        progress.text = goalProgress(goal);
        progress.anchor.set(0, 0.5);
        progress.position.set(-half + REWARD.titleX, REWARD.progressY);
        holder.addChild(frame, icon, title, progress);
        const buttonX = half + REWARD.buttonX;
        if (goalClaimed(goal)) {
            const check = iconSprite('Icon_Check03_l', REWARD.check);
            check.x = buttonX;
            holder.addChild(check);
            return holder;
        }
        const button = new PIXI.Container();
        button.x = buttonX;
        const [plane, words] = buttonParts(REWARD.buttonWidth, REWARD.buttonHeight, String(goal.reward), goalDone(goal) ? 'Button01_l_Green' : 'Button01_l_Gray');
        words.x = 18;
        const coin = iconSprite('Icon_Coin', REWARD.coin);
        coin.x = -46;
        button.addChild(plane, words, coin);
        if (ready) {
            tappable(button, () => {
                claimGoal(goal);
                UfoAudio.win();
                this.refresh();
            });
        }
        holder.addChild(button);
        return holder;
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
        this.coinBar.position.set(left + COIN_BAR.left + COIN_BAR.icon / 2, top + COIN_BAR.top);
        const zoneY = top + HEADER.strip;
        this.zone.position.set(left, zoneY);
        this.zone.width = screen.width / TABS.zoneScale;
        this.tabs.position.set(screen.center.x, zoneY + TABS.trackY);
        this.ends.position.set(screen.center.x, zoneY + TABS.zone + LIST.ends);
        this.list.position.set(screen.center.x, zoneY + TABS.zone + LIST.top);
        const bottomY = top + screen.height - BOTTOM.y;
        const total = BOTTOM.back + BOTTOM.gap + BOTTOM.play;
        this.backButton.position.set(screen.center.x - total / 2 + BOTTOM.back / 2, bottomY);
        this.playButton.position.set(screen.center.x + total / 2 - BOTTOM.play / 2, bottomY);
    }

    public override destroy(): void {
        gsap.killTweensOf(this.chosen);
        gsap.killTweensOf(this.playButton.scale);
        super.destroy({ children: true });
    }
}
