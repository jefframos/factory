// CardTray.ts
//
// The battle's unit cards, across the bottom of the screen: one for each unit the player has (MobSave.cards: a card's
// unlocked by the first level with its house). Each is a card in its unit's colour (the giant's, or its house's pad
// colour), its unit's picture (UnitIcons) big in it on a light blue panel, and its charge bar along the bottom (in the
// unit's colour). Charging, the picture's grey with its coloured copy revealed up it from the bottom as it charges;
// charged, it lights up (golden rays turning behind it, its panel bright, sparkles round it, its edge flashing, a shine
// sweeping over it, a glow breathing, bouncing, TAP! on it, the bar gold) and waits for the player: a tap sends its
// unit out of the cannon (onTap), the card flashes and pops (GO!), and it starts charging again. A card just unlocked
// says NEW!.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { CardKind } from '../data/Settings';
import { cardColour, loadIcon, panelColour, panelShine } from './CardFace';
import { framePlane, iconSprite, label, tappable } from './UiParts';

/** A card's size, gap, its frames' scale, the inner panel's inset and dark tint, the picture's size, the name. */
export const CARD = { width: 124, height: 152, gap: 12, frameScale: 0.55, inset: 9, picture: 150, barHeight: 16, barGap: 6 };
/** The charge bar along the card's bottom: its back (its fill is the unit's colour). */
const BAR = { back: 0x10123a };
/** The grey picture under the coloured one: how dark. */
const GREY = { tint: 0xb8bcc8, alpha: 0.9 };
/** Charging: how dim the card is; ready: its glow, bounce and shine. */
const DIM = { alpha: 0.82, tint: 0x8a90b0 };
const READY = { glow: 1.75, glowFrom: 0.35, glowTo: 0.85, bounce: 0.06, speed: 5, shineEvery: 1.4, tap: 26, rays: 2.1, raysTint: 0xffe27a, raysSpin: 0.9, sparkles: 6, edge: 0xfff3b0 };
/** A colour's lighter version (towards white by `t`). */
const lighter = (colour: number, t: number): number => {
    const mix = (shift: number) => Math.round(((colour >> shift) & 255) + (255 - ((colour >> shift) & 255)) * t);
    return (mix(16) << 16) | (mix(8) << 8) | mix(0);
};
const colourOf = cardColour;

/** A card: its parts, the panel its colour rises in (and that colour), and its charge. */
interface Card {
    kind: CardKind; holder: PIXI.Container; body: PIXI.Container; outer: PIXI.NineSlicePlane; inner: PIXI.NineSlicePlane; reveal: PIXI.Graphics; picture: PIXI.Sprite; grey: PIXI.Sprite;
    glow: PIXI.Sprite; rays: PIXI.Sprite; sparkles: PIXI.Graphics; edge: PIXI.Graphics; bar: PIXI.Graphics; shine: PIXI.Graphics; tap: PIXI.Text; flash: PIXI.Graphics;
    charge: number; ready: boolean;
    panel: { left: number; top: number; width: number; height: number; colour: number };
}

export class CardTray extends PIXI.Container {
    /** A charged card tapped. */
    public onTap: (kind: CardKind) => void = () => undefined;
    private cards: Card[] = [];
    private time = 0;

    /** The player's cards (`fresh`: just unlocked: NEW! on it). */
    public setCards(kinds: readonly CardKind[], fresh: readonly CardKind[] = []): void {
        for (const card of this.cards) gsap.killTweensOf([card.holder.scale, card.flash, card.body]);
        this.removeChildren().forEach((child) => child.destroy({ children: true }));
        this.cards = kinds.map((kind, i) => {
            const card = this.buildCard(kind, fresh.includes(kind));
            card.holder.x = (i - (kinds.length - 1) / 2) * (CARD.width + CARD.gap);
            this.addChild(card.holder);
            return card;
        });
        this.visible = kinds.length > 0;
    }

