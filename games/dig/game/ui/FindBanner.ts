// FindBanner.ts
//
// The "you found something" moment: a popup with light rays in the find's rarity colour, its model, the
// rarity ("RARE FIND!"), its name and reward — rare and better ones throw confetti — and, the first time
// a kind is found, a pointer to the collection totem. Completing the collection gets its own banner.
// Banners queue, so a burst of finds plays one after another. Styles: ui/uikit.json (screen "findBanner").

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { UiAnim, UiTween } from './UiAnim';
import { ModelIcons } from './ModelIcons';
import { RARITY_COLORS } from './CollectionPanel';
import { DIG, FindDef, Rarity } from '../data/DigConfig';
import { FindResult } from '../data/DigProgress';

const WIDTH = 400;
const HEIGHT = 330;
/** Widest any line may be: the card minus its rounded border. */
const TEXT_WIDTH = WIDTH - 48;
const SHOW_SEC = 2.6;
const RARITY_LABEL: Record<Rarity, string> = {
    common: 'FIND!',
    rare: 'RARE FIND!',
    epic: 'EPIC FIND!!',
    legendary: 'LEGENDARY FIND!!!',
};

interface Banner {
    title: string;
    color: number;
    name: string;
    reward: number;
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

    public show(find: FindDef, result: FindResult): void {
        this.queue.push({
            title: result.first ? `NEW ${RARITY_LABEL[find.rarity]}` : RARITY_LABEL[find.rarity],
            color: RARITY_COLORS[find.rarity],
            name: find.name.toUpperCase(),
            reward: find.reward,
            hint: result.first ? 'Added to the collection — check the totem in the hub!' : 'Another one for the collection',
            icon: `./dig/models/${find.model}`,
            confetti: find.rarity !== 'common',
        });
        if (result.completed) {
            const reward = DIG.collectionReward;
            this.queue.push({
                title: 'COLLECTION COMPLETE!',
                color: RARITY_COLORS.legendary,
                name: `ALL ${DIG.finds.length} ARTIFACTS`,
                reward: reward.money,
                hint: `The ${reward.hat} is waiting in your wardrobe!`,
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
            icon.y = -24;
            card.addChild(icon);
            this.tweens.push(gsap.fromTo(icon, { rotation: -0.12 }, { rotation: 0.12, duration: 0.8, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
        } else {
            const star = UiKit.sprite('hud', 'moneyIcon');
            star.scale.set(110 / Math.max(star.width, 1));
            star.y = -24;
            card.addChild(star);
        }
        const name = UiKit.text('findBanner', 'name', { name: banner.name });
        name.anchor.set(0.5);
        fitWidth(name);
        name.y = 52;
        const reward = UiKit.text('findBanner', 'reward', { reward: banner.reward.toLocaleString('en-US') });
        reward.anchor.set(0.5);
        fitWidth(reward);
        reward.y = 88;
        // Hints are sentences: wrapped onto two lines (uikit.json wrapWidth) rather than shrunk to unreadable.
        const hint = UiKit.text('findBanner', 'hint', { text: banner.hint });
        hint.anchor.set(0.5);
        fitWidth(hint);
        hint.y = HEIGHT / 2 - 30;
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
