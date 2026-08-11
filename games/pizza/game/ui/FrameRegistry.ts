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
    /** Texture alias inside the packed 'images' bundle — see Assets.getTexture(). */
    textureKey: string;
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
        textureKey: 'BorderFrame_Round24',
        padding: DEFAULT_PADDING_BUBBLE,
    },
    Popup: {
        textureKey: 'BorderFrame_Round24',
        padding: DEFAULT_PADDING_BUBBLE,
        arrowTexture: 'BubbleFrame03_Arrow_Bottom',
        arrowPivot: { x: 0.5, y: 1 },
    },
};

export type FrameName = keyof typeof FrameRegistry;
