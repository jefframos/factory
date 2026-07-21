// PieceStorage.ts

import { Vertices } from 'matter-js';
import * as PIXI from 'pixi.js';

export interface PieceDefinition {
    id: string;
    /** Level a piece first becomes eligible to spawn at — see PieceManager. */
    level: number;
    /** Multiplies blockWidth/blockHeight (2D) and cube width/height (3D) independently — {x: 1, y: 1} is the standard block, >1 on either axis stretches that axis. */
    scale: { x: number; y: number };
    /**
     * Optional outline override — points in unit-square space (0..1, 0..1;
     * top-left origin, same convention as the block's own w/h) drawn instead
     * of the default rect/rounded-rect when present, on both the 2D body
     * texture (see BlockBodyTextureCache) and the 3D mesh (see
     * PieceBoxBuilder), AND used as the actual 2D collision shape (see
     * FaceTowerBlockController.buildPolygonEntity) instead of the piece's
     * rectangular bounding box.
     */
    polygon?: { x: number; y: number }[];
    /** Hex color applied to the block's body. */
    color: string;
    /** Relative path under images/non-preload/ — e.g. "skins/dog.webp". Resolve with resolvePieceImagePath(). */
    texture: string;
    /**
     * Shifts the face texture off-center — in 2D design px (+x right, +y
     * down), same units as everything else in FaceTowerConfig, NOT a
     * fraction of the piece's own size. Applied on the 2D face sprite (see
     * FaceTowerBlockController.styleBlockView) directly, and on the 3D face
     * decal (see PieceBoxBuilder.buildFaceDecal) after TowerBlockSync3D
     * converts it through pixelsPerUnit — so one px value tunes both
     * renderers together. Defaults to {x: 0, y: 0} — centered.
     */
    faceOffset?: { x: number; y: number };
    /**
     * Multiplies the face texture's default size independently per axis —
     * {x: 1, y: 1} is the default (square, sized off the piece's shorter
     * axis). Applied on both the 2D face sprite and the 3D face decal.
     */
    faceScale?: { x: number; y: number };
    /**
     * Nudges the "landing preview" strip (see FaceTowerConfig.previewStripHeight)
     * off its default position right at the piece's own base — in 2D
     * design px (+x right, +y down), same units as everything else in
     * FaceTowerConfig, NOT a fraction of the piece's own size. The 3D side
     * converts this through pixelsPerUnit itself (see TowerBlockSync3D), so
     * one px value tunes both renderers together. Tune per piece shape
     * (e.g. an arch's legs sit lower than its notch) — defaults to {x: 0, y: 0}.
     */
    previewOffset?: { x: number; y: number };
    /**
     * 3D-only override for the preview strip's nudge — in 3D world units
     * ("meters", i.e. already the pixelsPerUnit-divided scale everything
     * else in the 3D scene uses), NOT px. When set, TowerBlockSync3D uses
     * this DIRECTLY instead of converting `previewOffset` through
     * pixelsPerUnit — for the rare piece where the shared px value doesn't
     * land right in 3D specifically (2D keeps using `previewOffset`
     * either way). Omit to just use `previewOffset` for both renderers.
     */
    preview3DOffset?: { x: number; y: number };
    /**
     * Insets the preview strip's WIDTH symmetrically — NOT a gap/offset —
     * on top of FaceTowerConfig.previewMargin2D/3D, same as a CSS margin:
     * a margin of 1 removes half a px from the strip's left edge and half
     * from the right, so it stays centered but reads narrower than the
     * piece's own visual span. In 2D design px, converted through
     * pixelsPerUnit for the 3D side (same px value tunes both), unless
     * `margin3D` is set. Omit entirely for "no extra per-piece margin" (0).
     */
    margin?: number;
    /**
     * 3D-only override for `margin` — in 3D world units ("meters"), NOT
     * px. When set, TowerBlockSync3D uses this DIRECTLY instead of
     * converting `margin` through pixelsPerUnit. 2D always keeps using
     * `margin` regardless. Omit to just use `margin` for both renderers.
     */
    margin3D?: number;
}

