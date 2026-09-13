// FaceTowerTypes.ts

import type { BasePhysicsEntity } from 'core/phyisics/entities/BaseEntity';
import type { PieceDefinition } from './PieceStorage';

export enum FaceTowerState {
    Initialising = 'initialising',
    MovingBlock = 'moving-block',
    DroppingBlock = 'dropping-block',
    /** A powerup's async destroy queue is still draining — see PowerupSystem.isBusy(). Next block spawns once it empties. */
    PowerupEffect = 'powerup-effect',
    /** A level-up notification is up (see IslandViewScene's LevelUpNotification) — the trapdoor sequence already finished, but the next piece deliberately isn't spawned yet, so the board just sits as-is behind the popup. Exits back to MovingBlock only via FaceTowerGameController.resumeAfterLevelUpNotification(), called once the popup is actually dismissed. */
    WaitingForNotification = 'waiting-for-notification',
    /** Brief cosmetic beat the instant a weight milestone is reached, before the floor is actually destroyed — game-over-line check is paused. See TowerTrapdoorController. */
    TrapdoorOpening = 'trapdoor-opening',
    /** The old floor is gone, the pile is free-falling (merges keep firing normally the whole time), and the camera is panning down to the new floor — game-over-line check stays paused. See TowerTrapdoorController. */
    TrapdoorFalling = 'trapdoor-falling',
    /** The new floor is placed and the camera's done panning, but the pile hasn't been given a beat to actually finish settling yet — game-over-line check (and, on a level-up, the popup itself) both wait out FaceTowerConfig.trapdoorSettleDelay before anything happens. See FaceTowerGameController.update()/finishTrapdoor(). */
    TrapdoorSettling = 'trapdoor-settling',
    GameOver = 'game-over',
}

/**
 * What a powerup's dropped piece does to each block it touches, and how
 * many it's allowed to affect before it also removes itself — see
 * PowerupSystem. 'destroy' (bomb/super-bomb) is the only kind left —
 * freeze/shrink were trimmed out entirely, so there's no `action`
 * discriminant anymore, just the destroy-specific tuning fields.
 */
export interface PowerupEffectConfig {
    /** Seconds between destroying each additional queued block, so a run of simultaneous touches cascades one at a time instead of all vanishing at once. */
    stepDelay: number;
    /** Max blocks this can destroy before it also removes itself right away instead of continuing to fall — 1 for the single-target bomb, omit for unlimited (the super bomb, destroying everything it touches until it exits the bottom). */
    maxTargets?: number;
    /** Overrides FaceTowerConfig.dropForceY for this piece's release — e.g. a bigger downward kick. */
    dropForceY?: number;
}

export interface FaceTowerBlock {
    id: number;
    /** BoxEntity for a plain rect piece, PolygonEntity when the piece has a `polygon` override — see FaceTowerBlockController.spawnHeldBlock/spawnMergedBlock. */
    entity: BasePhysicsEntity;
    /** Which piece (color/texture/scale/tier/weight) this block was spawned from — see PieceManager. */
    piece: PieceDefinition;
    /** Seconds left in the one-shot "shoot" bounce (see PieceAnimations.sampleShoot) — set on release/merge-spawn. */
    shootRemaining: number;
    /** Seconds left in the one-shot "jiggle" wiggle (see PieceAnimations.sampleJiggle) — set on first physical contact, once ever. */
    jiggleRemaining: number;
    /** True once this block's first-hit jiggle has already fired — prevents every subsequent collision from re-triggering it. Also gates whether it counts toward getHighestTopWorldY()/the board's total weight (a still-falling piece that hasn't touched anything yet shouldn't count as "built" height/weight). */
    hasJiggled: boolean;
    /**
     * Seconds left before this block is eligible to merge again — set to
     * FaceTowerConfig.mergeGraceDuration on a fresh merge-result (see
     * FaceTowerBlockController.spawnMergedBlock), 0 for a normally dropped
     * piece (which merges as soon as it touches a same-tier neighbor, same
     * as before). TowerMergeController.notifyTouch() ignores a touch while
     * either side is still in grace — without it, a merge that spawns
     * touching a THIRD same-tier piece instantly chains again in the same
     * physics step, which reads as everything collapsing at once instead
     * of a readable sequence of individual merges.
     */
    mergeGraceRemaining: number;
    /**
     * Set only for a powerup's dropped piece (see PowerupSystem). Its body
     * becomes a sensor the instant it's released (see
     * FaceTowerBlockController.releaseHeldBlock) — falls under gravity but
     * passes through everything instead of colliding — and it never settles
     * into the tower: PowerupSystem destroys it once it falls past the
     * bottom of the play column (or hits its maxTargets cap), ending the
     * effect. Never merges, never counts toward the board's total weight.
     */
    powerup?: PowerupEffectConfig;
}

