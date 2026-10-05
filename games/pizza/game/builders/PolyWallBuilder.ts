// PolyWallBuilder.ts
//
// One wall mesh following a "polyWall" polyline/polygon drawn on a "--storeView--" layer (see
// WorldObjectRegistry.StoreWallPlacement) — a single extruded strip WALL_SETUP.thickness wide
// and WALL_SETUP.height tall (StoreViewTypes.ts), centered on the drawn line, instead of one
// glb wall model per piece. Its look is a WallStyleConfig, applied separately (applyStyle()) so
// a store's walls can be re-skinned in place.
//
// UVs: u = distance along the line (world units), v = 0 at the floor -> 1 at the top (the top
// face is v = 1) — so a style is a texture read bottom-to-top; for now two flat color bands.
//
// Corners are MITERED (both faces of the wall meet cleanly at every vertex — no gaps or
// overlapping boxes), capped at the miter limit so a very sharp corner doesn't spike out.
// Each segment is subdivided along its length via BendService.segmentsForSpan() so the wall
// follows the world bend instead of only bending at its corners.
//
// Openings: a "polyWindow" / "polyDoor" rect overlapping the wall (StoreWallPlacement.openings)
// cuts a hole along the stretch of wall it overlaps — a door from the floor up to
// WALL_SETUP.doorHeight (and no collider there, so it can be walked through), a window
// WALL_SETUP.windowHeight tall, centered on the wall's height (collider kept). A 'gap' (a built
// store section crossing the wall) removes that stretch entirely — full height, no collider.
// See openingSpans().
//
// Camera occlusion: every one of those ~1-unit slices is its own occlusion part
// (BendService.applyOcclusionFadeToParts()), so only the stretch of wall between the camera and
// the player fades — the rest of this one mesh stays solid.

import * as THREE from 'three';
import { BendService, OcclusionPart, STRUCTURE_OCCLUSION_FADE } from '../services/BendService';
import { FloorLayers } from '../world/FloorLayers';
import type { StoreWallOpening, StoreWallPlacement } from '../world/WorldObjectRegistry';
import type { WallSetupConfig, WallStyleConfig } from '../store/StoreViewTypes';

/** A miter longer than this many half-thicknesses (very sharp corner) is clamped. */
const MITER_LIMIT = 4;
/** Rows in a style's band texture — the band edge lands within height / this of bottomHeight. */
const BAND_TEXTURE_ROWS = 256;

/** Band textures, shared across every wall with the same style + height — never disposed (tiny). */
const textureCache = new Map<string, THREE.DataTexture>();

/** A band at or above this opacity counts as solid (drawn in the opaque layer); below it, glass. */
const SOLID_OPACITY = 0.999;

/** The style's band opacities, clamped — unset = 1 (solid). */
function bandOpacities(style: WallStyleConfig): { bottom: number; top: number } {
    return {
        bottom: THREE.MathUtils.clamp(style.bottomOpacity ?? 1, 0, 1),
        top: THREE.MathUtils.clamp(style.topOpacity ?? 1, 0, 1),
    };
}

/** True when either band is see-through — the wall then also gets a glass layer (see applyStyle()). */
function hasGlassBand(style: WallStyleConfig): boolean {
    const { bottom, top } = bandOpacities(style);
    return bottom < SOLID_OPACITY || top < SOLID_OPACITY;
}

/**
 * The 1-wide band texture: bottom color up to bottomHeight, top color above. Its alpha splits the
 * wall into two layers drawn from the same geometry, so a solid band and a glass band on ONE mesh
 * still sort right:
 *   - 'solid': solid bands alpha 1, glass bands alpha 0 — the main (opaque, depth-writing,
 *     alpha-tested) material, so glass rows are cut away from it;
 *   - 'glass': glass bands at their opacity, solid bands alpha 0 — the see-through child mesh
 *     (blended, no depth write), so it never hides what's behind it.
 * A fully solid style just uses 'solid' (every row alpha 1), exactly as before opacities existed.
 */
