// FlapShape.ts

/** Unit-square-space point (0..1, top-left origin). */
export interface UnitPoint {
    x: number;
    y: number;
}

/**
 * Pinball-flipper-style outline.
 *
 * The flap is:
 * - wide at the hinge
 * - progressively tapered toward the tip
 * - rounded at the tip
 * - slightly extended into the wall at the hinge
 *
 * This is purely visual. The physics collider remains a symmetric box.
 */

const TIP_STEPS = 8;
const WALL_OVERLAP = 0.4;

/** Total visual height, measured downward from the fixed top edge. */
const FLIPPER_HEIGHT = 2.5;

/** Radius of the rounded tip, in normalized Y units. */
const TIP_RADIUS = 0.50;

/**
 * X coordinate where the rounded tip begins.
 *
 * The radius in X is calculated from the remaining distance to x=1,
 * so the nose always reaches exactly x=1.
 */
const TIP_START_X = 0.9;

function buildFlipperPolygon(): UnitPoint[] {
    const top = 0;

    /*
     * The top of the flipper is ALWAYS y=0.
     *
     * Nothing above this line is generated.
     */
    const tipTop = top;
    const tipBottom = top + TIP_RADIUS * 2;

    /*
     * The bottom of the hinge is determined by the requested
     * overall height.
     */
    const hingeBottom = top + FLIPPER_HEIGHT;

    const points: UnitPoint[] = [
        // Hinge top.
        {
            x: -WALL_OVERLAP,
            y: top,
        },

        // Completely straight top edge.
        {
            x: TIP_START_X,
            y: top,
        },
    ];

    /*
     * Rounded pinball tip.
     *
     * It starts at the top of the tip and ends at the bottom.
     */
    const centerX = TIP_START_X;
    const centerY = top + TIP_RADIUS;
    const radiusX = 1 - TIP_START_X;

    for (let i = 1; i < TIP_STEPS; i++) {
        const t = i / TIP_STEPS;
        const angle = -Math.PI * 0.5 + t * Math.PI;

        points.push({
            x: centerX + Math.cos(angle) * radiusX,
            y: centerY + Math.sin(angle) * TIP_RADIUS,
        });
    }

    // Bottom of rounded tip.
    points.push({
        x: TIP_START_X,
        y: tipBottom,
    });

    /*
     * Connect the bottom of the tip to the bottom of the hinge.
     *
     * This is what gives the flipper its taper.
     */
    points.push({
        x: -WALL_OVERLAP,
        y: hingeBottom,
    });

    return points;
}

/** Hinge at x=0, tip at x=1. */
export const FLIPPER_POLYGON_HINGE_LEFT: UnitPoint[] =
    buildFlipperPolygon();

/**
 * Mirrored version with the hinge at x=1.
 *
 * Reverse the winding after mirroring so the polygon retains
 * the clockwise winding used throughout the project.
 */
export const FLIPPER_POLYGON_HINGE_RIGHT: UnitPoint[] =
    [...FLIPPER_POLYGON_HINGE_LEFT]
        .reverse()
        .map(p => ({
            x: 1 - p.x,
            y: p.y,
        }));

export function getFlapPolygon(side: 'left' | 'right'): UnitPoint[] {
    return side === 'left'
        ? FLIPPER_POLYGON_HINGE_LEFT
        : FLIPPER_POLYGON_HINGE_RIGHT;
}