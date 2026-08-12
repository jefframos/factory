// DottedLineBuilder.ts
//
// Floor-flat dotted-line decal builder — a single flat plane textured with a
// baked canvas dash pattern, NOT a pile of small merged dash quads (the
// previous approach): one mesh, one draw call, and the texture itself is
// cacheable/reusable across every dropper that shares the same size+style,
// instead of rebuilding geometry per instance. Two shapes:
//
//   buildLine()        — a straight dashed line (tower-style), any length.
//     The texture is just ONE dash+gap tile, RepeatWrapping'd — reused
//     across every line regardless of length, since length only scales the
//     plane's UVs (see buildLine()'s own doc), never the texture itself.
//   buildRoundedRect()  — a dashed rounded-rect outline, baked whole into a
//     canvas (dashing a closed path is what canvas's own line-dash engine is
//     for — it handles the corners for free, no manual per-segment phase
//     tracking needed). Cached by (width, depth, radius, style) — same-size
//     droppers (the common case: most zones share HALF_EXTENTS) share one
//     texture.
//
// Both meshes render with depthTest disabled and a high renderOrder — a
// floor decal a few centimeters above the ground should never flicker
// against (or get hidden behind) the floor plane itself; it should just
// always draw on top of whatever's beneath it.

import * as THREE from 'three';
import { BendService } from '../services/BendService';

export interface DottedLineStyle {
    color?: number;
    opacity?: number;
    /** Length of one dash along the path, world units. */
    dashLength?: number;
    /** Gap between dashes, world units. */
    gapLength?: number;
    /** Dash thickness (perpendicular to the path), world units. */
    lineWidth?: number;
    /** Height above the floor — kept slightly off 0 to avoid z-fighting with FloorBuilder's plane. */
    y?: number;
}

const DEFAULT_STYLE: Required<DottedLineStyle> = {
    color: 0xffffff,
    opacity: 0.9,
    dashLength: 0.25,
    gapLength: 0.2,
    lineWidth: 0.15,
    y: 0.1,
};

/** Texels per world unit for baked canvas textures — high enough that dashes/corners stay crisp at normal play-camera distance without the canvas ballooning for a big zone. */
const PX_PER_UNIT = 64;

/** Draws on top of the floor (and anything else at a similar height) regardless of the small `y` offset alone — see this file's own doc. */
const DECAL_RENDER_ORDER = 10;

export class DottedLineBuilder {
    /**
     * One dash+gap tile per unique style — shared by every buildLine() call with that style
     * REGARDLESS of length (length is baked into the plane's UV repeat, not the texture — see
     * buildLine()). Never evicted/disposed: these are tiny (a few KB) and every dropper in a
     * level lives for the level's whole lifetime, so there's nothing to reclaim.
     */
    private static readonly lineTileCache = new Map<string, THREE.CanvasTexture>();

    /** One baked outline per unique (width, depth, radius, style) — see buildRoundedRect()'s own doc. Never evicted, same reasoning as lineTileCache. */
    private static readonly roundedRectCache = new Map<string, THREE.CanvasTexture>();

    /** Straight dotted line on the floor between two XZ points — same look as tower's dashed UI lines, just in world space. */
    public static buildLine(start: THREE.Vector2, end: THREE.Vector2, style: DottedLineStyle = {}): THREE.Mesh {
        const resolved = { ...DEFAULT_STYLE, ...style };
        const length = start.distanceTo(end);
        const pitch = resolved.dashLength + resolved.gapLength;
        const texture = DottedLineBuilder.getLineTileTexture(resolved);

        const geometry = new THREE.PlaneGeometry(length, resolved.lineWidth);
        // The tile texture is one pitch wide; stretching its UV by length/pitch (instead of
        // touching the shared texture's own .repeat, which every OTHER line using this same
        // cached texture would also see) is what lets every line reuse one texture object
        // regardless of its own length.
        DottedLineBuilder.scaleUv(geometry, length / pitch, 1);
        geometry.rotateX(-Math.PI / 2);
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        geometry.rotateY(-angle);
        const mid = start.clone().lerp(end, 0.5);
        geometry.translate(mid.x, resolved.y, mid.y);

        return DottedLineBuilder.makeMesh(geometry, texture);
    }