function bandTexture(style: WallStyleConfig, height: number, layer: 'solid' | 'glass' = 'solid'): THREE.DataTexture {
    const opacity = bandOpacities(style);
    const key = `${style.bottomColor}|${style.topColor}|${style.bottomHeight}|${height}|${opacity.bottom}|${opacity.top}|${layer}`;
    let texture = textureCache.get(key);
    if (texture) {
        return texture;
    }
    // getHex() gives sRGB bytes — the texture is tagged sRGB below.
    const bottom = new THREE.Color(style.bottomColor).getHex();
    const top = new THREE.Color(style.topColor).getHex();
    const split = THREE.MathUtils.clamp(style.bottomHeight / height, 0, 1);
    const data = new Uint8Array(BAND_TEXTURE_ROWS * 4);
    for (let row = 0; row < BAND_TEXTURE_ROWS; row++) {
        // Row 0 = v 0 (the floor) — DataTexture isn't flipped.
        const isBottom = (row + 0.5) / BAND_TEXTURE_ROWS < split;
        const hex = isBottom ? bottom : top;
        const bandOpacity = isBottom ? opacity.bottom : opacity.top;
        const solid = bandOpacity >= SOLID_OPACITY;
        const alpha = layer === 'solid' ? (solid ? 1 : 0) : (solid ? 0 : bandOpacity);
        data[row * 4] = (hex >> 16) & 0xff;
        data[row * 4 + 1] = (hex >> 8) & 0xff;
        data[row * 4 + 2] = hex & 0xff;
        data[row * 4 + 3] = Math.round(alpha * 255);
    }
    texture = new THREE.DataTexture(data, 1, BAND_TEXTURE_ROWS, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    textureCache.set(key, texture);
    return texture;
}

type Vec2 = { x: number; z: number };

/** Left-hand unit normal of the direction a -> b (in the XZ plane). */
function segmentNormal(a: Vec2, b: Vec2): Vec2 {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1;
    return { x: -dz / length, z: dx / length };
}

/** Per-vertex offset (from the center line to the wall's LEFT face) — the miter of the two segment normals meeting there. */
function miterOffsets(points: Vec2[], closed: boolean, halfThickness: number): Vec2[] {
    const count = points.length;
    return points.map((point, i) => {
        const prev = closed ? points[(i - 1 + count) % count] : points[i - 1];
        const next = closed ? points[(i + 1) % count] : points[i + 1];
        const nIn = prev ? segmentNormal(prev, point) : undefined;
        const nOut = next ? segmentNormal(point, next) : undefined;
        if (!nIn || !nOut) {
            const n = (nIn ?? nOut)!;
            return { x: n.x * halfThickness, z: n.z * halfThickness };
        }
        let mx = nIn.x + nOut.x;
        let mz = nIn.z + nOut.z;
        const mLength = Math.hypot(mx, mz);
        if (mLength < 1e-6) {
            // Doubles straight back on itself — no meaningful miter.
            return { x: nIn.x * halfThickness, z: nIn.z * halfThickness };
        }
        mx /= mLength;
        mz /= mLength;
        // Length so the offset sits halfThickness away from BOTH segments' lines.
        const cos = mx * nIn.x + mz * nIn.z;
        const scale = Math.min(halfThickness / Math.max(cos, 1e-6), halfThickness * MITER_LIMIT);
        return { x: mx * scale, z: mz * scale };
    });
}

/** A hole cut along the wall: distance range along the line [u0, u1] and height range [y0, y1] (from the floor). */
interface WallOpeningSpan {
    kind: 'window' | 'door' | 'gap';
    /** Doors only — see StoreWallOpening.double / .sliding. */
    double?: boolean;
    sliding?: boolean;
    /** Doors only — see StoreWallOpening.style. */
    style?: string;
    /** Doors only — see StoreWallOpening.facing. */
    facing?: { x: number; z: number };
    u0: number;
    u1: number;
    y0: number;
    y1: number;
}

/** Shortest opening (world units along the wall) that's kept — anything thinner is a rect just grazing the wall. */
const MIN_OPENING_LENGTH = 0.05;

/** Parameter range [t0, t1] of segment a -> b inside the axis-aligned rect (Liang–Barsky clip), or undefined. */
function clipSegmentToRect(a: Vec2, b: Vec2, rect: { minX: number; maxX: number; minZ: number; maxZ: number }): [number, number] | undefined {
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
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
    }
    return t0 < t1 ? [t0, t1] : undefined;
}

