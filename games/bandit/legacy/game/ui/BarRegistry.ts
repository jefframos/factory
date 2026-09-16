// BarRegistry.ts
//
// Named progress-bar presets — same "registry of reusable named presets"
// shape as FrameRegistry.ts, one level below it: a BarStyleName picks a
// bg/fill texture pair plus the border widths PIXI.NineSlicePlane needs to
// stretch each one without warping its corners (exactly FrameDef.padding's
// own meaning, not a layout margin — see BarComponent.ts, which is what
// actually turns one of these into a sized, progress-settable bar).
//
// Every style shares the SAME bg/fill texture pair by default
// (Slider_Basic01_Bg_Single / Slider_Basic03_FillMask) — the fill's source
// art is plain white specifically so a style only has to pick its own
// `fillColor` tint to read as a completely different bar (green for a
// capture/growth bar, red for a health-style bar, ...), without needing a
// whole new pair of texture assets per style. `bgTextureKey`/`fillTextureKey`/
// `bgPadding`/`fillPadding` are still per-entry overridable (same escape
// hatch FrameRegistry entries have for their own texture/padding) for
// whichever future style genuinely needs different art, not just a
// different color.
//
// Add a new style by adding an entry here — nothing else needs to change to
// start using it via BarComponent.

export interface BarPadding {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export function uniformBarPadding(px: number): BarPadding {
    return { left: px, top: px, right: px, bottom: px };
}

/** Slider_Basic01_Bg_Single's own 9-slice border widths — see this file's own top doc. */
const DEFAULT_BG_TEXTURE_KEY = 'Slider_Basic01_Bg_Single';
const DEFAULT_BG_PADDING = uniformBarPadding(12);
/** Slider_Basic03_FillMask's own 9-slice border widths — smaller than the bg's own (8 vs 12) since the fill mask's corners are less pronounced than the frame's decorative border. */
const DEFAULT_FILL_TEXTURE_KEY = 'Slider_Basic03_FillMask';
const DEFAULT_FILL_PADDING = uniformBarPadding(8);

/**
 * Below this, Slider_Basic01_Bg_Single's own border art visibly warps/overlaps itself (its top
 * + bottom 12px border regions need real room to render distinctly) — BarComponent.setSize()
 * enforces this as a hard floor regardless of whatever height a caller asks for, same
 * "asset-driven minimum" reasoning MartZone.ts's own BUTTON_FRAME_PADDING bump (and its doc)
 * ran into with FarmFrame's baked-in arrow.
 */
export const MIN_BAR_HEIGHT = 24;

export interface BarStyleDef {
    /** Tint applied to the (white-source) fill 9-slice — see this file's own top doc for why this is the ONE thing most styles need to set. */
    fillColor: number;
    bgTextureKey?: string;
    fillTextureKey?: string;
    bgPadding?: BarPadding;
    fillPadding?: BarPadding;
}

export const BarRegistry = {
    /** AnimalNode's own capture bar / FarmCropHud's own growth bar — both share this one style, same green every other "gain/progress" feedback in this game uses (GlobalResourcesUI's own gain popup, LooseResourceNode's own gain popup, ...). */
    Green: { fillColor: 0x33cc66 },
    Red: { fillColor: 0xe5484d },
    Blue: { fillColor: 0x3388ff },
    Yellow: { fillColor: 0xffcc33 },
} satisfies Record<string, BarStyleDef>;

export type BarStyleName = keyof typeof BarRegistry;

/** A style's own texture/padding, falling back to the shared defaults for whichever fields it didn't override — see this file's own top doc. */
export function resolveBarStyle(style: BarStyleName): {
    bgTextureKey: string;
    fillTextureKey: string;
    bgPadding: BarPadding;
    fillPadding: BarPadding;
    fillColor: number;
} {
    const def: BarStyleDef = BarRegistry[style];
    return {
        bgTextureKey: def.bgTextureKey ?? DEFAULT_BG_TEXTURE_KEY,
        fillTextureKey: def.fillTextureKey ?? DEFAULT_FILL_TEXTURE_KEY,
        bgPadding: def.bgPadding ?? DEFAULT_BG_PADDING,
        fillPadding: def.fillPadding ?? DEFAULT_FILL_PADDING,
        fillColor: def.fillColor,
    };
}
