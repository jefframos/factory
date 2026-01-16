import { EdgeSide, PieceEdgeVariants } from "games/game4/types";

export function buildJigsawPath(
    w: number,
    h: number,
    tab: number,
    edges: EdgeSide,
    edgeVariants: PieceEdgeVariants
): number[] {
    const x0 = tab, y0 = tab;
    const x1 = tab + w, y1 = tab + h;

    const pts: number[] = [];
    const push = (x: number, y: number) => { pts.push(x, y); };


    // 0.5 is standard Catmull-Rom. Lower (0.3) is tighter, Higher (0.8) is "rounder/looser"
    const tension = 0.6;

    const addEdge = (ax: number, ay: number, bx: number, by: number, type: number, side: string) => {
        if (type === 0) { push(bx, by); return; }
        // --- Tuning Parameters ---
        let neckW = tab * 0.35;
        let headW = tab * 0.5;
        let headOut = tab * 0.85;
        let neckDepth = tab * 0.05;
        let fillet = tab * 0.35;

        let midX = (ax + bx) / 2, midY = (ay + by) / 2;
        const dx = bx - ax, dy = by - ay;
        const len = Math.sqrt(dx * dx + dy * dy);
        const tx = dx / len, ty = dy / len;
        const nx = ty, ny = -tx;

        //console.log(edgeVariants[side])

        const variant = edgeVariants[side]

        if (variant) {
            const seedRnd2 = Math.cos(variant.seed / 30000) * 0.05
            neckW += tab * seedRnd2
            const seedRnd1 = Math.sin(variant.seed / 100000) * 0.1
            if (headW + tab * seedRnd1 <= neckW * 1.25) {
                headW -= tab * seedRnd1
            } else {
                headW += tab * seedRnd1
            }
            const seedRnd3 = Math.sin(variant.seed / 900000) * 0.1
            headOut += tab * seedRnd3

            if (side == 'top' || side == 'bottom') {
                midX += (ax + bx) / 2 * variant.offsetN / 4;
            } else {
                midY += (ay + by) / 2 * variant.offsetN / 4;
            }
        }


        // Expanded node set for a smoother "Rounded" top
        const nodes = [
            { x: -neckW - fillet * 2, y: 0 },         // Ghost
            { x: -neckW - fillet, y: 0 },         // Base entry
            { x: -neckW, y: neckDepth }, // Neck
            { x: -headW, y: headOut * 0.5 }, // Shoulder
            { x: -headW * 0.5, y: headOut },       // Top Left Curve
            // { x: 0, y: headOut },       // Top Right Curve
            { x: headW * 0.5, y: headOut },       // Top Left Curve
            { x: headW, y: headOut * 0.5 }, // Shoulder
            { x: neckW, y: neckDepth }, // Neck
            { x: neckW + fillet, y: 0 },         // Base exit
            { x: neckW + fillet * 2, y: 0 }          // Ghost
        ];

        for (let i = 1; i < nodes.length - 2; i++) {
            const p0 = nodes[i - 1], p1 = nodes[i], p2 = nodes[i + 1], p3 = nodes[i + 2];

            // Higher steps = smoother visual edge
            const steps = 16;
            for (let t = (i === 1 ? 0 : 1 / steps); t <= 1; t += 1 / steps) {
                const cx = catmullRom(p0.x, p1.x, p2.x, p3.x, t, tension);
                const cy = catmullRom(p0.y, p1.y, p2.y, p3.y, t, tension);

                const depth = cy * type;
                push(
                    midX + (cx * tx) + (depth * nx),
                    midY + (cx * ty) + (depth * ny)
                );
            }
        }
        push(bx, by);
    };

    function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number, m: number): number {
        const v0 = (p2 - p0) * m;
        const v1 = (p3 - p1) * m;
        const t2 = t * t;
        const t3 = t * t2;
        return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
    }

    push(x0, y0);
    addEdge(x0, y0, x1, y0, edges.top, 'top');
    addEdge(x1, y0, x1, y1, edges.right, 'right');
    addEdge(x1, y1, x0, y1, edges.bottom, 'bottom');
    addEdge(x0, y1, x0, y0, edges.left, 'left');
    return pts;
}