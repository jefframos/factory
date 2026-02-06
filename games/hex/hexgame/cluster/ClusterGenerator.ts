import { ClusterData, Difficulty, GridMatrix, HexPos } from "../HexTypes";

export class ClusterGenerator {
    // In Axial, neighbors are ALWAYS these 6 relative offsets
    private static readonly AXIAL_OFFSETS = [
        { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
        { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
    ];

    public static generateFromGrid(matrix: GridMatrix, difficulty: Difficulty): ClusterData[] {
        let availableCoords: HexPos[] = [];

        // 1. CONVERT OFFSET MATRIX TO AXIAL
        for (let r = 0; r < matrix.length; r++) {
            for (let q = 0; q < matrix[r].length; q++) {
                if (matrix[r][q] === 1) {
                    // Axial conversion: q_axial = q_offset - floor(r_offset / 2)
                    availableCoords.push({
                        q: q - Math.floor(r / 2),
                        r: r
                    });
                }
            }
        }

        const clusters: HexPos[][] = [];
        const range = this.getRange(difficulty);

        // 2. GENERATE CLUSTERS (Same logic, but using Axial neighbors)
        while (availableCoords.length > 0) {
            const targetSize = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
            const currentCluster: HexPos[] = [];

            let startNode = availableCoords.splice(Math.floor(Math.random() * availableCoords.length), 1)[0];
            currentCluster.push(startNode);

            while (currentCluster.length < targetSize && availableCoords.length > 0) {
                const neighborIdx = this.findAvailableNeighborIndex(currentCluster, availableCoords);
                if (neighborIdx !== -1) {
                    currentCluster.push(availableCoords.splice(neighborIdx, 1)[0]);
                } else break;
            }
            clusters.push(currentCluster);
        }

        // 3. CLEANUP (Merge small fragments)
        for (let i = clusters.length - 1; i >= 0; i--) {
            if (clusters[i].length < range.min && clusters.length > 1) {
                const smallCluster = clusters.splice(i, 1)[0];
                const target = this.findAdjacentCluster(smallCluster, clusters);
                if (target) target.push(...smallCluster);
                else clusters.push(smallCluster);
            }
        }

        return clusters.map(coords => {
            // Find the min values used for normalization
            const minQ = Math.min(...coords.map(c => c.q));
            const minR = Math.min(...coords.map(c => c.r));

            return {
                coords: this.normalize(coords),
                color: this.getRandomColor(),
                rootPos: { q: minQ, r: minR } // This is where the piece belongs
            };
        });
    }

    private static findAvailableNeighborIndex(currentGroup: HexPos[], available: HexPos[]): number {
        for (const pos of currentGroup) {
            for (const off of this.AXIAL_OFFSETS) {
                const nQ = pos.q + off.q;
                const nR = pos.r + off.r;
                const idx = available.findIndex(a => a.q === nQ && a.r === nR);
                if (idx !== -1) return idx;
            }
        }
        return -1;
    }

    private static findAdjacentCluster(fragment: HexPos[], allClusters: HexPos[][]): HexPos[] | null {
        for (const pos of fragment) {
            for (const off of this.AXIAL_OFFSETS) {
                const nQ = pos.q + off.q;
                const nR = pos.r + off.r;
                for (const cluster of allClusters) {
                    if (cluster.find(p => p.q === nQ && p.r === nR)) return cluster;
                }
            }
        }
        return null;
    }

    private static normalize(coords: HexPos[]): HexPos[] {
        // Just find the minimum q and r to make the piece relative to (0,0)
        const minQ = Math.min(...coords.map(c => c.q));
        const minR = Math.min(...coords.map(c => c.r));
        return coords.map(c => ({ q: c.q - minQ, r: c.r - minR }));
    }

    private static getRange(d: Difficulty) {
        if (d === Difficulty.EASY) return { min: 4, max: 7 };
        if (d === Difficulty.MEDIUM) return { min: 3, max: 5 };
        return { min: 2, max: 4 };
    }

    private static COLORID = 0
    private static getRandomColor(): number {
        return [0xFF5733, 0x33FF57, 0x3357FF, 0xF333FF, 0xFFF333, 0x00CED1][this.COLORID++ % 6];
    }
}