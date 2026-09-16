// ZoneLabelConfig.ts
//
// Shared "how far away can you still see it, how big does it render"
// tuning for a zone's PERSISTENT nameplate/panel — DropZone's "Drop Zone"
// label, BuildingZone's requirements panel. One shared ScreenAnchorOptions
// object so the two never drift out of sync, and a single place to retune
// both at once. Deliberately NOT applied to transient popups (deposit "+1
// Wood", "Level Up!") — those are short-lived combat-text-style effects,
// not standing zone UI, so they stay visible/full-scale regardless of
// distance.

import { ScreenAnchorOptions } from '../components/ScreenAnchorComponent';

export const ZONE_LABEL_ANCHOR_OPTIONS: ScreenAnchorOptions = {
    /** Beyond this, the nameplate hides entirely rather than clutter the screen from across the map. */
    maxDistance: 16,
    distanceScale: {
        /** At/below this distance, the nameplate renders at full size. */
        nearDistance: 3,
        /** At/beyond this distance, the nameplate is at its smallest (minScale) — same value as maxDistance so it's already near-invisible by the time it'd stop shrinking. */
        farDistance: 14,
        minScale: 0.85,
    },
};
