// TractorSkins.ts
//
// What the tractor can wear (ui/tractor.json): colours (plain: its body's and its frame's), paints (a pattern over both) and
// parts (pieces bolted onto it), one of each at a time; a colour picked takes the paint off. Bought or unlocked in the tractor's panel (TractorPanel) or by an offer while playing (TractorOffer);
// what's owned and worn is DigProgress's. TractorDress puts them on the model.

import type { Piece } from 'core/pieces/Pieces';
import data from '../../ui/tractor.json';

export type TractorKind = 'colors' | 'paints' | 'parts';

export interface TractorItem {
    /** '' is what it comes with: the classic colour, no paint, no part. */
    id: string;
    name: string;
    price: number;
    /** A gift: claimed for nothing. */
    free?: boolean;
    /** Not for sale: a rewarded video unlocks it. */
    video?: boolean;
}

/** A plain colour: its body (hood and roof) and its frame (cab and fenders). */
export interface TractorColor extends TractorItem {
    body: string;
    frame: string;
}

export interface TractorPaint extends TractorItem {
    /** Its tile's size on the tractor (world units at the base height). */
    scale: number;
}

export interface TractorPart extends TractorItem {
    pieces: Piece[];
    /** Where it goes on the tractor (unset: where every part does, ui/dig.json tractor.partsAt). */
    at?: { x: number; y: number; z: number };
}

/** What it wears: a colour's id, a paint's and a part's. */
export type TractorLook = Record<TractorKind, string>;

/** Nothing picked: the classic colour. */
export const NO_TRACTOR_LOOK: TractorLook = { colors: '', paints: '', parts: '' };

const COLORS = data.colors as TractorColor[];
const PAINTS = data.paints as TractorPaint[];
const PARTS = data.parts as TractorPart[];

/** What each tab shows, the first one taking it off. */
export const TRACTOR_ITEMS: Record<TractorKind, TractorItem[]> = {
    colors: COLORS,
    paints: [{ id: '', name: 'No Pattern', price: 0 }, ...PAINTS],
    parts: [{ id: '', name: 'No Part', price: 0 }, ...PARTS],
};
export const TRACTOR_KINDS: TractorKind[] = ['colors', 'paints', 'parts'];

/** A colour (the classic one, if there's none by that id). */
export const tractorColor = (id: string | undefined): TractorColor => COLORS.find((color) => color.id === (id ?? '')) ?? COLORS[0];
export const tractorPaint = (id: string): TractorPaint | undefined => PAINTS.find((paint) => paint.id === id);
export const tractorPart = (id: string): TractorPart | undefined => PARTS.find((part) => part.id === id);
