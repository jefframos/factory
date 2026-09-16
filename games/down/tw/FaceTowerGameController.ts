// FaceTowerGameController.ts

import type { BasePhysicsEntity } from 'core/phyisics/entities/BaseEntity';
import * as PIXI from 'pixi.js';
import { FaceTowerBlockController } from './FaceTowerBlockController';
import {
    FaceTowerInputController,
} from './FaceTowerInputController';
import {
    FaceTowerState,
    type FaceTowerBlock,
    type FaceTowerConfig,
    type PowerupEffectConfig,
} from './FaceTowerTypes';
import { GemStorage } from './GemStorage';
import { PieceManager } from './PieceManager';
import { getMergeGemReward, type PieceDefinition } from './PieceStorage';
import { getPowerup } from './PowerupStorage';
import { PowerupSystem, type PowerupContactPoint } from './PowerupSystem';
import { TowerCameraController } from './TowerCameraController';
import { TowerDeadZoneController } from './TowerDeadZoneController';
import { TowerGateController, type GateRequirement } from './TowerGateController';
import { resolveIslandForZone } from './TowerIslandProgression';
import { TowerLevelController, type ZoneAdvanceResult } from './TowerLevelController';
import { TowerMergeController } from './TowerMergeController';
import { TowerMergeProximityController } from './TowerMergeProximityController';
import { TowerPieceUnlockStorage } from './TowerPieceUnlockStorage';
import { TowerTrapdoorController } from './TowerTrapdoorController';
import { TowerZoneController } from './TowerZoneController';

export interface FaceTowerGameEvents {
    onScoreChanged?(score: number): void;
    /**
     * Fired the instant a gate requirement is met and the trapdoor sequence
     * begins (renamed from the old weight-milestone-based version — the
     * trigger is TowerGateController now, see checkGateMilestone(), not a
     * weight threshold; `satisfiedGate` is the requirement that was JUST
     * met, for the "pop away + show an opening lock" celebration beat —
     * see onGateProgressRevealed for the NEXT requirement, revealed later).
     */
    onTrapdoorOpened?(zoneIndex: number, satisfiedGate: GateRequirement): void;
    /** Fired once every zone of the current level is complete and play has rolled over into the next level — see TowerLevelController. Never fires again once the last authored level is reached; its zones just keep repeating. */
    onLevelProgressed?(levelIndex: number): void;
    /**
     * Fired once the CURRENT gate requirement should actually be shown —
     * at run start (see start()), and again `trapdoorSettleDelay` after
     * every onTrapdoorOpened (see finishTrapdoor()), the same beat the
     * level-up popup already waits for. NOT fired at the same instant as
     * onTrapdoorOpened — that event's `satisfiedGate` is the OLD
     * (just-met) requirement; this one is the NEW one to display next.
     */
    onGateProgressRevealed?(requirement: GateRequirement): void;
    /** `topWorldY` is the run's final climbed height (world Y, see getCurrentTopWorldY()) — same value TowerHeightGauge/TowerHeightMarkers3D convert to meters/km for their own display, for the game-over popup to show alongside the score. */
    onGameOver?(score: number, topWorldY: number): void;
    /** Fired the instant a piece is released and physics takes over — the "shoot" moment. See dropBlock(). */
    onBlockDropped?(block: FaceTowerBlock): void;
    /**
     * Fired once per block, on its first physical contact with anything —
     * the "jiggle" moment. `contactPoint` is a best-effort 2D physics
     * position; `hitBlock` is whichever other block was struck (undefined
     * for a base/wall). See FaceTowerBlockController.registerCollisionListener
     * and TowerVfxUtils.onFirstTouchVfx, the intended consumer for VFX tuning.
     */
    onBlockFirstHit?(block: FaceTowerBlock, contactPoint: PowerupContactPoint, hitBlock: FaceTowerBlock | undefined): void;
    /**
     * Fired the instant a powerup piece touches ANY block (before its
     * destroy queue gets around to actually removing it, which can lag
     * behind on a busy touch) — `contactPoint` is the touched block's own
     * 2D physics position. Meant purely for reactive VFX: a particle burst
     * + camera shake for the bomb/super-bomb — see PowerupSystem's own
     * `onTouch` constructor param, which this just forwards. `actionBlock`
     * is the falling powerup piece itself.
     */
    onPowerupTouch?(block: FaceTowerBlock, contactPoint: PowerupContactPoint, powerup: PowerupEffectConfig, actionBlock: FaceTowerBlock): void;
    /** Fired whenever the upcoming piece changes — see spawnNextBlock()/getNextPiece(). Powerups swapped in via spawnPowerup() don't count as "next" and never fire this. */
    onNextPieceChanged?(piece: PieceDefinition): void;
    /**
     * Fired the instant a merge resolves — score is already applied (see
     * handleMerge()) by the time this fires, so this is purely for
     * VFX/popup wiring (see TowerVfxUtils.onScorePopVfx /
     * TowerScorePopupUtils.popAt in IslandViewScene). `resultPiece` is
     * undefined for a top-tier + top-tier despawn (both pieces vanish for a
     * bonus, nothing spawned). (x, y) are 2D physics world coords — the
     * merged pair's midpoint.
     */
    onMerge?(resultPiece: PieceDefinition | undefined, x: number, y: number, points: number): void;
    /**
     * Fired once per piece the 'clear-low-tier' powerup actually removes —
     * see triggerClearLowTierPowerup()/updateLowTierRemovalQueue(). Staggered
     * over time (a start delay, then one every LOW_TIER_REMOVAL_INTERVAL),
     * not all at once, so each firing is its own VFX/SFX beat rather than a
     * single instantaneous burst — see IslandViewScene, which spawns a
     * discard VFX burst + sound per call. (x, y) are the removed block's own
     * 2D physics world position, captured the instant it's actually removed.
     */
    onLowTierPieceRemoved?(x: number, y: number): void;
}

export class FaceTowerGameController {
    /** The first gate's requirement — tier4, the 5th piece (1-indexed: tier0 is "piece 1"). See TowerGateController. */
    private static readonly FIRST_GATE_TIER = 4;

    /** Seconds between the 'clear-low-tier' powerup being used and its first piece actually being removed — see triggerClearLowTierPowerup(). */
    private static readonly LOW_TIER_REMOVAL_START_DELAY = 1;
    /** Seconds between each subsequent removal once the first one fires — see updateLowTierRemovalQueue(). */
    private static readonly LOW_TIER_REMOVAL_INTERVAL = 0.25;

    private readonly camera: TowerCameraController;
    private readonly blocks: FaceTowerBlockController;
    private readonly zones: TowerZoneController;
    private readonly levels: TowerLevelController;
    private readonly deadZones: TowerDeadZoneController;
    private readonly pieces: PieceManager;
    private readonly gates: TowerGateController;
    private readonly powerups: PowerupSystem;
    private readonly merges: TowerMergeController;
    private readonly mergeProximity: TowerMergeProximityController;
    private readonly trapdoor: TowerTrapdoorController;
    private readonly input: FaceTowerInputController;

    private state = FaceTowerState.Initialising;
    private score = 0;

    /** Set true by beginTrapdoor() whenever that milestone also leveled up — read (and cleared) once the trapdoor sequence finishes, to detour into WaitingForNotification instead of spawning the next piece immediately. See finishTrapdoor(). */
    private pendingLevelUpHold = false;
    /** The level just reached, set alongside pendingLevelUpHold — read (and cleared) by finishTrapdoor(), which is what actually fires onLevelProgressed now (see its own doc for why that moved off beginTrapdoor()). */
    private pendingLevelUpIndex?: number;
    /** A piece that was hovering over the drop area when a trapdoor opened out from under it — remembered so it reappears unchanged once play resumes instead of being swapped for a freshly rolled one. See beginTrapdoor()/finishTrapdoor(). */
    private pendingHeldPiece?: PieceDefinition;

