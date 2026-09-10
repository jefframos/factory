// LayoutRegistry.ts
//
// Named presets for the LAYOUT (not the look — see IconSlotRegistry.ts for
// that) of every "icon in a slot, optionally with a count/level label and/or
// a badge" composition in this game — backpack, shop, crafting, building,
// queue, gate, mart, inventory popup, farm HUD, main-screen resources/tools.
// Same "registry of reusable named presets, Default cloned until something
// actually needs to diverge" shape as FrameRegistry.ts/IconSlotRegistry.ts.
//
// DELIBERATELY DATA ONLY — this file does NOT build PIXI objects. Every one
// of the ~15 files above already has its own, already-correct construction
// code (icon fitting, label positioning, badge overlap) with genuinely
// different needs (a mirrored row here, a bottom-center label there, a
// dynamic per-level badge texture somewhere else) — forcing all of that
// through one shared builder would mean either a builder too narrow to cover
// half of them, or one so parameterized it stops being simpler than what it
// replaces, and either way risks silently breaking a layout nobody can
// visually re-check line by line. So the split is: THIS file is the single
// place that says "how big," "how much gap," "where the label sits," "does
// a badge show and how big" — every consuming file keeps its own rendering
// code, just reading those numbers here instead of a local hardcoded
// constant. Tune ICON_LAYOUT_DEFAULT (or one named preset below) and every
// file that reads it moves together; a file that still needs its own exact
// number passes a one-off override into getIconLayout() instead of arguing
// with the shared default.
//
// See IconSlotRegistry.ts for the square background texture/tint/alpha
// (Tool/Crop/Resource/Currency/Animal) — `IconLayout.background` here just
// NAMES which of those styles (if any) this layout uses; the actual pixels
// still come from createIconSlotBackground().

import { IconSlotName } from './IconSlotRegistry';

/**
 * A count/level readout next to or on an icon slot. `format` is NOT read by
 * anything here — this registry only lays elements out, it doesn't know a
 * tool's level or a resource's remaining need. `format` exists purely so a
 * reader of this file (or the pizza web editor, eventually) can tell at a
 * glance what KIND of text a layout's label is for, since "N/M" (progress),
 * "N" (count), "Lv.N" (level) and "+N" (signed) are four different ideas
 * that happen to render the same way (one PIXI.Text at one anchor point).
 */
export interface IconLayoutLabel {
    /** false is the Default's own resting state — most icons show no label at all (AnimalDockUI's rows, FarmCropHud's status icon, ...). A preset/override flips this on. */
    enabled: boolean;
    format: 'progress' | 'count' | 'level' | 'signed' | 'custom';
    /** PIXI.Text.anchor — which point ON THE LABEL sits at the position `placement`+`offset` compute. */
    anchor: [number, number];
    /**
     * Where the label sits relative to the slot square:
     *  - 'corner': INSIDE the slot's own bottom-right corner (ResourceSlotVisual/BackpackUI's own count-badge idiom) — `offset` insets from that corner.
     *  - 'outsideRight': to the right of the slot, clear of it entirely (ToolListUI/ToolLevelUI's "Lv.N") — `offset` is the gap from the slot's right edge.
     *  - 'bottomCenter': centered horizontally, sitting just above the slot's own bottom edge (InventoryPopup's grid/FarmSeedPicker) — `offset` insets up from that edge.
     *  - 'farRight': independent of the icon entirely, right-aligned at the ROW's own full width (GlobalResourcesUI) — `offset` is unused; the caller already has its own row-width value to anchor against.
     */
    placement: 'corner' | 'outsideRight' | 'bottomCenter' | 'farRight';
    /**
     * [x, y] px, meaning depends on `placement` — NOT always a uniform inset,
     * since real usage isn't symmetric (ResourceSlotVisual/BackpackUI's own
     * corner label sits 4px in from the right but only 2px up from the
     * bottom, matched here rather than rounded to one shared number):
     *  - 'corner': label position = (slotSize - offset[0], slotSize - offset[1]).
     *  - 'outsideRight': offset[0] is the gap from the slot's right edge; offset[1] is unused (vertical centering is the caller's own row-height math, not this label's own offset).
     *  - 'bottomCenter': offset[1] is the inset up from the slot's bottom edge; offset[0] is unused (horizontally centered on the slot regardless).
     *  - 'farRight': both unused.
     */
    offset: [number, number];
    /** Overrides TextStyleRegistry.Body's own font size — undefined keeps that style's default (used by the 80px grid cells, whose label reads too large at Body's own default size otherwise). */
    fontSize?: number;
}

