// PieceStorage.ts

import { Vertices } from 'matter-js';
import * as PIXI from 'pixi.js';

export interface PieceDefinition {
    id: string;
    /** Level a piece first becomes eligible to spawn at — see PieceManager. */
    level: number;
    /**
     * 0-based ascending merge-chain position, unique per real catalog piece
     * — two pieces of the same `tier` touching merge into whichever piece
     * has `tier + 1` (see PieceManager.getNextTierPiece/TowerMergeController).
     * The highest tier has no next piece — merging two of those despawns
     * both for a bonus instead (see TowerMergeController). Optional/undefined
     * for a powerup's embedded piece shape (see PowerupStorage) — those are
     * never tier-matched or merged.
     */
    tier?: number;
    /**
     * Contributes to the board's running total weight (see
     * FaceTowerBlockController.getTotalWeight) that drives the trapdoor
     * milestone — a distinct field from `points` (score) even though both
     * typically scale the same way (doubling per tier), since one measures
     * score and the other measures "how much is on the board". Falls back
     * to DEFAULT_PIECE_WEIGHT (see getPieceWeight) when omitted — true for
     * every powerup piece, which never counts toward the board's weight.
     */
    weight?: number;
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
    /**
     * When true, `polygon` is generated at load time (see loadPieces()) as a
     * regular CIRCLE_SEGMENTS-gon inscribed in a circle of `radius` centered
     * on the unit square (0.5, 0.5) — instead of authoring/hand-tweaking the
     * point list directly. `radius` defaults to 0.5 (touching all four edges
     * of the unit square) when omitted. Sizing a circle piece should still go
     * through `scale`, same as every other piece — `radius` only changes the
     * shape's own roundness/footprint within the unit square, e.g. a smaller
     * radius for a circle that doesn't fill its bounding box.
     */
    isCircle?: boolean;
    /** Circle radius in unit-square units (0.5 = touches the square's edges) — only used when `isCircle` is true. Defaults to 0.5. */
    radius?: number;
    /**
     * When true, the piece's colored body shape is never drawn — on the 2D
     * board (see FaceTowerBlockController.styleBlockView), the 3D mesh (see
     * TowerBlockSync3D/PieceBoxBuilder), and its flat-drawn icons/previews
     * (NextPiecePreview, PieceIconRenderer) — leaving only the face texture
     * visible. Collision/physics shape and layout (scale, polygon) are
     * unaffected; this only hides the visual body. Defaults to false (always
     * render the mesh).
     */
    hideMesh?: boolean;
    /**
     * Bare icon name (e.g. "cat-0", NOT a path/extension) — same convention
     * as PowerupDefinition.icon — handed straight to PIXI.Sprite.from()
     * wherever this piece's icon appears (PieceIconRenderer, NextPiecePreview,
     * PowerupButton.buildPieceIcon for a powerup's embedded piece). When set,
     * that sprite is drawn AS-IS with no colored shape behind it, entirely
     * bypassing the normal shape+face composite (and, for PieceIconRenderer/
     * NextPiecePreview, the pre-rendered 3D snapshot too) — takes priority
     * over that existing system, same as PowerupDefinition.icon does over its
     * own drawn piece-shape fallback. Omit to just keep using that system.
     */
    icon?: string;
    /** Multiplies `icon`'s default rendered size independently per axis — {x: 1, y: 1} is the default. Applied on top of whatever base size the UI slot already sizes the icon to. Only meaningful when `icon` is set. */
    iconScale?: { x: number; y: number };
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

    disabled?: boolean,

    /** Score awarded when this piece merges into the next tier (or, at the top tier, when two of it despawn together) — see TowerMergeController/FaceTowerGameEvents.onMerge. Omit to use DEFAULT_PIECE_POINTS. */
    points?: number;
}

/** Fallback score for any piece that doesn't set its own `points` — "add 2 points for each for now". */
export const DEFAULT_PIECE_POINTS = 2;

/** `piece.points` if set, else DEFAULT_PIECE_POINTS. */
export function getPiecePoints(piece: PieceDefinition): number {
    return piece.points ?? DEFAULT_PIECE_POINTS;
}

/** Fallback board-weight contribution for any piece that doesn't set its own `weight` (a powerup's embedded piece, most notably — see PieceDefinition.weight). */
export const DEFAULT_PIECE_WEIGHT = 1;

