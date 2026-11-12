// CardTile.ts
//
// A unit card as the CARDS tab, a chest and the trophy road show it: its face (CardFace), "LV 3" on a strip at its
// bottom, and under it the copies bar — copies / copies needed, an up arrow at its left: blue while it fills, green (and
// the bar green) once there are enough for the next level (MAX at the top). NEW on a card not looked at yet. A card
// not found yet: dark, a padlock, ???.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { MobSave } from '../data/MobSave';
import { CardKind } from '../data/Settings';
import { cardFace } from './CardFace';
import { framePlane, iconSprite, label } from './UiParts';

/** A tile's card size (the copies bar under it adds BAR.height + BAR.gap). */
export const TILE = { width: 116, height: 150 };
const BAR = { height: 26, gap: 6, back: 0x10123a, fill: 0x3d8cff, ready: 0x2fd35c, arrow: 34 };
const LEVEL = { height: 30, back: 0x10123a, alpha: 0.75, text: 20 };

/** The whole tile's height (card and bar). */
export const TILE_HEIGHT = TILE.height + BAR.gap + BAR.height;

/** A card the player has, `scale` x TILE: its face, level, copies bar (`copies`: false, no bar), NEW. */
export function cardTile(kind: CardKind, scale = 1, copies = true): PIXI.Container {
    const tile = new PIXI.Container();
    const w = TILE.width;
    const h = TILE.height;
    tile.addChild(cardFace(kind, w, h, 0, 0.5));
    // LV n on a dark strip across the bottom of the face.
    const strip = new PIXI.Graphics().beginFill(LEVEL.back, LEVEL.alpha).drawRoundedRect(-w / 2 + 8, h / 2 - 8 - LEVEL.height, w - 16, LEVEL.height, 8).endFill();
    const level = label(LEVEL.text);
    level.text = `LV ${MobSave.cardLevel(kind)}`;
    level.y = h / 2 - 8 - LEVEL.height / 2 - 1;
    tile.addChild(strip, level);
    if (copies) tile.addChild(copiesBar(kind, w, h / 2 + BAR.gap + BAR.height / 2));
    if (MobSave.isNew(kind)) {
        const badge = new PIXI.Container();
        const back = new PIXI.Graphics().beginFill(0xff3b4e).lineStyle(3, 0xffffff).drawRoundedRect(-34, -14, 68, 28, 10).endFill();
        const words = label(18);
        words.text = 'NEW!';
        badge.addChild(back, words);
        badge.position.set(w / 2 - 22, -h / 2 + 6);
        badge.rotation = 0.18;
        gsap.to(badge.scale, { x: 1.12, y: 1.12, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        tile.addChild(badge);
        tile.on('destroyed', () => gsap.killTweensOf(badge.scale));
    }
    tile.scale.set(scale);
    return tile;
}

/** The copies bar, `width` wide, centred at (0, y): copies / needed, the up arrow (green when it's ready). */
export function copiesBar(kind: CardKind, width: number, y: number): PIXI.Container {
    const bar = new PIXI.Container();
    const need = MobSave.copiesNeeded(kind);
    const have = MobSave.copies(kind);
    const ready = need !== null && have >= need;
    const left = -width / 2 + BAR.arrow * 0.45;
    const room = width / 2 - left;
    const back = framePlane('ResourceBar_Single_Bg', room, BAR.height, 0.8);
    back.tint = BAR.back;
    back.position.set(left, y - BAR.height / 2);
    bar.addChild(back);
    const share = need === null ? 1 : Math.min(1, have / Math.max(1, need));
    if (share > 0) {
        const fill = framePlane('ResourceBar_Single_Bg', Math.max(16, (room - 6) * share), BAR.height - 6, 0.6);
        fill.tint = need === null ? 0xffd23f : ready ? BAR.ready : BAR.fill;
        fill.position.set(left + 3, y - BAR.height / 2 + 3);
        bar.addChild(fill);
    }
    const words = label(17);
    words.text = need === null ? 'MAX' : `${have}/${need}`;
    words.position.set(left + room / 2 + 6, y - 1);
    const arrow = iconSprite('Slider_Level02_Icon_Up_Green', BAR.arrow);
    arrow.position.set(-width / 2 + BAR.arrow * 0.35, y);
    if (!ready) arrow.tint = need === null ? 0xffd23f : 0x5aa8ff;
    bar.addChild(words, arrow);
    if (ready) {
        gsap.to(arrow, { y: y - 5, duration: 0.4, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        bar.on('destroyed', () => gsap.killTweensOf(arrow));
    }
    return bar;
}

/** A card not found yet: dark, a padlock, ??? (`lock` false: an empty deck slot, its words only). */
export function lockedTile(scale = 1, words = '???', lock = true): PIXI.Container {
    const tile = new PIXI.Container();
    const back = framePlane('CardFrame03_n_Bg', TILE.width, TILE.height, 0.5);
    back.tint = 0x1c2c5c;
    back.alpha = lock ? 1 : 0.6;
    back.position.set(-TILE.width / 2, -TILE.height / 2);
    const text = label(22, 0xc3cdea);
    text.text = words;
    text.style.align = 'center';
    text.y = lock ? 38 : 0;
    // Kept inside the card (a long word shrinks).
    text.scale.set(Math.min(1, (TILE.width - 14) / Math.max(1, text.width)));
    tile.addChild(back, text);
    if (lock) {
        const padlock = iconSprite('Icon_Lock03', 54);
        padlock.y = -14;
        tile.addChild(padlock);
    }
    tile.scale.set(scale);
    return tile;
}
