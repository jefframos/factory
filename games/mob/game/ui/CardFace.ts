// CardFace.ts
//
// A unit's card face, as the tray, the reveal and the upgrades draw it: the frame in the card's main colour
// (ui/settings.json cards.<kind>.colour), its panel a lighter one with the pack's shine over it, and the unit's
// picture (UnitIcons) framed as the settings say (cards.<kind>.icon: its offset, a share of the picture, and its zoom),
// cropped to the panel.

import * as PIXI from 'pixi.js';
import { CardKind, SETTINGS } from '../data/Settings';
import { UnitIcons } from './UnitIcons';
import { framePlane } from './UiParts';

export const CARD_NAMES: Record<CardKind, string> = { giant: 'GIANT', truck: 'TRUCK', saucer: 'UFO', car: 'CAR' };
/** How much lighter than its main colour a card's panel is (more when it's ready); the shine over it. */
export const CARD_PANEL = { light: 0.45, ready: 0.62, shine: 0.75 };

/** A colour's lighter version (towards white by `t`). */
export const lighter = (colour: number, t: number): number => {
    const mix = (shift: number) => Math.round(((colour >> shift) & 255) + (255 - ((colour >> shift) & 255)) * t);
    return (mix(16) << 16) | (mix(8) << 8) | mix(0);
};

/** Each card's main colour (the settings'). */
export const cardColour = (kind: CardKind): number => parseInt((SETTINGS.cards[kind].colour ?? '#3d6dff').replace('#', ''), 16) || 0x3d6dff;

/** A card's panel's colour: a lighter version of its main one (lighter still when it's ready). */
export const panelColour = (kind: CardKind, ready = false): number => lighter(cardColour(kind), ready ? CARD_PANEL.ready : CARD_PANEL.light);

/** The pack's card shine, over a panel `width` x `height` at (x, y). */
export function panelShine(width: number, height: number, x: number, y: number, scale: number): PIXI.NineSlicePlane {
    const shine = framePlane('CardFrame03_n_Light', width, height, scale);
    shine.position.set(x, y);
    shine.alpha = CARD_PANEL.shine;
    return shine;
}

/** The picture `size` across (the card's own), framed by the settings: its zoom, and its offset (a share of `size`). */
export function frameIcon(sprite: PIXI.Sprite, kind: CardKind, size: number, centreY: number): void {
    const icon = SETTINGS.cards[kind].icon ?? { x: 0, y: 0, zoom: 1 };
    if (sprite.texture.width > 1) sprite.scale.set((size / sprite.texture.width) * (icon.zoom || 1));
    sprite.position.set(icon.x * size, centreY + icon.y * size);
}

/** Its picture into `sprites` (each framed), once it's rendered. */
export function loadIcon(kind: CardKind, sprites: PIXI.Sprite[], size: number, centreY: number): void {
    void UnitIcons.get(kind).then((texture) => {
        if (!texture) return;
        for (const sprite of sprites) {
            if (sprite.destroyed) continue;
            sprite.texture = texture;
            frameIcon(sprite, kind, size, centreY);
        }
    });
}

/**
 * A plain card face, `width` x `height`, centred: frame, panel (its bottom `under` px left for what goes there) and the
 * picture in colour. For the reveal and the upgrades (the tray's own are built in CardTray, with their charge).
 */
export function cardFace(kind: CardKind, width: number, height: number, under = 0, frameScale = 0.55): PIXI.Container {
    const face = new PIXI.Container();
    const inset = width * 0.075;
    const outer = framePlane('CardFrame03_n_Bg', width, height, frameScale);
    outer.tint = cardColour(kind);
    outer.position.set(-width / 2, -height / 2);
    const innerWidth = width - inset * 2;
    const innerHeight = height - inset * 2 - under;
    const inner = framePlane('CardFrame03_n_InnerBg', innerWidth, innerHeight, frameScale);
    inner.tint = panelColour(kind, true);
    inner.position.set(-innerWidth / 2, -height / 2 + inset);
    const shine = panelShine(innerWidth, innerHeight, -innerWidth / 2, -height / 2 + inset, frameScale);
    const picture = new PIXI.Sprite(PIXI.Texture.EMPTY);
    picture.anchor.set(0.5);
    const mask = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(-innerWidth / 2 + 2, -height / 2 + inset + 2, innerWidth - 4, innerHeight - 4, width * 0.08).endFill();
    picture.mask = mask;
    loadIcon(kind, [picture], width * 1.2, -height / 2 + inset + innerHeight / 2);
    face.addChild(outer, inner, shine, picture, mask);
    return face;
}
