// PowerupSystem.ts

import type { FaceTowerBlockController } from './FaceTowerBlockController';
import type { FaceTowerBlock, PowerupEffectConfig } from './FaceTowerTypes';

interface Bounds {
    min: { x: number; y: number };
    max: { x: number; y: number };
}

/** World-space (2D physics) point a powerup piece touched a block at — the touched block's own center, not the powerup piece's, since that's where the visual reaction (burst/shake) should anchor. */
export interface PowerupContactPoint {
    x: number;
    y: number;
}

/**
 * Runs the active powerup effect against the live 2D block set — the bomb
 * (destroys the first piece it touches, then removes itself) or the super
 * bomb (destroys everything it touches, falling until it exits the bottom
 * of the column). Dropped exactly like a normal piece (see
 * FaceTowerGameController.spawnPowerup), but
 * FaceTowerBlockController.releaseHeldBlock() makes its body a sensor the
 * instant it's released, so it falls under gravity but passes through
 * everything instead of colliding.
 *
 * trackDroppedPiece() then does two things for the rest of that piece's
 * life, both driven from update() every frame: finds what it touched (via a
 * swept-AABB overlap check — see update() — rather than Matter's
 * collisionStart, since nothing ever slows this piece down and it can
 * easily move farther than a thin piece's own width in a single physics
 * step, tunneling clean past it with no frame where their bounds actually
 * overlap for collisionStart to ever fire), queuing each newly-touched
 * block rather than acting on it on the spot so a run of touches cascades
 * one at a time instead of all resolving at once (see drainQueue()); and
 * watches its own Y position so it can be destroyed the moment it falls
 * past the bottom of the play column (or hits its effect's maxTargets cap
 * — see PowerupEffectConfig — e.g. the bomb exploding after its first hit)
 * — "leaving the scene", which is what ends the effect.
 * FaceTowerGameController gates spawnNextBlock() on isBusy() so the next
 * piece never appears while either the piece is still falling or the queue
 * is still draining.
 */
export class PowerupSystem {
    private activeBlock?: FaceTowerBlock;
    private previousBounds?: Bounds;
    private readonly queue: FaceTowerBlock[] = [];
    private readonly queuedIds = new Set<number>();
    private busy = false;

    public constructor(
        private readonly blocks: FaceTowerBlockController,
        /**
         * Fired the INSTANT a block is queued in update()'s touch-detection
         * loop below — i.e. on contact itself, not once drainQueue() gets
         * around to actually destroying it (which can lag behind by
         * several stepDelay-spaced turns for a piece touching many things
         * at once). Purely a hook for reactive VFX (a particle burst +
         * camera shake — see FaceTowerGameEvents.onPowerupTouch) — has no
         * bearing on the actual destroy logic, which drainQueue() still
         * owns entirely. `actionBlock` is the falling powerup piece itself.
         */
        private readonly onTouch?: (block: FaceTowerBlock, contactPoint: PowerupContactPoint, powerup: PowerupEffectConfig, actionBlock: FaceTowerBlock) => void,
    ) { }

    /** True while a powerup piece is still falling, or its destroy queue still has pieces left to process — see FaceTowerGameController.spawnNextBlock/update. */
    public isBusy(): boolean {
        return this.activeBlock !== undefined || this.busy || this.queue.length > 0;
    }

    /**
     * Call right after a powerup-tagged block is released (see
     * FaceTowerGameController.dropBlock) — starts watching it for touches
     * and bottom-of-column exit via update().
     */
    public trackDroppedPiece(block: FaceTowerBlock): void {
        this.activeBlock = block;
        this.previousBounds = undefined;
    }

