// PieceManager.ts

import { PIECES, type PieceDefinition } from './PieceStorage';

/**
 * Organizes loaded piece definitions (see PieceStorage) into level-keyed
 * pools — a level's pool is cumulative, i.e. every piece unlocked at or
 * before that level, so early levels only ever draw from the easy shapes
 * and harder ones join the pool as the level climbs.
 *
 * Call build() once PieceStorage.loadPieces() has populated PIECES (see
 * index.ts loadAssets()), before the first piece is spawned.
 */
export class PieceManager {
    private readonly poolsByLevel = new Map<number, PieceDefinition[]>();
    private sortedLevels: number[] = [];

    private lastId = '';

    public build(): void {
        this.poolsByLevel.clear();

        const levels = [...new Set(PIECES.map(piece => piece.level))].sort(
            (a, b) => a - b,
        );

        this.sortedLevels = levels;

        let cumulative: PieceDefinition[] = [];

        for (const level of levels) {
            cumulative = [
                ...cumulative,
                ...PIECES.filter(piece => piece.level === level && !piece.disabled),
            ];

            this.poolsByLevel.set(level, cumulative);
        }
    }

    /** Every piece unlocked at or before `level` — empty if build() hasn't run or no piece qualifies. */
    public getPoolForLevel(level: number): readonly PieceDefinition[] {
        let pool: readonly PieceDefinition[] = [];

        for (const l of this.sortedLevels) {
            if (l > level) {
                break;
            }

            pool = this.poolsByLevel.get(l) ?? pool;
        }

        return pool;
    }

    /**
     * A random piece from the pool available at `level`. Avoids repeating
     * the last piece when the pool has at least 2 options — if the pool
     * only contains one piece, that piece is returned every time.
     */
    public getPieceForLevel(level: number): PieceDefinition {
        const pool = this.getPoolForLevel(level);

        if (pool.length === 0) {
            throw new Error(
                `PieceManager: no pieces available for level ${level}.`,
            );
        }

        if (pool.length === 1) {
            const only = pool[0];
            this.lastId = only.id;
            return only;
        }

        const candidates = pool.filter(piece => piece.id !== this.lastId);
        const pick = candidates[Math.floor(Math.random() * candidates.length)];

        this.lastId = pick.id;
        return pick;
    }
}
