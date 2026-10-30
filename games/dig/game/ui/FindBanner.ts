// FindBanner.ts
//
// The "you found something" moment: a popup with light rays in the find's rarity colour, its model, the
// rarity ("RARE FIND!"), its name, its payout (DigProgress.findPayout: rarer and deeper pays more) and a CLAIM
// button — tapping it flies the cash into the HUD's money, coin by coin (the money is already in the save; the HUD
// holds it back until the coins land). Rare and better ones throw confetti; the first time a kind is found, a pointer
// to the collection totem. Completing the collection gets its own banner. Banners queue, so a burst of finds plays
// one after another. Shown at the bottom of the screen (DigHud), clear of the miner.
//
// The very first find is a tutorial step: the game dims and stops (host.onBlocking) and the hand points at CLAIM
// until it's tapped. Later finds don't stop the game and claim themselves after AUTO_CLAIM_SEC if left alone.
// Styles: ui/uikit.json (screen "findBanner").

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { UiAnim, UiTween } from './UiAnim';
import { ModelIcons } from './ModelIcons';
import { RARITY_COLORS } from './CollectionPanel';
import { flyCoin, coinCount, COIN_STAGGER } from './RewardPopup';
import { DIG, FindDef, Rarity } from '../data/DigConfig';
import { FindResult } from '../data/DigProgress';
import { t, names, type StringId } from '../i18n/Localization';
import { DigAudio } from '../audio/DigAudio';
import { GameAnalytics } from '../analytics/GameAnalytics';

const WIDTH = 400;
const HEIGHT = 450;
/** Room under the last line (the hint), inside the card's border. */
const BOTTOM_PADDING = 40;
export const FIND_BANNER_SIZE = { width: WIDTH, height: HEIGHT };
/** Widest any line may be: the card minus its rounded border. */
const TEXT_WIDTH = WIDTH - 48;
const BUTTON = { width: 190, height: 66, y: 100 };
/** A find nobody claims (not the tutorial one) claims itself after this long. */
const AUTO_CLAIM_SEC = 6;
const RARITY_LABEL: Record<Rarity, StringId> = {
    common: 'find_common',
    rare: 'find_rare',
    epic: 'find_epic',
    legendary: 'find_legendary',
};

/** What the banner needs from the HUD. */
export interface FindBannerHost {
    /** The money icon, in the banner's parent space (where claimed coins fly to). */
    moneyTarget(): PIXI.Point;
    /** Keep `amount` off the HUD's money until handed back with release(). */
    hold(amount: number): void;
    release(amount: number): void;
    /** A coin landed: bump the money icon. */
    punchMoney(): void;
    /** The tutorial banner started / stopped holding the game (dim it, stop the miner). */
    onBlocking(blocking: boolean): void;
}

interface Banner {
    /** The find (none for the collection-complete banner). */
    findId?: string;
    title: string;
    color: number;
    name: string;
    amount: number;
    hint: string;
    icon?: string;
    confetti: boolean;
    /** The first find: blocks the game until claimed. */
    tutorial: boolean;
}

/** Shrinks a line that's wider than the card (long find names, "NEW LEGENDARY FIND!!!"). */
function fitWidth(text: PIXI.Text): void {
    text.scale.set(Math.min(1, TEXT_WIDTH / Math.max(text.width, 1)));
}

export class FindBanner extends PIXI.Container {
    private readonly queue: Banner[] = [];
    private showing = false;
    private tweens: UiTween[] = [];
    private blockingNow = false;

    public constructor(private readonly host: FindBannerHost) {
        super();
        this.eventMode = 'passive';
    }

    /** The tutorial banner is up: the game waits for its CLAIM. */
    public get blocking(): boolean {
        return this.blockingNow;
    }

    /** Queues a find's banner; `amount` is what it pays (already added to the money), `tutorial` = the first find ever. */
    public show(find: FindDef, result: FindResult, amount: number, tutorial: boolean): void {
        this.host.hold(amount);
        this.queue.push({
            findId: find.id,
            title: result.first ? t('newFind', { title: t(RARITY_LABEL[find.rarity]) }) : t(RARITY_LABEL[find.rarity]),
            color: RARITY_COLORS[find.rarity],
            name: names.find(find).toUpperCase(),
            amount,
            hint: result.first ? t('findAdded') : t('findAnother'),
            icon: `./dig/models/${find.model}`,
            confetti: find.rarity !== 'common',
            tutorial,
        });
        if (result.completed) {
            const reward = DIG.collectionReward;
            this.host.hold(reward.money);
            this.queue.push({
                title: t('titleCollection'),
                color: RARITY_COLORS.legendary,
                name: t('allArtifacts', { count: DIG.finds.length }),
                amount: reward.money,
                hint: t('collectionComplete'),
                confetti: true,
                tutorial: false,
            });
        }
        this.next();
    }

    private setBlocking(blocking: boolean): void {
        if (blocking === this.blockingNow) return;
        this.blockingNow = blocking;
        this.host.onBlocking(blocking);
    }

