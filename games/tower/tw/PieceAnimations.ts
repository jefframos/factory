// PieceAnimations.ts

export interface PieceAnimPose {
    scaleX: number;
    scaleY: number;
    rotation: number;
}

const IDENTITY: PieceAnimPose = { scaleX: 1, scaleY: 1, rotation: 0 };

/**
 * Static, stateless animation math for pieces — a caller owns its own
 * countdown timer (seconds remaining, one per animation kind), counts it
 * down itself each frame, and samples the matching method with whatever's
 * left. Both settle back to IDENTITY once remaining <= 0, so applying the
 * result on top of the view's own position/rotation sync is always safe,
 * triggered or not. See FaceTowerBlockController (2D) and TowerBlockSync3D
 * (3D) for the two call sites.
 */
export class PieceAnimations {
    /** Single stretch-then-settle bounce on scale to sell the launch — trigger once the instant a piece is released. */
    static readonly SHOOT_DURATION = 0.18;
    private static readonly SHOOT_SCALE_AMPLITUDE = 0.25;

    /** Decaying squash + wiggle — trigger once on the piece's first physical contact with anything, and never again after. */
    static readonly JIGGLE_DURATION = 0.35;
    private static readonly JIGGLE_FREQUENCY = 3;
    private static readonly JIGGLE_ROTATION_AMPLITUDE = 0.12;
    private static readonly JIGGLE_SQUASH_AMPLITUDE = 0.18;

    static sampleShoot(remaining: number): PieceAnimPose {
        if (remaining <= 0) {
            return IDENTITY;
        }

        const t = 1 - remaining / PieceAnimations.SHOOT_DURATION;
        const pulse = Math.sin(t * Math.PI); // one hump: 0 -> 1 -> 0 across the duration

        return {
            scaleX: 1 - pulse * PieceAnimations.SHOOT_SCALE_AMPLITUDE,
            scaleY: 1 + pulse * PieceAnimations.SHOOT_SCALE_AMPLITUDE,
            rotation: 0,
        };
    }

    static sampleJiggle(remaining: number): PieceAnimPose {
        if (remaining <= 0) {
            return IDENTITY;
        }

        const t = 1 - remaining / PieceAnimations.JIGGLE_DURATION;
        const decay = 1 - t;
        const wave = Math.sin(t * Math.PI * 2 * PieceAnimations.JIGGLE_FREQUENCY) * decay;

        return {
            scaleX: 1 + wave * PieceAnimations.JIGGLE_SQUASH_AMPLITUDE,
            scaleY: 1 - wave * PieceAnimations.JIGGLE_SQUASH_AMPLITUDE,
            rotation: wave * PieceAnimations.JIGGLE_ROTATION_AMPLITUDE,
        };
    }
}
