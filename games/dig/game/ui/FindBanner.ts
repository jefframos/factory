// FindBanner.ts
//
// The "you found something" moment: a popup with light rays in the find's rarity colour, its model, the
// rarity ("RARE FIND!"), its name, what it's worth (DigProgress.findPayout: rarer and deeper pays more) and a CLAIM
// button right there: tapping it pays the reward on the spot (onClaim: the HUD flies the coins from the button into
// the money), so nobody has to stop digging and walk back to the Trophy Room for it. The very first find has the
// pointing hand on CLAIM. Left alone, a banner claims itself after AUTO_CLAIM_SEC (FIRST_CLAIM_SEC for the first
// find); the Trophy Room's CLAIM buttons (CollectionPanel) only pick up what's still waiting (an old save, a closed
// tab). Rare and better ones throw confetti. Completing the collection gets its own banner. Banners queue, so a burst
// of finds plays one after another; none stops the game (only the button takes taps). Shown at the bottom of the
// screen (DigHud), clear of the miner. Styles: ui/uikit.json (screen "findBanner").

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { UiAnim, UiTween } from './UiAnim';
import { ModelIcons } from './ModelIcons';
import { RARITY_COLORS } from './CollectionPanel';
import { DIG, FindDef, Rarity } from '../data/DigConfig';
import { COLLECTION_REWARD, DigProgress, FindResult } from '../data/DigProgress';
import { t, names, type StringId } from '../i18n/Localization';
import { DigAudio } from '../audio/DigAudio';

const WIDTH = 400;
const HEIGHT = 390;
export const FIND_BANNER_SIZE = { width: WIDTH, height: HEIGHT };
/** Widest any line may be: the card minus its rounded border. */
const TEXT_WIDTH = WIDTH - 48;
/** The CLAIM button, its centre this far below the card's. */
const BUTTON = { width: 210, height: 66, y: 132 };
/** A banner nobody taps claims itself after this long; the first find (the hand on CLAIM) waits longer. */
const AUTO_CLAIM_SEC = 5;
const FIRST_CLAIM_SEC = 12;
/** After the claim, the card fades this long after its coins set off. */
const FADE_DELAY_SEC = 0.5;
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
    /** What CLAIM pays: a find id, or COLLECTION_REWARD. */
    claimId: string;
    /** The tutorial's first find: the hand on CLAIM, and longer before it claims itself. */
    first: boolean;
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
    /** The first find's pointing hand, hidden once CLAIM is tapped. */
    private hand: PIXI.Container | null = null;

    /** `onClaim` pays a waiting reward (a find id or COLLECTION_REWARD), its coins flying from `from` (on screen). */
    public constructor(private readonly onClaim: (id: string, from: PIXI.Point) => void) {
        super();
        // Only the CLAIM button takes taps: the rest of the card never gets in the way of steering the miner.
        this.eventMode = 'passive';
    }

    /** Queues a find's banner; `amount` is its reward (DigProgress.addFind already holds it, waiting to be claimed). */
    public show(find: FindDef, result: FindResult, amount: number): void {
        this.queue.push({
            title: result.first ? t('newFind', { title: t(RARITY_LABEL[find.rarity]) }) : t(RARITY_LABEL[find.rarity]),
            color: RARITY_COLORS[find.rarity],
            name: names.find(find).toUpperCase(),
            amount,
            claimId: find.id,
            first: DigProgress.totalFinds === 1,
            icon: `./dig/models/${find.model}`,
            confetti: find.rarity !== 'common',
        });
        if (result.completed) {
            this.queue.push({
                title: t('titleCollection'),
                color: RARITY_COLORS.legendary,
                name: t('allArtifacts', { count: DIG.finds.length }),
                amount: DIG.collectionReward.money,
                claimId: COLLECTION_REWARD,
                first: false,
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
        const button = this.claimButton(() => this.claim(banner, card, button));
        card.addChild(name, reward, button);
        this.hand = banner.first ? card.addChild(this.pointingHand()) : null;
        this.tweens.push(...rayTweens, ...UiAnim.popIn(card), ...UiAnim.pulse(button, 0.06, 0.5));
        if (banner.confetti) {
            this.tweens.push(...UiAnim.confetti(this, 0, -60, 70, 1.2));
        }
        this.tweens.push(gsap.delayedCall(banner.first ? FIRST_CLAIM_SEC : AUTO_CLAIM_SEC, () => this.claim(banner, card, button)));
    }

    private claimButton(onTap: () => void): PIXI.Container {
        const button = new PIXI.Container();
        button.y = BUTTON.y;
        const label = UiKit.text('achievements', 'buttonLabel', { text: t('claim') });
        UiKit.fit(label, BUTTON.width - 24);
        button.addChild(UiKit.image('achievements', 'buttonClaim', BUTTON.width, BUTTON.height), label);
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        button.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            onTap();
        });
        return button;
    }

    /** The handHud pointing hand, fingertip on the CLAIM button and tapping at it (same art as the HUD's). */
    private pointingHand(): PIXI.Container {
        const holder = new PIXI.Container();
        holder.eventMode = 'none';
        holder.position.set(BUTTON.width / 2 - 30, BUTTON.y);
        const hand = PIXI.Sprite.from('handHud');
        hand.width = hand.height = 80;
        hand.position.set(-80 * 0.22, -80 * 0.16);
        holder.addChild(hand);
        this.tweens.push(gsap.to(holder, { y: BUTTON.y + 10, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
        return holder;
    }

    /** CLAIM (tapped, or on its own after a while): paid now, its coins fly off the button, then the next banner. */
    private claim(banner: Banner, card: PIXI.Container, button: PIXI.Container): void {
        if (!button.visible) return;
        this.onClaim(banner.claimId, button.getGlobalPosition());
        button.visible = false;
        if (this.hand) this.hand.visible = false;
        this.tweens.push(gsap.to(card, {
            alpha: 0,
            duration: 0.35,
            delay: FADE_DELAY_SEC,
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
