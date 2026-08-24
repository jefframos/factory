// PopupConfig.ts
//
// Shared "how does this zone's floating requirements popup look" knobs —
// BuildingZone/ShopZone/QueueZone/CraftZone each have their own PERSISTENT
// panel (see ZoneLabelConfig.ts for the shared distance-scale tuning those
// share) but used to hardcode both which FrameRegistry frame it used
// ('Popup', always) and how high above the entity it floated (a fixed
// per-file LABEL_HEIGHT_OFFSET constant) — this is what makes both
// per-entity-config settings instead, editable from the pizza web editor.
//
// `popupMode` (defaults to 'complete' when unset, i.e. every entity's exact
// pre-existing behavior):
//   - 'none'     — no popup at all. The entity's own labelAnchor still
//                  exists (a flying deposit icon still needs somewhere to
//                  fly TO), just nothing is ever drawn there.
//   - 'complete' — today's full panel: whatever entity-specific "header"
//                  (a big result/tool icon, a reward line, ...) plus the
//                  resource requirement row(s) below it.
//   - 'simple'   — ONLY the resource requirement row(s), no header at all
//                  — for a design that wants "what do I need" at a glance
//                  without a big icon competing for attention. Rendered in
//                  the 'Simple' FrameRegistry frame (no speech-bubble arrow)
//                  rather than 'Popup's, since Simple is the style meant to
//                  sit flush on the entity's own base (see popupBobOffset
//                  below) rather than float above it pointing down.
//
// `popupBobOffset` — world-units above the entity's own transform.position
// (which sits at ground level for every one of these zones) the popup
// floats. undefined/omitted means "sit at the entity's own base" (offset
// 0) instead of floating higher — a level designer who wants a popup
// higher up (clearing a tall model, e.g.) sets this explicitly; leaving it
// unset is the "just sits right on the entity" default this file's own doc
// promised.
//
// Sitting flush at the entity's base (the common 'simple' case) is exactly
// where the player's own character ends up once they walk into the zone to
// interact with it — resolvePopupAvoidViewer() below opts 'simple' popups
// into ScreenAnchorComponent's avoidViewer option (see that file's own doc),
// which reads the actual region to dodge from PlayerUIAvoidanceComponent.ts
// (anchored at the player's HEAD, with a designer-tunable, live radius —
// there's no fixed radius baked in here anymore), sliding the popup aside
// with a small placeholder pointer (PIXI.Texture.WHITE — no dedicated arrow
// asset exists yet) fading in to show which entity it's still about.
// 'complete' popups don't get this: they already float well above the
// player by default (see every zone's own POPUP_HEIGHT_OFFSET-equivalent),
// so the overlap this exists to avoid rarely happens for them in the first
// place.
//
// 'simple' also sets ScreenAnchorOptions.anchor to SIMPLE_POPUP_ANCHOR
// (top-center) — see that option's own doc for the general mechanism.
// Without it, "the popup" for avoidance/positioning purposes would default
// to content's own local origin, which for these panels sits at the BOTTOM
// (every zone's own resource-row layout stacks upward from y=0) — meaning
// the point actually being kept clear of the player would be the panel's
// bottom edge while its top (visually closer to the player once pushed)
// went unchecked. Top-center instead of dead-center specifically because
// requirement rows are wider than they are tall — centering on width keeps
// the popup from drifting sideways for no reason, while anchoring at the
// top (not the vertical middle) means avoidance only pushes as far as the
// popup's own top edge actually needs, not further. A future per-entity
// override would just add its own `anchor` field to CraftTableConfig/etc.
// and pass it through here instead of this fixed constant.

import * as THREE from 'three';
import { FrameName } from './FrameRegistry';
import { ScreenAnchorOptions } from '../components/ScreenAnchorComponent';

export type PopupMode = 'none' | 'complete' | 'simple';

/** Top-center — see this file's own top-of-file doc for why 'simple' popups use this instead of leaving ScreenAnchorOptions.anchor unset (content's own local-origin default). */
const SIMPLE_POPUP_ANCHOR = { x: 0.5, y: 0 };

/** Which FrameRegistry preset a zone's AutoFitFrame should use for its floating popup — 'simple' gets the arrow-less 'Simple' frame, everything else (including 'none', which never actually builds a frame) keeps the existing 'Popup' speech-bubble. */
export function resolvePopupFrameName(mode: PopupMode | undefined): FrameName {
    return mode === 'simple' ? 'Simple' : 'Popup';
}

/** See `popupBobOffset`'s own doc above — undefined/0 means "right at the entity's own base." */
export function resolvePopupAnchorOffset(bobOffset: number | undefined): THREE.Vector3 {
    return new THREE.Vector3(0, bobOffset ?? 0, 0);
}

/**
 * `avoidViewer`/`anchor`/`pointerAlwaysVisible` only for 'simple' — see this file's own
 * top-of-file doc for why 'complete' doesn't need any of them. `pointerAlwaysVisible` is on
 * here so the pointer reads as attached to the popup for the FULL time it's displaced, not just
 * once the dodge clears ScreenAnchorComponent's own small "worth mentioning yet" margin — see
 * that option's own doc. Spread this into whichever ScreenAnchorOptions object a zone otherwise
 * passes (e.g. `{ ...ZONE_LABEL_ANCHOR_OPTIONS, ...resolvePopupAvoidViewer(mode) }`).
 */
export function resolvePopupAvoidViewer(mode: PopupMode | undefined): Pick<ScreenAnchorOptions, 'avoidViewer' | 'anchor' | 'pointerAlwaysVisible'> {
    return mode === 'simple' ? { avoidViewer: true, anchor: SIMPLE_POPUP_ANCHOR, pointerAlwaysVisible: true } : {};
}
