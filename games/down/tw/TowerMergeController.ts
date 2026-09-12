// TowerMergeController.ts

import type { FaceTowerBlockController } from './FaceTowerBlockController';
import type { FaceTowerBlock } from './FaceTowerTypes';
import type { PieceManager } from './PieceManager';
import { getPiecePoints, type PieceDefinition } from './PieceStorage';

interface PendingMergePair {
    a: FaceTowerBlock;
    b: FaceTowerBlock;
}

/**
 * Suika-style merge-on-touch — same "focused controller driven every frame"
 * pattern as PowerupSystem. Fed by FaceTowerBlockController's persistent
 * per-block collision listener (see registerCollisionListener()/
 * onBlockTouch), which fires on EVERY collision a block ever has, forever
 * (unlike the one-shot jiggle it shares that listener with).
 *
 * notifyTouch() only ever QUEUES a pair — actually removing/spawning blocks
 * has to happen outside Matter's own collision callback (never mutate
 * bodies mid-step), so update() (called once per frame from
 * FaceTowerGameController.update()) is what actually resolves them.
 */
export class TowerMergeController {
    /** Every block id currently claimed by a pending (not yet resolved) pair — prevents the same block from being queued into a second pair before its first one resolves, and lets cancelBlock() know who else to free. */
    private readonly consumedIds = new Set<number>();
    private readonly pending: PendingMergePair[] = [];

    public constructor(
        private readonly blocks: FaceTowerBlockController,
        private readonly pieces: PieceManager,
        /** Fired once per resolved pair — `resultPiece` is undefined for a top-tier + top-tier despawn (no replacement spawned, just a bonus). (x, y) are 2D physics world coords (the pair's midpoint). Score itself is applied by the caller BEFORE this fires — see FaceTowerGameController.handleMerge — this is purely for VFX/popup wiring. */
        private readonly onMerge?: (resultPiece: PieceDefinition | undefined, x: number, y: number, points: number) => void,
    ) { }

    /**
     * Call from FaceTowerBlockController's onBlockTouch hook. Ignores
     * non-piece hits (already filtered upstream — see
     * FaceTowerBlockController.registerCollisionListener, which only calls
     * this when the other body resolved to a real tracked block), powerup
     * pieces, mismatched/undefined tiers, and either side still sitting in
     * its post-merge grace period (see FaceTowerBlock.mergeGraceRemaining/
     * FaceTowerConfig.mergeGraceDuration — a pacing beat so a cascade reads
     * as a sequence of individual merges instead of resolving all at once).
     * A touch fires symmetrically from both bodies (A's listener sees B and
     * vice versa) — the consumedIds/pending dedupe below collapses that
     * into a single queued pair either way.
     */
    public notifyTouch(block: FaceTowerBlock, other: FaceTowerBlock): void {
        if (block.powerup || other.powerup) {
            return;
        }

        if (block.mergeGraceRemaining > 0 || other.mergeGraceRemaining > 0) {
            return;
        }

        if (block.piece.tier === undefined || block.piece.tier !== other.piece.tier) {
            return;
        }

        if (this.consumedIds.has(block.id) || this.consumedIds.has(other.id)) {
            return;
        }

        this.consumedIds.add(block.id);
        this.consumedIds.add(other.id);
        this.pending.push({ a: block, b: other });
    }

    /**
     * Purges `blockId` from any pending pair — wired to
     * FaceTowerBlockController's onBlockRemoved hook so a bomb destroying a
     * block mid-merge-queue can't leave update() trying to resolve a dead
     * body. Frees the OTHER block in that pair too, so it isn't stuck
     * unable to merge again just because its partner got blown up.
     */
    public cancelBlock(blockId: number): void {
        this.consumedIds.delete(blockId);

        for (let i = this.pending.length - 1; i >= 0; i--) {
            const pair = this.pending[i];

            if (pair.a.id === blockId || pair.b.id === blockId) {
                this.consumedIds.delete(pair.a.id === blockId ? pair.b.id : pair.a.id);
                this.pending.splice(i, 1);
            }
        }
    }

    /** Call once per frame — resolves every pair queued since the last call, outside of Matter's own collision-processing step. */
    public update(): void {
        if (this.pending.length === 0) {
            return;
        }

        const queued = this.pending.splice(0, this.pending.length);

        for (const pair of queued) {
            this.resolvePair(pair.a, pair.b);
        }
    }

    private resolvePair(a: FaceTowerBlock, b: FaceTowerBlock): void {
        this.consumedIds.delete(a.id);
        this.consumedIds.delete(b.id);

        // Either could have already been removed by something else (a bomb,
        // a different merge resolved earlier this same frame) between being
        // queued and resolved here.
        if (!this.blocks.hasBlock(a.id) || !this.blocks.hasBlock(b.id)) {
            return;
        }

        const midX = (a.entity.body.position.x + b.entity.body.position.x) / 2;
        const midY = (a.entity.body.position.y + b.entity.body.position.y) / 2;
        const piece = a.piece;
        const nextPiece = this.pieces.getNextTierPiece(piece);

        this.blocks.removeBlock(a);
        this.blocks.removeBlock(b);

        if (!nextPiece) {
            // Top tier + top tier: despawn both, double bonus, no
            // replacement — matches real Suika's watermelon+watermelon.
            this.onMerge?.(undefined, midX, midY, getPiecePoints(piece) * 2);
            return;
        }

        this.blocks.spawnMergedBlock(nextPiece, midX, midY);
        this.onMerge?.(nextPiece, midX, midY, getPiecePoints(nextPiece));
    }

    public clear(): void {
        this.consumedIds.clear();
        this.pending.length = 0;
    }
}