/**
 * Every opening's span along `wall` — each opening rect clipped against each segment, then
 * merged where one rect covers a corner (two touching pieces = one hole). Sorted by u0.
 * Openings shouldn't overlap each other; if they do, the later one wins over the shared stretch.
 */
function openingSpans(wall: StoreWallPlacement, setup: WallSetupConfig): WallOpeningSpan[] {
    const { points, closed } = wall;
    const segmentCount = closed ? points.length : points.length - 1;
    const doorTop = (opening: StoreWallOpening): number =>
        opening.fitToCeiling ? setup.height : Math.min(opening.high ? setup.tallDoorHeight : setup.doorHeight, setup.height);
    const windowHeight = Math.min(setup.windowHeight, setup.height);
    const windowBottom = (setup.height - windowHeight) / 2;

    const spans: WallOpeningSpan[] = [];
    for (const opening of wall.openings ?? []) {
        const pieces: WallOpeningSpan[] = [];
        let distance = 0;
        for (let s = 0; s < segmentCount; s++) {
            const p0 = points[s];
            const p1 = points[(s + 1) % points.length];
            const length = Math.hypot(p1.x - p0.x, p1.z - p0.z);
            const clip = clipSegmentToRect(p0, p1, opening.rect);
            if (clip) {
                pieces.push({
                    kind: opening.kind,
                    ...(opening.double ? { double: true } : {}),
                    ...(opening.sliding ? { sliding: true } : {}),
                    ...(opening.style ? { style: opening.style } : {}),
                    ...(opening.facing ? { facing: opening.facing } : {}),
                    u0: distance + clip[0] * length,
                    u1: distance + clip[1] * length,
                    y0: opening.kind === 'window' ? windowBottom : 0,
                    y1: opening.kind === 'window' ? windowBottom + windowHeight : opening.kind === 'door' ? doorTop(opening) : setup.height,
                });
            }
            distance += length;
        }
        pieces.sort((a, b) => a.u0 - b.u0);
        for (const piece of pieces) {
            const last = spans[spans.length - 1];
            if (last && last.kind === piece.kind && last.y0 === piece.y0 && last.y1 === piece.y1 && last.double === piece.double && last.sliding === piece.sliding && last.style === piece.style && last.facing === piece.facing && Math.abs(last.u1 - piece.u0) < 1e-4) {
                last.u1 = piece.u1;
            } else {
                spans.push(piece);
            }
        }
    }
    // A window/door that a gap (a built section opening the wall up) overlaps is gone with it.
    const gaps = spans.filter(span => span.kind === 'gap');
    return spans
        .filter(span => span.u1 - span.u0 >= MIN_OPENING_LENGTH)
        .filter(span => span.kind === 'gap' || !gaps.some(gap => span.u0 < gap.u1 && span.u1 > gap.u0))
        .sort((a, b) => a.u0 - b.u0);
}

/** The opening covering distance `u` along the wall, if any. */
function openingAt(spans: readonly WallOpeningSpan[], u: number): WallOpeningSpan | undefined {
    let found: WallOpeningSpan | undefined;
    for (const span of spans) {
        if (u > span.u0 && u < span.u1) {
            found = span;
        }
    }
    return found;
}

