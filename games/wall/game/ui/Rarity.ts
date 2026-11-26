// Rarity.ts
//
// How a rarity looks (as the pack's collection cards, Preview/5_Collection_List): the card in its tier's colour
// (ItemFrame02_Single_<frame>: grey, green, blue, purple, gold, red, rainbow), and its stars, 1 to 7 (rainbow ones for the
// last), in a dark band.

import * as PIXI from 'pixi.js';
import { RARITY, RarityDef } from '../data/WallConfig';
import { frame, sprite } from './parts';

/** The card frames' nine-slice (ItemFrame02_Single_*). */
export const CARD_SLICE: [number, number, number, number] = [25, 27, 25, 27];

/** A card in a rarity's colour. */
export const rarityCard = (rarity: RarityDef, width: number, height: number): PIXI.NineSlicePlane =>
    frame(`ItemFrame02_Single_${rarity.frame}`, CARD_SLICE, width, height);

/** A rarity's stars in a row, centred (`size`: each one's). */
export function rarityStars(rarity: RarityDef, size: number): PIXI.Container {
    const row = new PIXI.Container();
    const step = size * 0.78;
    for (let i = 0; i < rarity.stars; i++) {
        const star = sprite(rarity.premium ? 'GradeIcon_Star_s_Premium' : 'GradeIcon_Star_s_Yellow', size);
        star.x = (i - (rarity.stars - 1) / 2) * step;
        row.addChild(star);
    }
    return row;
}

/** The stars in a dark band across a card's foot (`width`: the band's), as the collection cards have them. */
export function rarityBand(rarity: RarityDef, width: number, size = 22): PIXI.Container {
    const band = new PIXI.Container();
    const back = frame('BasicFrame_Round12', [12, 12, 12, 12], width, size + 10, 0.9);
    back.tint = 0x100e18;
    back.alpha = 0.55;
    back.position.set(-width / 2, -(size + 10) / 2);
    const stars = rarityStars(rarity, size);
    // (Seven barely fit a small card: then they shrink.)
    stars.scale.set(Math.min(1, (width - 12) / Math.max(1, stars.width)));
    band.addChild(back, stars);
    return band;
}

export { RARITY };