    /** Counts down FaceTowerConfig.trapdoorSettleDelay once TrapdoorSettling begins — see update()/finishTrapdoor(). */
    private postTrapdoorSettleTimer = 0;

    /**
     * True from the instant a trapdoor begins until the player's first
     * REAL drop (see dropBlock()) once play resumes — suppresses the
     * top-line game-over check for that whole span (trapdoor open/fall/
     * settle, any level-up popup, and the following piece just hovering),
     * so a still-bouncing just-landed pile — or the board simply sitting
     * there while a popup is up — can never end the run before the player
     * has even had a chance to act on the new zone. See beginTrapdoor()/
     * dropBlock()/update().
     */
    private suppressGameOverUntilDrop = false;

    /**
     * Wall/pole height (px) for the current floor — always enough to reach
     * containmentTopBuffer past the fixed game-over line (see
     * computeContainmentWallHeight()), NOT a fraction of trapdoorDropHeight/
     * zone size. A shorter, zone-derived height used to leave a gap above
     * the walls that a tall pile (or a trapdoor's uncontained mid-fall
     * drift) could tip/roll sideways through into the instant-death dead
     * zones — this game's invariant is that entities never leave the play
     * column at all, so the walls must always physically span the whole
     * reachable column, not just a cosmetic "pole" near the base.
     */
    private currentWallHeight: number;

    /**
     * Highest tier ever produced by a merge this run — drives rollPiece()'s
     * spawn pool (see its own doc) so the range of freshly-droppable pieces
     * widens as the player actually progresses, instead of being tied to
     * how many trapdoors have fired. Starts at 0 (only the lowest tier
     * exists at the run's very start); a top-tier + top-tier despawn (see
     * TowerMergeController, resultPiece undefined) doesn't need to bump
     * this further — reaching that already required the tier below it.
     */
    private maxTierReached = 0;

    /**
     * One-shot per-frame flag: set true in handleMerge() whenever a
     * top-tier + top-tier merge just despawned two pieces (see
     * TowerMergeController's own top-tier-despawn case), consumed (read
     * and reset) once a frame by checkGateMilestone() — only meaningful
     * once TowerGateController is in its "top tier repeat" mode, but set
     * unconditionally since handleMerge() has no reason to know which mode
     * gates is in.
     */
    private topTierMergeHappened = false;

    /** The piece just released, still waited on before the next one spawns — see updateDropWait(). Cleared once its own hasJiggled flips true or the fallback timeout elapses. */
    private droppedBlock?: FaceTowerBlock;
    private dropWaitTimer = 0;

    /** Seconds the pile's top has continuously sat at/above the game-over line — see updateGameOverLine(). */
    private gameOverLineTimer = 0;
    /** Seconds left in a post-powerup grace window — see suppressGameOverBriefly(). While > 0, updateGameOverLine() doesn't run at all (gameOverLineTimer stays reset to 0), so a pile a bomb/trapdoor/discard just disturbed gets a moment to settle before the game-over check resumes. */
    private powerupGameOverGraceTimer = 0;

    /**
     * Blocks still waiting to be removed by the 'clear-low-tier' powerup —
     * see triggerClearLowTierPowerup()/updateLowTierRemovalQueue(). Empty
     * whenever nothing's pending. A block can vanish from the board some
     * other way (merged away, hit by a bomb) while still queued here —
     * updateLowTierRemovalQueue() checks it's still actually live before
     * removing it.
     */
    private pendingLowTierRemovals: FaceTowerBlock[] = [];
    /** Counts down to the next queued removal — see updateLowTierRemovalQueue(). Seeded to LOW_TIER_REMOVAL_START_DELAY when the queue is first filled, then LOW_TIER_REMOVAL_INTERVAL between every removal after that. */
    private lowTierRemovalTimer = 0;

    private targetX: number;
    /** Rolled one spawn ahead — see spawnNextBlock()/rollPiece(). Lets getNextPiece() answer "what's coming after this one" before it actually spawns. */
    private nextPiece?: PieceDefinition;

    public constructor(
        worldRoot: PIXI.Container,
        overlayRoot: PIXI.Container,
        coordinateRoot: PIXI.Container,
        private readonly config: FaceTowerConfig,
        private readonly events: FaceTowerGameEvents = {},
    ) {
        this.targetX =
            (config.minBlockX + config.maxBlockX) * 0.5;

        this.camera = new TowerCameraController(
            worldRoot,
            config.cameraPanSpeed,
        );

        this.blocks = new FaceTowerBlockController(
            worldRoot,
            config,
            this.camera,
            (block, contactPoint, hitBlock) => this.events.onBlockFirstHit?.(block, contactPoint, hitBlock),
            (block, otherBlock) => this.merges.notifyTouch(block, otherBlock),
            (blockId) => this.merges.cancelBlock(blockId),
        );

        this.powerups = new PowerupSystem(
            this.blocks,
            (block, contactPoint, powerup, actionBlock) => this.events.onPowerupTouch?.(block, contactPoint, powerup, actionBlock),
        );

        this.levels = new TowerLevelController();

        const initialZoneConfig = this.levels.getCurrentZoneConfig();
        this.currentWallHeight = this.computeContainmentWallHeight();

        this.zones = new TowerZoneController(this.scaleZoneTargetWeight(initialZoneConfig.weight));

        this.pieces = new PieceManager();
        this.pieces.build();

        this.gates = new TowerGateController(
            FaceTowerGameController.FIRST_GATE_TIER,
            this.pieces.getMaxTier(),
        );

        this.merges = new TowerMergeController(
            this.blocks,
            this.pieces,
            (resultPiece, x, y, points) => this.handleMerge(resultPiece, x, y, points),
        );

        this.mergeProximity = new TowerMergeProximityController(
            this.blocks,
            this.merges,
            config,
        );

        this.deadZones = new TowerDeadZoneController(
            worldRoot,
            config,
        );

        // Deliberately NOT wired to gameOver() any more — the only way the
        // run ends now is the top-line check (see updateGameOverLine()).
        // The containment walls this still builds/rebuilds stay in place
        // (still needed to physically keep pieces in the column); only the
        // instant-death sensor zones' effect is disabled — a piece touching
        // one is now a no-op.

        this.trapdoor = new TowerTrapdoorController(
            this.blocks,
            this.deadZones,
            this.camera,
            config,
            () => resolveIslandForZone(this.levels.getLevelIndex(), this.levels.getZoneIndexInLevel()).island.basePieceId,
        );

        this.input = new FaceTowerInputController(
            overlayRoot,
            coordinateRoot,
            {
                onMove: x => this.moveBlock(x),
                onRelease: () => this.dropBlock(),
            },
            config.tapMovesPieceOnDrop,
        );
    }

    public start(): void {
        this.blocks.initialise(resolveIslandForZone(this.levels.getLevelIndex(), this.levels.getZoneIndexInLevel()).island.basePieceId);
        this.deadZones.rebuild(this.config.floorY, this.currentWallHeight);

        this.score = 0;
        this.events.onScoreChanged?.(this.score);

        // The very first gate requirement — nothing has opened yet, so
        // there's no beginTrapdoor()/finishTrapdoor() beat to fire this
        // from otherwise.
        this.events.onGateProgressRevealed?.(this.gates.getCurrentRequirement());

        this.spawnNextBlock();
    }