/** Where a door hangs in a "polyDoor" opening — world-space centerline points at the opening's start (hinge side) and end, and its height. See StoreDoor.ts. */
export interface DoorFrame {
    hinge: Vec2;
    end: Vec2;
    height: number;
    /** Two leaves, one hinged at each side — see StoreWallOpening.double. */
    double: boolean;
    /** Leaves slide into the wall instead of swinging — see StoreWallOpening.sliding. */
    sliding: boolean;
    /** The door's own style id ("style" prop — see StoreWallOpening.style); undefined = the building's/store's. */
    style?: string;
    /**
     * Straight wall (world units) beside the opening on the hinge side / the far side, before
     * the next corner or the line's end, minus half a thickness (the corner's miter). How far a
     * sliding leaf can go into the wall without poking out past the corner.
     */
    roomBefore: number;
    roomAfter: number;
}

/** The world-space centerline point at distance `u` along the wall. */
function pointAlong(wall: StoreWallPlacement, u: number): Vec2 {
    const { points, closed } = wall;
    const segmentCount = closed ? points.length : points.length - 1;
    let distance = 0;
    for (let s = 0; s < segmentCount; s++) {
        const p0 = points[s];
        const p1 = points[(s + 1) % points.length];
        const length = Math.hypot(p1.x - p0.x, p1.z - p0.z);
        if (u <= distance + length || s === segmentCount - 1) {
            const t = length > 0 ? THREE.MathUtils.clamp((u - distance) / length, 0, 1) : 0;
            return { x: p0.x + (p1.x - p0.x) * t, z: p0.z + (p1.z - p0.z) * t };
        }
        distance += length;
    }
    return points[0];
}

/** One axis-aligned collider box, world-space center (XZ) and half extents (XZ). */
export interface WallColliderBox {
    x: number;
    z: number;
    halfX: number;
    halfZ: number;
}

export class PolyWallBuilder {
    /** One DoorFrame per door opening in `wall` — a door around a corner hangs straight across from its start to its end. */
    public static doorFrames(wall: StoreWallPlacement, setup: WallSetupConfig): DoorFrame[] {
        // Where each segment starts/ends along the line — for roomBefore/roomAfter.
        const { points, closed } = wall;
        const segmentCount = closed ? points.length : points.length - 1;
        const bounds: [number, number][] = [];
        let distance = 0;
        for (let s = 0; s < segmentCount; s++) {
            const p0 = points[s];
            const p1 = points[(s + 1) % points.length];
            const length = Math.hypot(p1.x - p0.x, p1.z - p0.z);
            bounds.push([distance, distance + length]);
            distance += length;
        }
        const segmentAt = (u: number): [number, number] => bounds.find(([a, b]) => u >= a - 1e-6 && u <= b + 1e-6) ?? [0, distance];
        const margin = setup.thickness / 2;

        return openingSpans(wall, setup)
            .filter(span => span.kind === 'door')
            .map(span => {
                const frame: DoorFrame = {
                    hinge: pointAlong(wall, span.u0),
                    end: pointAlong(wall, span.u1),
                    height: span.y1 - span.y0,
                    double: span.double ?? false,
                    sliding: span.sliding ?? false,
                    ...(span.style ? { style: span.style } : {}),
                    roomBefore: Math.max(0, span.u0 - segmentAt(span.u0 + 1e-4)[0] - margin),
                    roomAfter: Math.max(0, segmentAt(span.u1 - 1e-4)[1] - span.u1 - margin),
                };
                // StoreDoor's front (its local +Z) is the hinge -> end direction turned left:
                // (-dz, dx). If that points away from the door's own `facing` (its rect's
                // rotation), hang it from the other end instead — same opening, front flipped.
                const facing = span.facing;
                const dx = frame.end.x - frame.hinge.x;
                const dz = frame.end.z - frame.hinge.z;
                if (facing && -dz * facing.x + dx * facing.z < 0) {
                    return { ...frame, hinge: frame.end, end: frame.hinge, roomBefore: frame.roomAfter, roomAfter: frame.roomBefore };
                }
                return frame;
            });
    }

