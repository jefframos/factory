// AchievementsPanel.ts
//
// Opened from the HUD's trophy button: one row per achievement (ui/dig.json `achievements`) — its icon in a
// frame coloured by level, the name and level ("Lv 2/4"), the current goal ("Dig 500 blocks") with a
// progress bar, the reward, and a button: CLAIM (with the "!" when ready) pays the tier and moves on to the
// next; the last tier also unlocks the achievement's decor in the hub. Styles: ui/uikit.json (screen
// "achievements").

import * as PIXI from 'pixi.js';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { AchievementDef, DIG } from '../data/DigConfig';
import { DigProgress } from '../data/DigProgress';
import { t, names } from '../i18n/Localization';
import { DigAudio } from '../audio/DigAudio';
import { GameAnalytics } from '../analytics/GameAnalytics';

const WIDTH = 760;
const ROW_HEIGHT = 150;
const HEADER = 70;
/** Room under the last row for the footer line, clear of the frame's bottom edge. */
const FOOTER = 96;
const HEIGHT = HEADER + DIG.achievements.length * ROW_HEIGHT + FOOTER;
/** Frame size, for the HUD to fit the panel on screen. */
export const ACHIEVEMENTS_SIZE = { width: WIDTH, height: HEIGHT };
const ICON_FRAME = 104;
const TEXT_X = -WIDTH / 2 + 30 + ICON_FRAME + 20;
const TEXT_WIDTH = 390;
const BAR_WIDTH = 360;
const BUTTON = { x: WIDTH / 2 - 90, width: 140, height: 62 };
/** Icon frame per level reached: none yet, then climbing colours, gold when complete. */
const LEVEL_FRAMES = ['frameLevel0', 'frameLevel1', 'frameLevel2', 'frameLevel3', 'frameDone'];

export class AchievementsPanel extends PIXI.Container {
    private readonly body = new PIXI.Container();

    /** `onClaimed` after a level is claimed: the HUD plays the reward popup and flies the cash in. */
    public constructor(private readonly onClaimed: (achievement: AchievementDef, level: number, reward: number, decor: boolean, hat?: string) => void) {
        super();
        const frame = UiKit.image('achievements', 'panel', WIDTH, HEIGHT);
        const ribbon = UiKit.sprite('achievements', 'ribbon', 0.55);
        ribbon.y = -HEIGHT / 2;
        const title = UiKit.text('achievements', 'title');
        title.anchor.set(0.5);
        title.y = -HEIGHT / 2 - 5;
        // Taps on the panel must not fall through to the movement joystick underneath.
        frame.eventMode = 'static';
        frame.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.addChild(frame, ribbon, title, this.body);
        this.visible = false;
    }

    public refresh(): void {
        // Stop the old cards' pulses first: a tween left running on a destroyed sprite throws every frame and stalls
        // every other animation in the game (the reward coins froze mid-air).
        UiAnim.kill(this.body);
        this.body.removeChildren().forEach((child) => child.destroy({ children: true }));
        DIG.achievements.forEach((achievement, i) => {
            const row = this.row(achievement);
            row.y = -HEIGHT / 2 + HEADER + ROW_HEIGHT * (i + 0.5);
            this.body.addChild(row);
        });
        const footer = UiKit.fit(UiKit.text('achievements', 'footer', { text: t('achievementsFooter') }), WIDTH - 40);
        footer.anchor.set(0.5);
        footer.y = HEIGHT / 2 - 44;
        this.body.addChild(footer);
    }