/**
 * A small icon overlapping the slot's bottom-right corner — "requirement
 * met/missing," "tool level," "can afford to upgrade." `texture` here is
 * only the STATIC default (a checkmark — see this interface's own doc for
 * why); a caller whose badge texture is computed from game state at render
 * time (InventoryPopup's tiered level-ring, LevelBadgeStyle.badgeTextureFor
 * Level()) still reads `size`/`inset`/`anchor` from here to stay positioned
 * consistently with every other badge, it just skips this field's own
 * `texture` and resolves its own instead.
 */
export interface IconLayoutBadge {
    /** false is the Default's own resting state — most slots show no badge. */
    enabled: boolean;
    /**
     * Defaults to a checkmark (Icon_Check03_s) — a "this is satisfied/done"
     * badge is the single most common one across every surface that has
     * one at all (FarmCropHud/Gate.ts's post-unlock state), so it's the
     * sensible resting value here; override to 'Icon_Exclamation' for a
     * "missing" badge (BuildingZone/Gate.ts's pre-unlock state) or any
     * other texture key a future badge needs.
     */
    texture: string;
    size: number;
    /** Negative overlaps OUTWARD past the slot's own corner (BuildingZone/Gate.ts/ShopZone's shared convention — the majority); positive tucks INWARD, inside the slot's own edge (FarmCropHud's own deliberate choice — kept as its override, not folded into the default, since it reads better against that HUD's smaller icon). */
    inset: number;
    anchor: [number, number];
}

export interface IconLayout {
    /** Square background+icon slot size, px. Meaningless when `background` is undefined (a bare icon uses its own size directly, set by the caller) but still given a value here so a layout can be flipped between bare and backed without also having to invent a size from scratch. */
    slotSize: number;
    /** Gap between the icon's own rendered edge and the slot square's edge — same "icon fitted a bit smaller than its backdrop" idiom every IconSlotRegistry consumer already uses. Negative is valid (BackpackListUI deliberately draws its icon slightly BIGGER than its own backdrop) — keep that as an override, don't fold a negative number into the shared Default. */
    iconPadding: number;
    /** Which IconSlotRegistry style this slot's background renders with. Undefined means NO background square at all (a bare icon — GlobalResourcesUI, ShopZone, Gate.ts, ...), which is a real, deliberate layout choice distinct from "use IconSlotRegistry's own Default style" — this field lets a layout state either one explicitly rather than one silently standing in for the other. */
    background?: IconSlotName;
    label: IconLayoutLabel;
    badge: IconLayoutBadge;
    /** Recommended gap to the next sibling when several of these repeat in a row/list/grid — a value this registry SUGGESTS; nothing here enforces it, the caller's own layout loop still owns the actual positioning math. */
    gapToNeighbor: number;
}

/** Every field an override may touch — same shape as IconLayout but every leaf optional, so a caller only ever writes down what actually differs from whichever preset it started from. */
export interface IconLayoutOverride {
    slotSize?: number;
    iconPadding?: number;
    background?: IconSlotName;
    label?: Partial<IconLayoutLabel>;
    badge?: Partial<IconLayoutBadge>;
    gapToNeighbor?: number;
}

function mergeLayout(base: IconLayout, override?: IconLayoutOverride): IconLayout {
    if (!override) {
        return base;
    }

    return {
        ...base,
        ...override,
        label: { ...base.label, ...override.label },
        badge: { ...base.badge, ...override.badge },
    };
}

/**
 * The resting state every named preset below clones from and only tunes
 * away from — see this file's own top doc. Change a value HERE and every
 * preset (and therefore every file reading one, unless that file's own
 * preset overrides that exact field) moves with it; this is the one lever
 * that reaches the whole game's icon-slot layout at once.
 */
export const ICON_LAYOUT_DEFAULT: IconLayout = {
    slotSize: 56,
    iconPadding: 6,
    background: 'Default',
    label: {
        enabled: false,
        format: 'count',
        anchor: [1, 1],
        placement: 'corner',
        offset: [4, 2],
    },
    badge: {
        enabled: false,
        texture: 'Icon_Check03_s',
        size: 22,
        inset: -2,
        anchor: [1, 1],
    },
    gapToNeighbor: 10,
};

/**
 * Per-composition presets — each an OVERRIDE on top of ICON_LAYOUT_DEFAULT,
 * not a fully-restated layout, so a preset with nothing unusual to say about
 * (for instance) badges just doesn't mention badges at all and inherits the
 * default's "no badge" resting state. See the Icon Layout Registry audit
 * (shared separately) for exactly which files map to which preset today,
 * and getIconLayout()'s own doc for one-off per-call overrides (e.g.
 * FarmSeedPicker's 56px cell vs Grid's own 80px default).
 */
