// FogOfWarConfig.ts
//
// Picks which of the two zone-lock visual solutions is active, and how a tile/entity that
// overlaps more than one zone should resolve its own visibility — one switch here (not
// scattered across FogOfWarManager/ZoneVisibilityManager/WorldManager) so trying the other
// solution, or the other overlap rule, for comparison/testing is a one-line edit.

export enum FogOfWarStyle {
    /**
     * Solution 1 — an opaque, cloud-shaded box volume covers every unrevealed land cell (see
     * FogOfWarManager.ts). The real ground/props underneath keep rendering normally; the box
     * just visually hides them.
     */
    BoxCloud = 'boxCloud',
    /**
     * Solution 2 — nothing in a closed zone renders at all: no ground mesh, no resource/
     * building/shop/queue mesh (see ZoneVisibilityManager.ts). No placeholder sits over the gap.
     */
    HideEntities = 'hideEntities',
}

export type ZoneOverlapMode = 'any' | 'all';

export interface FogOfWarConfig {
    style: FogOfWarStyle;
    /**
     * How a tile/entity whose footprint touches MORE than one zone decides its own visibility:
     * 'any' shows it the moment ONE of those zones is revealed; 'all' waits until EVERY zone it
     * touches is revealed. Only matters for something straddling a zone boundary — most tiles/
     * entities sit fully inside a single zone, where both modes agree.
     */
    overlapMode: ZoneOverlapMode;
}

export const FOG_OF_WAR_CONFIG: FogOfWarConfig = {
    style: FogOfWarStyle.HideEntities,
    overlapMode: 'all',
};