export interface FaceTowerConfig {
    // Screen-space anchors (design-space pixels, Game.DESIGN_WIDTH/HEIGHT).
    // The camera keeps these fixed on screen no matter how tall/deep the
    // tower's own physics world gets.
    spawnScreenY: number;
    floorScreenY: number;
    deathScreenY: number;

    /**
     * Top-edge Y (design-space px) the 4-slot top powerup row sits at —
     * see TopPowerupSlots/GameHud.layout(). Shared by both the left and
     * right pair; there's no per-slot Y, only this one knob.
     */
    powerupSlotsScreenY: number;

    /**
     * Opposite orientation from deathScreenY, near the TOP of the screen —
     * the settled pile crossing this line and staying there (see
     * gameOverGraceDuration) ends the run. Fixed on screen forever —
     * trapdoors only ever buy more room BELOW it, never move it.
     */
    gameOverLineScreenY: number;
    /**
     * Seconds the pile's own top must stay at/above gameOverLineScreenY
     * before the run actually ends. A piece merely falling past the line
     * mid-drop doesn't count — getHighestTopWorldY() already excludes any
     * block that hasn't had its first real contact yet (see
     * FaceTowerBlock.hasJiggled), so only a piece that's actually landed
     * and stayed can trip this.
     */
    gameOverGraceDuration: number;

    /**
     * `true` (the default): a plain tap/click immediately repositions the
     * held piece under the pointer before dropping it — the original
     * behavior. `false`: a tap-and-release with no drag in between just
     * drops the piece exactly where it already was, and only an actual
     * swipe/drag repositions it — see FaceTowerInputController.onPointerDown().
     * Kept togglable rather than picking one outright since testers were
     * split on which felt right.
     */
    tapMovesPieceOnDrop: boolean;

    minBlockX: number;
    maxBlockX: number;

    blockWidth: number;
    blockHeight: number;

    floorWidth: number;
    floorHeight: number;
    floorX: number;
    floorY: number;

    /**
     * Fallback timer (seconds): how long to wait after a drop for the
     * released piece's own first physical contact (hasJiggled) before
     * spawning the next piece anyway — covers a piece that somehow never
     * touches anything before reaching the floor.
     */
    dropWaitFallbackTimeout: number;

    /**
     * Seconds a freshly-merged piece is immune to merging again — see
     * FaceTowerBlock.mergeGraceRemaining. Purely a pacing knob: without it,
     * a cascade (merge result immediately touching a third same-tier piece)
     * resolves within the same instant, which reads as the whole pile
     * collapsing at once rather than a readable chain of individual pops.
     */
    mergeGraceDuration: number;

    /**
     * Extra world-px margin, on top of two pieces' own approximate radii
     * (see FaceTowerBlockController.getPieceRadius), that still counts as
     * "touching" for TowerMergeProximityController's forgiving safety-net
     * scan — a same-tier pair whose CENTERS are within
     * radiusA + radiusB + this gets merged even if Matter's real
     * collisionStart event never fired for that specific pair (which can
     * happen when many bodies settle/overlap almost simultaneously, e.g.
     * right as a trapdoor's chaotic multi-body fall lands on the new
     * floor). 0 disables the safety net entirely, falling back to only the
     * exact collision-event path.
     */
    mergeProximityMargin: number;