    private buildCard(kind: CardKind, fresh: boolean): Card {
        const { width, height, inset } = CARD;
        const colour = colourOf(kind);
        const holder = new PIXI.Container();
        const body = new PIXI.Container();
        const glow = iconSprite('Glow_Circle01', width * READY.glow);
        glow.tint = colour;
        glow.visible = false;
        const rays = iconSprite('Image_Effect_Rotate', width * READY.rays);
        rays.tint = READY.raysTint;
        rays.alpha = 0.7;
        rays.visible = false;
        const sparkles = new PIXI.Graphics();
        sparkles.visible = false;
        const outer = framePlane('CardFrame03_n_Bg', width, height, CARD.frameScale);
        outer.tint = colour;
        outer.position.set(-width / 2, -height / 2);
        const innerWidth = width - inset * 2;
        // The panel the picture's in: all of the card but its edge and the bar along its bottom.
        const innerHeight = height - inset * 2 - CARD.barHeight - CARD.barGap;
        const inner = framePlane('CardFrame03_n_InnerBg', innerWidth, innerHeight, CARD.frameScale);
        inner.tint = panelColour(kind);
        inner.position.set(-innerWidth / 2, -height / 2 + inset);
        // The pack's shine over its panel.
        const panelLight = panelShine(innerWidth, innerHeight, -innerWidth / 2, -height / 2 + inset, CARD.frameScale);
        // The picture, big, filling the panel (cropped to it): grey, and its coloured copy over it, revealed from the bottom
        // up as the card charges (the reveal: its mask).
        const grey = new PIXI.Sprite(PIXI.Texture.EMPTY);
        const picture = new PIXI.Sprite(PIXI.Texture.EMPTY);
        const desaturate = new PIXI.ColorMatrixFilter();
        desaturate.desaturate();
        grey.filters = [desaturate];
        grey.tint = GREY.tint;
        grey.alpha = GREY.alpha;
        for (const sprite of [grey, picture]) sprite.anchor.set(0.5);
        const greyMask = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(-innerWidth / 2 + 2, -height / 2 + inset + 2, innerWidth - 4, innerHeight - 4, 10).endFill();
        grey.mask = greyMask;
        const reveal = new PIXI.Graphics();
        picture.mask = reveal;
        // Framed as the settings say (cards.<kind>.icon: offset and zoom).
        loadIcon(kind, [grey, picture], CARD.picture, -height / 2 + inset + innerHeight / 2);
        const bar = new PIXI.Graphics();
        bar.y = height / 2 - inset - CARD.barHeight / 2;
        // Its edge, flashing when it's ready.
        const edge = new PIXI.Graphics().lineStyle(4, READY.edge).drawRoundedRect(-width / 2 + 2, -height / 2 + 2, width - 4, height - 4, 16);
        edge.visible = false;
        // A shine across it when it's ready (a slanted white band, masked to the card).
        const shine = new PIXI.Graphics().beginFill(0xffffff, 0.45).drawPolygon([-14, -height, 14, -height, 34, height, 6, height]).endFill();
        const shineMask = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(-width / 2, -height / 2, width, height, 18).endFill();
        shine.mask = shineMask;
        shine.visible = false;
        const tap = label(READY.tap, 0xffe14d);
        tap.text = 'TAP!';
        tap.y = -height / 2 - 4;
        tap.visible = false;
        const flash = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(-width / 2, -height / 2, width, height, 18).endFill();
        flash.alpha = 0;
        body.addChild(outer, inner, panelLight, grey, greyMask, picture, reveal, bar, shine, shineMask, edge, flash, tap);
        holder.addChild(rays, glow, sparkles, body);
        if (fresh) {
            const tag = label(22, 0xffd23f);
            tag.text = 'NEW!';
            tag.position.set(width / 2 - 26, -height / 2 + 10);
            tag.rotation = 0.25;
            holder.addChild(tag);
            gsap.fromTo(tag.scale, { x: 1.3, y: 1.3 }, { x: 1, y: 1, duration: 0.5, yoyo: true, repeat: 7, ease: 'sine.inOut' });
        }
        const card: Card = {
            kind, holder, body, outer, inner, reveal, picture, grey, glow, rays, sparkles, edge, bar, shine, tap, flash, charge: 0, ready: false,
            panel: { left: -innerWidth / 2, top: -height / 2 + inset, width: innerWidth, height: innerHeight, colour },
        };
        body.hitArea = new PIXI.Rectangle(-width / 2, -height / 2, width, height);
        tappable(body, () => {
            if (!card.ready) {
                gsap.fromTo(body, { x: -5 }, { x: 0, duration: 0.3, ease: 'elastic.out(1.2, 0.3)' });
                return;
            }
            this.onTap(kind);
        }, null);
        this.paint(card);
        return card;
    }

