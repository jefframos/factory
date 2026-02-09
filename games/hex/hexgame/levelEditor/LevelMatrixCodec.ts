import { GridMatrix, HexPos } from "../HexTypes";

export class LevelMatrixCodec {
    // axial -> offset (odd-r)
    public static axialToOffset(q: number, r: number): { q: number; r: number } {
        return { q: q + Math.floor(r / 2), r };
    }

    // offset -> axial
    public static offsetToAxial(q: number, r: number): { q: number; r: number } {
        return { q: q - Math.floor(r / 2), r };
    }

    public static key(q: number, r: number): string {
        return `${q},${r}`;
    }

    public static parseKey(k: string): HexPos {
        const [q, r] = k.split(",").map(Number);
        return { q, r };
    }

    public static fromMatrix(matrix: GridMatrix): Set<string> {
        const set = new Set<string>();

        for (let r = 0; r < matrix.length; r++) {
            for (let qOff = 0; qOff < matrix[r].length; qOff++) {
                if (matrix[r][qOff] !== 1) continue;
                const a = this.offsetToAxial(qOff, r);
                set.add(this.key(a.q, a.r));
            }
        }

        return set;
    }
    // Add to LevelMatrixCodec or a new Validator class
    public static validateLevel(lvl: LevelData): { ok: boolean; msg: string } {
        if (!lvl.matrix || lvl.matrix.length === 0) return { ok: false, msg: "No grid" };

        // If it's procedural (no baked pieces), we assume it's valid for now
        if (!lvl.pieces || lvl.pieces.length === 0) return { ok: true, msg: "Procedural" };

        const gridSet = this.fromMatrix(lvl.matrix);
        const seen = new Set<string>();

        for (const p of lvl.pieces) {
            for (const c of p.coords) {
                const k = this.key(p.rootPos.q + c.q, p.rootPos.r + c.r);
                if (!gridSet.has(k)) return { ok: false, msg: "Out of bounds" };
                if (seen.has(k)) return { ok: false, msg: "Overlap" };
                seen.add(k);
            }
        }

        return seen.size === gridSet.size
            ? { ok: true, msg: "Valid" }
            : { ok: false, msg: "Incomplete" };
    }
    public static toMatrix(axialTiles: Set<string>): GridMatrix {
        if (axialTiles.size === 0) {
            return [[1]];
        }

        // compute bounds in OFFSET space (because matrix is offset rows)
        let minR = Infinity;
        let maxR = -Infinity;
        let minQOff = Infinity;
        let maxQOff = -Infinity;

        axialTiles.forEach(k => {
            const { q, r } = this.parseKey(k);
            const off = this.axialToOffset(q, r);

            if (off.r < minR) minR = off.r;
            if (off.r > maxR) maxR = off.r;
            if (off.q < minQOff) minQOff = off.q;
            if (off.q > maxQOff) maxQOff = off.q;
        });

        const rows = (maxR - minR) + 1;
        const cols = (maxQOff - minQOff) + 1;

        const matrix: GridMatrix = [];
        for (let r = 0; r < rows; r++) {
            const row: number[] = [];
            for (let c = 0; c < cols; c++) row.push(0);
            matrix.push(row);
        }

        axialTiles.forEach(k => {
            const { q, r } = this.parseKey(k);
            const off = this.axialToOffset(q, r);

            const rr = off.r - minR;
            const cc = off.q - minQOff;

            if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) {
                matrix[rr][cc] = 1;
            }
        });

        return matrix;
    }
}
