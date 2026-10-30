// RewardPopup.ts
//
// The "you earned a prize" moment for a claimed achievement level, after bandit-controller's level-complete payout
// (PathLevelScene.showPayout + FlyingResourceIcon): a card pops in at the centre with light rays, sparks and
// confetti — the achievement's icon, its name and level, the prize and, for the last level, the trophy it adds to the
// hub — then after a short hold a stream of cash icons arcs into the HUD's money icon while the prize counts down,
// the card shrinking as it "spends" itself. The money (already added by DigProgress) is held back from the HUD and
// handed over coin by coin, so the counter climbs exactly as the coins land. Popups queue.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { UiAnim, UiTween } from './UiAnim';
import { AchievementDef } from '../data/DigConfig';
import { t, names } from '../i18n/Localization';
import { DigAudio } from '../audio/DigAudio';

const WIDTH = 440;
const HEIGHT = 330;
const HOLD_SEC = 1.1;
/** The dim behind a prize: how dark, and how far it reaches (past any screen edge). */
const DIM_ALPHA = 0.6;
const DIM_EXTENT = 5000;
const COIN_SIZE = 52;
export const COIN_STAGGER = 0.06;
const FLIGHT_SEC = 0.6;
/** Coins rise this far above the straight line on their way (screen +Y is down, so it's negative). */
const ARC_HEIGHT = -110;

/**
 * One cash icon added to `layer` at `from` (layer space), flying along an arc into `target()` (re-aimed every frame,
 * in case the HUD moves); `onArrive` runs once it lands. Shared by this popup and the find banner's CLAIM.
 */
export function flyCoin(layer: PIXI.Container, from: PIXI.Point, target: () => PIXI.Point, delay: number, onArrive: () => void): UiTween {
    const coin = PIXI.Sprite.from(UiKit.imageName('hud', 'moneyIcon'));
    coin.anchor.set(0.5);
    coin.scale.set(COIN_SIZE / Math.max(coin.texture.width, coin.texture.height, 1));
    coin.visible = false;
    layer.addChild(coin);
    const startScale = coin.scale.x;
    const progress = { t: 0 };
    return gsap.to(progress, {
        t: 1,
        duration: FLIGHT_SEC,
        delay,
        ease: 'power2.in',
        onUpdate: () => {
            const to = target();
            // Quadratic bezier through a raised midpoint.
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2 + ARC_HEIGHT;
            const t = progress.t;
            const u = 1 - t;
            coin.visible = true;
            coin.position.set(u * u * from.x + 2 * u * t * midX + t * t * to.x, u * u * from.y + 2 * u * t * midY + t * t * to.y);
            coin.scale.set(startScale * (1 - t * 0.35));
            coin.rotation = Math.sin(t * Math.PI * 2) * 0.3;
        },
        onComplete: () => {
            coin.destroy();
            // Run the landing just after gsap's update loop, not inside it: landing refreshes the HUD, which kills
            // the old buttons' tweens, and killing tweens mid-loop drops the other coins out of gsap's list (they
            // froze mid-air, never finishing).
            queueMicrotask(onArrive);
        },
    });
}

/** How many coins a payout of `amount` flies in as (each carrying a share). */
export function coinCount(amount: number): number {
    return Math.min(14, Math.max(6, Math.round(amount / 50)));
}

export interface RewardHost {
    /** Where the coins fly to, in the popup layer's parent space (the HUD's money icon). */
    moneyTarget(): PIXI.Point;
    /** Keep `amount` off the HUD's money until handed back with release(). */
    hold(amount: number): void;
    release(amount: number): void;
    /** A coin landed: bump the money icon. */
    punchMoney(): void;
    /** The popup's centre, in the parent's space. */
    center(): PIXI.Point;
}

interface Reward {
    achievement: AchievementDef;
    level: number;
    levels: number;
    amount: number;
    decor?: string;
}

export class RewardPopup extends PIXI.Container {
    private readonly queue: Reward[] = [];
    private playing = false;
    private tweens: UiTween[] = [];

    public constructor(private readonly host: RewardHost) {
        super();
        // Its dim (while a prize plays) catches taps; the card and coins don't take any.
        this.eventMode = 'passive';
    }

    /** Queues the prize for achievement level `level` (1-based) of `levels`; `decor` = the hub trophy it unlocked. */
    public show(achievement: AchievementDef, level: number, levels: number, amount: number, decor?: string): void {
        // The money is already in the save: hold it back now, so the HUD doesn't jump before the coins land.
        this.host.hold(amount);
        this.queue.push({ achievement, level, levels, amount, decor });
        this.next();
    }

