// FlapShape.ts

/** Unit-square-space point (0..1, top-left origin) — same convention as PieceDefinition.polygon. */
export interface UnitPoint {
    x: number;
    y: number;
}

/**
 * Pinball-flipper-style outline for a trapdoor flap (see
 * FaceTowerBlockController.createFlap()/TowerBaseSync3D.createPanel()) —
 * wide at the hinge end (x=0) tapering through a rounded arc to a narrow
 * tip at x=1, instead of the plain rect a flap used to draw. Purely
 * cosmetic: a flap's PHYSICS collider stays a plain symmetric BoxEntity
 * either way (see createFlap()'s own doc for why an asymmetric silhouette
 * never touches collision here) — this only swaps what gets drawn on top
 * of it, in both the 2D view (StaticPieceView2D) and the 3D mesh
 * (PieceBoxBuilder).
 *
 * Traced in the SAME clockwise (y-down-authored) winding every other
 * polygon in this codebase uses (see e.g. PieceStorage's circle-tier
 * pieces, PieceBoxBuilder's own RECT_POLYGON fallback) — top edge
 * left-to-right, then the tip arc top-to-bottom, then bottom edge
 * right-to-left, implicitly closed hinge-side bottom-to-top — so it fills
 * (2D) and extrudes (3D) with the correct orientation, same as the plain
 * rect it replaces.
 *
 * The hinge-side edge sits PAST x=0 (at -WALL_OVERLAP, not exactly 0) —
 * this shape is scaled/positioned using the same nominal flapWidth as the
 * flap's own (unchanged) physics collider and rotation pivot (see
 * createFlap()/setFlapAngle()), so extending only the mesh's own polygon
 * coordinates past that nominal edge makes the visual flipper stick out a
 * little further on the hinge side — into the containment wall it's
 * hinged against — without moving the hinge itself or touching collision.
 * Reads as the flipper physically emerging from inside the wall instead of
 * visibly butting flush against it. The tip-side edge (x=1) is untouched.
 */
const TIP_STEPS = 6;
const TIP_CENTER_X = 0.68;
const TIP_RADIUS_X = 0.32;
/** Fraction of flapWidth the hinge edge extends past x=0/1 into the wall — tune to match FaceTowerConfig.wallWidth's own visual thickness. */
const WALL_OVERLAP = 0.16;

function buildFlipperPolygon(): UnitPoint[] {
    const points: UnitPoint[] = [
        { x: -WALL_OVERLAP, y: 0 },
        { x: TIP_CENTER_X, y: 0 },
    ];

    // Arcs from directly above the tip center (-90deg) to directly below it
    // (+90deg), through the tip's own rightmost point (0deg) — i.e. the
    // shape's "right edge", curved into a rounded point instead of a
    // straight vertical line.
    for (let i = 1; i < TIP_STEPS; i++) {
        const t = i / TIP_STEPS;
        const angle = -Math.PI * 0.5 + t * Math.PI;

        points.push({
            x: TIP_CENTER_X + Math.cos(angle) * TIP_RADIUS_X,
            y: 0.5 + Math.sin(angle) * 0.5,
        });
    }

    points.push({ x: TIP_CENTER_X, y: 1 });
    points.push({ x: -WALL_OVERLAP, y: 1 });

    return points;
}

/** Hinge at x=0 (this shape's own "left"), tapering to the tip at x=1. */
export const FLIPPER_POLYGON_HINGE_LEFT: UnitPoint[] = buildFlipperPolygon();

/**
 * Same outline mirrored so the hinge sits at x=1 instead — the point order
 * is also reversed, since mirroring only the X axis flips a clockwise
 * outline into a counter-clockwise one, and reversing the array restores
 * the clockwise winding FLIPPER_POLYGON_HINGE_LEFT already has.
 */
export const FLIPPER_POLYGON_HINGE_RIGHT: UnitPoint[] = [...FLIPPER_POLYGON_HINGE_LEFT]
    .reverse()
    .map(p => ({ x: 1 - p.x, y: p.y }));

/**
 * `side` is the flap's own side (see FaceTowerBlockController's FlapInfo) —
 * the LEFT flap hinges at its own OUTER (world-left) edge, which is this
 * shape's local x=0 side, so it uses the polygon as-authored; the RIGHT
 * flap hinges at its own OUTER (world-right) edge (local x=1), so it needs
 * the mirrored variant instead.
 */
export function getFlapPolygon(side: 'left' | 'right'): UnitPoint[] {
    return side === 'left' ? FLIPPER_POLYGON_HINGE_LEFT : FLIPPER_POLYGON_HINGE_RIGHT;
}