    cameraPanSpeed: number;

    // Matter.js world gravity (y is downward-positive, same as Matter's default).
    gravityX: number;
    gravityY: number;

    // Extra impulse applied to a block the instant it's released, on top of
    // gravity. Zero means "just drop it" — positive dropForceY nudges it down
    // faster, dropForceX can be used for a sideways toss.
    dropForceX: number;
    dropForceY: number;

    // Solid (non-sensor) bumper rails flush against the base's edges — keep
    // blocks contained in the build column under normal play. Their height
    // always reaches at least containmentTopBuffer past the fixed
    // gameOverLineScreenY (see FaceTowerGameController's wall-height
    // computation) — NOT a fraction of trapdoorDropHeight/zone size — so
    // nothing can ever tip/roll sideways out of the column under normal
    // play, regardless of pile height or which zone/level is active.
    wallWidth: number;

    /**
     * Extra world-px margin the containment walls extend ABOVE the fixed
     * gameOverLineScreenY — see FaceTowerGameController's wall-height
     * computation (floorScreenY - gameOverLineScreenY + this). Also reused
     * as the margin the walls extend below the NEW floor's landing point
     * while a trapdoor's pile is still mid-fall (see
     * TowerTrapdoorController.openFloor()) so the walls stay solid and
     * unbroken for the ENTIRE fall, not just the steady-state span — the
     * game's invariant is that entities never leave the play column, fall
     * included.
     */
    containmentTopBuffer: number;

    // Manual vertical nudge (world px, +down) for the walls' position on
    // top of the flush-with-base-top placement — see
    // TowerDeadZoneController.rebuild(). Plain additive fudge factor for
    // when the flush math doesn't quite read right visually, instead of
    // re-deriving the "correct" offset from wall/base geometry.
    wallOffsetY: number;

    // Invisible sensor strips beyond the walls (and one under the base).
    // Only reachable if something gets knocked past a wall, e.g. mid
    // trapdoor-fall — touching one ends the run immediately.
    deadZoneWidth: number;

    /**
     * How far (world px) the pile free-falls once a weight milestone opens
     * the trapdoor, before a fresh floor is placed under it — see
     * TowerTrapdoorController. The new floor lands exactly this far below
     * the old one's own Y.
     */
    trapdoorDropHeight: number;
    /** Seconds of cosmetic lead-in once a weight milestone is reached, before the floor is actually destroyed — see TowerTrapdoorController's 'opening' phase. Also the duration of the two-flap swing-open animation (see floorFlapOpenAngle) — lengthened from the old silent-countdown default so the swing actually reads on screen. */
    trapdoorOpenDuration: number;
    /**
     * Seconds to wait, once the new floor is placed and the camera's done
     * panning, before actually resuming play — see the new
     * FaceTowerState.TrapdoorSettling and FaceTowerGameController.
     * finishTrapdoor(). Gives the pile (still bouncing from the fall,
     * especially with a bouncier restitution) a beat to visibly finish
     * landing before either the next piece spawns or — on a level-up —
     * the popup itself appears; without this the popup could show (and
     * the board could even end the run) while pieces were still visibly
     * crashing down.
     */
    trapdoorSettleDelay: number;

    /**
     * Minimum pieces that must be dropped in a zone before its weight
     * milestone is allowed to trigger the trapdoor, even if
     * TowerZoneController.hasReachedWeight() is already satisfied — see
     * FaceTowerGameController.checkWeightMilestone()/dropsThisZone.
     * Without this, a single big cascade (merging conserves/compounds
     * weight, never reduces it) could clear an entire zone's milestone in
     * one lucky merge, which feels great in the moment but skips playing
     * the zone at all — this keeps that big merge rewarding without
     * letting it alone instantly end the zone.
     */
    minDropsPerZone: number;