    private next(): void {
        if (this.playing) return;
        const reward = this.queue.shift();
        if (!reward) return;
        this.playing = true;
        DigAudio.play('complete');
        DigAudio.play('cheer');
        if (reward.decor) DigAudio.play('applause');
        this.removeChildren().forEach((child) => child.destroy({ children: true }));
        const center = this.host.center();
        // The screen darkens behind the prize and swallows taps until its coins have landed, so another level can't
        // be claimed (nor the game played) mid-payout.
        const dim = new PIXI.Graphics().beginFill(0x000000, DIM_ALPHA).drawRect(-DIM_EXTENT, -DIM_EXTENT, DIM_EXTENT * 2, DIM_EXTENT * 2).endFill();
        dim.eventMode = 'static';
        dim.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        dim.on('pointertap', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.addChild(dim);
        this.tweens.push(gsap.fromTo(dim, { alpha: 0 }, { alpha: 1, duration: 0.25 }));

        const card = new PIXI.Container();
        card.position.copyFrom(center);
        this.addChild(card);
        const { tweens: rayTweens, rays } = UiAnim.rays(card, 420, 0xffd86b, 0.9, 10);
        card.addChild(UiKit.image('findBanner', 'back', WIDTH, HEIGHT));

        const title = UiKit.fit(UiKit.text('findBanner', 'rarity', { text: reward.decor ? t('achievementComplete') : t('achievementTitle') }, { fill: 0xffd23f }), WIDTH - 48);
        title.y = -HEIGHT / 2 + 40;
        const icon = PIXI.Sprite.from(reward.achievement.icon);
        icon.anchor.set(0.5);
        icon.scale.set(100 / Math.max(icon.texture.width, icon.texture.height, 1));
        icon.y = -38;
        const name = UiKit.fit(UiKit.text('findBanner', 'name', { name: `${names.achievement(reward.achievement).toUpperCase()}  ${t('level', { level: reward.level, levels: reward.levels })}` }), WIDTH - 48);
        name.y = 38;
        const amount = UiKit.fit(UiKit.text('findBanner', 'reward', { reward: reward.amount.toLocaleString('en-US') }), WIDTH - 48);
        amount.y = 78;
        const hint = UiKit.fit(UiKit.text('findBanner', 'hint', { text: reward.decor ?? t('moreAchievements') }), WIDTH - 48);
        hint.y = HEIGHT / 2 - 32;
        card.addChild(title, icon, name, amount, hint);

        this.tweens.push(
            ...rayTweens,
            gsap.fromTo(rays.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.5, ease: 'back.out(1.6)' }),
            ...UiAnim.popIn(card),
            gsap.fromTo(icon.scale, { x: 0, y: 0 }, { x: icon.scale.x, y: icon.scale.y, duration: 0.55, delay: 0.15, ease: 'elastic.out(1.1, 0.5)' }),
            ...UiAnim.staggerRise([name, amount], 0.25, 0.08, 30),
            ...UiAnim.sparkBurst(card, 0, -38, 0xffe066, 150),
            ...UiAnim.confetti(card, 0, -60, 60, 1.1),
        );

        const coins = coinCount(reward.amount);
        const countSec = coins * COIN_STAGGER + FLIGHT_SEC;
        let landed = 0;
        // Everything after the hold is scheduled now with delays (not from inside a delayedCall callback: tweens made
        // there could drop out of gsap's update list and freeze mid-air).
        this.tweens.push(
            gsap.to(card.scale, { x: 0.75, y: 0.75, duration: countSec, delay: HOLD_SEC, ease: 'power1.in' }),
            ...UiAnim.countUp(amount, reward.amount, 0, (value) => `+$${value.toLocaleString('en-US')}`, countSec, HOLD_SEC),
        );
        amount.text = `+$${reward.amount.toLocaleString('en-US')}`;
        for (let i = 0; i < coins; i++) {
            // Each coin carries its share; the last one takes the rounding remainder.
            const share = i === coins - 1 ? reward.amount - Math.floor(reward.amount / coins) * (coins - 1) : Math.floor(reward.amount / coins);
            const from = new PIXI.Point(center.x + (Math.random() - 0.5) * 80, center.y + 78 + (Math.random() - 0.5) * 40);
            this.tweens.push(flyCoin(this, from, () => this.host.moneyTarget(), HOLD_SEC + i * COIN_STAGGER, () => {
                landed++;
                this.host.release(share);
                this.host.punchMoney();
                DigAudio.play('coins');
                if (landed < coins) return;
                this.tweens.push(gsap.to(card, { alpha: 0, duration: 0.3, delay: 0.3, onComplete: () => this.finish() }));
            }));
        }
    }

    private finish(): void {
        this.tweens.forEach((tween) => tween.kill());
        this.tweens = [];
        this.removeChildren().forEach((child) => child.destroy({ children: true }));
        this.playing = false;
        this.next();
    }

    public override destroy(): void {
        this.tweens.forEach((tween) => tween.kill());
        super.destroy({ children: true });
    }
}
