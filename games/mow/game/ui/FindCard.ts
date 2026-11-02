// FindCard.ts
//
// The "you found something" moment (dig's FindBanner): a card with light rays in the find's colour, its model
// turning a little, a title ("TREASURE FOUND!", "SECRET FOUND!"), its name, what it's worth and a CLAIM button right
// there: tapping it pays on the spot (the HUD flies the coins from the button into the money), so nothing waits in a
// panel. Left alone, a card claims itself after AUTO_CLAIM_SEC. Rare and better throw confetti. Cards queue (a burst of
// finds plays one after another); none stops the game: only the button takes taps. The HUD keeps it at the bottom of
// the screen, clear of the player. Styles: ui/uikit.json ("findBanner").

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { UiAnim, UiTween } from './UiAnim';
import { ModelIcons } from './ModelIcons';
import { t } from '../i18n/Localization';
import { MowAudio } from '../audio/MowAudio';

const WIDTH = 400;
const HEIGHT = 390;
export const FIND_CARD_SIZE = { width: WIDTH, height: HEIGHT };
/** Widest any line may be: the card minus its rounded border. */
const TEXT_WIDTH = WIDTH - 48;
/** The CLAIM button, its centre this far below the card's. */
const BUTTON = { width: 210, height: 66, y: 132 };
/** A card nobody taps claims itself after this long. */
const AUTO_CLAIM_SEC = 6;
/** After the claim, the card fades this long after its coins set off. */
const FADE_DELAY_SEC = 0.5;

const COIN_SIZE = 52;
const COIN_STAGGER = 0.06;
const COIN_FLIGHT_SEC = 0.6;
/** Coins rise this far above the straight line on their way (screen +Y is down, so it's negative). */
const COIN_ARC = -110;

/** How many coins a payout of `amount` flies in as (each carrying a share). */
export function coinCount(amount: number): number {
    return Math.min(14, Math.max(6, Math.round(amount / 50)));
}

/**
 * dig's flyCoin: cash icons added to `layer` at `from` (layer space), each flying along an arc into `target()`
 * (re-aimed every frame, in case the HUD moves), `onArrive(share)` as each lands with its share of `amount`.
 */
export function flyCoins(layer: PIXI.Container, from: PIXI.IPointData, target: () => PIXI.IPointData, amount: number,
    onArrive: (share: number) => void): UiTween[] {
    const coins = coinCount(amount);
    const tweens: UiTween[] = [];
    let paid = 0;
    for (let i = 0; i < coins; i++) {
        // Each coin carries its share; the last one takes the rounding remainder.
        const share = i === coins - 1 ? amount - paid : Math.floor(amount / coins);
        paid += share;
        const coin = PIXI.Sprite.from(UiKit.imageName('hud', 'moneyIcon'));
        coin.anchor.set(0.5);
        coin.scale.set(COIN_SIZE / Math.max(coin.texture.width, coin.texture.height, 1));
        coin.visible = false;
        layer.addChild(coin);
        const startScale = coin.scale.x;
        const progress = { t: 0 };
        tweens.push(gsap.to(progress, {
            t: 1,
            duration: COIN_FLIGHT_SEC,
            delay: i * COIN_STAGGER,
            ease: 'power2.in',
            onUpdate: () => {
                const to = target();
                // Quadratic bezier through a raised midpoint.
                const midX = (from.x + to.x) / 2;
                const midY = (from.y + to.y) / 2 + COIN_ARC;
                const k = progress.t;
                const u = 1 - k;
                coin.visible = true;
                coin.position.set(u * u * from.x + 2 * u * k * midX + k * k * to.x, u * u * from.y + 2 * u * k * midY + k * k * to.y);
                coin.scale.set(startScale * (1 - k * 0.35));
                coin.rotation = Math.sin(k * Math.PI * 2) * 0.3;
            },
            onComplete: () => {
                coin.destroy();
                // After gsap's update loop, not inside it (landing refreshes the HUD, which kills tweens).
                queueMicrotask(() => onArrive(share));
            },
        }));
    }
    return tweens;
}

/** One find for the card. */
export interface Find {
    title: string;
    /** The rays' and title's colour (its rarity's). */
    color: number;
    name: string;
    amount: number;
    /** Its model (a ./mow/models/... url); none: a money icon. */
    model?: string;
    confetti: boolean;
    /** Pays it (MowProgress); returns what was paid (0: nothing, already paid). */
    claim: () => number;
}

/** Shrinks a line that's wider than the card. */
function fitWidth(text: PIXI.Text): void {
    text.scale.set(Math.min(1, TEXT_WIDTH / Math.max(text.width, 1)));
}

export class FindCard extends PIXI.Container {
    private readonly queue: Find[] = [];
    private showing = false;
    private tweens: UiTween[] = [];

    /**
     * `onClaim(find, from)`: CLAIM on a find: the HUD pays it (find.claim(), holding the counter back) and flies its
     * coins from `from` (on screen) into the money.
     */
    public constructor(private readonly onClaim: (find: Find, from: PIXI.Point) => void) {
        super();
        // Only the CLAIM button takes taps: the rest of the card never gets in the way of steering.
        this.eventMode = 'passive';
    }

    public show(find: Find): void {
        this.queue.push(find);
        this.next();
    }

    private next(): void {
        if (this.showing || this.destroyed) return;
        const find = this.queue.shift();
        if (!find) return;
        this.showing = true;
        MowAudio.play('cheer');
        this.removeChildren().forEach((child) => child.destroy({ children: true }));

        const card = new PIXI.Container();
        this.addChild(card);
        const { tweens: rayTweens } = UiAnim.rays(card, 400, find.color, 0.9, 8);
        card.addChild(UiKit.image('findBanner', 'back', WIDTH, HEIGHT));
        const title = UiKit.text('findBanner', 'rarity', { text: find.title }, { fill: find.color });
        title.anchor.set(0.5);
        fitWidth(title);
        title.y = -HEIGHT / 2 + 38;
        card.addChild(title);
        if (find.model) {
            const icon = ModelIcons.sprite(find.model, 130);
            icon.y = -40;
            card.addChild(icon);
            this.tweens.push(gsap.fromTo(icon, { rotation: -0.12 }, { rotation: 0.12, duration: 0.8, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
        } else {
            const money = UiKit.sprite('hud', 'moneyIcon');
            money.scale.set(110 / Math.max(money.width, 1));
            money.y = -40;
            card.addChild(money);
        }
        const name = UiKit.text('findBanner', 'name', { name: find.name });
        name.anchor.set(0.5);
        fitWidth(name);
        name.y = 44;
        const reward = UiKit.text('findBanner', 'reward', { reward: find.amount.toLocaleString('en-US') });
        reward.anchor.set(0.5);
        fitWidth(reward);
        reward.y = 82;
        const button = this.claimButton(() => this.claim(find, card, button));
        card.addChild(name, reward, button);
        this.tweens.push(...rayTweens, ...UiAnim.popIn(card), ...UiAnim.pulse(button, 0.06, 0.5));
        if (find.confetti) this.tweens.push(...UiAnim.confetti(this, 0, -60, 70, 1.2));
        this.tweens.push(gsap.delayedCall(AUTO_CLAIM_SEC, () => this.claim(find, card, button)));
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

    /** CLAIM (tapped, or on its own after a while): paid now, its coins fly off the button, then the next card. */
    private claim(find: Find, card: PIXI.Container, button: PIXI.Container): void {
        if (!button.visible || this.destroyed) return;
        this.onClaim(find, button.getGlobalPosition());
        button.visible = false;
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
