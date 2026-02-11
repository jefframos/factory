import { ClusterData, Difficulty, GridMatrix, HexPos, PIECE_COLOR_PALETTE } from "../HexTypes";

export class ClusterGenerator {
    private static readonly AXIAL_OFFSETS = [
        { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
        { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
    ];

    public static generateFromGrid(matrix: GridMatrix, difficulty: Difficulty): ClusterData[] {
        const MAX_ATTEMPTS = 10;
        let bestAttempt: HexPos[][] | null = null;

        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            const attempt = this.runSingleGeneration(matrix, difficulty);

            // Criteria: 
            // 1. Must have more than 1 piece (unless the grid is tiny)
            // 2. No piece should be excessively large (e.g., > 1.5x range max)
            const range = this.getRange(difficulty);
            const hasGiantPiece = attempt.some(p => p.length > range.max + 2);

            if (attempt.length > 1 && !hasGiantPiece) {
                bestAttempt = attempt;
                break; // Found a good one!
            }

            // Keep the first attempt as a fallback
            if (!bestAttempt) bestAttempt = attempt;
        }

        return (bestAttempt || []).map(coords => {
            const minQ = Math.min(...coords.map(c => c.q));
            const minR = Math.min(...coords.map(c => c.r));
            return {
                coords: coords.map(c => ({ q: c.q - minQ, r: c.r - minR })),
                color: this.getRandomColor(),
                rootPos: { q: minQ, r: minR }
            };
        });
    }

    private static runSingleGeneration(matrix: GridMatrix, difficulty: Difficulty): HexPos[][] {
        let availableCoords: HexPos[] = [];
        for (let r = 0; r < matrix.length; r++) {
            for (let q = 0; q < matrix[r].length; q++) {
                if (matrix[r][q] === 1) {
                    availableCoords.push({ q: q - Math.floor(r / 2), r: r });
                }
            }
        }

        let clusters: HexPos[][] = [];
        const range = this.getRange(difficulty);

        // Generation
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

        // Cleanup: Merge fragments into the SMALLEST neighbor to prevent huge pieces
        for (let i = clusters.length - 1; i >= 0; i--) {
            if (clusters[i].length < range.min && clusters.length > 1) {
                const fragment = clusters[i];
                let bestNeighbor: HexPos[] | null = null;
                let smallestSize = Infinity;

                for (const pos of fragment) {
                    for (const off of this.AXIAL_OFFSETS) {
                        const n = { q: pos.q + off.q, r: pos.r + off.r };
                        for (let j = 0; j < clusters.length; j++) {
                            if (i === j) continue;
                            if (clusters[j].some(p => p.q === n.q && p.r === n.r)) {
                                if (clusters[j].length < smallestSize) {
                                    smallestSize = clusters[j].length;
                                    bestNeighbor = clusters[j];
                                }
                            }
                        }
                    }
                }
                if (bestNeighbor) {
                    bestNeighbor.push(...clusters.splice(i, 1)[0]);
                }
            }
        }
        return clusters;
    }
    private static findBestNeighborForMerge(fragment: HexPos[], all: HexPos[][], currentIndex: number, maxAllowed: number): HexPos[] | null {
        let candidate: HexPos[] | null = null;
        let smallestSize = Infinity;

        for (const pos of fragment) {
            for (const off of this.AXIAL_OFFSETS) {
                const nQ = pos.q + off.q;
                const nR = pos.r + off.r;

                for (let j = 0; j < all.length; j++) {
                    if (j === currentIndex) continue;
                    const cluster = all[j];

                    if (cluster.some(p => p.q === nQ && p.r === nR)) {
                        // Check if this neighbor is the smallest one we've found
                        if (cluster.length < smallestSize) {
                            smallestSize = cluster.length;
                            candidate = cluster;
                        }
                    }
                }
            }
        }
        return candidate;
    }

    private static splitIntoTwoConnected(original: HexPos[]): HexPos[][] {
        const targetSize = Math.floor(original.length / 2);
        const piece1: HexPos[] = [];
        const pool = [...original];

        // Pick a starting point for the split (index 0 is fine)
        piece1.push(pool.splice(0, 1)[0]);

        // Grow piece1 from its own neighbors found in the pool
        while (piece1.length < targetSize && pool.length > 0) {
            const neighborIdx = this.findAvailableNeighborIndex(piece1, pool);
            if (neighborIdx !== -1) {
                piece1.push(pool.splice(neighborIdx, 1)[0]);
            } else {
                break;
            }
        }

        // Piece 2 is the remainder. 
        // We MUST verify piece 2 is also connected, or merge it if it's not.
        return [piece1, pool];
    }

    private static findAvailableNeighborIndex(currentGroup: HexPos[], available: HexPos[]): number {
        // Look through every cell in our growing cluster
        for (const pos of currentGroup) {
            // Check all 6 axial directions
            for (const off of this.AXIAL_OFFSETS) {
                const nQ = pos.q + off.q;
                const nR = pos.r + off.r;

                // See if that neighbor is in the 'available' pool
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

    private static getRange(d: Difficulty) {
        const diff = typeof d === 'string' ? d : Difficulty[d];
        switch (diff) {
            case "VERY_EASY": return { min: 5, max: 7 };
            case "EASY": return { min: 4, max: 7 };
            case "MEDIUM": return { min: 3, max: 6 };
            case "HARD": return { min: 3, max: 5 };
            default: return { min: 2, max: 4 };
        }
    }

    private static COLORID = 0;
    private static getRandomColor(): string {
        const list = PIECE_COLOR_PALETTE;
        const c = list[this.COLORID++ % list.length];
        return c.id;
    }
}