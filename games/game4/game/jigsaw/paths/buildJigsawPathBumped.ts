import { EdgeSide } from "games/game4/types";


export function buildJigsawPathBumped(
    w: number,
    h: number,
    tab: number,
    edges: EdgeSide
): number[] {
    const pad = tab;

    const x0 = pad;
    const y0 = pad;
    const x1 = pad + w;
    const y1 = pad + h;

    const SEG = 10;
    const pts: number[] = [];

    const push = (x: number, y: number) => {
        pts.push(x, y);
    };

    // Convenience: add a sinus bump from a..b on one axis, bulging by +/- tab.
    const sin01 = (t: number) => Math.sin(Math.PI * t);

    const addTopBump = (dir: number) => {
        const mid = (x0 + x1) * 0.5;
        for (let i = 0; i <= SEG; i++) {
            const t = i / SEG;
            const x = mid - tab + (2 * tab * t);

            // dir=+1 => outward (up) => -Y
            // dir=-1 => inward (down) => +Y
            const y = y0 - (dir * sin01(t) * tab);

            push(x, y);
        }
    };

    const addBottomBump = (dir: number) => {
        const mid = (x0 + x1) * 0.5;
        for (let i = 0; i <= SEG; i++) {
            const t = i / SEG;
            const x = mid + tab - (2 * tab * t);

            // dir=+1 => outward (down) => +Y
            // dir=-1 => inward (up) => -Y
            const y = y1 + (dir * sin01(t) * tab);

            push(x, y);
        }
    };

    const addRightBump = (dir: number) => {
        const mid = (y0 + y1) * 0.5;
        for (let i = 0; i <= SEG; i++) {
            const t = i / SEG;
            const y = mid - tab + (2 * tab * t);

            // dir=+1 => outward (right) => +X
            // dir=-1 => inward (left) => -X
            const x = x1 + (dir * sin01(t) * tab);

            push(x, y);
        }
    };

    const addLeftBump = (dir: number) => {
        const mid = (y0 + y1) * 0.5;
        for (let i = 0; i <= SEG; i++) {
            const t = i / SEG;
            const y = mid + tab - (2 * tab * t);

            // dir=+1 => outward (left) => -X
            // dir=-1 => inward (right) => +X
            const x = x0 - (dir * sin01(t) * tab);

            push(x, y);
        }
    };

    // Start
    push(x0, y0);

    // Top edge
    if (edges.top === 0) {
        push(x1, y0);
    }
    else {
        push((x0 + x1) * 0.5 - tab, y0);
        addTopBump(edges.top);
        push(x1, y0);
    }

    // Right edge
    if (edges.right === 0) {
        push(x1, y1);
    }
    else {
        push(x1, (y0 + y1) * 0.5 - tab);
        addRightBump(edges.right);
        push(x1, y1);
    }

    // Bottom edge
    if (edges.bottom === 0) {
        push(x0, y1);
    }
    else {
        push((x0 + x1) * 0.5 + tab, y1);
        addBottomBump(edges.bottom);
        push(x0, y1);
    }

    // Left edge
    if (edges.left === 0) {
        push(x0, y0);
    }
    else {
        push(x0, (y0 + y1) * 0.5 + tab);
        addLeftBump(edges.left);
        push(x0, y0);
    }

    return pts;
}



