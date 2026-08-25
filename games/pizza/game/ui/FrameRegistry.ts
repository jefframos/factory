// FrameRegistry.ts
//
// Named 9-sliced panel presets — same "registry of reusable named presets"
// shape as TextStyleRegistry.ts, one level below it: a FrameName picks a
// texture (already packed into the 'images' bundle's ui.webp atlas — see
// public/pizza/images/ui.webp.json) plus the border widths PIXI.NineSlicePlane
// needs to stretch it without warping its corners. FrameComponent.ts is what
// actually turns one of these into a sized panel; AutoFitFrame.ts sizes one
// automatically around a piece of content (see that file's own doc).
//
// Add a new frame by adding an entry here — nothing else needs to change to
// start using it via FrameComponent/AutoFitFrame.

export interface FramePadding {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface FrameDef {
    /** Texture alias inside the packed 'images' bundle — see Assets.getTexture(). Undefined means no background texture at all — FrameComponent.ts falls back to PIXI.Texture.EMPTY, i.e. a fully invisible 9-slice (still occupies/sizes its bounds normally, just renders nothing) — for a frame that's only ever meant to size/position its content, not draw a visible panel behind it. */
    textureKey?: string;
    /** Border widths (source pixels) PIXI.NineSlicePlane keeps unstretched at each edge/corner — see FrameComponent.ts. */
    padding: FramePadding;

    arrowTexture?: string
    arrowPivot?: { x: number, y: number }
}

export function uniformPadding(px: number): FramePadding {
    return { left: px, top: px, right: px, bottom: px };
}

/** Every BorderFrame_Round20_* asset was exported with the same 22px border on every side — see uniformPadding(). Override per-frame below if a different asset ever needs asymmetric padding. */
const DEFAULT_PADDING = uniformPadding(22);
const DEFAULT_PADDING_BUBBLE = uniformPadding(30);

export const FrameRegistry: Record<string, FrameDef> = {
    Main: {
        textureKey: 'BorderFrame_Round20_Single_Dark',
        padding: DEFAULT_PADDING,
    },
    Large: {
        textureKey: 'BorderFrame_Round20_Single_Yellow',
        padding: DEFAULT_PADDING,
    },
    Info: {
        textureKey: 'ResourceBar_Single_Btn_Blue1',
        padding: DEFAULT_PADDING_BUBBLE,
    },
    Popup: {
        textureKey: 'ResourceBar_Single_Btn_Blue1',
        padding: DEFAULT_PADDING_BUBBLE,
        //arrowTexture: 'BubbleFrame03_Arrow_Bottom',
        arrowPivot: { x: 0.5, y: 1 },
    },
    /**
     * The lean "Simple" zone-popup style (see PopupConfig.ts's own doc) — no speech-bubble
     * arrow, since Simple is the style meant for a popup sitting flush on an entity's own base
     * rather than floating above it with something to visibly point down at. Texture/padding
     * are a first-pass estimate off the raw asset's own pixel dimensions (BubbleFrame05_Bg.png
     * is 222x82) rather than a measured 9-slice spec — cheap to retune (just these two
     * numbers) if the border ends up looking stretched or over-cropped in practice.
     */
    Simple: {
        padding: uniformPadding(20),
    },
    /** Gate.ts's icon-only "locked" panel (padlock + requirement icon, no text/arrow) — same bubble asset as Popup, kept as its own named preset so its look can be tuned independently. */
    GateLock: {
        textureKey: 'ResourceBar_Single_Btn_Grey',
        padding: DEFAULT_PADDING_BUBBLE,
    },
    /**
     * Per-entity-TYPE default popup frames (see PopupConfig.ts's own doc on resolvePopupFrameName()) —
     * BuildingZone/ShopZone/QueueZone/CraftZone each use their own preset here instead of all
     * four sharing the one 'Popup' frame, so a designer can retexture/repad one entity type's
     * popup without touching the others. Each config entry can still override its OWN frame
     * individually (BuildingConfig.frame/ShopConfig.frame/QueueConfig.frame/CraftTableConfig.frame,
     * settable per-id from the pizza web editor) — these are just the type-wide starting point,
     * cloned from 'Popup's own look so nothing changes visually until one gets tuned.
     */
    BuildingFrame: {
        textureKey: 'ResourceBar_Single_Btn_Yellow1',
        padding: DEFAULT_PADDING_BUBBLE,
        arrowPivot: { x: 0.5, y: 1 },
    },
    ShopFrame: {
        textureKey: 'ResourceBar_Single_Btn_Green1',
        padding: DEFAULT_PADDING_BUBBLE,
        arrowPivot: { x: 0.5, y: 1 },
    },
    QueueFrame: {
        textureKey: 'ResourceBar_Single_Btn_Blue1',
        padding: DEFAULT_PADDING_BUBBLE,
        arrowPivot: { x: 0.5, y: 1 },
    },
    CraftingFrame: {
        textureKey: 'ResourceBar_Single_Btn_Purple1',
        padding: DEFAULT_PADDING_BUBBLE,
        arrowPivot: { x: 0.5, y: 1 },
    },
};

export type FrameName = keyof typeof FrameRegistry;
