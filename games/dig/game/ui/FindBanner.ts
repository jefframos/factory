// FindBanner.ts
//
// The "you found something" moment: a popup with light rays in the find's rarity colour, its model, the
// rarity ("RARE FIND!"), its name and what it's worth (DigProgress.findPayout: rarer and deeper pays more) — and
// where to get it: rewards wait in the Trophy Room (CollectionPanel's CLAIM buttons), so the player heads back to the
// hub for them. Rare and better ones throw confetti. Completing the collection gets its own banner. Banners queue, so
// a burst of finds plays one after another; each fades on its own and never stops the game. Shown at the bottom of
// the screen (DigHud), clear of the miner. Styles: ui/uikit.json (screen "findBanner").

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { UiAnim, UiTween } from './UiAnim';
import { ModelIcons } from './ModelIcons';
import { RARITY_COLORS } from './CollectionPanel';
import { DIG, FindDef, Rarity } from '../data/DigConfig';
import { FindResult } from '../data/DigProgress';
import { t, names, type StringId } from '../i18n/Localization';
import { DigAudio } from '../audio/DigAudio';

const WIDTH = 400;
const HEIGHT = 390;
/** Room under the last line (the hint), inside the card's border. */
const BOTTOM_PADDING = 40;
export const FIND_BANNER_SIZE = { width: WIDTH, height: HEIGHT };
/** Widest any line may be: the card minus its rounded border. */
const TEXT_WIDTH = WIDTH - 48;
const SHOW_SEC = 3;
const RARITY_LABEL: Record<Rarity, StringId> = {
    common: 'find_common',
    rare: 'find_rare',
    epic: 'find_epic',
    legendary: 'find_legendary',
};

interface Banner {
    title: string;
    color: number;
    name: string;
    amount: number;
    hint: string;
    icon?: string;
    confetti: boolean;
}

/** Shrinks a line that's wider than the card (long find names, "NEW LEGENDARY FIND!!!"). */
function fitWidth(text: PIXI.Text): void {
    text.scale.set(Math.min(1, TEXT_WIDTH / Math.max(text.width, 1)));
}

export class FindBanner extends PIXI.Container {
    private readonly queue: Banner[] = [];
    private showing = false;
    private tweens: UiTween[] = [];

    public constructor() {
        super();
        this.eventMode = 'none';
    }

    /** Queues a find's banner; `amount` is its reward, now waiting in the Trophy Room. */
    public show(find: FindDef, result: FindResult, amount: number): void {
        this.queue.push({
            title: result.first ? t('newFind', { title: t(RARITY_LABEL[find.rarity]) }) : t(RARITY_LABEL[find.rarity]),
            color: RARITY_COLORS[find.rarity],
            name: names.find(find).toUpperCase(),
            amount,
            hint: t('claimAtTrophy', { amount: amount.toLocaleString('en-US') }),
            icon: `./dig/models/${find.model}`,
            confetti: find.rarity !== 'common',
        });
        if (result.completed) {
            const reward = DIG.collectionReward.money;
            this.queue.push({
                title: t('titleCollection'),
                color: RARITY_COLORS.legendary,
                name: t('allArtifacts', { count: DIG.finds.length }),
                amount: reward,
                hint: t('claimAtTrophy', { amount: reward.toLocaleString('en-US') }),
                confetti: true,
            });
        }
        this.next();
    }

    private next(): void {
        if (this.showing) return;
        const banner = this.queue.shift();
        if (!banner) return;
        this.showing = true;
        // Rare and better finds get a cheer; the legendary one and the completed collection, applause too.
        if (banner.confetti) DigAudio.play('cheer');
        if (banner.color === RARITY_COLORS.legendary) DigAudio.play('applause');
        this.removeChildren().forEach((child) => child.destroy({ children: true }));

        const card = new PIXI.Container();
        this.addChild(card);
        const { tweens: rayTweens } = UiAnim.rays(card, 400, banner.color, 0.9, 8);
        card.addChild(UiKit.image('findBanner', 'back', WIDTH, HEIGHT));
        const title = UiKit.text('findBanner', 'rarity', { text: banner.title }, { fill: banner.color });
        title.anchor.set(0.5);
        fitWidth(title);
        title.y = -HEIGHT / 2 + 38;
        card.addChild(title);
        if (banner.icon) {
            const icon = ModelIcons.sprite(banner.icon, 120);
            icon.y = -40;
            card.addChild(icon);
            this.tweens.push(gsap.fromTo(icon, { rotation: -0.12 }, { rotation: 0.12, duration: 0.8, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
        } else {
            const star = UiKit.sprite('hud', 'moneyIcon');
            star.scale.set(110 / Math.max(star.width, 1));
            star.y = -40;
            card.addChild(star);
        }
        const name = UiKit.text('findBanner', 'name', { name: banner.name });
        name.anchor.set(0.5);
        fitWidth(name);
        name.y = 44;
        const reward = UiKit.text('findBanner', 'reward', { reward: banner.amount.toLocaleString('en-US') });
        reward.anchor.set(0.5);
        fitWidth(reward);
        reward.y = 82;
        // Hints are sentences: wrapped onto two lines (uikit.json wrapWidth) rather than shrunk to unreadable.
        // Anchored by its bottom, so one line or two, it keeps the same room under it.
        const hint = UiKit.text('findBanner', 'hint', { text: banner.hint }, { fill: 0xffe27a });
        hint.anchor.set(0.5, 1);
        fitWidth(hint);
        hint.y = HEIGHT / 2 - BOTTOM_PADDING;
        card.addChild(name, reward, hint);
        this.tweens.push(...rayTweens, ...UiAnim.popIn(card));
        if (banner.confetti) {
            this.tweens.push(...UiAnim.confetti(this, 0, -60, 70, 1.2));
        }
        this.tweens.push(gsap.to(card, {
            alpha: 0,
            duration: 0.35,
            delay: SHOW_SEC,
            onComplete: () => {
                this.tweens.forEach((tween) => tween.kill());
                this.tweens = [];
                this.showing = false;
                this.next();
            },
        }));
    }

    public override destroy(): void {
        this.tweens.forEach((tween) => tween.kill());
        super.destroy({ children: true });
    }
}