    private next(): void {
        if (this.showing) return;
        const banner = this.queue.shift();
        if (!banner) return;
        this.showing = true;
        this.setBlocking(banner.tutorial);
        // Rare and better finds get a cheer; the legendary one and the completed collection, applause too.
        if (banner.confetti) DigAudio.play('cheer');
        if (banner.color === RARITY_COLORS.legendary) DigAudio.play('applause');
        this.removeChildren().forEach((child) => child.destroy({ children: true }));

        const card = new PIXI.Container();
        this.addChild(card);
        const { tweens: rayTweens } = UiAnim.rays(card, 400, banner.color, 0.9, 8);
        const back = UiKit.image('findBanner', 'back', WIDTH, HEIGHT);
        // Taps on the card must not start the movement joystick underneath.
        back.eventMode = 'static';
        back.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        card.addChild(back);
        const title = UiKit.text('findBanner', 'rarity', { text: banner.title }, { fill: banner.color });
        title.anchor.set(0.5);
        fitWidth(title);
        title.y = -HEIGHT / 2 + 38;
        card.addChild(title);
        if (banner.icon) {
            const icon = ModelIcons.sprite(banner.icon, 110);
            icon.y = -78;
            card.addChild(icon);
            this.tweens.push(gsap.fromTo(icon, { rotation: -0.12 }, { rotation: 0.12, duration: 0.8, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
        } else {
            const star = UiKit.sprite('hud', 'moneyIcon');
            star.scale.set(100 / Math.max(star.width, 1));
            star.y = -78;
            card.addChild(star);
        }
        const name = UiKit.text('findBanner', 'name', { name: banner.name });
        name.anchor.set(0.5);
        fitWidth(name);
        name.y = 2;
        const reward = UiKit.text('findBanner', 'reward', { reward: banner.amount.toLocaleString('en-US') });
        reward.anchor.set(0.5);
        fitWidth(reward);
        reward.y = 40;
        // Hints are sentences: wrapped onto two lines (uikit.json wrapWidth) rather than shrunk to unreadable.
        // Anchored by its bottom, so one line or two, it keeps the same room under it.
        const hint = UiKit.text('findBanner', 'hint', { text: banner.hint });
        hint.anchor.set(0.5, 1);
        fitWidth(hint);
        hint.y = HEIGHT / 2 - BOTTOM_PADDING;
        const button = this.claimButton(() => this.claim(banner, card, button, reward));
        card.addChild(name, reward, button, hint);
        if (banner.tutorial) card.addChild(this.pointingHand(BUTTON.y));
        this.tweens.push(...rayTweens, ...UiAnim.popIn(card), ...UiAnim.pulse(button, 0.06, 0.5));
        if (banner.confetti) {
            this.tweens.push(...UiAnim.confetti(this, 0, -60, 70, 1.2));
        }
        if (!banner.tutorial) {
            this.tweens.push(gsap.delayedCall(AUTO_CLAIM_SEC, () => this.claim(banner, card, button, reward)));
        }
    }

    private claimButton(onTap: () => void): PIXI.Container {
        const button = new PIXI.Container();
        button.y = BUTTON.y;
        button.addChild(UiKit.image('achievements', 'buttonClaim', BUTTON.width, BUTTON.height),
            UiKit.fit(UiKit.text('achievements', 'buttonLabel', { text: t('claim') }), BUTTON.width - 24));
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
    private pointingHand(y: number): PIXI.Container {
        const holder = new PIXI.Container();
        holder.eventMode = 'none';
        holder.y = y;
        const hand = PIXI.Sprite.from('handHud');
        hand.width = hand.height = 80;
        hand.position.set(30 - 80 * 0.22, 10 - 80 * 0.16);
        holder.addChild(hand);
        this.tweens.push(gsap.to(holder, { y: y + 10, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
        return holder;
    }

    /** CLAIM (tapped, or on its own after a while): the cash flies from the button into the money, then the next banner. */
    private claim(banner: Banner, card: PIXI.Container, button: PIXI.Container, amountText: PIXI.Text): void {
        if (!button.visible) return;
        button.visible = false;
        if (banner.findId) GameAnalytics.findClaimed(banner.findId);
        if (banner.tutorial) GameAnalytics.tutorialStep('claim');
        DigAudio.play('confirm');
        this.setBlocking(false);
        const coins = coinCount(banner.amount);
        const target = () => this.toLocal(this.parent.toGlobal(this.host.moneyTarget()));
        let landed = 0;
        let paid = 0;
        this.tweens.push(...UiAnim.countUp(amountText, banner.amount, 0, (value) => `+$${value.toLocaleString('en-US')}`, coins * COIN_STAGGER + 0.6));
        for (let i = 0; i < coins; i++) {
            // Each coin carries its share; the last one takes the rounding remainder.
            const share = i === coins - 1 ? banner.amount - paid : Math.floor(banner.amount / coins);
            paid += share;
            const from = new PIXI.Point(card.x + (Math.random() - 0.5) * 80, card.y + BUTTON.y + (Math.random() - 0.5) * 30);
            this.tweens.push(flyCoin(this, from, target, i * COIN_STAGGER, () => {
                landed++;
                this.host.release(share);
                this.host.punchMoney();
                DigAudio.play('coins');
                if (landed < coins) return;
                this.tweens.push(gsap.to(card, { alpha: 0, duration: 0.3, delay: 0.2, onComplete: () => this.finish() }));
            }));
        }
    }

    private finish(): void {
        this.tweens.forEach((tween) => tween.kill());
        this.tweens = [];
        this.removeChildren().forEach((child) => child.destroy({ children: true }));
        this.showing = false;
        this.next();
    }

    public override destroy(): void {
        this.tweens.forEach((tween) => tween.kill());
        super.destroy({ children: true });
    }
}
