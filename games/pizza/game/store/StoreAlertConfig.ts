// StoreAlertConfig.ts
//
// How far away the store's player prompts (the '!' over the cashier, the trash icon over garbage —
// see ui/AlertIcon.ts) stay visible: further than a zone nameplate (ZONE_LABEL_ANCHOR_OPTIONS),
// since their whole point is calling the player over from elsewhere in the store.

import type { ScreenAnchorOptions } from '../components/ScreenAnchorComponent';

export const STORE_ALERT_ANCHOR_OPTIONS: ScreenAnchorOptions = {
    maxDistance: 28,
    distanceScale: {
        nearDistance: 4,
        farDistance: 24,
        minScale: 0.7,
    },
};
