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
    /** Fine-tune nudge (screen pixels, in the frame's own unadjusted size space — unaffected by scaleAdjust) added on top of arrowPivot's computed position — see FrameComponent.setSize(). Undefined is {x:0,y:0}, i.e. no nudge — unchanged behavior for every frame that hasn't needed this. */
    arrowOffset?: { x: number, y: number }
    /**
     * Renders the underlying NineSlicePlane at `requestedSize * scaleAdjust`, then scales the
     * plane itself back down by `1 / scaleAdjust` so the frame's final on-screen size is
     * unchanged — see FrameComponent.setSize(). Since the border widths above are fixed texture
     * pixels that don't scale with the plane's own width/height (only the stretchy middle does),
     * asking for a bigger plane makes those borders a smaller fraction of the total, so they end
     * up thinner (and the middle less aggressively stretched) once scaled back down — useful for
     * a small/low-res source texture whose 9-slice otherwise looks chunky or over-stretched at
     * the sizes this frame actually gets used at. Undefined (or 1) is a no-op — the default,
     * unchanged behavior for every frame that hasn't needed this.
     */
    scaleAdjust?: number
}

export function uniformPadding(px: number): FramePadding {
    return { left: px, top: px, right: px, bottom: px };
}

/** Every BorderFrame_Round20_* asset was exported with the same 22px border on every side — see uniformPadding(). Override per-frame below if a different asset ever needs asymmetric padding. */
const DEFAULT_PADDING = uniformPadding(25);
const DEFAULT_PADDING_BUBBLE = uniformPadding(28);

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
        padding: uniformPadding(30),
    },
    /** Gate.ts's icon-only "locked" panel (padlock + requirement icon, no text/arrow) — same bubble asset as Popup, kept as its own named preset so its look can be tuned independently. */
    GateLock: {
        textureKey: 'ResourceBar_Single_Btn_Grey',
        padding: DEFAULT_PADDING_BUBBLE,
    },
    /** PlayerNotificationComponent's throwaway "action blocked" popup (missing-tool icon + exclamation badge) over the player's own head — same grey bubble as GateLock, kept as its own preset so its look can be tuned independently of the gate's requirement panel. */
    Blocked: {
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
        textureKey: 'request-bubble',
        padding: { bottom: 25, top: 25, left: 25, right: 25 },
        arrowTexture: 'request-tip',
        arrowPivot: { x: 0.5, y: 1 },
        arrowOffset: { x: 0, y: -6 }, // tune here if the tip doesn't sit flush against the body
        // See FrameDef.scaleAdjust's own doc — request-bubble.png is small (132x96), so at this
        // frame's actual (content-fit) on-screen size the fixed borders ate up most of the
        // panel, squeezing the stretchy middle (and the tail baked into it) down hard. Bump to
        // 3 if it still looks off.
        scaleAdjust: 2,
    },
    CraftingFrame: {
        textureKey: 'ResourceBar_Single_Btn_Purple1',
        padding: DEFAULT_PADDING_BUBBLE,
        arrowPivot: { x: 0.5, y: 1 },
    },
    /** FarmZone's own price popup (see that file's own doc) — shares ShopFrame's green texture (a purchase, same as a shop upgrade) but kept as its own preset so it can be retuned independently. */
    FarmFrame: {
        textureKey: 'ResourceBar_Single_Btn_Green1',
        padding: DEFAULT_PADDING_BUBBLE,
        arrowPivot: { x: 0.5, y: 1 },
    },
    /** InventoryPopup's own panel shape (see popups/InventoryPopup.ts) — a bordered item-frame plate rather than the speech-bubble 'Popup' style, no arrow. 64px border on every side, per the source asset's own bake. */
    ItemFrame: {
        textureKey: 'ItemFrame03_Single_Navy',
        padding: uniformPadding(64),
    },
    /**
     * A plain rounded-corner square backdrop — everywhere else this same texture is used
     * (BackpackUI/AnimalDockUI/ResourceSlotVisual/... — see that texture key's own usages) it's
     * a small, always-square icon-slot background stretched as a plain Sprite, never 9-sliced;
     * this is the first spot that needs it behind non-square content (MovementTutorialOverlay's
     * text prompt), where a plain stretch would visibly warp its rounded corners. 10px border on
     * every side is a first-pass estimate off the raw asset's own small 35x38px size, not a
     * measured 9-slice spec — retune if the corners look stretched/over-cropped in practice.
     */
    PromptBg: {
        textureKey: 'BorderFrame_Squrare_Bg',
        padding: uniformPadding(10),
    },
    /**
     * 'back1' (see IconSlotRegistry.ts) at PANEL scale rather than icon-slot scale — everywhere
     * else this texture is used, it's a small (80px or under) square backdrop stretched as a
     * plain Sprite, never 9-sliced; that's fine there since PIXI.NineSlicePlane's own corner-
     * shrink kicks in below this border's own 100px sum anyway, degenerating to the exact same
     * uniform scale a plain stretch already produces at icon-slot sizes. This preset is for the
     * first caller that renders 'back1' bigger than that (InventoryPopup's own tab body, 450x500)
     * — a plain stretch at that size visibly smears the source PNG's own rounded corners. 50px
     * border matches the raw asset's own generous corner-radius clearance (130x130 native,
     * corner radius ~25-30px — 50px leaves real safety margin either side of the actual curve).
     */
    PanelBody: {
        textureKey: 'back1',
        padding: uniformPadding(50),
    },
};

export type FrameName = keyof typeof FrameRegistry;