    /**
     * Axis-aligned boxes covering `wall` for collision (the physics only has AABBs — see
     * RigidBody.ts). An axis-aligned (or nearly) segment is ONE box: its extent padded by half
     * the thickness. A slanted segment is cut into short chunks so each chunk's box stays about
     * `thickness` across on its short side — a staircase hugging the line instead of one huge
     * box filling the whole diagonal. Neighbouring boxes overlap at the corners, so there's no
     * gap to slip through. A DOOR or GAP opening is left out (walk-through); its neighbours stop
     * half a thickness short of it so their padding doesn't narrow the doorway. Windows keep their box.
     */
    public static colliderBoxes(wall: StoreWallPlacement, setup: WallSetupConfig): WallColliderBox[] {
        const { points, closed } = wall;
        const { thickness } = setup;
        const half = thickness / 2;
        const segmentCount = closed ? points.length : points.length - 1;
        // Doors and gaps are walk-through.
        const doors = openingSpans(wall, setup).filter(span => span.kind !== 'window');
        const boxes: WallColliderBox[] = [];
        let distance = 0;
        for (let s = 0; s < segmentCount; s++) {
            const p0 = points[s];
            const p1 = points[(s + 1) % points.length];
            const dx = p1.x - p0.x;
            const dz = p1.z - p0.z;
            const length = Math.hypot(dx, dz);

            // This segment's solid stretches [t0, t1] — the whole segment minus any door.
            const solid: [number, number][] = [];
            let from = 0;
            for (const door of doors) {
                const doorFrom = (door.u0 - distance) / length;
                const doorTo = (door.u1 - distance) / length;
                if (doorTo <= 0 || doorFrom >= 1) {
                    continue;
                }
                solid.push([from, Math.max(from, doorFrom - half / length)]);
                from = Math.min(1, doorTo + half / length);
            }
            solid.push([from, 1]);
            distance += length;

            for (const [solidFrom, solidTo] of solid) {
                if ((solidTo - solidFrom) * length < 1e-3) {
                    continue;
                }
                const spanX = Math.abs(dx) * (solidTo - solidFrom);
                const spanZ = Math.abs(dz) * (solidTo - solidFrom);
                const chunks = Math.max(1, Math.ceil(Math.min(spanX, spanZ) / thickness));
                for (let k = 0; k < chunks; k++) {
                    const t0 = solidFrom + (solidTo - solidFrom) * (k / chunks);
                    const t1 = solidFrom + (solidTo - solidFrom) * ((k + 1) / chunks);
                    boxes.push({
                        x: p0.x + dx * (t0 + t1) / 2,
                        z: p0.z + dz * (t0 + t1) / 2,
                        halfX: Math.abs(dx) * (t1 - t0) / 2 + half,
                        halfZ: Math.abs(dz) * (t1 - t0) / 2 + half,
                    });
                }
            }
        }
        return boxes;
    }

