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