    /** Tears the run down and starts a brand-new tower from scratch. */
    public reset(): void {
        this.blocks.destroy();
        this.deadZones.clear();
        this.powerups.clear();
        this.merges.clear();
        this.camera.reset();

        // Rebuilds every tier/level pool from the CURRENT PieceStorage.PIECES
        // — a plain Replay leaves PIECES unchanged so this is a no-op rebuild
        // of the same data, but IslandViewScene's theme toggle calls
        // loadPieces() with a different catalog (see GameThemeStorage)
        // BEFORE this reset(), and without this, `this.pieces` (built once,
        // in the constructor) would keep spawning/showing whatever piece
        // objects were live back then — stale shape/art forever, since
        // loadPieces() replaces PIECES' contents wholesale rather than
        // mutating the same piece objects in place.
        this.pieces.build();

        this.levels.reset();
        // Reset before scaleZoneTargetWeight() reads it below — a fresh
        // run's first zone must use the unscaled, as-authored target, same
        // as the constructor's own initial zone.
        this.maxTierReached = 0;
        this.gates.reset();
        this.topTierMergeHappened = false;

        const zoneConfig = this.levels.getCurrentZoneConfig();
        this.currentWallHeight = this.computeContainmentWallHeight();

        this.zones.reset(this.scaleZoneTargetWeight(zoneConfig.weight));
        this.nextPiece = undefined;
        this.pendingLevelUpHold = false;
        this.pendingLevelUpIndex = undefined;
        this.pendingHeldPiece = undefined;
        this.droppedBlock = undefined;
        this.dropWaitTimer = 0;
        this.gameOverLineTimer = 0;
        this.postTrapdoorSettleTimer = 0;
        this.suppressGameOverUntilDrop = false;

        this.state = FaceTowerState.Initialising;

        this.start();
    }

    public update(delta: number): void {
        this.camera.update(delta);
        this.blocks.update(delta);
        // Runs unconditionally, same as merges.update() itself — merges
        // (real-collision AND proximity-forgiven alike) keep firing through
        // every state, trapdoor fall included.
        this.mergeProximity.update();
        this.merges.update();
        // Also unconditional — a clear-low-tier removal already in
        // progress must keep draining regardless of what other state the
        // run moves through in the meantime (e.g. a real gate opening
        // mid-drain), same reasoning as merges above.
        this.updateLowTierRemovalQueue(delta);

        /*
         * Change this conversion if your engine already supplies milliseconds.
         *
         * Pixi commonly supplies a frame-based delta where approximately
         * 1 means one 60 Hz frame.
         */

        const deathWorldY = this.camera.toWorldY(
            this.config.deathScreenY,
        );

        // Watches for an active powerup piece falling past the bottom of
        // the column — cheap no-op unless one's currently dropped. Run
        // unconditionally (not just during PowerupEffect) since it's the
        // thing that eventually MAKES isBusy() go false below.
        this.powerups.update(deathWorldY);

        if (this.state === FaceTowerState.GameOver) {
            return;
        }

        if (this.state === FaceTowerState.PowerupEffect) {
            if (!this.powerups.isBusy()) {
                this.spawnNextBlock();
            }

            return;
        }

        if (this.trapdoor.isActive()) {
            this.state = this.trapdoor.getPhase() === 'opening'
                ? FaceTowerState.TrapdoorOpening
                : FaceTowerState.TrapdoorFalling;

            if (this.trapdoor.update(delta)) {
                // The floor's placed and the camera's done panning, but
                // don't call finishTrapdoor() yet — give the pile an
                // explicit beat (see FaceTowerConfig.trapdoorSettleDelay)
                // to actually finish crashing down/settling first, so
                // neither the next piece nor a level-up popup appears
                // while things are still visibly falling.
                this.state = FaceTowerState.TrapdoorSettling;
                this.postTrapdoorSettleTimer = this.config.trapdoorSettleDelay;
            }

            // Game-over-line/weight checks are paused for the whole
            // trapdoor sequence — see TowerTrapdoorController's own doc.
            return;
        }

        if (this.state === FaceTowerState.TrapdoorSettling) {
            this.postTrapdoorSettleTimer -= delta;

            if (this.postTrapdoorSettleTimer <= 0) {
                this.finishTrapdoor();
            }

            return;
        }

        // WaitingForNotification falls through here too — deliberately
        // does nothing until resumeAfterLevelUpNotification() is called.
        if (this.state === FaceTowerState.WaitingForNotification) {
            return;
        }

        if (this.state === FaceTowerState.DroppingBlock) {
            this.updateDropWait(delta);
        }

        // See suppressGameOverUntilDrop's own doc — stays true clear
        // through TrapdoorSettling/WaitingForNotification/the following
        // piece just hovering, only clearing on the player's next REAL
        // drop (dropBlock()), so nothing here can end the run before
        // they've had a chance to act on the new zone. Also held off for
        // as long as a clear-low-tier batch is still draining
        // (pendingLowTierRemovals) — the whole point of that powerup is to
        // bring the pile back down; letting the game-over line fire while
        // it's only PARTWAY through removing the queued pieces would be
        // exactly the unfair "used a powerup and still lost anyway" case
        // suppressGameOverBriefly() exists to prevent, just stretched out
        // over the longer staggered duration instead of a single instant.
        if (this.powerupGameOverGraceTimer > 0 || this.pendingLowTierRemovals.length > 0) {
            this.powerupGameOverGraceTimer = Math.max(0, this.powerupGameOverGraceTimer - delta);
        } else if (!this.suppressGameOverUntilDrop && this.updateGameOverLine(delta)) {
            return;
        }

        this.checkGateMilestone();
    }

    public resizeInput(
        x: number,
        y: number,
        width: number,
        height: number,
    ): void {
        this.input.resize(x, y, width, height);
    }

    /** See FaceTowerInputController.setEnabled's own doc — stops the drag/drop input layer from responding at all, independent of whether anything is currently rendering. */
    public setInputEnabled(enabled: boolean): void {
        this.input.setEnabled(enabled);
    }

    public getState(): FaceTowerState {
        return this.state;
    }

    /** How far (design-space px) the 2D camera has scrolled — for pairing a 3D camera to it. */
    public getCameraOffsetY(): number {
        return this.camera.getOffsetY();
    }

    /** Live physics blocks — for mirroring each one as a 3D cube. */
    public getBlocks(): readonly FaceTowerBlock[] {
        return this.blocks.getBlocks();
    }

    /** The piece currently hovering over the drop area (undefined once dropped) — see TowerBlockSync3D's landing-preview strip. */
    public getHeldBlock(): FaceTowerBlock | undefined {
        return this.blocks.getHeldBlock();
    }

    /** The piece that will spawn once the current one is dropped (and, mid-trapdoor, settles) — see spawnNextBlock(). Undefined only before the very first spawn. */
    public getNextPiece(): PieceDefinition | undefined {
        return this.nextPiece;
    }

    /** Every flap base currently placed — practically always exactly two, the current floor's left/right flaps (a trapdoor removes both of the old floor's flaps before the new floor's pair is placed) — see FaceTowerBlockController.addBase(). */
    public getBases() {
        return this.blocks.getBases();
    }

    /** Whichever STATIC_PIECES id `base` actually resolved to — see FaceTowerBlockController.getBasePieceId(), TowerBaseSync3D's sole consumer. */
    public getBasePieceId(base: BasePhysicsEntity): string | undefined {
        return this.blocks.getBasePieceId(base);
    }

    /** Which flap (left/right) `base` is — see FaceTowerBlockController.getFlapSide(), TowerBaseSync3D's sole consumer. */
    public getFlapSide(base: BasePhysicsEntity): 'left' | 'right' | undefined {
        return this.blocks.getFlapSide(base);
    }

    /**
     * World Y of the tower's current top — the highest live (non-powerup)
     * block, or the current base's own Y when nothing's stacked on it yet
     * — see TowerHeightGauge, which converts this to a screen Y and a
     * meters display value.
     */
    public getCurrentTopWorldY(): number {
        const topWorldY = this.blocks.getHighestTopWorldY();

        if (Number.isFinite(topWorldY)) {
            return topWorldY;
        }

        return this.blocks.getCurrentFloorY();
    }

    /** World Y of the fixed top game-over line — same screen position always (see FaceTowerConfig.gameOverLineScreenY), converted through the camera's current pan so 3D/world-space consumers can track it. */
    public getGameOverLineWorldY(): number {
        return this.camera.toWorldY(this.config.gameOverLineScreenY);
    }

