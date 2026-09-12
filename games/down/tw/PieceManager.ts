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

    /** Most recent picks, oldest first — see getPieceForLevel()'s HISTORY_DEPTH. */
    private recentIds: string[] = [];

    /** Every real catalog piece keyed by its own `tier` — see getNextTierPiece()/getMaxTier(). Pieces with no `tier` (a powerup's embedded shape never runs through PieceManager anyway) are simply absent. */
    private readonly pieceByTier = new Map<number, PieceDefinition>();
    private maxTier = 0;

    public build(): void {
        this.poolsByLevel.clear();
        this.pieceByTier.clear();
        this.maxTier = 0;

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

        for (const piece of PIECES) {
            if (piece.disabled || piece.tier === undefined) {
                continue;
            }

            this.pieceByTier.set(piece.tier, piece);
            this.maxTier = Math.max(this.maxTier, piece.tier);
        }
    }

    /** Whichever piece is one tier above `piece` — the result of merging two of it — or undefined if `piece` has no tier (shouldn't happen for a real board piece) or is already the highest tier (see TowerMergeController's top-tier-despawn case). */
    public getNextTierPiece(piece: PieceDefinition): PieceDefinition | undefined {
        if (piece.tier === undefined) {
            return undefined;
        }

        return this.pieceByTier.get(piece.tier + 1);
    }

    /** Highest `tier` among every loaded (non-disabled) piece — 0 if none define one. */
    public getMaxTier(): number {
        return this.maxTier;
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
     * any of the last HISTORY_DEPTH picks — falling back to a shorter
     * history (down to just the immediately-previous pick, same as before)
     * whenever the pool isn't big enough to honor the full depth, so a
     * small early-game pool never throws or stalls waiting for variety it
     * can't supply. A single-piece pool still just returns that piece every
     * time.
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
            this.recentIds = [only.id];
            return only;
        }

        let candidates: readonly PieceDefinition[] = [];

        for (let depth = Math.min(PieceManager.HISTORY_DEPTH, this.recentIds.length); depth >= 0; depth--) {
            const excluded = new Set(this.recentIds.slice(this.recentIds.length - depth));
            candidates = pool.filter(piece => !excluded.has(piece.id));

            if (candidates.length > 0) {
                break;
            }
        }

        const pick = candidates[Math.floor(Math.random() * candidates.length)];

        this.recentIds = [...this.recentIds, pick.id].slice(-PieceManager.HISTORY_DEPTH);
        return pick;
    }

    /** How many of the most recent picks getPieceForLevel() tries to avoid repeating — see its own doc for the pool-too-small fallback. */
    private static readonly HISTORY_DEPTH = 2;
}
