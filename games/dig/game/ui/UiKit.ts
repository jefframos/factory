// UiKit.ts
//
// Reads ui/uikit.json (edited in the web editor's "UI Kit" tab) so popups pick their images, slices,
// tints, texts and text colors from data instead of hard-coded constants.

import * as PIXI from 'pixi.js';
import kit from '../../ui/uikit.json';

type StyleRole = 'primary' | 'secondary';

interface ShadowSettings {
    enabled: boolean;
    color: string;
    alpha: number;
    angle: number;
    distance: number;
    blur: number;
}

/** Everything that defines a look; text elements pick one by name and may override single fields. */
interface TextStyleSettings {
    fontFamily: string;
    fill: string;
    stroke: string;
    strokeWidth: number;
    letterSpacing: number;
    shadow: ShadowSettings;
}

interface ImageElement {
    type: 'image';
    image: string;
    slice: [number, number, number, number] | null;
    tint: string;
    /** Optional size override in the element's own units (before any parent scale). */
    w?: number;
    h?: number;
    /** Nine-slice corner scale (DEFAULT_SLICE_SCALE when unset). */
    sliceScale?: number;
}

interface TextElement extends Partial<Omit<TextStyleSettings, 'shadow'>> {
    type: 'text';
    text: string;
    size: number;
    style?: StyleRole;
    shadow?: Partial<ShadowSettings>;
    /** 0 / missing = no wrapping. */
    wrapWidth?: number;
    align?: 'left' | 'center' | 'right';
}

type KitElement = ImageElement | TextElement;
type KitData = {
    styles?: Partial<Record<StyleRole, TextStyleSettings>>;
    screens: Record<string, { elements: Record<string, KitElement> }>;
};

const DEFAULT_STYLE: TextStyleSettings = {
    fontFamily: 'Baloo2-ExtraBold',
    fill: '#ffffff',
    stroke: '#1d1b1a',
    strokeWidth: 4,
    letterSpacing: 0,
    shadow: { enabled: false, color: '#000000', alpha: 0.5, angle: 90, distance: 2, blur: 0 },
};

const toNumber = (hex: string): number => parseInt(hex.replace('#', ''), 16);

function element<T extends KitElement>(screen: string, id: string, type: T['type']): T {
    const found = (kit as unknown as KitData).screens[screen]?.elements[id];
    if (!found || found.type !== type) {
        throw new Error(`UiKit: missing ${type} "${screen}.${id}" in ui/uikit.json`);
    }
    return found as T;
}

/**
 * Nine-slice corners are drawn at this fraction of their source size (the plane is built 1/sliceScale bigger,
 * then scaled down), so frames and buttons keep ~2x detail on high-DPI screens like plain sprites drawn
 * smaller than their source. An element's own `sliceScale` overrides it (ribbons use 1).
 */
const DEFAULT_SLICE_SCALE = 0.5;

export const UiKit = {
    /** A stretchable image (nine-slice when the kit defines a slice), sized in pixels and centered on its origin. */
    image(screen: string, id: string, width: number, height: number): PIXI.Container {
        const data = element<ImageElement>(screen, id, 'image');
        width = data.w ?? width;
        height = data.h ?? height;
        const texture = PIXI.Texture.from(data.image);
        let display: PIXI.NineSlicePlane | PIXI.Sprite;
        if (data.slice) {
            const sliceScale = data.sliceScale ?? DEFAULT_SLICE_SCALE;
            const plane = new PIXI.NineSlicePlane(texture, ...data.slice);
            plane.width = width / sliceScale;
            plane.height = height / sliceScale;
            plane.scale.set(sliceScale);
            plane.position.set(-width / 2, -height / 2);
            plane.tint = toNumber(data.tint);
            display = plane;
        } else {
            const sprite = new PIXI.Sprite(texture);
            sprite.anchor.set(0.5);
            sprite.width = width;
            sprite.height = height;
            sprite.tint = toNumber(data.tint);
            display = sprite;
        }
        const holder = new PIXI.Container();
        holder.addChild(display);
        return holder;
    },

    /** An image at its native size times `scale` (ribbons, icons); stretched/sliced when the kit sets a size or slice. */
    sprite(screen: string, id: string, scale = 1): PIXI.Container {
        const data = element<ImageElement>(screen, id, 'image');
        const texture = PIXI.Texture.from(data.image);
        const holder = (data.w || data.h || data.slice)
            ? UiKit.image(screen, id, data.w ?? texture.width, data.h ?? texture.height)
            : (() => {
                const sprite = new PIXI.Sprite(texture);
                sprite.anchor.set(0.5);
                sprite.tint = toNumber(data.tint);
                const wrapper = new PIXI.Container();
                wrapper.addChild(sprite);
                return wrapper;
            })();
        holder.scale.set(scale);
        return holder;
    },

    /** The merged style (named style + this element's overrides). */
    resolveStyle(role: StyleRole = 'primary', overrides: Partial<Omit<TextStyleSettings, 'shadow'>> & { shadow?: Partial<ShadowSettings> } = {}): TextStyleSettings {
        const base = (kit as unknown as KitData).styles?.[role] ?? DEFAULT_STYLE;
        const defined = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined));
        return { ...base, ...defined, shadow: { ...base.shadow, ...(overrides.shadow ?? {}) } };
    },

    /** The atlas frame an image element shows — for code that wants the texture name (core's SoundToggleButton). */
    imageName(screen: string, id: string): string {
        return element<ImageElement>(screen, id, 'image').image;
    },

    /** Shrinks `text` (never grows it) so it's at most `maxWidth` wide — for names that would spill out of their frame. */
    fit<T extends PIXI.Text>(text: T, maxWidth: number): T {
        text.scale.set(1);
        text.scale.set(Math.min(1, maxWidth / Math.max(text.width, 1)));
        return text;
    },

    /** CSS font-family for a named style, for text that is not built from the kit. */
    fontFamily(role: StyleRole = 'primary'): string {
        return `${UiKit.resolveStyle(role).fontFamily}, sans-serif`;
    },

    /** Styled text; `{name}` placeholders are replaced from `values`. */
    text(screen: string, id: string, values: Record<string, string | number> = {}, extra: Partial<PIXI.TextStyle> = {}): PIXI.Text {
        const data = element<TextElement>(screen, id, 'text');
        const content = data.text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
        const style = UiKit.resolveStyle(data.style, data);
        const wrap = data.wrapWidth && data.wrapWidth > 0 ? data.wrapWidth : 0;
        const text = new PIXI.Text(content, {
            fontFamily: `${style.fontFamily}, sans-serif`,
            fontSize: data.size,
            fontWeight: 'normal',
            fill: toNumber(style.fill),
            stroke: toNumber(style.stroke),
            strokeThickness: style.strokeWidth,
            letterSpacing: style.letterSpacing,
            dropShadow: style.shadow.enabled,
            dropShadowColor: toNumber(style.shadow.color),
            dropShadowAlpha: style.shadow.alpha,
            dropShadowAngle: (style.shadow.angle * Math.PI) / 180,
            dropShadowDistance: style.shadow.distance,
            dropShadowBlur: style.shadow.blur,
            wordWrap: wrap > 0,
            wordWrapWidth: wrap,
            align: data.align ?? 'center',
            ...extra,
        });
        text.anchor.set(0.5);
        return text;
    },
};
