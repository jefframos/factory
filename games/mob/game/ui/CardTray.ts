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
import { cardColour, loadIcon, panelColour, panelShine, cardFace } from './CardFace';
import { framePlane, iconSprite, label, tappable, killTweensDeep } from './UiParts';

/** A card's size, gap, its frames' scale, the inner panel's inset and dark tint, the picture's size, the name. */
export const CARD = { width: 124, height: 152, gap: 12, frameScale: 0.55, inset: 9, picture: 118, barHeight: 16, barGap: 6 };
/** The hand: at most this many cards at once (the rest wait their turn: a card used, the next takes its place). */
export const HAND = 4;
/** The waiting cards' pile, right of the hand: the next one small, how many wait on it; its size and the gap to the hand. */
export const PILE = { width: 72, height: 90, gap: 16 };
/** The tray's whole width (the hand and the pile), for fitting it to the screen. */
export const TRAY_WIDTH = HAND * CARD.width + (HAND - 1) * CARD.gap + 2 * (PILE.gap + PILE.width);
/** The charge bar along the card's bottom, from the baked bar textures (Bar_Trough, Bar_Segment: white, tinted; see
 *  SegmentBar): its back, the fill's inset (its colour is the unit's), the textures' height and nine-slice borders. */
const BAR = { back: 0x10123a, inset: 2, texture: 48, troughSlice: 16, fillSlice: 12 };
/** Charging: the card sits this much lower (it rises when it's ready), and a clock on its corner (ticking) says it's
 *  charging, not ready (a tap on it does nothing). */
const CHARGING = { drop: 14, ease: 10, clock: 'Icon_Timer', clockSize: 42, clockX: 10, clockY: 12, tick: 0.18, tickSpeed: 7 };
/** The grey picture under the coloured one: just greyscale, not darkened or see-through (that read as dull). */
const GREY = { tint: 0xffffff, alpha: 1 };
/** A navy shade rising from the panel's bottom over the picture (baked: Card_Vignette, white, tinted): strong while
 *  charging (depth on the grey picture), lighter when it's ready. */
const VIGNETTE = { tint: 0x0b1550, charging: 0.5, ready: 0.25 };
/** A soft drop shadow under each card (baked: Card_Shadow, the card's rect with `margin` px of blur round it, white,
 *  tinted): how far down it's dropped, its colour and strength. */
const SHADOW = { margin: 24, drop: 7, tint: 0x060a2a, alpha: 0.55 };
/** Charging: the card's frame blue (not grey: a tray of grey cards looked dead), and not see-through. */
const DIM = { alpha: 1, tint: 0x3f6bf5 };
const READY = { glow: 1.75, glowFrom: 0.35, glowTo: 0.85, bounce: 0.06, speed: 5, shineEvery: 1.4, tap: 26, rays: 2.1, raysTint: 0xffe27a, raysSpin: 0.9, sparkles: 6, edge: 0xfff3b0 };
/** A colour's lighter version (towards white by `t`). */
const lighter = (colour: number, t: number): number => {
    const mix = (shift: number) => Math.round(((colour >> shift) & 255) + (255 - ((colour >> shift) & 255)) * t);
    return (mix(16) << 16) | (mix(8) << 8) | mix(0);
};
const colourOf = cardColour;

/** A card: its parts, the panel its colour rises in (and that colour), and its charge. */
interface Card {
    kind: CardKind; holder: PIXI.Container; body: PIXI.Container; outer: PIXI.NineSlicePlane; inner: PIXI.NineSlicePlane; reveal: PIXI.Graphics; picture: PIXI.Sprite; grey: PIXI.Sprite; vignette: PIXI.Sprite;
    glow: PIXI.Sprite; rays: PIXI.Sprite; sparkles: PIXI.Graphics; edge: PIXI.Graphics; bar: PIXI.Container; barFill: PIXI.NineSlicePlane; shine: PIXI.Graphics; tap: PIXI.Text; flash: PIXI.Graphics;
    clock: PIXI.Sprite; charge: number; ready: boolean;
    panel: { left: number; top: number; width: number; height: number; colour: number };
}

export class CardTray extends PIXI.Container {
    /** A charged card tapped. */
    public onTap: (kind: CardKind) => void = () => undefined;
    private cards: Card[] = [];
    private time = 0;
    /** The waiting cards' pile (the next, how many). */
    private pile = new PIXI.Container();