const PRESET_OVERRIDES: Record<string, IconLayoutOverride> = {
    /** The type-wide resting state itself, kept as its own named entry so a lookup by name always resolves, even for "just give me Default." */
    Default: {},
    /**
     * "Bring N of resource X" — the requirement row every zone popup
     * (Queue/Building/Craft, via ResourceSlotVisual.createResourceSlot())
     * already shares byte-for-byte. `background` is left unset here
     * (inheriting Default's own 'Default' style) since these callers
     * actually resolve a dynamic Tool/Crop/Resource style per-item via
     * styleForResourceType() rather than one fixed style for the whole
     * preset — see IconSlotRegistry.ts's own doc on that function.
     */
    Requirement: {
        label: { enabled: true, format: 'progress', placement: 'corner', offset: [4, 2] },
    },
    /** BackpackUI's own slot — BackpackListUI overrides slotSize/iconPadding further still (32px, -3 padding — see getIconLayout() call site) rather than folding those into this shared preset. */
    BackpackSlot: {
        slotSize: 38,
        background: 'Resource',
        label: { enabled: true, format: 'count', placement: 'corner', offset: [4, 2] },
        gapToNeighbor: 8,
    },
    /**
     * A tool's own icon + "Lv.N" — ToolListUI/ToolLevelUI's shape.
     * InventoryPopup's tools-tab row shows level as a BADGE (a tiered
     * ring + number, texture resolved per-level by LevelBadgeStyle, not a
     * fixed string) rather than this inline label — it reads `badge.size`/
     * `inset`/`anchor` from its OWN override of this preset instead of
     * `label`, since the two files chose genuinely different presentations
     * of the same "what level is this tool" fact. See this file's own doc
     * on why a dynamically-textured badge doesn't fit `badge.texture`.
     */
    ToolRow: {
        slotSize: 44,
        iconPadding: 4,
        background: 'Tool',
        label: { enabled: true, format: 'level', placement: 'outsideRight', anchor: [0, 0.5], offset: [8, 0] },
        gapToNeighbor: 8,
    },
    /** A count sitting bottom-center under a bigger cell — InventoryPopup's resource/farm grid, FarmSeedPicker (which overrides slotSize/iconPadding down to 56/9 — see getIconLayout() call site). */
    Grid: {
        slotSize: 80,
        iconPadding: 18,
        label: { enabled: true, format: 'count', placement: 'bottomCenter', anchor: [0.5, 1], offset: [0, 2], fontSize: 14 },
        gapToNeighbor: 10,
    },
    /**
     * A bare icon with NO background square at all — GlobalResourcesUI,
     * ShopZone's cost row/tool header, FarmZone's price row, QueueZone's
     * reward line, CraftZone's result icon, Gate.ts's lock/requirement
     * icons. `slotSize`/`iconPadding` are meaningless here (the caller
     * sizes its own bare icon directly) — `gapToNeighbor` is the one field
     * this preset actually exists for: the icon-to-inline-label gap three
     * separate files used to each hand-type as a bare `+ 4` literal.
     */
    Bare: {
        background: undefined,
        gapToNeighbor: 4,
    },
    /** AnimalDockUI/AnimalFollowUI's own roster slot — see IconSlotRegistry.ts's 'Animal' style, added alongside this preset so animals stop silently falling back to IconSlotRegistry's own 'Default' the way every other content kind already has a name of its own. */
    Animal: {
        background: 'Animal',
        gapToNeighbor: 8,
    },
};

export const LayoutRegistry: Record<string, IconLayout> = Object.fromEntries(
    Object.entries(PRESET_OVERRIDES).map(([name, override]) => [name, mergeLayout(ICON_LAYOUT_DEFAULT, override)]),
) as Record<string, IconLayout>;

export type IconLayoutName = keyof typeof LayoutRegistry;

/**
 * `LayoutRegistry[name]`, optionally further merged with a one-off
 * `override` for the rare case a caller's own numbers don't quite match
 * every other user of that preset (e.g. FarmSeedPicker wanting Grid's
 * bottom-center count label but at a 56px cell instead of Grid's own 80px)
 * — the caller states only the ONE thing that differs, not a whole
 * restated layout, same "override just what you need" contract every
 * preset above already has with ICON_LAYOUT_DEFAULT.
 */
export function getIconLayout(name: IconLayoutName, override?: IconLayoutOverride): IconLayout {
    return mergeLayout(LayoutRegistry[name], override);
}
