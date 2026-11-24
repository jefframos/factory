// TractorSkins.ts
//
// What the tractor can wear (ui/tractor.json): paints (a pattern over its body) and parts (pieces bolted onto it), one of
// each at a time. Bought or unlocked in the tractor's panel (TractorPanel) or by an offer while playing (TractorOffer);
// what's owned and worn is MowProgress's. TractorDress puts them on the model.

import type { Piece } from 'core/pieces/Pieces';
import data from '../../ui/tractor.json';

export type TractorKind = 'paints' | 'parts';

export interface TractorItem {
    /** '' is none: the mower's own paint, no part. */
    id: string;
    name: string;
    price: number;
    /** A gift: claimed for nothing. */
    free?: boolean;
    /** Not for sale: a rewarded video unlocks it. */
    video?: boolean;
}

export interface TractorPaint extends TractorItem {
    /** Its tile's size on the tractor (world units at the base height). */
    scale: number;
}

export interface TractorPart extends TractorItem {
    pieces: Piece[];
}

/** What it wears: a paint's id and a part's. */
export type TractorLook = Record<TractorKind, string>;

const PAINTS = data.paints as TractorPaint[];
const PARTS = data.parts as TractorPart[];

/** What each tab shows, the first one taking it off. */
export const TRACTOR_ITEMS: Record<TractorKind, TractorItem[]> = {
    paints: [{ id: '', name: 'Plain', price: 0 }, ...PAINTS],
    parts: [{ id: '', name: 'No Part', price: 0 }, ...PARTS],
};
export const TRACTOR_KINDS: TractorKind[] = ['paints', 'parts'];

export const tractorPaint = (id: string): TractorPaint | undefined => PAINTS.find((paint) => paint.id === id);
export const tractorPart = (id: string): TractorPart | undefined => PARTS.find((part) => part.id === id);