    /**
     * Seconds left before a settled piece sitting at/above the game-over
     * line actually ends the run — undefined whenever nothing's currently
     * sitting up there (gameOverLineTimer only ever accumulates from
     * updateGameOverLine(), and is reset to 0 the instant nothing qualifies,
     * including for the whole suppressed trapdoor span). Drives the on-
     * screen countdown/flash warning (see TowerHeightGauge) — purely a
     * display concern, doesn't itself affect whether/when the run ends.
     */
    public getGameOverWarningSecondsRemaining(): number | undefined {
        if (this.gameOverLineTimer <= 0) {
            return undefined;
        }

        return Math.max(0, this.config.gameOverGraceDuration - this.gameOverLineTimer);
    }

    /** Current total board weight — see FaceTowerBlockController.getTotalWeight(). */
    public getTotalWeight(): number {
        return this.blocks.getTotalWeight();
    }

    /** The weight the current zone's trapdoor milestone needs — see TowerZoneController.getTargetWeight(). */
    public getTargetWeight(): number {
        return this.zones.getTargetWeight();
    }

    /** 0..1 fraction of progress toward the current zone's weight milestone — see TowerNextLevelPanel. */
    public getWeightProgress(): number {
        const target = this.zones.getTargetWeight();

        if (target <= 0) {
            return 0;
        }

        return Math.max(0, Math.min(1, this.blocks.getTotalWeight() / target));
    }

    /** The side containment poles for the current floor — see TowerDeadZoneController. */
    public getWalls() {
        return this.deadZones.getWalls();
    }

    /** Current wall/pole height (px) — see computeContainmentWallHeight(). See TowerWallSync3D.sync(). */
    public getWallHeight(): number {
        return this.currentWallHeight;
    }

    /**
     * Always `floorScreenY - gameOverLineScreenY + containmentTopBuffer` —
     * a fixed screen-space span, so the containment walls always reach at
     * least `containmentTopBuffer` past the game-over line regardless of
     * which floor/zone/level is current (the camera keeps floorScreenY
     * pinned to whichever floor is active, so this world-px height is
     * correct relative to ANY settled floor, not just the starting one).
     * Deliberately NOT derived from trapdoorDropHeight/zoneConfig.polePercent
     * any more — that let the walls fall short of the line entirely,
     * leaving a gap a tall pile (or a trapdoor's mid-fall drift) could tip
     * sideways through into the instant-death dead zones.
     */
    private computeContainmentWallHeight(): number {
        return this.config.floorScreenY - this.config.gameOverLineScreenY + this.config.containmentTopBuffer;
    }

    /**
     * levels-config.json's per-zone weight targets were authored against
     * pieces around BASELINE_TIER (piece weight doubles every tier — see
     * pieces-config.json's `weight` field, 1/2/4/8/16/...) and never scale
     * any further past the last authored level (see
     * TowerLevelController.resolveZoneConfig() repeating the last zone
     * forever) even though maxTierReached keeps climbing indefinitely as
     * merges chain higher. Left as pure config, a zone that took dozens of
     * drops early on becomes clearable by a single drop/merge once the
     * player's pieces have grown past whatever the JSON number assumed —
     * the milestone stops reflecting any real, sustained progress. Scaling
     * the configured value by 2^(tiers past baseline) keeps the target
     * moving in lockstep with how heavy the player's OWN pieces have
     * actually gotten, so clearing a zone keeps costing roughly the same
     * number of real drops no matter how far the run has progressed.
     */
    private static readonly BASELINE_TIER_FOR_ZONE_WEIGHT = 1;

    private scaleZoneTargetWeight(configWeight: number): number {
        const tiersPastBaseline = Math.max(
            0,
            this.maxTierReached - FaceTowerGameController.BASELINE_TIER_FOR_ZONE_WEIGHT,
        );

        return configWeight * Math.pow(2, tiersPastBaseline);
    }

    /** 0-based progression tier (see TowerLevelController) — drives the trapdoor/weight-milestone pacing and island/sky theming. No longer what gates the piece spawn pool — see rollPiece()'s own doc, which now scales off maxTierReached instead. */
    public getLevelIndex(): number {
        return this.levels.getLevelIndex();
    }

    /** Highest tier ever produced by a merge THIS run — see maxTierReached's own doc (drives piece-drop-pool/zone-weight scaling, which is meant to reset each run). Not what PieceProgressionBar shows as unlocked — see getMaxTierEverUnlocked() for that. */
    public getMaxTierReached(): number {
        return this.maxTierReached;
    }

    /** Highest tier ever produced across EVERY run, persisted — see TowerPieceUnlockStorage. What PieceProgressionBar actually reads to decide which pieces stay shown as unlocked, so progress there survives a reset. */
    public getMaxTierEverUnlocked(): number {
        return Math.max(this.maxTierReached, TowerPieceUnlockStorage.getMaxTier());
    }

    /** Every real catalog piece, ascending by tier — see PieceManager.getAllPiecesOrderedByTier()/PieceProgressionBar. */
    public getPieceProgression(): readonly PieceDefinition[] {
        return this.pieces.getAllPiecesOrderedByTier();
    }

    /** 0-based zone index within the CURRENT level — resets to 0 every level-up. See TowerIslandProgression.resolveIslandForZone(). */
    public getZoneIndexInLevel(): number {
        return this.levels.getZoneIndexInLevel();
    }

    /** Total zones completed this ENTIRE run — never resets per level (only on a full reset()). See TowerZoneController.getZoneIndex(). */
    public getZoneIndex(): number {
        return this.zones.getZoneIndex();
    }

    /** True once the last authored level (see levels-config.json) has been reached — its zones repeat forever from here on. */
    public isFinalLevel(): boolean {
        return this.levels.isFinalLevel();
    }

    /** How far (km) the CURRENT level's own destination is — levels-config.json's distanceFromPreviousKm, 0 if that level doesn't define one. See getLevelProgressFraction() for scaling this into an in-progress "how far traveled" readout. */
    public getLevelDistanceKm(): number {
        return this.levels.getCurrentLevelConfig()?.distanceFromPreviousKm ?? 0;
    }

    /**
     * 0..1 continuous progress through the CURRENT level's zones —
     * (zoneIndexInLevel + fractional progress toward the current zone's own
     * weight milestone) / zoneCount. Multiply by getLevelDistanceKm() for a
     * live "how far traveled toward this level's destination" value.
     */
    public getLevelProgressFraction(): number {
        const zoneCount = Math.max(1, this.levels.getZoneCount());
        const fraction = (this.levels.getZoneIndexInLevel() + this.getWeightProgress()) / zoneCount;

        return Math.max(0, Math.min(1, fraction));
    }

    public getScore(): number {
        return this.score;
    }

    /** Call after changing block size/bevel/stroke config at runtime — see FaceTowerBlockController.invalidateBodyTexture(). */
    public invalidateBlockTexture(): void {
        this.blocks.invalidateBodyTexture();
    }

    /**
     * Dev-only: swaps whatever's currently hovering over the drop area for
     * `piece` — a no-op unless a block is actually being held (i.e. the
     * player hasn't already dropped it), since there's nothing to replace
     * otherwise. See IslandViewScene.setupPieceDevGui.
     */
    public replaceHeldBlockWithPiece(piece: PieceDefinition): void {
        if (this.state !== FaceTowerState.MovingBlock) {
            return;
        }

        this.blocks.discardHeldBlock();
        this.blocks.spawnHeldBlock(this.targetX, piece);
    }