/** `piece.weight` if set, else DEFAULT_PIECE_WEIGHT. */
export function getPieceWeight(piece: PieceDefinition): number {
    return piece.weight ?? DEFAULT_PIECE_WEIGHT;
}

/** Gems awarded when a merge produces a piece of this tier — see FaceTowerGameController.handleMerge/GemStorage.add(). Tiers not listed award none ("big merges" only). */
export const MERGE_GEM_REWARDS: Record<number, number> = {
    6: 2,
    7: 4,
    8: 8,
    9: 16,
    10: 32,
    11: 64,
};

/** Gems `tier` awards on merge (0 for an untiered result, e.g. a top-tier + top-tier despawn, or any tier not in MERGE_GEM_REWARDS). */
export function getMergeGemReward(tier: number | undefined): number {
    if (tier === undefined) return 0;
    return MERGE_GEM_REWARDS[tier] ?? 0;
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
const NON_PRELOAD_IMAGE_BASE = 'down/images/non-preload/';

export function resolvePieceImagePath(relativePath: string): string {
    return `${NON_PRELOAD_IMAGE_BASE}${relativePath}`;
}

/** Point count for a generated circle polygon — see PieceDefinition.isCircle. Matches the hand-authored circle outlines this replaces. */
const CIRCLE_SEGMENTS = 16;

/**
 * Regular CIRCLE_SEGMENTS-gon of the given radius, centered on the unit
 * square (0.5, 0.5) — same unit-square-space convention as
 * PieceDefinition.polygon. Starts at angle 0 (due "right", i.e. (0.5 +
 * radius, 0.5)) and winds clockwise in this y-down space, matching the
 * point order every hand-authored circle `polygon` in pieces-config.json
 * already used.
 */
export function generateCirclePolygon(radius: number, segments: number = CIRCLE_SEGMENTS): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = [];

    for (let i = 0; i < segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        points.push({
            x: Math.round((0.5 + radius * Math.cos(theta)) * 1000) / 1000,
            y: Math.round((0.5 + radius * Math.sin(theta)) * 1000) / 1000,
        });
    }

    return points;
}

/** Default catalog — see loadPieces()'s `bundleKey` param. */
export const DEFAULT_PIECES_BUNDLE = 'pieces-config.json';

/**
 * Populated in place from a 'json' PIXI bundle (raw-assets/json/pieces-config.json
 * by default) once it finishes loading — see MyGame.loadAssets() in index.ts.
 * Kept as a mutated const array (rather than reassigned) so existing imports
 * of PIECES stay valid references.
 */
export const PIECES: PieceDefinition[] = [];

/**
 * Bumped every time loadPieces() (re)populates PIECES — see
 * getPieceCatalogGeneration(). Lets a cache keyed on cheap signals like
 * PieceShapeMode (only 'circle'/'cube', not "which catalog") notice a
 * catalog swap even when those signals happen not to have changed (e.g.
 * IslandViewScene's theme toggle going from 'cats' back to 'circle' — both
 * resolve to PieceShapeMode 'circle').
 */
let pieceCatalogGeneration = 0;

/** See pieceCatalogGeneration's own doc. */
export function getPieceCatalogGeneration(): number {
    return pieceCatalogGeneration;
}

/**
 * Call once the 'json' PIXI.Assets bundle has loaded — see index.ts
 * loadAssets(). `bundleKey` picks which catalog to (re)populate PIECES from
 * — defaults to DEFAULT_PIECES_BUNDLE, but IslandViewScene's theme toggle
 * (see GameThemeStorage) also calls this again with a different catalog
 * (e.g. 'pieces-config-cats.json') to swap the whole piece set at runtime,
 * same "mutate PIECES in place" contract as the initial load.
 */
export function loadPieces(bundleKey: string = DEFAULT_PIECES_BUNDLE): void {
    const pieces = PIXI.Assets.get(bundleKey) as PieceDefinition[];

    for (const piece of pieces) {
        if (piece.isCircle) {
            piece.polygon = generateCirclePolygon(piece.radius ?? 0.5);
        }
    }

    PIECES.splice(0, PIECES.length, ...pieces);
    pieceCatalogGeneration++;
}