    /**
     * Idle-rest tilt (radians, magnitude only) for each floor flap — see
     * FaceTowerBlockController.addBase()/setFlapAngle(). Each flap is
     * hinged at its own OUTER edge (against the wall), which stays fixed
     * and high; this is how far its INNER edge (toward the center seam)
     * droops below that hinge at rest, forming a shallow V/funnel so
     * pieces roll toward the middle. Applied with an opposite sign per
     * side (left flap tilts +magnitude, right flap -magnitude) so they
     * mirror into a symmetric funnel rather than both tilting the same
     * way.
     */
    floorFlapRestAngle: number;

    /**
     * Full swing-open tilt (radians, magnitude only) each flap rotates to
     * (around that same outer hinge) once a weight milestone triggers the
     * trapdoor — see TowerTrapdoorController's 'opening' phase, which
     * interpolates from floorFlapRestAngle to this over
     * trapdoorOpenDuration before the flap bodies are actually destroyed.
     * Same left/right mirrored sign convention as floorFlapRestAngle.
     */
    floorFlapOpenAngle: number;

    // --- 2D block visuals ---

    // Global fill opacity (0-1) for every 2D block's body — the 3D world
    // renders underneath the 2D overlay, so this is what lets it show
    // through instead of being fully hidden.
    blockFillAlpha: number;
    blockStrokeColor: number;
    blockStrokeWidth: number;

    // Corner radius for the block-body texture — 0 draws a plain square,
    // anything above draws a rounded rect. See BlockBodyTextureCache.
    blockBevelRadius: number;

    // Master toggle for the whole 2D visual layer (blocks/bases/target line)
    // — physics, camera, and score keep running either way; this only hides
    // the Pixi view so you can preview 3D-only. See IslandViewScene.
    render2D: boolean;

    // Master toggle for the whole 3D layer (island cluster, camera, mirrored
    // pieces/bases/poles) — physics, camera tracking math, and score keep
    // running either way; this just skips the THREE render call and hides
    // its canvas, so you can preview 2D-only. See IslandViewScene.update().
    render3D: boolean;

    // Whether newly-spawned blocks draw their piece's face texture on top
    // of the colored/stroked body. Independent of render2D so you can have
    // plain colored boxes without faces even with the 2D layer visible.
    render2DFaces: boolean;

    // Height (world px in 2D, converted via pixelsPerUnit for 3D) of the
    // "landing preview" strip shown at the held piece's own base — a
    // vfx/grad.webp gradient (opaque at the piece, fading to transparent
    // below it) tinted to the piece's color, hinting where it'll land. 0
    // disables it entirely. Width always matches the piece's own visual
    // span (see PieceDefinition.previewOffset for per-piece position
    // tuning, and margin/margin3D below for per-piece width tuning).
    previewStripHeight: number;

    // Insets the strip's WIDTH symmetrically (world px in 2D, world units
    // in 3D) — NOT a gap/offset — same as a CSS margin: a margin of 1
    // removes half a px from the strip's left edge and half from the
    // right, so it stays centered but reads narrower than the piece's own
    // visual span. Stacks with PieceDefinition.margin/margin3D (per-piece).
    previewMargin2D: number;
    previewMargin3D: number;

    // Flat (x, y) nudge (2D world px / 3D world units) applied to EVERY
    // piece's preview strip on top of that piece's own
    // PieceDefinition.previewOffset — for a constant adjustment that
    // doesn't scale with piece dimensions.
    previewGlobalOffset2D: { x: number; y: number };
    previewGlobalOffset3D: { x: number; y: number };

    // --- 3D piece visuals — see PieceBoxBuilder ---

    // Z thickness of a piece's 3D mesh, as a fraction of its shorter
    // width/height — 1 means "as thick as the piece is wide/tall (whichever
    // is smaller)", so pieces read as flat plates rather than long boxes.
    pieceDepthRatio: number;

    // Corner-fillet radius, as a fraction of the piece's shorter
    // width/height — 0 turns off rounding entirely (sharp corners).
    pieceBevelRadiusRatio: number;

    // How far the bevel extrudes outward, as a fraction of
    // min(depth, bevel radius) — 0 turns off the bevel extrude (flat-edged
    // fillet only).
    pieceBevelThicknessRatio: number;
}

export interface TowerZoneResult {
    zoneIndex: number;
}