    /**
     * Dev-only: swaps whatever's currently hovering over the drop area for
     * `powerupId`'s own embedded shape (see PowerupDefinition.piece) — same
     * guard and mechanics as replaceHeldBlockWithPiece, plus tagging the
     * held block as a powerup so releaseHeldBlock/PowerupSystem treat it
     * specially once dropped. `id`/`level` are synthesized since the
     * embedded shape doesn't carry them (see PowerupDefinition.piece's
     * doc). Unknown ids no-op. See PowerupDevGui.
     */
    public spawnPowerup(powerupId: string): void {
        if (this.state !== FaceTowerState.MovingBlock) {
            return;
        }

        const powerup = getPowerup(powerupId);

        if (!powerup) {
            return;
        }

        const piece: PieceDefinition = {
            id: `powerup-${powerup.id}`,
            level: 0,
            ...powerup.piece,
        };

        this.blocks.discardHeldBlock();
        this.blocks.spawnHeldBlock(this.targetX, piece);

        this.blocks.markHeldBlockAsPowerup({
            // Only 'drop'-type powerups ever reach spawnPowerup() (see
            // IslandViewScene.useHudPowerup()'s branch on powerup.type), so
            // destroyStepDelay is always actually set in practice — the
            // fallback is purely to satisfy PowerupEffectConfig.stepDelay's
            // non-optional type.
            stepDelay: powerup.destroyStepDelay ?? 0.1,
            maxTargets: powerup.maxTargets,
            dropForceY: powerup.dropForceY,
        });
    }

    /**
     * 'trapdoor' (type: 'instant') — no longer a cosmetic physics rattle
     * (see git history for the old FaceTowerBlockController.applyWindEffect(),
     * back when this powerup was still called 'wind'): drops the CURRENT
     * floor immediately, exactly like a real gate requirement being met,
     * EXCEPT it does NOT actually satisfy/advance that requirement — the
     * same gate/zone/level/target-weight threshold stays active afterward,
     * so the player is still working toward the exact same goal, just from
     * a freshly-dropped floor. Routed through beginTrapdoor(false) — see
     * its own doc for exactly what that skips (gates.advance(),
     * levels.advanceZone(), zones.completeZone(), onTrapdoorOpened's "zone
     * complete" celebration) versus what still runs either way (the actual
     * floor-drop animation, held-piece discard, next-piece reroll). A no-op
     * while a trapdoor is already mid-sequence or the run has ended, same
     * guard devSkipZone()/devSkipLevel() use.
     */
    public triggerTrapdoorPowerup(): void {
        if (this.state === FaceTowerState.GameOver || this.trapdoor.isActive()) {
            return;
        }

        this.beginTrapdoor(false);
    }

    /**
     * 'clear-low-tier' (type: 'instant') — queues every live tier-0/1/2
     * block for removal (see FaceTowerBlockController.getBlocksByTiers())
     * rather than removing them all in the same instant: the first one
     * actually goes LOW_TIER_REMOVAL_START_DELAY seconds from now, then one
     * more every LOW_TIER_REMOVAL_INTERVAL seconds after that — see
     * updateLowTierRemovalQueue(), which drains this queue from update().
     * Each individual removal fires onLowTierPieceRemoved (see
     * IslandViewScene, which spawns a VFX burst + sound per call) instead of
     * one synchronous batch, so the clear reads as a staggered sweep rather
     * than every low-tier piece popping at once.
     *
     * A second tap while a batch is still draining just appends any NEWLY
     * qualifying blocks to the same queue/timer rather than starting a
     * second independent one — canUsePowerupRightNow()'s hasLowTierBlocks()
     * check already keeps this from happening in practice (nothing left to
     * queue once everything qualifying is already queued), but staying
     * append-only here means it can't ever double-queue the same block
     * either way.
     */
    public triggerClearLowTierPowerup(): void {
        const queued = this.blocks.getBlocksByTiers([0, 1, 2]).filter(
            block => !this.pendingLowTierRemovals.includes(block),
        );

        if (queued.length === 0) {
            return;
        }

        const wasEmpty = this.pendingLowTierRemovals.length === 0;
        this.pendingLowTierRemovals.push(...queued);

        if (wasEmpty) {
            this.lowTierRemovalTimer = FaceTowerGameController.LOW_TIER_REMOVAL_START_DELAY;
        }
    }

    /**
     * Drains pendingLowTierRemovals one block at a time — see
     * triggerClearLowTierPowerup()'s own doc for the start-delay/interval
     * shape. Skips (without consuming a timer tick) a queued block that's
     * already gone some OTHER way (merged away, hit by a bomb) in the
     * meantime, rather than firing a VFX/SFX beat for a piece that isn't
     * there any more.
     */
    private updateLowTierRemovalQueue(delta: number): void {
        if (this.pendingLowTierRemovals.length === 0) {
            return;
        }

        this.lowTierRemovalTimer -= delta;

        if (this.lowTierRemovalTimer > 0) {
            return;
        }

        this.lowTierRemovalTimer = FaceTowerGameController.LOW_TIER_REMOVAL_INTERVAL;

        const block = this.pendingLowTierRemovals.shift();

        if (!block || !this.blocks.getBlocks().includes(block)) {
            return;
        }

        const { x, y } = block.entity.body.position;
        this.blocks.removeBlock(block);
        this.events.onLowTierPieceRemoved?.(x, y);
    }

    /**
     * Call right after ANY powerup is actually used (see
     * IslandViewScene.confirmPendingPowerup()) — resets the game-over grace
     * timer to 0 and holds updateGameOverLine()'s per-frame check off for
     * `seconds` more real-time seconds, so a pile a bomb/trapdoor/discard
     * just disturbed gets a moment to settle before the game-over line can
     * start counting against the player again. Purely a delay: whether the
     * timer actually starts climbing once the window ends still depends
     * entirely on updateGameOverLine()'s own live check against the current
     * pile — this doesn't force a game over OR force a reprieve, only
     * defers WHEN that check resumes.
     */
    public suppressGameOverBriefly(seconds: number): void {
        this.gameOverLineTimer = 0;
        this.powerupGameOverGraceTimer = Math.max(this.powerupGameOverGraceTimer, seconds);
    }

    /**
     * 'destroy-piece' (type: 'target') — removes whichever live block
     * `blockId` refers to outright. A no-op if that id no longer exists
     * (e.g. it merged/got removed between the player tapping it in
     * PieceTargetingOverlay and this actually running), resolves to a
     * powerup piece, or is the currently-HELD block (PieceTargetingOverlay
     * already excludes it from ever being tapped — see its own doc — this
     * is just defense in depth, since removing it here without clearing
     * FaceTowerBlockController's own heldBlock reference would leave that
     * dangling and break the next spawn).
     */
    public destroyBlock(blockId: number): void {
        const block = this.blocks.getBlocks().find(candidate => candidate.id === blockId);

        if (!block || block.powerup || block.state === 'held') {
            return;
        }

        this.blocks.removeBlock(block);
    }

    /**
     * 'upgrade-piece' (type: 'target') — replaces `blockId`'s block with
     * the next tier up, in place, exactly like a real self-merge (see
     * TowerMergeController.resolvePair, the same remove-then-spawnMergedBlock
     * pair) — including bumping maxTierReached/TowerPieceUnlockStorage the
     * same way a real merge does, so PieceProgressionBar stays consistent.
     * Deliberately does NOT go through handleMerge()/award score or fire
     * onMerge — this is a utility action, not something the player
     * "earned" by playing. A no-op if the block no longer exists, is a
     * powerup, or is already the top tier (nextPiece undefined).
     */
    /** True if `block` has a next tier to upgrade into — false for the top-tier piece, which upgradeBlock() already safely no-ops for. Used by PieceTargetingOverlay to skip showing an upgrade marker on a block tapping it would do nothing to. */
    public canUpgradeBlock(block: FaceTowerBlock): boolean {
        return this.pieces.getNextTierPiece(block.piece) !== undefined;
    }

    public upgradeBlock(blockId: number): void {
        const block = this.blocks.getBlocks().find(candidate => candidate.id === blockId);

        if (!block || block.powerup || block.state === 'held') {
            return;
        }

        const nextPiece = this.pieces.getNextTierPiece(block.piece);

        if (!nextPiece) {
            return;
        }

        const { x, y } = block.entity.body.position;

        this.blocks.removeBlock(block);
        this.blocks.spawnMergedBlock(nextPiece, x, y);

        if (nextPiece.tier !== undefined) {
            this.maxTierReached = Math.max(this.maxTierReached, nextPiece.tier);
            TowerPieceUnlockStorage.recordTier(nextPiece.tier);
        }
    }