    /**
     * Call every frame regardless of state — cheap no-op unless a powerup
     * piece is currently falling.
     *
     * Touch detection: a swept AABB — the union of this frame's bounds and
     * last frame's — checked against every live block's bounds. Using the
     * union (rather than just this frame's bounds) is what catches a fast
     * piece that moved most of the way past something thin between two
     * frames; a same-frame-only check would miss it exactly like
     * collisionStart does.
     *
     * Cap/exit detection: if the effect has a maxTargets cap and this frame
     * just reached it (the bomb, at 1), the piece "explodes" — it's removed
     * right away instead of continuing to fall or scanning for more
     * touches, while the queue keeps draining independently (see isBusy()).
     * Otherwise, once it crosses `deathWorldY` (same bottom-of-column
     * threshold a normal piece's game-over check uses) it's removed
     * outright — quietly "leaving the scene". It's a powerup, not a real
     * piece, so neither of these ever ends the run — unlike a normal block
     * crossing the top game-over line — they just despawn it and that's
     * what ends the effect.
     */
    public update(deathWorldY: number): void {
        if (!this.activeBlock) {
            return;
        }

        const powerup = this.activeBlock.powerup!;
        const currentBounds = this.activeBlock.entity.body.bounds;

        const sweptMinY = this.previousBounds
            ? Math.min(this.previousBounds.min.y, currentBounds.min.y)
            : currentBounds.min.y;
        const sweptMaxY = this.previousBounds
            ? Math.max(this.previousBounds.max.y, currentBounds.max.y)
            : currentBounds.max.y;

        for (const block of this.blocks.getBlocks()) {
            // Skip the piece itself, other powerup pieces, and anything
            // already queued — nothing useful to act on there.
            if (block === this.activeBlock || block.powerup || this.queuedIds.has(block.id)) {
                continue;
            }

            const bounds = block.entity.body.bounds;
            const overlapsX = bounds.max.x >= currentBounds.min.x && bounds.min.x <= currentBounds.max.x;
            const overlapsY = bounds.max.y >= sweptMinY && bounds.min.y <= sweptMaxY;

            if (!overlapsX || !overlapsY) {
                continue;
            }

            this.queuedIds.add(block.id);
            this.queue.push(block);
            this.onTouch?.(block, { x: block.entity.body.position.x, y: block.entity.body.position.y }, powerup, this.activeBlock);
            this.drainQueue(powerup);

            if (powerup.maxTargets !== undefined && this.queuedIds.size >= powerup.maxTargets) {
                this.blocks.removeBlock(this.activeBlock);
                this.activeBlock = undefined;
                this.previousBounds = undefined;
                return;
            }
        }

        this.previousBounds = { min: { ...currentBounds.min }, max: { ...currentBounds.max } };

        if (this.activeBlock.entity.body.position.y > deathWorldY) {
            this.blocks.removeBlock(this.activeBlock);
            this.activeBlock = undefined;
            this.previousBounds = undefined;
        }
    }

    /**
     * Works through the queue one block at a time, destroying each.
     * Re-entrancy-safe: a call that finds `busy` already true (an earlier
     * drain is mid-flight) just returns — that in-flight loop's `while`
     * condition picks up anything pushed to the queue meanwhile, so
     * touches arriving mid-drain still get processed in order without
     * starting a second concurrent loop.
     */
    private async drainQueue(powerup: PowerupEffectConfig): Promise<void> {
        if (this.busy) {
            return;
        }

        this.busy = true;

        while (this.queue.length > 0) {
            const block = this.queue.shift()!;
            this.blocks.removeBlock(block);
            await PowerupSystem.wait(powerup.stepDelay);
        }

        this.busy = false;

        // Clean up this effect's bookkeeping the instant it finishes — the
        // touched-block id set is per-run state, not global, so the next
        // powerup dropped on the same live blocks can still affect them.
        this.queue.length = 0;
        this.queuedIds.clear();
    }

    private static wait(seconds: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }

    public clear(): void {
        this.activeBlock = undefined;
        this.previousBounds = undefined;
        this.queue.length = 0;
        this.queuedIds.clear();
        this.busy = false;
    }

    public destroy(): void {
        this.clear();
    }
}
