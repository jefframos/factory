// PolyFenceBuilder.ts
//
// A see-through wooden fence following a "polyFence" polyline/polygon (same drawing as a
// "polyWall" — see WorldObjectRegistry.getFences()): posts at every vertex and every
// FenceStyleConfig.postSpacing in between, with `railCount` horizontal rails from post to post.
// Size and color come from a FenceStyleConfig (StoreViewTypes.ts, editor: Store View -> Fence).
//
// layout() cuts the line into post-to-post SPANS, leaving out every OPENING: the stretch of the
// line inside a "polyFenceGap" rect (a plain hole) or a "polyDoor" rect (a hole with a fence door
// in it — FenceDoor.ts, sized by a FenceDoorSetupConfig). Openings are exact (the line clipped to
// the rect); a post closes the fence on both sides of each one. PizzaScene groups the spans by
// the fog-of-war zone they stand in and merges each group into one mesh (buildGeometry()).
// Collision reuses the wall's staircase collider boxes (PolyWallBuilder.colliderBoxes()), one
// post thick — a fence blocks like a low wall.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BendService } from '../services/BendService';
import { FloorLayers } from '../world/FloorLayers';
import type { StoreWallPlacement } from '../world/WorldObjectRegistry';
import { DEFAULT_WALL_SETUP, FenceDoorSetupConfig, FenceStyleConfig } from '../store/StoreViewTypes';
import { PolyWallBuilder, WallColliderBox } from './PolyWallBuilder';

type Vec2 = { x: number; z: number };

/** An opening rect over a fence, world-space bounds — a "polyFenceGap" (no `door`) or a "polyDoor" (with its door setup). */
export interface FenceOpeningRect {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    door?: FenceDoorSetupConfig;
}

/** One post-to-post stretch: a post at `from`, rails to `to` (plus a post at `to` when an opening or an open fence's end follows). */
export interface FenceSpan {
    from: Vec2;
    to: Vec2;
    /** Where the span's middle is — what decides which zone it belongs to. */
    mid: Vec2;
    endPost: boolean;
}

/** Where a fence door goes: the hole from `from` to `to` (along the fence) and its setup. */
export interface FenceDoorSlot {
    from: Vec2;
    to: Vec2;
    mid: Vec2;
    /** Direction from -> to, radians in the XZ plane (atan2(dz, dx)). */
    angle: number;
    setup: FenceDoorSetupConfig;
}

/** Shorter overlaps than this (world units) are ignored — a rect merely touching the line. */
const MIN_OPENING_LENGTH = 0.05;

/** [t0, t1] of segment a->b inside `rect` (Liang–Barsky), or undefined. */
function clipToRect(a: Vec2, b: Vec2, rect: FenceOpeningRect): [number, number] | undefined {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    let t0 = 0;
    let t1 = 1;
    const edges: [number, number][] = [[-dx, a.x - rect.minX], [dx, rect.maxX - a.x], [-dz, a.z - rect.minZ], [dz, rect.maxZ - a.z]];
    for (const [p, q] of edges) {
        if (Math.abs(p) < 1e-9) {
            if (q < 0) {
                return undefined;
            }
            continue;
        }
        const r = q / p;
        if (p < 0) {
            t0 = Math.max(t0, r);
        } else {
            t1 = Math.min(t1, r);
        }
        if (t0 > t1) {
            return undefined;
        }
    }
    return [t0, t1];
}

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

export class PolyFenceBuilder {
    /** `fence` as post-to-post spans (at most style.postSpacing long) around its openings, plus a door slot per "polyDoor" opening. */
    public static layout(fence: StoreWallPlacement, style: FenceStyleConfig, openings: readonly FenceOpeningRect[] = []): { spans: FenceSpan[]; doors: FenceDoorSlot[] } {
        const { points, closed } = fence;
        const spacing = Math.max(0.25, style.postSpacing);
        const segmentCount = closed ? points.length : points.length - 1;
        const spans: FenceSpan[] = [];
        const doors: FenceDoorSlot[] = [];
        for (let s = 0; s < segmentCount; s++) {
            const a = points[s];
            const b = points[(s + 1) % points.length];
            const length = Math.hypot(b.x - a.x, b.z - a.z);
            if (length < 1e-3) {
                continue;
            }

            // This segment's openings, as [t0, t1] along it — a door narrowed to its setup's
            // width (centered on the overlap) when it has one.
            const cuts: { t0: number; t1: number; door?: FenceDoorSetupConfig }[] = [];
            for (const opening of openings) {
                const clipped = clipToRect(a, b, opening);
                if (!clipped || (clipped[1] - clipped[0]) * length < MIN_OPENING_LENGTH) {
                    continue;
                }
                let [t0, t1] = clipped;
                const width = opening.door?.width;
                if (width !== undefined && width > 0 && width < (t1 - t0) * length) {
                    const center = (t0 + t1) / 2;
                    t0 = center - width / 2 / length;
                    t1 = center + width / 2 / length;
                }
                cuts.push({ t0, t1, door: opening.door });
            }
            cuts.sort((p, q) => p.t0 - q.t0);

            // Solid stretches between the cuts, each split into post-to-post spans.
            let from = 0;
            const solid: [number, number, boolean][] = [];
            for (const cut of cuts) {
                if (cut.t0 > from) {
                    solid.push([from, cut.t0, true]);
                }
                from = Math.max(from, cut.t1);
                if (cut.door) {
                    const doorFrom = lerp(a, b, cut.t0);
                    const doorTo = lerp(a, b, cut.t1);
                    doors.push({
                        from: doorFrom,
                        to: doorTo,
                        mid: lerp(a, b, (cut.t0 + cut.t1) / 2),
                        angle: Math.atan2(b.z - a.z, b.x - a.x),
                        setup: cut.door,
                    });
                }
            }
            if (from < 1) {
                // A closing post at the end only where nothing continues: an open fence's last point.
                solid.push([from, 1, !closed && s === segmentCount - 1]);
            }
            for (const [s0, s1, closeWithPost] of solid) {
                const count = Math.max(1, Math.ceil((s1 - s0) * length / spacing));
                for (let i = 0; i < count; i++) {
                    const t0 = s0 + (s1 - s0) * (i / count);
                    const t1 = s0 + (s1 - s0) * ((i + 1) / count);
                    spans.push({
                        from: lerp(a, b, t0),
                        to: lerp(a, b, t1),
                        mid: lerp(a, b, (t0 + t1) / 2),
                        endPost: closeWithPost && i === count - 1,
                    });
                }
            }
        }
        return { spans, doors };
    }