    /** True only while a piece is actively hovering/falling toward the drop area — the same guard spawnPowerup()/skipHeldPiece()/replaceHeldBlockWithPiece() already enforce internally, exposed so a HUD button can grey itself out instead of silently no-opping on click. */
    public canUsePowerup(): boolean {
        return this.state === FaceTowerState.MovingBlock;
    }

    /**
     * True while at least one live, non-powerup, non-held block is actually
     * on the board — see IslandViewScene.canUsePowerupRightNow(), which
     * gates the trapdoor powerup (dropping the floor with nothing standing
     * on it does nothing worth doing) and the two target-type powerups
     * (destroy-piece/upgrade-piece — nothing to enter targeting mode FOR
     * otherwise) on this. Same 'held' exclusion getBlocksByTiers() uses:
     * the piece still hovering, waiting to be dropped, isn't really "on the
     * board" yet.
     */
    public hasAnyBlocks(): boolean {
        return this.blocks.getBlocks().some(block => !block.powerup && block.state !== 'held');
    }

    /** True while at least one live, non-powerup, non-held block sits in tier 0/1/2 — see IslandViewScene.canUsePowerupRightNow(), which gates the clear-low-tier powerup on this (nothing for it to actually clear otherwise). Mirrors getBlocksByTiers([0, 1, 2])'s own filter exactly. */
    public hasLowTierBlocks(): boolean {
        return this.blocks.getBlocks().some(
            block => !block.powerup && block.state !== 'held' &&
                block.piece.tier !== undefined && [0, 1, 2].includes(block.piece.tier),
        );
    }

    /**
     * Swaps the currently-held piece for the one already queued as "next"
     * (skipping straight to it instead of waiting to drop the current one),
     * then rolls a fresh "next" — see the in-game skip-piece HUD button.
     * Reuses replaceHeldBlockWithPiece()'s own MovingBlock guard, so this is
     * a no-op at any other time.
     */
    public skipHeldPiece(): void {
        if (this.state !== FaceTowerState.MovingBlock) {
            return;
        }

        const piece = this.nextPiece ?? this.rollPiece();
        this.replaceHeldBlockWithPiece(piece);

        this.nextPiece = this.rollPiece();
        this.events.onNextPieceChanged?.(this.nextPiece);
    }

    /**
     * Call once the level-up popup has actually been dismissed (see
     * IslandViewScene's LevelUpNotification.onCollect) — resumes play by
     * spawning the next piece. No-op unless the game is genuinely sitting
     * in WaitingForNotification (e.g. a stray second call), so this is safe
     * to call defensively.
     */
    public resumeAfterLevelUpNotification(): void {
        if (this.state !== FaceTowerState.WaitingForNotification) {
            return;
        }

        this.spawnNextBlock();
    }

    public destroy(): void {
        this.input.destroy();
        this.blocks.destroy();
        this.deadZones.clear();
        this.powerups.destroy();
        this.merges.clear();

        this.state = FaceTowerState.GameOver;
    }

    /**
     * Resumes play after a collapse WITHOUT resetting the tower — clears out
     * the entire BOTTOM HALF of the play column (not just whatever actually
     * fell past the death line) and spawns the next piece as normal, leaving
     * score and everything still standing untouched. A no-op unless
     * currently GameOver.
     *
     * Clearing only what's already past the death line (the old behavior)
     * left the pile sitting almost exactly where it was the instant it
     * died — right at/above the game-over line — so a respawn would very
     * often collapse again within a piece or two. Clearing the bottom half
     * of the whole column (from the fixed top game-over line down to the
     * current floor) gives the player genuine breathing room to actually
     * keep playing instead of just delaying the same loss by one drop.
     *
     * TODO: this is meant to be gated behind a rewarded ad — IslandViewScene's
     * "Continue" button currently calls this directly with no ad in front
     * of it yet.
     */
    public continueRun(): FaceTowerBlock[] {
        if (this.state !== FaceTowerState.GameOver) {
            return [];
        }

        const gameOverLineWorldY = this.getGameOverLineWorldY();
        const floorWorldY = this.camera.toWorldY(this.config.floorScreenY);
        const bottomHalfWorldY = (gameOverLineWorldY + floorWorldY) / 2;

        for (const block of [...this.blocks.getBlocks()]) {
            if (!block.powerup && block.entity.body.position.y > bottomHalfWorldY) {
                this.blocks.removeBlock(block);
            }
        }

        /*
         * The collapse can be caused by an OLDER, already-placed piece
         * toppling into a dead zone well after it settled — completely
         * unrelated to whatever's currently held (state stays MovingBlock
         * the whole time, since only the dropped/settled path ever reaches
         * GameOver via the dead-zone sensors). gameOver() doesn't discard
         * that held block, so without this, spawnNextBlock() below would
         * throw straight into spawnHeldBlock()'s "already holding one"
         * guard. Safe to call unconditionally — a no-op if nothing's
         * actually held.
         */
        this.blocks.discardHeldBlock();
        this.gameOverLineTimer = 0;

        // spawnNextBlock() itself bails whenever state === GameOver, so
        // clear that first — it overwrites state again immediately anyway.
        this.state = FaceTowerState.MovingBlock;
        this.spawnNextBlock();

        return this.blocks.getBlocks() as FaceTowerBlock[];
    }

    private moveBlock(x: number): void {
        if (this.state !== FaceTowerState.MovingBlock) {
            return;
        }

        this.targetX = x;
        this.blocks.moveHeldBlock(x);
    }

    private dropBlock(): void {
        if (this.state !== FaceTowerState.MovingBlock) {
            return;
        }

        const releasedBlock = this.blocks.releaseHeldBlock();

        if (!releasedBlock) {
            return;
        }

        // A real drop — re-arms the game-over check (see
        // suppressGameOverUntilDrop's own doc), whether this piece is a
        // normal drop or a powerup.
        this.suppressGameOverUntilDrop = false;

        this.events.onBlockDropped?.(releasedBlock);

        if (releasedBlock.powerup) {
            /*
             * A powerup piece never settles into the tower — it just keeps
             * falling (as a sensor — see releaseHeldBlock) until
             * PowerupSystem removes it past the bottom of the column, so it
             * skips DroppingBlock entirely. Parking in PowerupEffect
             * immediately gates the next spawn on powerups.isBusy() (see
             * update()) the same way it would if this state were reached
             * from spawnNextBlock() instead.
             */
            this.state = FaceTowerState.PowerupEffect;
            this.powerups.trackDroppedPiece(releasedBlock);
            return;
        }

        this.state = FaceTowerState.DroppingBlock;
        this.droppedBlock = releasedBlock;
        this.dropWaitTimer = 0;
    }

    /**
     * Replaces the old "wait until the whole pile is fully still"
     * TowerStabilityController gate — a merge game wants the next piece to
     * drop while things are still gently settling, not once every last
     * piece has stopped moving. All that's actually needed is: wait until
     * the just-released piece's own first real contact (hasJiggled), or a
     * fixed fallback timeout for a piece that somehow never touches
     * anything before reaching the floor.
     */
    private updateDropWait(delta: number): void {
        this.dropWaitTimer += delta;

        if (!this.droppedBlock || this.droppedBlock.hasJiggled || this.dropWaitTimer >= this.config.dropWaitFallbackTimeout) {
            this.droppedBlock = undefined;
            this.spawnNextBlock();
        }
    }

