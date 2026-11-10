// SegmentBar.ts
//
// A segmented progress bar (an area's levels): a segment each, green up to those done, the next gold (it can pulse),
// dark after, sunk in a dark trough; a crown can sit over the last (the area's boss level). Built from baked, white,
// tinted textures (Bar_Segment, Bar_Trough; the crown Icon_Boss / Icon_Boss_Small: raw-assets/images/ui{tps}) as
// nine-slices, so it's sharp at any size, and its pulse only changes an alpha (nothing is redrawn).

import * as PIXI from 'pixi.js';

export const SEGMENT_COLOURS = { done: 0x4cdc6a, next: 0xffd23f, off: 0x3a3d63, trough: 0x10123a };
/** The textures' sizes and nine-slice borders (as baked). */
const SEGMENT_TEXTURE = { height: 48, slice: 12 };
const TROUGH_TEXTURE = { height: 48, slice: 16 };

export interface SegmentBarLook {
    /** Its inner width (where the segments go) and the segments' height. */
    width: number;
    height: number;
    /** The room between segments, and between them and the trough's edge. */
    gap: number;
    pad: number;
    /** The boss crown's height over the last segment (0: none). Baked in two sizes: under BOSS.smallUnder, the small
     *  one (a thicker outline, made to read that small). */
    boss?: number;
}

/** The crown's textures (raw-assets/images/ui{tps}), the size under which the small one's used, and how far it sits
 *  down into the trough (a share of its height). */
const BOSS = { frame: 'Icon_Boss', small: 'Icon_Boss_Small', smallUnder: 30, sink: 0.25 };

export class SegmentBar extends PIXI.Container {
    private readonly trough: PIXI.NineSlicePlane;
    private segments: PIXI.NineSlicePlane[] = [];
    private next = -1;
    private readonly crown: PIXI.Sprite | null = null;

    /** Centred on its position. */
    public constructor(private readonly look: SegmentBarLook) {
        super();
        const { width, height, pad } = look;
        this.trough = plane('Bar_Trough', TROUGH_TEXTURE.slice, width + pad * 2, height + pad * 2, (height + pad * 2) / TROUGH_TEXTURE.height);
        this.trough.tint = SEGMENT_COLOURS.trough;
        this.trough.position.set(-width / 2 - pad, -height / 2 - pad);
        this.addChild(this.trough);
        if (look.boss) {
            this.crown = PIXI.Sprite.from(look.boss < BOSS.smallUnder ? BOSS.small : BOSS.frame);
            this.crown.anchor.set(0.5, 1);
            this.crown.scale.set(look.boss / this.crown.texture.height);
        }
    }

    /** `total` segments, `done` of them green; `next` (-1: none) gold. */
    public set(total: number, done: number, next = done < total ? done : -1): void {
        const { width, height, gap } = this.look;
        if (this.segments.length !== total) {
            this.segments.forEach((segment) => segment.destroy());
            const each = (width - gap * (total - 1)) / Math.max(1, total);
            // The corners scaled with the height, but never wider than half a segment.
            const scale = Math.min(height / SEGMENT_TEXTURE.height, each / (SEGMENT_TEXTURE.slice * 2 + 1));
            this.segments = Array.from({ length: total }, (_, k) => {
                const segment = plane('Bar_Segment', SEGMENT_TEXTURE.slice, each, height, scale);
                segment.position.set(-width / 2 + k * (each + gap), -height / 2);
                this.addChild(segment);
                return segment;
            });
            // The boss crown over the last segment, on top.
            if (this.crown) {
                this.crown.position.set(-width / 2 + (total - 1) * (each + gap) + each / 2, -height / 2 - this.look.pad + (this.look.boss ?? 0) * BOSS.sink);
                this.addChild(this.crown);
            }
        }
        this.next = next;
        this.segments.forEach((segment, k) => {
            segment.tint = k < done ? SEGMENT_COLOURS.done : k === next ? SEGMENT_COLOURS.next : SEGMENT_COLOURS.off;
            segment.alpha = 1;
        });
    }

    /** The next segment's glow, 0 to 1 (call each frame to pulse it). */
    public pulse(amount: number): void {
        const segment = this.segments[this.next];
        if (segment) segment.alpha = 0.45 + 0.55 * amount;
    }
}

/** A nine-slice of `frame` (equal borders) `width` x `height` (in the parent's units), its borders drawn at `scale`. */
function plane(frame: string, slice: number, width: number, height: number, scale: number): PIXI.NineSlicePlane {
    const nine = new PIXI.NineSlicePlane(PIXI.Texture.from(frame), slice, slice, slice, slice);
    nine.scale.set(scale);
    nine.width = width / scale;
    nine.height = height / scale;
    return nine;
}
