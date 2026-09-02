// BarComponent.ts
//
// Turns a BarRegistry.ts style into a sized, progress-settable bar — same
// "resolve a named preset into a real 9-sliced PIXI object" role
// FrameComponent.ts plays for FrameRegistry.ts, just two stacked
// NineSlicePlanes (bg behind, fill on top, tinted per style) instead of
// one. The ONE shared bar shape every progress readout in this game should
// use from now on (AnimalNode's own capture bar and FarmCropHud's own
// growth bar both do — see each file's own doc) instead of each place
// hand-rolling its own plain-white-Sprite bg+fill pair.
//
//   const bar = new BarComponent('Green', 120, 20);
//   bar.setProgress(0.5); // fill halfway
//
// setSize()'s own height is clamped to BarRegistry.MIN_BAR_HEIGHT
// regardless of what's asked for — see that constant's own doc for why a
// smaller bar visibly breaks the background texture's own border art.

import * as PIXI from 'pixi.js';
import { BarStyleName, resolveBarStyle, MIN_BAR_HEIGHT } from './BarRegistry';

/** Fixed gap between the bg's own edge and the fill on every side — separate from the bg's own 9-slice border padding, which is about the ART not overlapping, not about leaving the fill visibly inset. */
const FILL_MARGIN = 3;

export default class BarComponent extends PIXI.Container {
    private readonly bg: PIXI.NineSlicePlane;
    private readonly fill: PIXI.NineSlicePlane;
    private readonly fillMinWidth: number;
    /** Inset between the bg's own edge and the fill — FILL_MARGIN on each side. */
    private readonly fillInsetX: number;
    private readonly fillInsetY: number;
    private barWidth = 0;

    public constructor(style: BarStyleName, width: number, height: number) {
        super();

        const resolved = resolveBarStyle(style);

        this.bg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(resolved.bgTextureKey),
            resolved.bgPadding.left,
            resolved.bgPadding.top,
            resolved.bgPadding.right,
            resolved.bgPadding.bottom,
        );
        this.addChild(this.bg);

        // Added AFTER bg so it renders on top — same draw-order convention
        // AutoFitFrame's own frame-then-content ordering uses.
        this.fill = new PIXI.NineSlicePlane(
            PIXI.Texture.from(resolved.fillTextureKey),
            resolved.fillPadding.left,
            resolved.fillPadding.top,
            resolved.fillPadding.right,
            resolved.fillPadding.bottom,
        );
        this.fill.tint = resolved.fillColor;
        this.addChild(this.fill);

        this.fillInsetX = FILL_MARGIN * 2;
        this.fillInsetY = FILL_MARGIN * 2;

        // A NineSlicePlane rendering below its own left+right border-width sum inverts/warps
        // its corners — same reasoning setSize()'s own MIN_BAR_HEIGHT clamp uses for height,
        // just the width-axis equivalent, and specific to the FILL (whose corners are smaller,
        // 8px, than the bg's 12px) since it's the one whose width actually changes at runtime.
        this.fillMinWidth = resolved.fillPadding.left + resolved.fillPadding.right;

        this.setSize(width, height);
        this.setProgress(1);
    }

    /** Resizes the whole bar — the fill's own width is NOT touched here (see setProgress()), so call setProgress() again after a resize if the fill should keep reflecting the same fraction rather than snapping back to full. */
    public setSize(width: number, height: number): void {
        this.barWidth = Math.max(1, width);
        const clampedHeight = Math.max(height, MIN_BAR_HEIGHT);

        this.bg.width = this.barWidth;
        this.bg.height = clampedHeight;

        // Fill sits inset within the bg by FILL_MARGIN — see fillInsetX/Y's own doc.
        this.fill.position.set(this.fillInsetX / 2, this.fillInsetY / 2);
        this.fill.height = Math.max(1, clampedHeight - this.fillInsetY);
    }

    /** 0-1 — resizes the fill's own width to that fraction of the bar's own inset width (barWidth minus fillInsetX — see that field's own doc), floored at fillMinWidth so the fill NineSlicePlane never renders smaller than its own border art needs, even at fraction 0. */
    public setProgress(fraction: number): void {
        const clamped = Math.min(1, Math.max(0, fraction));
        const insetWidth = Math.max(1, this.barWidth - this.fillInsetX);
        this.fill.width = Math.max(this.fillMinWidth, insetWidth * clamped);
    }
}