    private row(achievement: AchievementDef): PIXI.Container {
        const row = new PIXI.Container();
        const level = DigProgress.achievementLevel(achievement.id);
        const tiers = achievement.tiers.length;
        const done = level >= tiers;
        const tier = achievement.tiers[Math.min(level, tiers - 1)];
        const value = DigProgress.achievementStat(achievement.stat);
        const ready = DigProgress.canClaim(achievement.id);

        row.addChild(UiKit.image('achievements', 'rowBack', WIDTH - 32, ROW_HEIGHT - 12));
        const iconX = -WIDTH / 2 + 30 + ICON_FRAME / 2;
        const frame = UiKit.image('achievements', LEVEL_FRAMES[Math.min(level, LEVEL_FRAMES.length - 1)], ICON_FRAME, ICON_FRAME);
        frame.x = iconX;
        const icon = PIXI.Sprite.from(achievement.icon);
        icon.anchor.set(0.5);
        icon.scale.set((ICON_FRAME * 0.62) / Math.max(icon.texture.width, icon.texture.height, 1));
        icon.x = iconX;
        row.addChild(frame, icon);

        const name = UiKit.fit(UiKit.text('achievements', 'name', { name: `${names.achievement(achievement).toUpperCase()}  ${done ? t('max') : t('level', { level: level + 1, levels: tiers })}` }), TEXT_WIDTH);
        name.anchor.set(0, 0.5);
        name.position.set(TEXT_X, -44);
        const goal = names.achievementGoal(achievement, tier.goal.toLocaleString('en-US'));
        const cash = tier.reward.toLocaleString('en-US');
        const decorAt = achievement.decorAt ?? tiers;
        const reward = done
            ? achievement.hat ? t('hatEarned', { hat: names.look(achievement.hat) }) : t('rewardCash', { reward: cash })
            : achievement.hat && level === tiers - 1 ? t('rewardCashHat', { reward: cash, hat: names.look(achievement.hat) })
                : achievement.decor && level === decorAt - 1 ? t('rewardCashDecor', { reward: cash, decor: names.decor({ id: achievement.id, decor: achievement.decor }) })
                    : t('rewardCash', { reward: cash });
        const info = UiKit.fit(UiKit.text('achievements', 'info', { text: done ? t('complete') : goal }), TEXT_WIDTH);
        info.anchor.set(0, 0.5);
        info.position.set(TEXT_X, -14);
        row.addChild(name, info);

        // Progress towards the current tier.
        const bar = new PIXI.Container();
        bar.position.set(TEXT_X + BAR_WIDTH / 2, 16);
        bar.addChild(UiKit.image('achievements', 'barBack', BAR_WIDTH, 22));
        const progress = done ? 1 : Math.min(1, value / tier.goal);
        if (progress > 0) {
            const width = Math.max(14, (BAR_WIDTH - 4) * progress);
            const fill = UiKit.image('achievements', done || ready ? 'barDone' : 'barFill', width, 18);
            fill.x = -(BAR_WIDTH - 4) / 2 + width / 2;
            bar.addChild(fill);
        }
        const count = UiKit.text('achievements', 'count', { text: done ? t('done') : `${Math.min(value, tier.goal).toLocaleString('en-US')} / ${tier.goal.toLocaleString('en-US')}` });
        count.anchor.set(0.5);
        bar.addChild(count);
        const rewardText = UiKit.fit(UiKit.text('achievements', 'reward', { text: reward }), TEXT_WIDTH);
        rewardText.anchor.set(0, 0.5);
        rewardText.position.set(TEXT_X, 46);
        row.addChild(bar, rewardText);

        row.addChild(this.button(achievement, done, ready));
        return row;
    }

    private button(achievement: AchievementDef, done: boolean, ready: boolean): PIXI.Container {
        const button = new PIXI.Container();
        button.x = BUTTON.x;
        const image = done ? 'buttonDone' : ready ? 'buttonClaim' : 'buttonLocked';
        button.addChild(UiKit.image('achievements', image, BUTTON.width, BUTTON.height));
        if (done) {
            const check = PIXI.Sprite.from(UiKit.imageName('hud', 'check'));
            check.anchor.set(0.5);
            check.scale.set(34 / Math.max(check.texture.width, check.texture.height, 1));
            check.y = -3;
            button.addChild(check);
        } else {
            button.addChild(UiKit.fit(UiKit.text('achievements', 'buttonLabel', { text: ready ? t('claim') : t('locked') }), BUTTON.width - 20));
        }
        if (!ready) {
            if (!done) button.alpha = 0.7;
            return button;
        }
        // The pizza game's "!" over a claimable reward.
        const alert = PIXI.Sprite.from(UiKit.imageName('hud', 'alert'));
        alert.anchor.set(0.5, 1);
        alert.scale.set(34 / Math.max(alert.texture.height, 1));
        alert.position.set(BUTTON.width / 2 - 8, -BUTTON.height / 2 + 12);
        button.addChild(alert);
        UiAnim.pulse(button, 0.06, 0.6);
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        button.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            const claimed = DigProgress.claimAchievement(achievement.id);
            if (claimed) DigAudio.play('confirm');
            if (!claimed) return;
            GameAnalytics.achievementClaimed(achievement.id, DigProgress.achievementLevel(achievement.id));
            this.onClaimed(achievement, DigProgress.achievementLevel(achievement.id), claimed.reward, claimed.decor, claimed.hat);
            this.refresh();
        });
        return button;
    }
}
