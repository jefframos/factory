// TowerGateController.ts

/** What must happen for the current gate to open — see TowerGateController's own doc. */
export interface GateRequirement {
    /** The tier that must be unlocked — or, once `isTopTierRepeat` is true, the top tier itself (the one that must be merged again). */
    tier: number;
    /** True once every real tier has already been unlocked — from then on the SAME (top) tier repeats forever, and the requirement is "merge two of it again," not "unlock a new one." */
    isTopTierRepeat: boolean;
}

/**
 * Tracks which piece-tier the next gate needs unlocked — replaces the old
 * board-weight milestone (see TowerZoneController, whose own zone/level
 * bookkeeping is untouched and still runs; only WHAT triggers a gate
 * changed). The first gate needs `firstGateTier` unlocked; every gate after
 * that needs the NEXT tier unlocked; once `maxCatalogTier` itself is
 * unlocked, every further gate instead needs another top-tier + top-tier
 * merge (see TowerMergeController's own top-tier despawn case) — the
 * requirement stops advancing and just repeats.
 */
export class TowerGateController {
    private nextTierGoal: number;
    private topTierMode = false;

    public constructor(
        private readonly firstGateTier: number,
        private readonly maxCatalogTier: number,
    ) {
        this.nextTierGoal = firstGateTier;
    }

    /** What the player currently needs to do to open the next gate. */
    public getCurrentRequirement(): GateRequirement {
        return {
            tier: this.topTierMode ? this.maxCatalogTier : this.nextTierGoal,
            isTopTierRepeat: this.topTierMode,
        };
    }

    /**
     * True the instant the current requirement is satisfied — `maxTierReached`
     * is FaceTowerGameController's own per-run high-water mark (bumped the
     * moment a merge produces a new tier); `topTierMergeHappened` is a
     * one-shot flag the caller sets whenever a top-tier + top-tier merge
     * just despawned two pieces (see TowerMergeController), consumed
     * (reset) by the caller every frame regardless of the result here.
     */
    public isRequirementMet(maxTierReached: number, topTierMergeHappened: boolean): boolean {
        if (this.topTierMode) {
            return topTierMergeHappened;
        }

        return maxTierReached >= this.nextTierGoal;
    }

    /**
     * Call once the gate the current requirement guards is actually
     * opening — moves on to the next requirement, or (once the top tier
     * itself was just unlocked) flips into permanent topTierMode instead.
     * A no-op once already in topTierMode (there's nothing further to
     * advance to).
     */
    public advance(): void {
        if (this.topTierMode) {
            return;
        }

        if (this.nextTierGoal >= this.maxCatalogTier) {
            this.topTierMode = true;
        } else {
            this.nextTierGoal++;
        }
    }

    public reset(): void {
        this.nextTierGoal = this.firstGateTier;
        this.topTierMode = false;
    }
}