    /**
     * Continuous top-line game-over check — runs every frame during
     * MovingBlock/DroppingBlock (paused during the trapdoor sequence/
     * WaitingForNotification/GameOver, see update()). getHighestTopWorldY()
     * already excludes anything that hasn't had its own first physical
     * contact yet, so a piece merely falling past the line mid-drop never
     * counts — only a piece that's actually landed and STAYED there does.
     * Returns true the instant this actually ends the run.
     */
    private updateGameOverLine(delta: number): boolean {
        // getHighestTopWorldY() already excludes the held piece and
        // anything that hasn't had its first real contact yet (still
        // falling through on its initial drop) — see its own doc for why
        // it does NOT also require the block to currently be at rest: a
        // piece already at the line must keep counting even while a new
        // arrival jostles it, only actually leaving the line (or the
        // board) should reset this timer.
        const topWorldY = this.blocks.getHighestTopWorldY();
        const lineWorldY = this.getGameOverLineWorldY();

        if (Number.isFinite(topWorldY) && topWorldY <= lineWorldY) {
            this.gameOverLineTimer += delta;

            if (this.gameOverLineTimer >= this.config.gameOverGraceDuration) {
                this.gameOver();
                return true;
            }
        } else {
            this.gameOverLineTimer = 0;
        }

        return false;
    }

    private checkGateMilestone(): void {
        if (this.trapdoor.isActive()) {
            return;
        }

        const met = this.gates.isRequirementMet(this.maxTierReached, this.topTierMergeHappened);
        // Consumed every frame regardless of the result above — a one-shot
        // signal for "did a top-tier merge happen since the last check",
        // not a sticky state.
        this.topTierMergeHappened = false;

        if (!met) {
            return;
        }

        this.beginTrapdoor();
    }

    /**
     * Kicks off the trapdoor sequence — the floor drops, the pile falls,
     * a new floor is placed, exactly the same physical animation either
     * way. `advanceProgression` (default true) picks which of two very
     * different things that ALSO means:
     *
     *  - true (the real "a gate requirement was just met" path — see
     *    checkGateMilestone()): advances the zone/level bookkeeping right
     *    away (same "advance first, animate after" order the old
     *    zone-advance used) so the active island/sky are already correct
     *    by the time the floor actually opens, and fires onTrapdoorOpened
     *    (drives the "zone complete" HUD/celebration).
     *  - false (triggerTrapdoorPowerup()): none of that runs — the SAME
     *    gate requirement/zone/level/target-weight stay exactly as they
     *    were, `currentWallHeight` is left untouched rather than
     *    recomputed (there's nothing new to compute it FROM), and
     *    onTrapdoorOpened does NOT fire, since no zone was actually
     *    completed — showing that "zone complete" celebration for a
     *    powerup that only reset the floor back to the same threshold
     *    would be actively misleading.
     *
     * zones/levels' own target-weight bookkeeping keeps running unchanged
     * in the true-path branch even though weight no longer GATES anything
     * — only what's consulted to decide "should a gate open" moved to
     * TowerGateController.
     */
    private beginTrapdoor(advanceProgression: boolean = true): void {
        const satisfiedGate = advanceProgression ? this.gates.getCurrentRequirement() : undefined;

        if (advanceProgression) {
            this.gates.advance();
        }

        const heldPiece = this.blocks.getHeldBlock()?.piece;

        if (heldPiece) {
            this.blocks.discardHeldBlock();
        }

        this.pendingHeldPiece = heldPiece;
        this.droppedBlock = undefined;

        // Suppress the game-over check for the whole span until the
        // player's next real drop (see its own doc).
        this.suppressGameOverUntilDrop = true;

        // updateGameOverLine() is the ONLY place that increments or resets
        // this timer — and it's never even called while suppressed (see
        // update()) — so without this reset, whatever it had already
        // accumulated to right before this milestone fired (e.g. the pile
        // was already sitting at/above the line for a moment right as a
        // big cascade cleared the weight threshold) stays frozen through
        // the ENTIRE trapdoor sequence, then resumes the instant the
        // player's next drop clears suppressGameOverUntilDrop — completing
        // in just a couple more frames instead of a fresh
        // gameOverGraceDuration, reading as an unfair near-instant loss
        // right as the new zone starts. Resetting here guarantees a full,
        // fresh grace window every time, regardless of how close the pile
        // already was to the line the instant the trapdoor triggered.
        this.gameOverLineTimer = 0;

        let leveledUp = false;
        let levelUpIndex = 0;
        let openedZoneIndex = 0;

        if (advanceProgression) {
            const advance = this.levels.advanceZone();
            const zoneConfig = this.levels.getCurrentZoneConfig();

            this.currentWallHeight = this.computeContainmentWallHeight();

            const result = this.zones.completeZone(this.scaleZoneTargetWeight(zoneConfig.weight));
            openedZoneIndex = result.zoneIndex;

            // The milestone is consumed — start the NEXT zone's progress
            // fresh at 0 rather than leaving the same pieces' weight to
            // instantly (or near-instantly) clear the next, only slightly
            // higher, threshold too. See
            // FaceTowerBlockController.resetWeight()'s own doc for why this
            // doesn't contradict "weight = what's on the board" even though
            // the pieces themselves aren't going anywhere.
            this.blocks.resetWeight();

            leveledUp = advance.leveledUp;
            levelUpIndex = advance.levelIndex;
        }

        this.trapdoor.begin(this.currentWallHeight);
        // Set immediately (not left to next frame's update() to notice via
        // trapdoor.isActive()) so a moveBlock()/dropBlock() call landing in
        // the same frame this fired reads the right state right away —
        // harmless either way since discardHeldBlock() above already left
        // nothing for those to act on, but this keeps getState() honest.
        this.state = FaceTowerState.TrapdoorOpening;

        if (advanceProgression) {
            this.events.onTrapdoorOpened?.(openedZoneIndex, satisfiedGate!);
        }

        // NOTE: onLevelProgressed is NOT fired here any more — see
        // finishTrapdoor(). Firing it this early meant the level-up popup
        // (and its powerup grant) appeared instantly, before the flap
        // swing/fall/settle had even played — "let the pieces fall and
        // wait a bit before the popup" wasn't possible with the event this
        // early. Just remember which level was reached; finishTrapdoor()
        // fires the real event once the pile has actually settled.
        if (leveledUp) {
            this.pendingLevelUpHold = true;
            this.pendingLevelUpIndex = levelUpIndex;
        }

        /*
         * The zone bump means rollPiece()'s level (and thus its pool) just
         * changed — re-roll right away so the "next piece" preview reflects
         * what will ACTUALLY spawn once the trapdoor finishes, instead of
         * staying stale on whatever was rolled under the old zone's level.
         * Unless a piece was just discarded off the drop area above — that
         * one takes priority over a fresh roll, for continuity. Rerolled
         * the same way in the non-advancing (powerup) path too — the held
         * piece was still discarded above, so a next piece still needs
         * picking, even though the pool itself didn't change.
         */
        this.nextPiece = this.pendingHeldPiece ?? this.rollPiece();
        this.events.onNextPieceChanged?.(this.nextPiece);
    }

    /**
     * Called once TrapdoorSettling's postTrapdoorSettleTimer elapses — the
     * pile has now had a real beat to finish landing, not just "the floor
     * is technically placed and the camera stopped." Only NOW does a
     * level-up actually fire onLevelProgressed (showing its popup) — see
     * beginTrapdoor()'s own doc for why that moved off the milestone
     * instant. suppressGameOverUntilDrop stays true right through
     * whichever branch runs below (WaitingForNotification's whole
     * duration, or the freshly spawned piece just hovering) — only the
     * player's own next drop clears it.
     */
    private finishTrapdoor(): void {
        this.pendingHeldPiece = undefined;

        if (this.pendingLevelUpHold) {
            this.pendingLevelUpHold = false;

            const levelIndex = this.pendingLevelUpIndex ?? this.levels.getLevelIndex();
            this.pendingLevelUpIndex = undefined;

            this.state = FaceTowerState.WaitingForNotification;
            this.events.onLevelProgressed?.(levelIndex);
        } else {
            this.spawnNextBlock();
        }

        // Fired unconditionally (both branches above) — this is what shows
        // the NEXT gate requirement, always this same beat after a gate
        // opens, whether or not that gate also happened to level the
        // player up.
        this.events.onGateProgressRevealed?.(this.gates.getCurrentRequirement());
    }

