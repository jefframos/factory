import { LevelMatrixCodec } from "./LevelMatrixCodec";

export class LevelPatternGenerator {
    /**
     * Generates a random "nice" pattern matrix.
     * @param targetSize Number of hexes to aim for (e.g., 15-30)
     */
    public static generateRandomPattern(targetSize: number = 20): number[][] {
        const types: Array<() => Set<string>> = [
            () => this.generateBlob(targetSize),
            () => this.generateRadial(targetSize),
            () => this.generateSymmetric(targetSize)
        ];

        const selectedType = types[Math.floor(Math.random() * types.length)];
        const tileSet = selectedType();

        return LevelMatrixCodec.toMatrix(tileSet);
    }

    private static generateBlob(size: number): Set<string> {
        const tiles = new Set<string>();
        let q = 0, r = 0;
        tiles.add(LevelMatrixCodec.key(q, r));

        const neighbors = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];

        while (tiles.size < size) {
            // Pick an existing tile and grow from it
            const arr = Array.from(tiles);
            const randomTile = arr[Math.floor(Math.random() * arr.length)];
            const pos = LevelMatrixCodec.parseKey(randomTile);
            const n = neighbors[Math.floor(Math.random() * neighbors.length)];
            tiles.add(LevelMatrixCodec.key(pos.q + n.q, pos.r + n.r));
        }
        return tiles;
    }

    private static generateRadial(size: number): Set<string> {
        const tiles = new Set<string>();
        const radius = Math.floor(Math.sqrt(size) / 1.5) + 1;

        for (let q = -radius; q <= radius; q++) {
            for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
                // Add a bit of noise so it's not a perfect hexagon
                if (Math.random() > 0.15) {
                    tiles.add(LevelMatrixCodec.key(q, r));
                }
            }
        }
        return tiles;
    }

    private static generateSymmetric(size: number): Set<string> {
        const tiles = new Set<string>();
        tiles.add(LevelMatrixCodec.key(0, 0));

        const halfSize = size / 2;
        while (tiles.size < size) {
            const q = Math.floor(Math.random() * 4) - 2;
            const r = Math.floor(Math.random() * 4) - 2;

            // Add (q, r) and its mirror (-q, -r) to keep it balanced
            tiles.add(LevelMatrixCodec.key(q, r));
            tiles.add(LevelMatrixCodec.key(-q, -r));
        }
        return tiles;
    }
}