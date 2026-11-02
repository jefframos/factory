// FindToasts.ts
//
// "You found something" without stopping play: a small toast on the left per find (its model, a title in the find's
// colour — "TREASURE FOUND!", "SECRET FOUND!" — and its name), sliding in under the ones already up and going after
// TOAST_SEC; several stack. What a find is worth is paid elsewhere (a treasure waits in the Trophies panel, a secret
// chest pays at once): the HUD flies the item / the coins (flyItem(), flyCoins()).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { UiTween } from './UiAnim';
import { ModelIcons } from './ModelIcons';

/** One find, for its toast (and the item's flight). */
export interface Find {
    title: string;
    /** The title's colour (a treasure's rarity, a secret's gold). */
    color: number;
    name: string;
    /** Its model (an icon is rendered from it). */
    model: string;
}

const TOAST = { width: 270, height: 62, gap: 8, icon: 50 };
/** How long a toast stays up, and the most up at once (a new one pushes the oldest out). */
const TOAST_SEC = 3.2;
const MAX_TOASTS = 4;

const COIN_SIZE = 52;
const COIN_STAGGER = 0.06;
const COIN_FLIGHT_SEC = 0.6;
/** Coins (and a flown item) rise this far above the straight line on their way (screen +Y is down, so it's negative). */
const ARC = -110;

/** How many coins a payout of `amount` flies in as (each carrying a share). */
export function coinCount(amount: number): number {
    return Math.min(14, Math.max(6, Math.round(amount / 50)));
}

/** A point along the quadratic bezier from `from` to `to` through a midpoint raised by `arc`, at `k` (0..1). */
function arcPoint(from: PIXI.IPointData, to: PIXI.IPointData, arc: number, k: number): PIXI.IPointData {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2 + arc;
    const u = 1 - k;
    return { x: u * u * from.x + 2 * u * k * midX + k * k * to.x, y: u * u * from.y + 2 * u * k * midY + k * k * to.y };
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
                const k = progress.t;
                coin.visible = true;
                coin.position.copyFrom(arcPoint(from, target(), ARC, k));
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

/**
 * A find's model flying from `from` into `target()` (layer space, re-aimed every frame): popping up big, then along an
 * arc, shrinking; `onArrive` as it lands.
 */
export function flyItem(layer: PIXI.Container, model: string, from: PIXI.IPointData, target: () => PIXI.IPointData, onArrive: () => void): void {
    const item = ModelIcons.sprite(model, 64);
    item.anchor.set(0.5);
    item.position.copyFrom(from);
    item.eventMode = 'none';
    layer.addChild(item);
    const scale = item.scale.x;
    item.scale.set(0);
    const progress = { t: 0 };
    gsap.timeline({ onComplete: () => {
        item.destroy();
        queueMicrotask(onArrive);
    } })
        .to(item.scale, { x: scale, y: scale, duration: 0.3, ease: 'back.out(2.5)' })
        .to(item, { y: from.y - 40, duration: 0.3, ease: 'power2.out' }, 0)
        .to(progress, {
            t: 1,
            duration: 0.75,
            ease: 'power2.in',
            onUpdate: () => {
                const k = progress.t;
                item.position.copyFrom(arcPoint({ x: from.x, y: from.y - 40 }, target(), ARC, k));
                item.scale.set(scale * (1 - k * 0.6));
                item.rotation = Math.sin(k * Math.PI) * 0.4;
            },
        }, 0.35);
}

/** The toasts' stack: its origin is the top-left of the first one. */
export class FindToasts extends PIXI.Container {
    private readonly toasts: PIXI.Container[] = [];

    public show(find: Find): void {
        const toast = this.build(find);
        this.toasts.push(toast);
        this.addChild(toast);
        if (this.toasts.length > MAX_TOASTS) this.dismiss(this.toasts[0]);
        toast.y = this.slotY(this.toasts.length - 1);
        toast.x = -TOAST.width - 30;
        gsap.to(toast, { x: 0, duration: 0.35, ease: 'back.out(1.4)' });
        gsap.delayedCall(TOAST_SEC, () => this.dismiss(toast));
    }

    private slotY(index: number): number {
        return index * (TOAST.height + TOAST.gap);
    }

    private dismiss(toast: PIXI.Container): void {
        const index = this.toasts.indexOf(toast);
        if (index < 0) return;
        this.toasts.splice(index, 1);
        gsap.killTweensOf(toast);
        gsap.to(toast, { x: -40, alpha: 0, duration: 0.25, ease: 'power2.in', onComplete: () => toast.destroy({ children: true }) });
        // The ones under it move up.
        this.toasts.forEach((other, i) => gsap.to(other, { y: this.slotY(i), duration: 0.25, ease: 'power2.out' }));
    }

    private build(find: Find): PIXI.Container {
        const { width, height, icon: iconSize } = TOAST;
        const toast = new PIXI.Container();
        toast.eventMode = 'none';
        const back = new PIXI.Graphics()
            .lineStyle(2, 0xffffff, 0.85)
            .beginFill(0x1d2633, 0.9).drawRoundedRect(0, 0, width, height, height / 2).endFill()
            .lineStyle(0)
            .beginFill(find.color, 0.9).drawCircle(height / 2, height / 2, height / 2 - 6).endFill();
        const icon = ModelIcons.sprite(find.model, iconSize);
        icon.anchor.set(0.5);
        icon.position.set(height / 2, height / 2);
        const textX = height + 6;
        const title = UiKit.text('hud', 'toast', { text: find.title }, { fontSize: 15, strokeThickness: 4, fill: find.color });
        title.anchor.set(0, 0.5);
        title.position.set(textX, height / 2 - 11);
        const name = UiKit.text('hud', 'toast', { text: find.name }, { fontSize: 19, strokeThickness: 4 });
        name.anchor.set(0, 0.5);
        name.position.set(textX, height / 2 + 11);
        for (const text of [title, name]) UiKit.fit(text, width - textX - 18);
        toast.addChild(back, icon, title, name);
        return toast;
    }

    public override destroy(): void {
        this.toasts.forEach((toast) => gsap.killTweensOf(toast));
        this.toasts.length = 0;
        super.destroy({ children: true });
    }
}