    /** Its picture coloured in as far as it's charged (from the bottom up); dim while charging, bright when ready. */
    private paint(card: Card): void {
        const data = card.panel;
        const filled = (data.height - 4) * Math.min(1, card.charge);
        card.reveal.clear();
        if (filled > 0.5) card.reveal.beginFill(0xffffff).drawRoundedRect(data.left + 2, data.top + 2 + (data.height - 4) - filled, data.width - 4, filled, 10).endFill();
        card.picture.visible = filled > 0.5;
        card.inner.tint = panelColour(card.kind, card.ready);
        card.body.alpha = card.ready ? 1 : DIM.alpha;
        card.outer.tint = card.ready ? data.colour : DIM.tint;
        for (const part of [card.glow, card.rays, card.sparkles, card.edge, card.shine, card.tap]) part.visible = card.ready;
        // The charge bar along the bottom, in the unit's colour (brighter when it's ready).
        const width = CARD.width - CARD.inset * 2;
        const h = CARD.barHeight;
        card.bar.clear().beginFill(BAR.back).drawRoundedRect(-width / 2, -h / 2, width, h, h / 2).endFill();
        const fill = Math.max(0, Math.min(1, card.charge)) * (width - 4);
        if (fill > 1) card.bar.beginFill(card.ready ? lighter(data.colour, 0.25) : data.colour).drawRoundedRect(-width / 2 + 2, -h / 2 + 2, fill, h - 4, (h - 4) / 2).endFill();
        card.body.cursor = card.ready ? 'pointer' : 'default';
    }

    /** A card's charge (0..1; at 1 it's ready to tap). */
    public setCharge(kind: CardKind, charge: number): void {
        const card = this.cards.find((entry) => entry.kind === kind);
        if (!card) return;
        const ready = charge >= 1;
        if (Math.abs(card.charge - charge) < 0.002 && ready === card.ready) return;
        const becameReady = ready && !card.ready;
        card.charge = charge;
        card.ready = ready;
        this.paint(card);
        if (becameReady) gsap.fromTo(card.holder.scale, { x: 1.2, y: 1.2 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(3)' });
    }

    /** `kind`'s card was used: it flashes, pops and says GO!. */
    public fired(kind: CardKind): void {
        const card = this.cards.find((entry) => entry.kind === kind);
        if (!card) return;
        gsap.fromTo(card.flash, { alpha: 0.9 }, { alpha: 0, duration: 0.45 });
        gsap.fromTo(card.holder.scale, { x: 1.18, y: 1.18 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(3)' });
        const go = label(34, 0x9fff8a);
        go.text = 'GO!';
        go.y = -CARD.height / 2;
        card.holder.addChild(go);
        gsap.to(go, { y: go.y - 50, alpha: 0, duration: 0.8, ease: 'power1.out', onComplete: () => go.destroy() });
    }

    /** Whether a screen point (CSS px) is on one of the cards (the field shouldn't take it too). */
    public hits(screenX: number, screenY: number): boolean {
        return this.visible && this.cards.some((card) => card.body.getBounds().contains(screenX, screenY));
    }

    /** Little four-pointed stars twinkling round a ready card (each its own beat, round the card's edge). */
    private drawSparkles(card: Card): void {
        const g = card.sparkles.clear();
        for (let n = 0; n < READY.sparkles; n++) {
            const angle = (n / READY.sparkles) * Math.PI * 2 + this.time * 0.6;
            const twinkle = Math.max(0, Math.sin(this.time * 4 + n * 1.7));
            if (twinkle < 0.05) continue;
            const x = Math.cos(angle) * CARD.width * 0.62;
            const y = Math.sin(angle) * CARD.height * 0.56;
            const r = 4 + 7 * twinkle;
            g.beginFill(0xffffff, twinkle).drawPolygon([x, y - r, x + r * 0.3, y - r * 0.3, x + r, y, x + r * 0.3, y + r * 0.3, x, y + r, x - r * 0.3, y + r * 0.3, x - r, y, x - r * 0.3, y - r * 0.3]).endFill();
        }
    }

    /** Each frame: the ready ones bounce, their glow breathes, their shine sweeps, TAP! pulses. */
    public update(dt: number): void {
        this.time += dt;
        const wave = 0.5 + 0.5 * Math.sin(this.time * READY.speed);
        for (const card of this.cards) {
            if (!card.ready) {
                if (!gsap.isTweening(card.body)) card.body.y = 0;
                continue;
            }
            card.body.y = -Math.abs(Math.sin(this.time * READY.speed * 0.7)) * 8;
            card.glow.alpha = READY.glowFrom + (READY.glowTo - READY.glowFrom) * wave;
            card.glow.scale.set((CARD.width * READY.glow) / Math.max(1, card.glow.texture.width) * (0.95 + 0.1 * wave));
            card.tap.scale.set(1 + READY.bounce * 2 * wave);
            card.tap.style.fill = wave > 0.5 ? 0xffe14d : 0xffffff;
            card.rays.rotation += dt * READY.raysSpin;
            card.edge.alpha = 0.35 + 0.65 * wave;
            this.drawSparkles(card);
            // The shine across, once every so often.
            const sweep = (this.time % READY.shineEvery) / READY.shineEvery;
            card.shine.x = -CARD.width + sweep * CARD.width * 3;
        }
    }
}
