// TowerMergeProximityController.ts

import type { FaceTowerBlockController } from './FaceTowerBlockController';
import type { FaceTowerConfig } from './FaceTowerTypes';
import type { TowerMergeController } from './TowerMergeController';

/**
 * A forgiving SAFETY NET on top of TowerMergeController's real collision-event
 * detection (see FaceTowerBlockController.registerCollisionListener/
 * onBlockTouch) — Matter's discrete collisionStart can occasionally miss a
 * pair that's visibly touching, most noticeably right as a trapdoor's
 * chaotic multi-body fall lands a whole pile on the new floor almost all at
 * once (many simultaneous contacts, higher restitution bouncing things back
 * into brief non-contact before settling again — plenty of room for a
 * specific pair's collisionStart to just never fire cleanly).
 *
 * Every frame, scans all live same-tier candidate pairs and treats two as
 * "touching" purely by CENTER-DISTANCE vs. an expanded (approximate radius +
 * FaceTowerConfig.mergeProximityMargin) threshold — no dependency on Matter
 * ever having fired a real collision event for that specific pair — then
 * feeds anything within range into the EXACT SAME
 * TowerMergeController.notifyTouch() the real collision path uses, so
 * dedupe/grace-period/resolution logic is never duplicated, only the
 * "are these two close enough to count" trigger differs.
 *
 * O(n²) per frame, but n is a handful to a few dozen live pieces for this
 * game — trivial at that scale.
 */
export class TowerMergeProximityController {
    public constructor(
        private readonly blocks: FaceTowerBlockController,
        private readonly merges: TowerMergeController,
        private readonly config: FaceTowerConfig,
    ) { }

    public update(): void {
        if (this.config.mergeProximityMargin <= 0) {
            return;
        }

        const heldBlock = this.blocks.getHeldBlock();

        const candidates = this.blocks.getBlocks().filter(block =>
            block !== heldBlock &&
            !block.powerup &&
            block.piece.tier !== undefined &&
            block.mergeGraceRemaining <= 0,
        );

        for (let i = 0; i < candidates.length; i++) {
            const a = candidates[i];

            for (let j = i + 1; j < candidates.length; j++) {
                const b = candidates[j];

                if (a.piece.tier !== b.piece.tier) {
                    continue;
                }

                const dx = a.entity.body.position.x - b.entity.body.position.x;
                const dy = a.entity.body.position.y - b.entity.body.position.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                const threshold =
                    this.blocks.getPieceRadius(a.piece) +
                    this.blocks.getPieceRadius(b.piece) +
                    this.config.mergeProximityMargin;

                if (distance <= threshold) {
                    this.merges.notifyTouch(a, b);
                }
            }
        }
    }
}
