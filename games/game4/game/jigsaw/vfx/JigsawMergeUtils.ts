// JigsawMergeUtils.ts
import * as PIXI from "pixi.js";
import { JigsawCluster } from "../JigsawCluster";
import { JigsawPiece } from "../JigsawPiece";
const TWO_PI = Math.PI * 2;

export function normalizeRad(a: number): number {
    a = a % TWO_PI;
    if (a < 0) {
        a += TWO_PI;
    }
    return a;
}

/**
 * Returns the signed smallest delta to go from `from` to `to` in radians.
 * Result is in (-PI, PI].
 */
export function shortestDeltaRad(from: number, to: number): number {
    const a = normalizeRad(from);
    const b = normalizeRad(to);

    let d = b - a; // (-2pi, 2pi)
    if (d > Math.PI) {
        d -= TWO_PI;
    }
    else if (d <= -Math.PI) {
        d += TWO_PI;
    }

    return d;
}


export class JigsawMergeUtils {
    /**
     * Align `source.container` so that `sourceWorldAnchor` moves to `targetWorldAnchor`,
     * then merge source into target preserving piece world positions.
     */
    public static alignAndMerge(opts: {
        source: JigsawCluster;
        target: JigsawCluster;

        // World anchors. If omitted, no pre-alignment is done.
        sourceWorldAnchor?: PIXI.IPointData;
        targetWorldAnchor?: PIXI.IPointData;

        // If true, rebuild target pivot after merge (recommended).
        rebuildPivot?: boolean;
    }): JigsawCluster {
        const source = opts.source;
        const target = opts.target;

        if (source === target) {
            return target;
        }

        // Optional alignment: translate source so anchor matches
        if (opts.sourceWorldAnchor && opts.targetWorldAnchor) {
            const dx = opts.targetWorldAnchor.x - opts.sourceWorldAnchor.x;
            const dy = opts.targetWorldAnchor.y - opts.sourceWorldAnchor.y;
            source.container.position.x += dx;
            source.container.position.y += dy;
        }

        // Reparent pieces preserving world position
        for (const piece of source.pieces) {
            const worldPos = new PIXI.Point();
            (piece as any).getGlobalPosition(worldPos);

            source.container.removeChild(piece);
            target.container.addChild(piece);

            const local = target.container.toLocal(worldPos);
            piece.position.set(local.x, local.y);

            piece.cluster = target;
            target.pieces.add(piece);
        }

        source.pieces.clear();

        if (source.container.parent) {
            source.container.parent.removeChild(source.container);
        }

        if (opts.rebuildPivot ?? true) {
            target.rebuildPivotFromBounds();
        }

        return target;
    }

    /**
     * Convenience: compute a stable "pivot world" for a cluster (good default anchor).
     */
    public static getPivotWorld(cluster: JigsawCluster): PIXI.Point {
        return cluster.container.toGlobal(cluster.container.pivot.clone());
    }

    /**
     * Convenience: compute a piece anchor in world (core origin).
     */
    public static getPieceCoreWorld(piece: JigsawPiece): PIXI.Point {
        return piece.getCoreOriginGlobal();
    }
}