    /**
     * Fires the instant a merge resolves — score is bumped immediately
     * (not deferred/awaited by any state transition, unlike the old
     * zone-popup flow: merges can cascade several times in a single frame,
     * and gameplay never pauses for any of it), then forwarded to
     * FaceTowerGameEvents.onMerge purely for VFX/popup wiring.
     */
    private handleMerge(resultPiece: PieceDefinition | undefined, x: number, y: number, points: number): void {
        this.score += points;
        this.events.onScoreChanged?.(this.score);

        if (resultPiece?.tier !== undefined) {
            this.maxTierReached = Math.max(this.maxTierReached, resultPiece.tier);
            TowerPieceUnlockStorage.recordTier(resultPiece.tier);

            const gemReward = getMergeGemReward(resultPiece.tier);
            if (gemReward > 0) {
                GemStorage.add(gemReward);
            }
        } else {
            // resultPiece undefined == a top-tier + top-tier merge just
            // despawned both pieces (see TowerMergeController) — see
            // TowerGateController's own doc for how this is used.
            this.topTierMergeHappened = true;
        }

        this.events.onMerge?.(resultPiece, x, y, points);
    }

    /**
     * Dev-only: instantly advances the current zone (and, if it rolls over,
     * the level) exactly as if its current gate requirement had just been
     * met — teleports the floor straight to its new position instead of
     * running the real TowerTrapdoorController opening/falling beats, so
     * repeated calls (see devSkipLevel()) can't stack up waiting on
     * multiple real-time camera pans in a row. Also advances/reveals the
     * gate requirement (same as a real beginTrapdoor()/finishTrapdoor()
     * pair, just without the animated wait between them) so the gate
     * widget stays in sync during dev testing. See
     * IslandViewScene.setupLevelDevGui().
     */
    private instantAdvanceZone(): ZoneAdvanceResult {
        const satisfiedGate = this.gates.getCurrentRequirement();
        this.gates.advance();

        const advance = this.levels.advanceZone();
        const zoneConfig = this.levels.getCurrentZoneConfig();

        this.currentWallHeight = this.computeContainmentWallHeight();

        const result = this.zones.completeZone(this.scaleZoneTargetWeight(zoneConfig.weight));
        this.blocks.resetWeight();

        const newFloorY = this.blocks.getCurrentFloorY() + this.config.trapdoorDropHeight;

        // Snapshot before removing — removeBase() mutates the SAME array
        // getBases() returns (both of the current floor's two flaps), so
        // iterating it directly while removing would skip an entry.
        for (const base of [...this.blocks.getBases()]) {
            this.blocks.removeBase(base);
        }

        const basePieceId = resolveIslandForZone(this.levels.getLevelIndex(), this.levels.getZoneIndexInLevel()).island.basePieceId;
        this.blocks.addBase(newFloorY, basePieceId);
        this.deadZones.rebuild(newFloorY, this.currentWallHeight);
        this.camera.panTo(this.config.floorScreenY - newFloorY);

        this.events.onTrapdoorOpened?.(result.zoneIndex, satisfiedGate);
        this.events.onGateProgressRevealed?.(this.gates.getCurrentRequirement());

        return advance;
    }

    /**
     * Dev-only: force-completes the current zone right away, exactly as if
     * its weight milestone had just been reached — see
     * IslandViewScene.setupLevelDevGui(). A no-op once the run has ended or
     * a real trapdoor is already mid-sequence.
     */
    public devSkipZone(): void {
        if (this.state === FaceTowerState.GameOver || this.trapdoor.isActive()) {
            return;
        }

        const advance = this.instantAdvanceZone();

        if (advance.leveledUp) {
            this.events.onLevelProgressed?.(advance.levelIndex);
        }

        this.nextPiece = this.rollPiece();
        this.events.onNextPieceChanged?.(this.nextPiece);
    }

    /**
     * Dev-only: repeatedly force-completes zones until the level tier
     * itself advances — i.e. as many instant zone-completions as the
     * current level's remaining zoneCount needs. On the final level
     * there's no next level to reach, so this just force-completes the one
     * (repeating) zone instead. A no-op once the run has ended or a real
     * trapdoor is mid-sequence.
     */
    public devSkipLevel(): void {
        if (this.state === FaceTowerState.GameOver || this.trapdoor.isActive()) {
            return;
        }

        if (this.levels.isFinalLevel()) {
            this.devSkipZone();
            return;
        }

        const startingLevel = this.levels.getLevelIndex();

        // Guarded against a misconfigured levels-config.json (e.g.
        // zoneCount <= 0) looping forever — no legitimate level needs
        // anywhere near this many zones to roll over.
        for (let i = 0; i < 1000 && this.levels.getLevelIndex() === startingLevel; i++) {
            const advance = this.instantAdvanceZone();

            if (advance.leveledUp) {
                this.events.onLevelProgressed?.(advance.levelIndex);
            }
        }

        this.nextPiece = this.rollPiece();
        this.events.onNextPieceChanged?.(this.nextPiece);
    }

    private spawnNextBlock(): void {
        if (this.state === FaceTowerState.GameOver) {
            return;
        }

        /*
         * The powerup effect must finish (every queued piece destroyed)
         * before the next piece appears — mirrors the trapdoor's own
         * deferred-spawn pattern: park in PowerupEffect and let update()'s
         * branch above call back in once isBusy() clears.
         */
        if (this.powerups.isBusy()) {
            this.state = FaceTowerState.PowerupEffect;
            return;
        }

        const piece = this.nextPiece ?? this.rollPiece();

        this.blocks.spawnHeldBlock(this.targetX, piece);
        this.state = FaceTowerState.MovingBlock;

        // Roll the FOLLOWING piece right away (rather than waiting until
        // this one drops) so getNextPiece()/onNextPieceChanged can answer
        // "what's coming after this" for the whole time this piece is being
        // positioned, not just for an instant right before it spawns.
        this.nextPiece = this.rollPiece();
        this.events.onNextPieceChanged?.(this.nextPiece);
    }
    /**
     * Piece pool tier fed to PieceManager.getPieceForLevel() — driven by
     * `maxTierReached` (how far the player has actually progressed by
     * merging), NOT the trapdoor/level counter. `pieces-config.json`'s
     * `level` field is cumulative (level N's pool = every piece unlocked at
     * or before N), so this reuses it as-is, just choosing a different
     * input: base pool is always the two lowest tiers (level 2 → tier0 +
     * tier1, "piece one or piece 2"), widening by one more tier every time
     * `maxTierReached` climbs another step past 3 — e.g. once the player
     * has ever merged up to tier4 (piece value 16, i.e. "above 8"),
     * `maxTierReached - 1 == 3` unlocks level 3 (tier0-2, "even piece 3").
     * Keeps the early game from staying stuck dropping only the tiniest
     * pieces once the player has clearly moved past them, without tying
     * difficulty to the unrelated trapdoor/zone-completion pacing.
     */
    private rollPiece(): PieceDefinition {
        const level = Math.max(2, this.maxTierReached - 1);
        return this.pieces.getPieceForLevel(level);
    }

    private gameOver(): void {
        if (this.state === FaceTowerState.GameOver) {
            return;
        }

        this.state = FaceTowerState.GameOver;
        this.events.onGameOver?.(this.score, this.getCurrentTopWorldY());
    }

    /** Dev-only: force-ends the run right away, exactly as if the top line had actually been held long enough — see IslandViewScene.setupLevelDevGui(). A no-op once already GameOver. */
    public devTriggerGameOver(): void {
        this.gameOver();
    }
}
