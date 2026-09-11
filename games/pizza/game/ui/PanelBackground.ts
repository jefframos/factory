// PanelBackground.ts
//
// The dark, translucent 'PanelBody' backdrop every content panel in this
// game shows behind its own rows/grid/cost-row (InventoryPopup, MartPopup,
// CraftingTablePopup, FarmSeedPicker, CraftZone's requirement panel,
// BackpackListUI) — pulled out into ONE shared component so every one of
// them always renders the exact same tint/alpha/corner style and measures
// its own content inset off the exact same margin constant, instead of each
// file hand-rolling its own copy of the same few lines. That's exactly how
// they drifted apart before this existed: InventoryPopup/MartPopup at 0.5
// alpha, others independently landing on 0.6, each with its own locally-
// named "BODY_CONTENT_MARGIN"/"CONTENT_PADDING" constant that all happened
// to be 10-20px but were never actually the SAME number anywhere. A new
// panel should use this instead of building its own
// `new FrameComponent('PanelBody', ...)` call.
//
// Two ways to size it, matching the two shapes a panel's own content comes
// in:
//   - setFixedSize(w, h) — a panel that reserves one footprint regardless
//     of which tab/rows currently show (InventoryPopup/MartPopup, both of
//     which have a tab strip sitting right below this panel that can't jump
//     around as tabs switch).
//   - fitToContent(bounds) — a panel with no fixed footprint of its own,
//     which should grow/shrink with however much content it currently
//     holds (CraftingTablePopup's row list, FarmSeedPicker's seed grid,
//     CraftZone's cost row, BackpackListUI's resource list). Pass whatever
//     the actual content container's own getLocalBounds() reports, read
//     fresh after every rebuild — nothing here watches for that
//     automatically, same "call again after content changes" convention
//     AutoFitFrame.fit() already uses.

import FrameComponent from './FrameComponent';

/** Inset every panel's own content sits at within this background, on every side — the one place this number lives, instead of each panel re-declaring its own margin/padding constant. */
export const PANEL_CONTENT_MARGIN = 20;

const BACKGROUND_TINT = 0x000000;
const BACKGROUND_ALPHA = 0.5;

export default class PanelBackground extends FrameComponent {
    public constructor() {
        super('PanelBody', 1, 1);
        this.setTint(BACKGROUND_TINT);
        this.alpha = BACKGROUND_ALPHA;
    }

    /** Fixed-footprint variant — see this file's own top doc. */
    public setFixedSize(width: number, height: number): void {
        this.setSize(width, height);
    }

    /** Content-tracking variant — see this file's own top doc. */
    public fitToContent(bounds: { x: number; y: number; width: number; height: number }): void {
        this.position.set(bounds.x - PANEL_CONTENT_MARGIN, bounds.y - PANEL_CONTENT_MARGIN);
        this.setSize(bounds.width + PANEL_CONTENT_MARGIN * 2, bounds.height + PANEL_CONTENT_MARGIN * 2);
    }
}