    /**
     * Dotted rounded-rect outline centered on local origin, sized to match a trigger
     * collider's own footprint (width/depth = halfExtents * 2) — trace the collider's
     * actual shape instead of covering it with a solid placeholder box.
     */
    public static buildRoundedRect(width: number, depth: number, radius: number, style: DottedLineStyle = {}): THREE.Mesh {
        const resolved = { ...DEFAULT_STYLE, ...style };
        const texture = DottedLineBuilder.getRoundedRectTexture(width, depth, radius, resolved);

        // Canvas is padded by lineWidth so the stroke isn't clipped at the plane's own edge —
        // the plane must match that same padded size or the texture stretches/squashes.
        const geometry = new THREE.PlaneGeometry(width + resolved.lineWidth, depth + resolved.lineWidth);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, resolved.y, 0);

        return DottedLineBuilder.makeMesh(geometry, texture);
    }

    private static makeMesh(geometry: THREE.BufferGeometry, texture: THREE.CanvasTexture): THREE.Mesh {
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            depthTest: true,
        });
        BendService.applyBend(material);

        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = DECAL_RENDER_ORDER;
        return mesh;
    }

    private static scaleUv(geometry: THREE.BufferGeometry, repeatX: number, repeatY: number): void {
        const uv = geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
            uv.setXY(i, uv.getX(i) * repeatX, uv.getY(i) * repeatY);
        }
        uv.needsUpdate = true;
    }

    private static getLineTileTexture(style: Required<DottedLineStyle>): THREE.CanvasTexture {
        const key = `${style.dashLength}|${style.gapLength}|${style.lineWidth}|${style.color}|${style.opacity}`;
        const cached = DottedLineBuilder.lineTileCache.get(key);
        if (cached) {
            return cached;
        }

        const pitch = style.dashLength + style.gapLength;
        const w = Math.max(2, Math.round(pitch * PX_PER_UNIT));
        const h = Math.max(2, Math.round(style.lineWidth * PX_PER_UNIT));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = DottedLineBuilder.rgba(style.color, style.opacity);
        ctx.fillRect(0, 0, (style.dashLength / pitch) * w, h);

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        DottedLineBuilder.lineTileCache.set(key, texture);
        return texture;
    }

    private static getRoundedRectTexture(width: number, depth: number, radius: number, style: Required<DottedLineStyle>): THREE.CanvasTexture {
        const key = [width, depth, radius, style.dashLength, style.gapLength, style.lineWidth, style.color, style.opacity].join('|');
        const cached = DottedLineBuilder.roundedRectCache.get(key);
        if (cached) {
            return cached;
        }

        const paddedWidth = width + style.lineWidth;
        const paddedDepth = depth + style.lineWidth;
        const w = Math.max(2, Math.round(paddedWidth * PX_PER_UNIT));
        const h = Math.max(2, Math.round(paddedDepth * PX_PER_UNIT));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;

        const lineWidthPx = style.lineWidth * PX_PER_UNIT;
        const dashPx = style.dashLength * PX_PER_UNIT;
        const gapPx = style.gapLength * PX_PER_UNIT;
        const r = Math.min(radius, width / 2, depth / 2) * PX_PER_UNIT;
        const hw = (width / 2) * PX_PER_UNIT;
        const hd = (depth / 2) * PX_PER_UNIT;
        const cx = w / 2;
        const cy = h / 2;

        ctx.lineWidth = lineWidthPx;
        ctx.strokeStyle = DottedLineBuilder.rgba(style.color, style.opacity);
        ctx.setLineDash([dashPx, gapPx]);
        ctx.lineJoin = 'round';
        // Canvas's own dash engine handles the corners for free — no per-segment phase
        // tracking needed, unlike a hand-rolled mesh-dash approach would require.
        if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(cx - hw, cy - hd, hw * 2, hd * 2, r);
            ctx.stroke();
        } else {
            ctx.strokeRect(cx - hw, cy - hd, hw * 2, hd * 2);
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        DottedLineBuilder.roundedRectCache.set(key, texture);
        return texture;
    }

    private static rgba(color: number, opacity: number): string {
        const c = new THREE.Color(color);
        return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${opacity})`;
    }
}