    /** One merged geometry for `spans`, positioned relative to `origin` (the parent's world position), standing on FloorLayers.baseY. The caller owns it (dispose). */
    public static buildGeometry(spans: readonly FenceSpan[], style: FenceStyleConfig, origin: THREE.Vector3): THREE.BufferGeometry {
        const parts: THREE.BufferGeometry[] = [];
        const baseY = FloorLayers.baseY - origin.y;
        const { height, postWidth } = style;
        const railCount = Math.max(1, Math.round(style.railCount));
        const railThickness = Math.max(0.02, style.railThickness);
        const post = (at: Vec2, angle: number): void => {
            const box = new THREE.BoxGeometry(postWidth, height, postWidth);
            box.rotateY(-angle);
            box.translate(at.x - origin.x, baseY + height / 2, at.z - origin.z);
            parts.push(box);
        };
        for (const span of spans) {
            const dx = span.to.x - span.from.x;
            const dz = span.to.z - span.from.z;
            const length = Math.hypot(dx, dz);
            // BoxGeometry's length runs along X — turned onto the span's direction.
            const angle = Math.atan2(dz, dx);
            post(span.from, angle);
            if (span.endPost) {
                post(span.to, angle);
            }
            for (let k = 0; k < railCount; k++) {
                // Rails spread over the upper part of the post: 35% .. 85% of its height.
                const y = height * (railCount === 1 ? 0.6 : 0.35 + 0.5 * k / (railCount - 1));
                const rail = new THREE.BoxGeometry(length, railThickness, railThickness * 0.6);
                rail.rotateY(-angle);
                rail.translate(span.mid.x - origin.x, baseY + y, span.mid.z - origin.z);
                parts.push(rail);
            }
        }
        const merged = mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
        parts.forEach(part => part.dispose());
        return merged;
    }

    /** Plain wood material in style.color, bent with the world (BendService). The caller owns it (dispose). */
    public static createMaterial(style: FenceStyleConfig): THREE.MeshStandardMaterial {
        const material = new THREE.MeshStandardMaterial({ color: style.color, roughness: 0.85, metalness: 0 });
        BendService.applyBend(material);
        return material;
    }

    /** Collider boxes along `spans` — the wall's staircase boxes, one post thick (see PolyWallBuilder.colliderBoxes()). */
    public static colliderBoxes(spans: readonly FenceSpan[], style: FenceStyleConfig): WallColliderBox[] {
        return spans.flatMap(span => PolyFenceBuilder.lineColliders(span.from, span.to, style.postWidth, style.height));
    }

    /** A door's two side colliders — FenceDoorSetupConfig.colliderInset from each end of the hole inward; the middle stays walkable. */
    public static doorColliderBoxes(slot: FenceDoorSlot, thickness: number): WallColliderBox[] {
        const length = Math.hypot(slot.to.x - slot.from.x, slot.to.z - slot.from.z);
        const inset = Math.min(Math.max(0, slot.setup.colliderInset), length / 2);
        if (inset <= 0) {
            return [];
        }
        const t = inset / length;
        return [
            ...PolyFenceBuilder.lineColliders(slot.from, lerp(slot.from, slot.to, t), thickness, slot.setup.height),
            ...PolyFenceBuilder.lineColliders(lerp(slot.from, slot.to, 1 - t), slot.to, thickness, slot.setup.height),
        ];
    }

    private static lineColliders(from: Vec2, to: Vec2, thickness: number, height: number): WallColliderBox[] {
        const setup = { ...DEFAULT_WALL_SETUP, height, thickness };
        return PolyWallBuilder.colliderBoxes({ points: [from, to], closed: false }, setup);
    }
}