/**
 * Area-weighted centroid of `polygon`, in the same unit-square space (0..1,
 * top-left origin) — or the trivial (0.5, 0.5) center for a plain rect. This
 * is the SAME point Matter.js treats as a polygon body's `position` (see
 * matter-js's Vertices.centre, which this calls directly, and Body.setVertices,
 * which always recenters a body's vertices around this exact point) —
 * anything that draws or positions a piece using its own local origin (the
 * 3D mesh built by PieceBoxBuilder) needs to use this same point as that
 * origin, or it visibly drifts from where the piece actually collides once
 * its outline isn't symmetric (e.g. an off-centre triangle).
 */
export function getPolygonCentroid(polygon?: { x: number; y: number }[]): { x: number; y: number } {
    return polygon ? Vertices.centre(polygon as any) : { x: 0.5, y: 0.5 };
}

/**
 * Where `polygon`'s own area centroid falls, as a 0..1 fraction of ITS OWN
 * bounding box — not the full unit square. Unlike PieceBoxBuilder's 3D mesh
 * (which owns its coordinate space outright), BlockBodyTextureCache
 * rasterizes the polygon to a PIXI texture that gets trimmed to the
 * polygon's own silhouette, so a PIXI.Sprite.anchor for it needs to be
 * expressed relative to that silhouette's bounds, not the nominal
 * blockWidth/blockHeight box a plain rect uses.
 */
export function getPolygonAnchorFraction(polygon?: { x: number; y: number }[]): { x: number; y: number } {
    if (!polygon) {
        return { x: 0.5, y: 0.5 };
    }

    const centroid = Vertices.centre(polygon as any);
    const xs = polygon.map(p => p.x);
    const ys = polygon.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    return {
        x: maxX > minX ? (centroid.x - minX) / (maxX - minX) : 0.5,
        y: maxY > minY ? (centroid.y - minY) / (maxY - minY) : 0.5,
    };
}

/**
 * `polygon`'s horizontal extent in unit-square space (0..1) — leftmost
 * point, rightmost point, and the midpoint between them (the bounding
 * box's own center, NOT the area centroid). Defaults to {left: 0, right: 1,
 * center: 0.5} for a plain rect.
 *
 * The preview strip (see FaceTowerConfig.previewStripHeight) needs this
 * instead of the centroid: a rect's centroid already sits at its bbox
 * center, so anchoring the strip there "just worked", but an asymmetric
 * polygon's centroid (e.g. a triangle whose mass leans to one side) is
 * offset from where the shape actually reads as visually centered — using
 * it to place/size the strip left the strip visibly off-center and the
 * wrong width for anything that wasn't a plain rect.
 */
export function getPolygonHorizontalBounds(polygon?: { x: number; y: number }[]): { left: number; right: number; center: number } {
    if (!polygon) {
        return { left: 0, right: 1, center: 0.5 };
    }

    const xs = polygon.map(p => p.x);
    const left = Math.min(...xs);
    const right = Math.max(...xs);

    return { left, right, center: (left + right) / 2 };
}

/**
 * Piece art is served straight from the asset pipeline's non-preload output
 * (raw-assets/non-preload/skins/*.webp), not bundled by Vite — same
 * convention as IslandStorage.resolveIslandImagePath / ShopStorage's icons.
 */
const NON_PRELOAD_IMAGE_BASE = 'tower/images/non-preload/';

export function resolvePieceImagePath(relativePath: string): string {
    return `${NON_PRELOAD_IMAGE_BASE}${relativePath}`;
}

/**
 * Populated in place from the 'json' PIXI bundle (raw-assets/json/pieces-config.json)
 * once it finishes loading — see MyGame.loadAssets() in index.ts. Kept as a
 * mutated const array (rather than reassigned) so existing imports of
 * PIECES stay valid references.
 */
export const PIECES: PieceDefinition[] = [];

/** Call once the 'json' PIXI.Assets bundle has loaded — see index.ts loadAssets(). */
export function loadPieces(): void {
    const pieces = PIXI.Assets.get('pieces-config.json') as PieceDefinition[];
    PIECES.splice(0, PIECES.length, ...pieces);
}