    /**
     * Builds `wall` as one mesh positioned relative to `origin` (the world point the mesh's
     * parent rests at — e.g. a BuildingZone's position), standing on FloorLayers.baseY, sized by
     * `setup` and painted with `style`. The caller owns the returned mesh's geometry/material
     * (dispose both).
     */
    public static build(wall: StoreWallPlacement, origin: THREE.Vector3, setup: WallSetupConfig, style: WallStyleConfig): THREE.Mesh {
        const { points, closed } = wall;
        const { height } = setup;
        const offsets = miterOffsets(points, closed, setup.thickness / 2);
        const segmentCount = closed ? points.length : points.length - 1;

        const positions: number[] = [];
        const uvs: number[] = [];
        type Corner = { p: THREE.Vector3; u: number; v: number };
        const quad = (a: Corner, b: Corner, c: Corner, d: Corner): void => {
            // a-b-c-d are listed clockwise as seen from the side the face points to, so the
            // triangles go a-c-b / a-d-c (THREE's front face is counter-clockwise).
            for (const corner of [a, c, b, a, d, c]) {
                positions.push(corner.p.x, corner.p.y, corner.p.z);
                uvs.push(corner.u, corner.v);
            }
        };
        const bottom = FloorLayers.baseY - origin.y;
        // `u` = distance along the line so far; `y` from the floor (0..height), v = y / height.
        const at = (p: Vec2, o: Vec2, side: 1 | -1, y: number, u: number): Corner => ({
            p: new THREE.Vector3(p.x + o.x * side - origin.x, bottom + y, p.z + o.z * side - origin.z),
            u,
            v: y / height,
        });
        const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

        /**
         * One solid band of a slice, from y0 up to y1: both side faces, plus its top face (the
         * wall top, or a window sill) and — when it doesn't start at the floor — its underside
         * (a door/window lintel).
         */
        const band = (c0: Vec2, c1: Vec2, o0: Vec2, o1: Vec2, u0: number, u1: number, y0: number, y1: number): void => {
            if (y1 - y0 < 1e-4) {
                return;
            }
            quad(at(c1, o1, 1, y0, u1), at(c0, o0, 1, y0, u0), at(c0, o0, 1, y1, u0), at(c1, o1, 1, y1, u1));
            quad(at(c0, o0, -1, y0, u0), at(c1, o1, -1, y0, u1), at(c1, o1, -1, y1, u1), at(c0, o0, -1, y1, u0));
            quad(at(c0, o0, -1, y1, u0), at(c1, o1, -1, y1, u1), at(c1, o1, 1, y1, u1), at(c0, o0, 1, y1, u0));
            if (y0 > 0) {
                quad(at(c0, o0, 1, y0, u0), at(c1, o1, 1, y0, u1), at(c1, o1, -1, y0, u1), at(c0, o0, -1, y0, u0));
            }
        };
        /** A vertical face across the wall's thickness at `c`, from y0 to y1 — facing along the line (`forward`) or back against it. Used for the end caps and an opening's sides. */
        const across = (c: Vec2, o: Vec2, u: number, y0: number, y1: number, forward: boolean): void => {
            if (y1 - y0 < 1e-4) {
                return;
            }
            if (forward) {
                quad(at(c, o, -1, y0, u), at(c, o, 1, y0, u), at(c, o, 1, y1, u), at(c, o, -1, y1, u));
            } else {
                quad(at(c, o, 1, y0, u), at(c, o, -1, y0, u), at(c, o, -1, y1, u), at(c, o, 1, y1, u));
            }
        };
        /** Solid bands at distance `u`: everything, or below + above the opening there. */
        const solidRanges = (opening: WallOpeningSpan | undefined): [number, number][] =>
            opening ? [[0, opening.y0], [opening.y1, height]] : [[0, height]];

        const spans = openingSpans(wall, setup);

        // Occlusion parts — one per slice / end cap, see this file's own doc.
        const parts: OcclusionPart[] = [];
        let partStart = 0;
        const endPart = (): void => {
            const start = partStart / 3;
            const count = positions.length / 3 - start;
            const box = new THREE.Box3();
            const point = new THREE.Vector3();
            for (let v = start; v < start + count; v++) {
                box.expandByPoint(point.fromArray(positions, v * 3));
            }
            parts.push({ start, count, box });
            partStart = positions.length;
        };

        let distance = 0;
        for (let s = 0; s < segmentCount; s++) {
            const i = s;
            const j = (s + 1) % points.length;
            const p0 = points[i];
            const p1 = points[j];
            const length = Math.hypot(p1.x - p0.x, p1.z - p0.z);
            // Slice breakpoints: the ~1-unit bend steps, plus every opening edge on this segment
            // (so a slice is always wholly inside or wholly outside an opening).
            const steps = BendService.segmentsForSpan(length);
            const breaks = new Set<number>(Array.from({ length: steps + 1 }, (_, k) => k / steps));
            for (const span of spans) {
                for (const u of [span.u0, span.u1]) {
                    const t = (u - distance) / length;
                    if (t > 1e-6 && t < 1 - 1e-6) {
                        breaks.add(t);
                    }
                }
            }
            const ts = [...breaks].sort((a, b) => a - b);
            // Offset to the wall's faces at t along this segment: the miter at either end, and
            // straight out from the line in between — NOT a blend of the two miters, which drifts
            // sideways near a corner and would skew every face cut across the thickness (an
            // opening's sides).
            const normal = segmentNormal(p0, p1);
            const halfThickness = setup.thickness / 2;
            const offsetAt = (t: number): Vec2 =>
                t <= 1e-6 ? offsets[i] : t >= 1 - 1e-6 ? offsets[j] : { x: normal.x * halfThickness, z: normal.z * halfThickness };
            for (let k = 0; k < ts.length - 1; k++) {
                const t0 = ts[k];
                const t1 = ts[k + 1];
                const c0 = lerp(p0, p1, t0);
                const c1 = lerp(p0, p1, t1);
                const o0 = offsetAt(t0);
                const o1 = offsetAt(t1);
                const u0 = distance + length * t0;
                const u1 = distance + length * t1;

                const opening = openingAt(spans, (u0 + u1) / 2);
                for (const [y0, y1] of solidRanges(opening)) {
                    band(c0, c1, o0, o1, u0, u1, y0, y1);
                }
                // An opening's sides — where the solid wall ends and the hole begins (and back).
                for (const span of spans) {
                    if (Math.abs(span.u0 - u1) < 1e-6 && opening !== span) {
                        across(c1, o1, u1, span.y0, span.y1, true);
                    }
                    if (Math.abs(span.u1 - u0) < 1e-6 && opening !== span) {
                        across(c0, o0, u0, span.y0, span.y1, false);
                    }
                }
                endPart();
            }
            distance += length;
        }

        if (!closed) {
            // End caps.
            const first = points[0];
            const last = points[points.length - 1];
            const oFirst = offsets[0];
            const oLast = offsets[points.length - 1];
            // A cap at an end inside an opening only closes the solid bands there.
            for (const [y0, y1] of solidRanges(openingAt(spans, 1e-4))) {
                across(first, oFirst, 0, y0, y1, false);
            }
            endPart();
            for (const [y0, y1] of solidRanges(openingAt(spans, distance - 1e-4))) {
                across(last, oLast, distance, y0, y1, true);
            }
            endPart();
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        // Not indexed — every face keeps its own flat normal (sharp corners, no smoothing).
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
        BendService.applyBend(material);

        const mesh = new THREE.Mesh(geometry, material);
        PolyWallBuilder.applyStyle(mesh, setup, style);
        BendService.applyOcclusionFadeToParts(mesh, parts, STRUCTURE_OCCLUSION_FADE);
        return mesh;
    }

    /** (Re)paints a mesh build() made with `style` — `setup` must be the one it was built with (the band split is relative to its height). */
    public static applyStyle(mesh: THREE.Mesh, setup: WallSetupConfig, style: WallStyleConfig): void {
        const glass = hasGlassBand(style);
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.map = bandTexture(style, setup.height, 'solid');
        // With a glass band, its rows are alpha 0 in the solid layer — cut them out of this pass.
        material.alphaTest = glass ? 0.5 : 0;
        material.needsUpdate = true;

        // The see-through band(s): a child sharing the wall's geometry, blended over everything
        // opaque and never writing depth (so whatever's behind the glass still shows).
        let glassMesh = mesh.children.find(child => child.userData.wallGlass) as THREE.Mesh | undefined;
        if (!glass) {
            if (glassMesh) {
                glassMesh.removeFromParent();
                (glassMesh.material as THREE.Material).dispose();
            }
            return;
        }
        if (!glassMesh) {
            const glassMaterial = new THREE.MeshStandardMaterial({
                roughness: 0.15,
                metalness: 0,
                transparent: true,
                depthWrite: false,
                side: material.side,
            });
            BendService.applyBend(glassMaterial);
            glassMesh = new THREE.Mesh(mesh.geometry, glassMaterial);
            glassMesh.userData.wallGlass = true;
            mesh.add(glassMesh);
        }
        const glassMaterial = glassMesh.material as THREE.MeshStandardMaterial;
        glassMaterial.map = bandTexture(style, setup.height, 'glass');
        glassMaterial.needsUpdate = true;
    }
}