    /** The player's cards (`fresh`: just unlocked: NEW! on it). */
    public setCards(kinds: readonly CardKind[], fresh: readonly CardKind[] = []): void {
        // (Everything on it still moving — a card's pop, a GO! floating up, the pile's — stopped before it's destroyed.)
        killTweensDeep(this);
        this.removeChildren().forEach((child) => child.destroy({ children: true }));
        this.cards = kinds.map((kind, i) => {
            const card = this.buildCard(kind, fresh.includes(kind));
            card.holder.x = (i - (kinds.length - 1) / 2) * (CARD.width + CARD.gap);
            card.holder.y = CHARGING.drop;
            this.addChild(card.holder);
            return card;
        });
        this.pile = new PIXI.Container();
        this.pile.visible = false;
        this.addChild(this.pile);
        this.visible = kinds.length > 0;
    }

    /** `old`'s card used: `next` takes its place (popping in from the pile's side), uncharged. */
    public replace(old: CardKind, next: CardKind): void {
        const at = this.cards.findIndex((entry) => entry.kind === old);
        if (at < 0) return;
        const before = this.cards[at];
        // Everything still moving on it (its fired pop, its glow...) stopped first: it's destroyed now.
        killTweensDeep(before.holder);
        const card = this.buildCard(next, false);
        card.holder.position.copyFrom(before.holder.position);
        this.removeChild(before.holder);
        before.holder.destroy({ children: true });
        this.addChildAt(card.holder, Math.min(at, this.children.length));
        this.cards[at] = card;
        gsap.fromTo(card.holder, { x: this.pile.x }, { x: card.holder.x, duration: 0.35, ease: 'power2.out' });
        gsap.fromTo(card.holder.scale, { x: 0.45, y: 0.45 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2.2)' });
    }

    /** The waiting cards: the next (small, its face), how many wait on a badge; hidden when none wait. */
    public setPile(next: CardKind | null, waiting: number): void {
        killTweensDeep(this.pile);
        this.pile.removeChildren().forEach((child) => child.destroy({ children: true }));
        this.pile.visible = !!next && waiting > 0;
        if (!next || waiting <= 0) return;
        const handRight = (Math.max(1, this.cards.length) / 2) * (CARD.width + CARD.gap) - CARD.gap / 2;
        // Level with the cards' middle (its badge inside the tray: the screen's edge is just under the cards).
        this.pile.position.set(handRight + PILE.gap + PILE.width / 2, CHARGING.drop - 8);
        // A card or two showing under it: a pile.
        for (let k = Math.min(2, waiting - 1); k > 0; k--) {
            const under = framePlane('CardFrame03_n_Bg', PILE.width, PILE.height, 0.4);
            under.tint = 0x2a3a7a;
            under.position.set(-PILE.width / 2 + k * 5, -PILE.height / 2 - k * 5);
            this.pile.addChild(under);
        }
        const face = cardFace(next, PILE.width, PILE.height, 0, 0.4);
        const words = label(16, 0xffffff);
        words.text = 'NEXT';
        words.y = -PILE.height / 2 - 14;
        const badge = new PIXI.Container();
        const circle = iconSprite('Alert_Circle_l_Bg', 36);
        circle.tint = 0x3d6dff;
        const count = label(18);
        count.text = `${waiting}`;
        badge.addChild(circle, count);
        badge.position.set(PILE.width / 2 - 6, PILE.height / 2 - 18);
        this.pile.addChild(face, words, badge);
        gsap.fromTo(this.pile.scale, { x: 0.8, y: 0.8 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(2.5)' });
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
        const shadow = new PIXI.Sprite(PIXI.Texture.from('Card_Shadow'));
        shadow.anchor.set(0.5);
        shadow.width = width + SHADOW.margin * 2;
        shadow.height = height + SHADOW.margin * 2;
        shadow.y = SHADOW.drop;
        shadow.tint = SHADOW.tint;
        shadow.alpha = SHADOW.alpha;
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
        // The navy shade up from the panel's bottom, over the picture (cropped to the panel as it is).
        const vignette = new PIXI.Sprite(PIXI.Texture.from('Card_Vignette'));
        vignette.tint = VIGNETTE.tint;
        vignette.position.set(-innerWidth / 2 + 2, -height / 2 + inset + 2);
        vignette.width = innerWidth - 4;
        vignette.height = innerHeight - 4;
        const vignetteMask = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(-innerWidth / 2 + 2, -height / 2 + inset + 2, innerWidth - 4, innerHeight - 4, 10).endFill();
        vignette.mask = vignetteMask;
        // The charge bar: a dark trough, and the fill (its width set as it charges: paint).
        const bar = new PIXI.Container();
        bar.y = height / 2 - inset - CARD.barHeight / 2;
        const troughScale = CARD.barHeight / BAR.texture;
        const trough = new PIXI.NineSlicePlane(PIXI.Texture.from('Bar_Trough'), BAR.troughSlice, BAR.troughSlice, BAR.troughSlice, BAR.troughSlice);
        trough.scale.set(troughScale);
        trough.width = innerWidth / troughScale;
        trough.height = BAR.texture;
        trough.position.set(-innerWidth / 2, -CARD.barHeight / 2);
        trough.tint = BAR.back;
        const fillScale = (CARD.barHeight - BAR.inset * 2) / BAR.texture;
        const barFill = new PIXI.NineSlicePlane(PIXI.Texture.from('Bar_Segment'), BAR.fillSlice, BAR.fillSlice, BAR.fillSlice, BAR.fillSlice);
        barFill.scale.set(fillScale);
        barFill.height = BAR.texture;
        barFill.position.set(-innerWidth / 2 + BAR.inset, -CARD.barHeight / 2 + BAR.inset);
        bar.addChild(trough, barFill);
        // The clock on its top right corner while it charges.
        const clock = iconSprite(CHARGING.clock, CHARGING.clockSize);
        clock.position.set(width / 2 - CHARGING.clockX, -height / 2 + CHARGING.clockY);
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
        body.addChild(outer, inner, panelLight, grey, greyMask, picture, reveal, vignette, vignetteMask, bar, shine, shineMask, edge, flash, clock, tap);
        holder.addChild(shadow, rays, glow, sparkles, body);
        if (fresh) {
            const tag = label(22, 0xffd23f);
            tag.text = 'NEW!';
            tag.position.set(width / 2 - 26, -height / 2 + 10);
            tag.rotation = 0.25;
            holder.addChild(tag);
            gsap.fromTo(tag.scale, { x: 1.3, y: 1.3 }, { x: 1, y: 1, duration: 0.5, yoyo: true, repeat: 7, ease: 'sine.inOut' });
        }
        const card: Card = {
            kind, holder, body, outer, inner, reveal, picture, grey, vignette, glow, rays, sparkles, edge, bar, barFill, shine, tap, flash, clock, charge: 0, ready: false,
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
        card.vignette.alpha = card.ready ? VIGNETTE.ready : VIGNETTE.charging;
        card.outer.tint = card.ready ? data.colour : DIM.tint;
        for (const part of [card.glow, card.rays, card.sparkles, card.edge, card.shine, card.tap]) part.visible = card.ready;
        card.clock.visible = !card.ready;
        // The charge bar along the bottom, in the unit's colour (brighter when it's ready); too short for its rounded
        // ends, it's not drawn yet.
        const fillScale = card.barFill.scale.x;
        const fill = Math.max(0, Math.min(1, card.charge)) * (CARD.width - CARD.inset * 2 - BAR.inset * 2);
        card.barFill.visible = fill >= BAR.fillSlice * 2 * fillScale;
        card.barFill.width = Math.max(BAR.fillSlice * 2, fill / fillScale);
        card.barFill.tint = card.ready ? lighter(data.colour, 0.25) : data.colour;
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
        // GO! on the tray itself, over the card (the card may be swapped for the next one at once).
        const go = label(34, 0x9fff8a);
        go.text = 'GO!';
        go.position.set(card.holder.x, card.holder.y - CARD.height / 2);
        this.addChild(go);
        gsap.to(go, { y: go.y - 50, alpha: 0, duration: 0.8, ease: 'power1.out', onComplete: () => go.destroy() });
    }

    /** A point on `kind`'s card (`x`, `y`: shares of its size from its middle, e.g. 0.5, 0 its right edge), in `to`'s
     *  space (null: no such card). */
    public cardPoint(kind: CardKind, x: number, y: number, to: PIXI.Container): PIXI.IPointData | null {
        const card = this.cards.find((entry) => entry.kind === kind);
        return card ? to.toLocal(new PIXI.Point(x * CARD.width, y * CARD.height), card.body) : null;
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
            // Charging, it sits lower; ready, it rises (eased).
            const drop = card.ready ? 0 : CHARGING.drop;
            card.holder.y += (drop - card.holder.y) * Math.min(1, dt * CHARGING.ease);
            if (!card.ready) {
                if (!gsap.isTweening(card.body)) card.body.y = 0;
                card.clock.rotation = Math.sin(this.time * CHARGING.tickSpeed) * CHARGING.tick;
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
