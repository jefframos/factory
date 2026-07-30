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
import { PieceManager } from './PieceManager';
import type { PieceDefinition } from './PieceStorage';
import { getPowerup, powerupGreyColorNumber } from './PowerupStorage';
import { PowerupSystem, type PowerupContactPoint } from './PowerupSystem';
import { TowerCameraController } from './TowerCameraController';
import { TowerDeadZoneController } from './TowerDeadZoneController';
import { resolveIslandForZone } from './TowerIslandProgression';
import { TowerLevelController } from './TowerLevelController';
import { TowerStabilityController } from './TowerStabilityController';
import { TowerZoneController } from './TowerZoneController';

export interface FaceTowerGameEvents {
    onScoreChanged?(score: number): void;
    onMilestoneReached?(zoneIndex: number): void;
    /** Fired once every zone of the current level is complete and play has rolled over into the next level — see TowerLevelController. Never fires again once the last authored level is reached; its zones just keep repeating. */
    onLevelProgressed?(levelIndex: number): void;
    onGameOver?(score: number): void;
    /** Fired the instant a piece is released and physics takes over — the "shoot" moment. See dropBlock(). */
    onBlockDropped?(block: FaceTowerBlock): void;
    /**
     * Fired once per block, on its first physical contact with anything —
     * the "jiggle" moment. `contactPoint` is a best-effort 2D physics
     * position; `hitBlock` is whichever other block was struck (undefined
     * for a base/wall). See FaceTowerBlockController.releaseHeldBlock and
     * TowerVfxUtils.onFirstTouchVfx, the intended consumer for VFX tuning.
     */
    onBlockFirstHit?(block: FaceTowerBlock, contactPoint: PowerupContactPoint, hitBlock: FaceTowerBlock | undefined): void;
    /** Fired once per block, the instant a powerup freezes-and-greys it — see PowerupSystem.drainQueue. */
    onBlockFrozen?(block: FaceTowerBlock, greyColorHex: number): void;
    /**
     * Fired the instant a powerup piece touches ANY block (before
     * drainQueue() gets around to actually applying the freeze/destroy/
     * shrink effect, which can lag behind on a busy touch) — `contactPoint`
     * is the touched block's own 2D physics position. Meant purely for
     * reactive VFX: wiggle the touched piece for freeze/shrink, or a
     * particle burst + camera shake for a destroy (bomb/super-bomb) — see
     * PowerupSystem's own `onTouch` constructor param, which this just
     * forwards. `actionBlock` is the falling powerup piece itself (the
     * "action piece" for TowerVfxUtils' hooks).
     */
    onPowerupTouch?(block: FaceTowerBlock, contactPoint: PowerupContactPoint, powerup: PowerupEffectConfig, actionBlock: FaceTowerBlock): void;
    /** Fired whenever the upcoming piece changes — see spawnNextBlock()/getNextPiece(). Powerups swapped in via spawnPowerup() don't count as "next" and never fire this. */
    onNextPieceChanged?(piece: PieceDefinition): void;
}

export class FaceTowerGameController {
    private readonly camera: TowerCameraController;
    private readonly blocks: FaceTowerBlockController;
    private readonly stability: TowerStabilityController;
    private readonly zones: TowerZoneController;
    private readonly levels: TowerLevelController;
    private readonly deadZones: TowerDeadZoneController;
    private readonly pieces: PieceManager;
    private readonly powerups: PowerupSystem;
    private readonly input: FaceTowerInputController;
    private readonly targetLine: PIXI.Graphics;

    private state = FaceTowerState.Initialising;
    private score = 0;

    /** Set true by advanceToNextZone() whenever that zone's completion also leveled up — read (and cleared) once the camera pan finishes, to detour into WaitingForNotification instead of spawning the next piece immediately. See resumeAfterLevelUpNotification(). */
    private pendingLevelUpHold = false;

    /** World-space height (px) of the zone currently being built — drives both getZoneProgress() and the wall/pole height (zone height × its polePercent). Set from the level's own zone config — see LevelStorage/TowerLevelController. */
    private currentZoneWorldHeight: number;
    /** Wall/pole height (px) for the zone currently being built — currentZoneWorldHeight × its polePercent. */
    private currentWallHeight: number;

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
        );

        this.powerups = new PowerupSystem(
            this.blocks,
            (block, greyColorHex) => this.events.onBlockFrozen?.(block, greyColorHex),
            (block, contactPoint, powerup, actionBlock) => this.events.onPowerupTouch?.(block, contactPoint, powerup, actionBlock),
        );

        this.stability = new TowerStabilityController(config);

        this.levels = new TowerLevelController();

        const initialZoneConfig = this.levels.getCurrentZoneConfig();
        this.currentZoneWorldHeight = initialZoneConfig.height * config.blockHeight;
        this.currentWallHeight = this.currentZoneWorldHeight * initialZoneConfig.polePercent;

        this.zones = new TowerZoneController(
            this.currentZoneWorldHeight,
            config.floorY,
        );

        this.pieces = new PieceManager();
        this.pieces.build();

        this.deadZones = new TowerDeadZoneController(
            worldRoot,
            config,
        );

        this.deadZones.setOnHit(() => this.gameOver());

        this.targetLine = new PIXI.Graphics();
        worldRoot.addChild(this.targetLine);
        this.drawTargetLine(this.zones.getTargetLineWorldY());

        this.input = new FaceTowerInputController(
            overlayRoot,
            coordinateRoot,
            {
                onMove: x => this.moveBlock(x),
                onRelease: () => this.dropBlock(),
            },
        );
    }

    public start(): void {
        this.blocks.initialise(resolveIslandForZone(this.levels.getLevelIndex(), this.levels.getZoneIndexInLevel()).island.basePieceId);
        this.deadZones.rebuild(this.config.floorY, this.currentWallHeight);

        this.score = 0;
        this.events.onScoreChanged?.(this.score);

        this.spawnNextBlock();
    }

    /** Tears the run down and starts a brand-new tower from scratch. */
    public reset(): void {
        this.blocks.destroy();
        this.deadZones.clear();
        this.powerups.clear();
        this.camera.reset();

        this.levels.reset();
        const zoneConfig = this.levels.getCurrentZoneConfig();
        this.currentZoneWorldHeight = zoneConfig.height * this.config.blockHeight;
        this.currentWallHeight = this.currentZoneWorldHeight * zoneConfig.polePercent;

        this.zones.reset(this.config.floorY, this.currentZoneWorldHeight);
        this.nextPiece = undefined;
        this.pendingLevelUpHold = false;

        this.state = FaceTowerState.Initialising;

        this.drawTargetLine(this.zones.getTargetLineWorldY());
        this.start();
    }

    public update(delta: number): void {
        this.camera.update(delta);
        this.blocks.update(delta);

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

        if (this.state === FaceTowerState.PowerupEffect) {
            if (!this.powerups.isBusy()) {
                this.spawnNextBlock();
            }

            return;
        }

        if (this.state === FaceTowerState.PanningCamera) {
            if (!this.camera.isPanning()) {
                if (this.pendingLevelUpHold) {
                    this.pendingLevelUpHold = false;
                    this.state = FaceTowerState.WaitingForNotification;
                } else {
                    this.spawnNextBlock();
                }
            }

            return;
        }

        // WaitingForNotification falls through here too — deliberately
        // does nothing until resumeAfterLevelUpNotification() is called.
        if (this.state !== FaceTowerState.WaitingForTower) {
            return;
        }

        const result = this.stability.update(
            delta,
            this.blocks.getBlocks(),
            deathWorldY,
        );

        if (result === 'failed') {
            this.gameOver();
            return;
        }

        if (result === 'stable') {
            this.completeTurn();
        }
    }

    public resizeInput(
        x: number,
        y: number,
        width: number,
        height: number,
    ): void {
        this.input.resize(x, y, width, height);
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

    /** The piece that will spawn once the current one is dropped (and, mid-zone-transition, settles) — see spawnNextBlock(). Undefined only before the very first spawn. */
    public getNextPiece(): PieceDefinition | undefined {
        return this.nextPiece;
    }

    /** Every base placed so far (the original floor plus one per completed zone). */
    public getBases() {
        return this.blocks.getBases();
    }

    /** Whichever STATIC_PIECES id `base` actually resolved to — see FaceTowerBlockController.getBasePieceId(), TowerBaseSync3D's sole consumer. */
    public getBasePieceId(base: BasePhysicsEntity): string | undefined {
        return this.blocks.getBasePieceId(base);
    }

    /**
     * World Y of the tower's current top — the highest live (non-frozen,
     * non-powerup) block, or the latest base's own Y when nothing's
     * stacked on it yet (right after a zone completes and freezes
     * everything, before the next piece settles) — see TowerHeightGauge,
     * which converts this to a screen Y and a meters display value.
     */
    public getCurrentTopWorldY(): number {
        const topWorldY = this.blocks.getHighestTopWorldY();

        if (Number.isFinite(topWorldY)) {
            return topWorldY;
        }

        const bases = this.blocks.getBases();
        return bases.length > 0 ? bases[bases.length - 1].body.position.y : this.config.floorY;
    }

    /** World Y of the next zone's target line — the height the player currently needs to reach. See TowerHeightGauge's "target" mark. */
    public getTargetLineWorldY(): number {
        return this.zones.getTargetLineWorldY();
    }

    /**
     * 0..1 fraction of progress toward the next zone's target line — 0 at
     * the current base, 1 once the target line is reached. Derived from
     * the same two world-Y values as getCurrentTopWorldY()/getTargetLineWorldY(),
     * rather than tracked separately, so it can never drift out of sync
     * with what those already report. See TowerProgressBar2D.
     */
    public getZoneProgress(): number {
        const targetWorldY = this.zones.getTargetLineWorldY();
        const zoneStartWorldY = targetWorldY + this.currentZoneWorldHeight;
        const currentTopWorldY = this.getCurrentTopWorldY();

        const climbed = zoneStartWorldY - currentTopWorldY;
        return Math.max(0, Math.min(1, climbed / this.currentZoneWorldHeight));
    }

    /** The side containment poles for the current zone — see TowerDeadZoneController. */
    public getWalls() {
        return this.deadZones.getWalls();
    }

    /** Current wall/pole height (px) — currentZoneWorldHeight × the current zone's polePercent. See TowerWallSync3D.sync(). */
    public getWallHeight(): number {
        return this.currentWallHeight;
    }

    /** 0-based progression tier (see TowerLevelController) — also what rollPiece() feeds PieceManager.getPieceForLevel() (as levelIndex + 1), so a piece's own `level` in pieces-config.json unlocks one full level's worth of zones at a time. */
    public getLevelIndex(): number {
        return this.levels.getLevelIndex();
    }

    /** 0-based zone index within the CURRENT level — resets to 0 every level-up. See TowerIslandProgression.resolveIslandForZone(). */
    public getZoneIndexInLevel(): number {
        return this.levels.getZoneIndexInLevel();
    }

    /** True once the last authored level (see levels-config.json) has been reached — its zones repeat forever from here on. */
    public isFinalLevel(): boolean {
        return this.levels.isFinalLevel();
    }

    /** How far (km) the CURRENT level's own destination is — levels-config.json's distanceFromPreviousKm, 0 if that level doesn't define one. See getLevelProgressFraction()/getZoneTargetProgressFraction() for scaling this into an in-progress "how far traveled" readout. */
    public getLevelDistanceKm(): number {
        return this.levels.getCurrentLevelConfig()?.distanceFromPreviousKm ?? 0;
    }

    /**
     * 0..1 continuous progress through the CURRENT level's zones —
     * (zoneIndexInLevel + fractional progress through the zone currently
     * being built) / zoneCount. Multiply by getLevelDistanceKm() for a
     * live "how far traveled toward this level's destination" value that
     * shares the exact same unit/scale as that destination's own distance
     * — see IslandViewScene, which uses this for both the HUD's level-goal
     * line and the height gauge's "current" readout, instead of each
     * showing an unrelated raw meters count.
     */
    public getLevelProgressFraction(): number {
        const zoneCount = Math.max(1, this.levels.getZoneCount());
        const fraction = (this.levels.getZoneIndexInLevel() + this.getZoneProgress()) / zoneCount;

        return Math.max(0, Math.min(1, fraction));
    }

    /**
     * 0..1 fraction of the level's distance the CURRENT ZONE's own target
     * line sits at — one whole zone-step ahead of getLevelProgressFraction()'s
     * continuous value, exactly 1 on the level's last zone (i.e. the target
     * IS the level's own destination). Mirrors getZoneProgress()/getTargetLineWorldY()'s
     * "current vs next zone" pairing, just expressed as a level-distance
     * fraction instead of world-Y.
     */
    public getZoneTargetProgressFraction(): number {
        const zoneCount = Math.max(1, this.levels.getZoneCount());
        const fraction = (this.levels.getZoneIndexInLevel() + 1) / zoneCount;

        return Math.max(0, Math.min(1, fraction));
    }

    /**
     * World Y the player needs to reach the level AFTER the one currently
     * being climbed — i.e. the target line as it will read once the current
     * level's remaining zones are all finished. Always defined (even on the
     * final level, where it just keeps climbing by the same repeating
     * zone) — for a "next level: Xm" HUD hint shown alongside the current
     * zone's own target line (getTargetLineWorldY()).
     */
    public getNextLevelTargetWorldY(): number {
        const currentBaseWorldY = this.zones.getTargetLineWorldY() + this.currentZoneWorldHeight;
        const remainingHeight = this.levels.getRemainingLevelHeight(this.config.blockHeight);

        return currentBaseWorldY - remainingHeight;
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

        if (powerup.type === 'freeze-drop') {
            this.blocks.markHeldBlockAsPowerup({
                action: 'freeze',
                greyColorHex: powerupGreyColorNumber(powerup),
                stepDelay: powerup.greyStepDelay,
                dropForceY: powerup.dropForceY,
            });
        } else if (powerup.type === 'destroy-drop') {
            this.blocks.markHeldBlockAsPowerup({
                action: 'destroy',
                stepDelay: powerup.destroyStepDelay,
                maxTargets: powerup.maxTargets,
                dropForceY: powerup.dropForceY,
            });
        } else {
            this.blocks.markHeldBlockAsPowerup({
                action: 'shrink',
                shrinkFactor: powerup.shrinkFactor,
                stepDelay: powerup.shrinkStepDelay,
                maxTargets: powerup.maxTargets,
                dropForceY: powerup.dropForceY,
            });
        }
    }

    /** True only while a piece is actively hovering/falling toward the drop area — the same guard spawnPowerup()/skipHeldPiece()/replaceHeldBlockWithPiece() already enforce internally, exposed so a HUD button can grey itself out instead of silently no-opping on click. */
    public canUsePowerup(): boolean {
        return this.state === FaceTowerState.MovingBlock;
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

        this.targetLine.removeFromParent();
        this.targetLine.destroy();

        this.state = FaceTowerState.GameOver;
    }

    /**
     * Resumes play after a collapse WITHOUT resetting the tower — clears
     * out whatever actually fell past the death line (the cause of the
     * collapse) and spawns the next piece as normal, leaving score and
     * everything still standing untouched. A no-op unless currently
     * GameOver.
     *
     * TODO: this is meant to be gated behind a rewarded ad — IslandViewScene's
     * "Continue" button currently calls this directly with no ad in front
     * of it yet.
     */
    public continueRun(): FaceTowerBlock[] {
        if (this.state !== FaceTowerState.GameOver) {
            return [];
        }

        const deathWorldY = this.camera.toWorldY(this.config.deathScreenY);

        for (const block of [...this.blocks.getBlocks()]) {
            if (!block.checkpointFrozen && !block.powerup && block.entity.body.position.y > deathWorldY) {
                this.blocks.removeBlock(block);
            }
        }

        /*
         * Whatever's left is very likely still mid-collapse — one piece
         * toppling into another, still settling — not just the one block
         * that actually crossed the death line. Freezing everything solid
         * (same mechanic a completed zone already uses — see
         * FaceTowerBlockController.freezeBlock) stops that chain reaction
         * dead in place, so the player doesn't drop back in only to watch
         * something else fall and die again a second later.
         */
        this.blocks.freezeAll();

        /*
         * The collapse can be caused by an OLDER, already-placed piece
         * toppling into a dead zone well after it settled — completely
         * unrelated to whatever's currently held (state stays MovingBlock
         * the whole time, since only the dropped/settled path ever reaches
         * WaitingForTower). gameOver() doesn't discard that held block, so
         * without this, spawnNextBlock() below would throw straight into
         * spawnHeldBlock()'s "already holding one" guard. Safe to call
         * unconditionally — a no-op if nothing's actually held.
         */
        this.blocks.discardHeldBlock();

        // spawnNextBlock() itself bails whenever state === GameOver, so
        // clear that first — it overwrites state again immediately anyway.
        this.state = FaceTowerState.MovingBlock;
        this.spawnNextBlock();

        return this.blocks.getBlocks()
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

        this.events.onBlockDropped?.(releasedBlock);

        if (releasedBlock.powerup) {
            /*
             * A powerup piece never settles into the tower — it just keeps
             * falling (as a sensor — see releaseHeldBlock) until
             * PowerupSystem removes it past the bottom of the column, so it
             * skips DroppingBlock/WaitingForTower/stability entirely. Parking
             * in PowerupEffect immediately gates the next spawn on
             * powerups.isBusy() (see update()) the same way it would if this
             * state were reached from spawnNextBlock() instead.
             */
            this.state = FaceTowerState.PowerupEffect;
            this.powerups.trackDroppedPiece(releasedBlock);
            return;
        }

        this.state = FaceTowerState.DroppingBlock;

        /*
         * DroppingBlock immediately becomes WaitingForTower.
         * Keeping the two states separate makes it easy to add:
         *
         * - a release animation;
         * - sound effects;
         * - a short input lock;
         * - block face animation.
         */
        this.beginTowerWait();
    }

    private beginTowerWait(): void {
        this.state = FaceTowerState.WaitingForTower;
        this.stability.beginWaiting();
    }

    private completeTurn(): void {
        this.score++;
        this.events.onScoreChanged?.(this.score);

        const topWorldY = this.blocks.getHighestTopWorldY();

        if (this.zones.hasReachedLine(topWorldY)) {
            this.advanceToNextZone();
            return;
        }

        this.spawnNextBlock();
    }

    /**
     * Freezes everything built so far into a new base on the current
     * target line and rolls play forward into the next zone (and, once
     * the level's zoneCount is exhausted, the next level) — the shared
     * path completeTurn() uses once the player actually reaches the
     * target line, also reused as-is by the dev-only skip helpers below
     * so "force it" behaves identically to "the player did it".
     */
    private advanceToNextZone(): void {
        /*
         * Normally there's nothing held here — the player already dropped
         * their piece before the tower settles and completeTurn() runs.
         * But the dev-only skip helpers (devSkipZone/devSkipLevel) can call
         * this mid-hold, while a piece is still hovering over the drop
         * area — spawnNextBlock() below would otherwise throw straight
         * into spawnHeldBlock()'s "already holding one" guard. Discard it,
         * but remember which piece it was so it reappears unchanged once
         * panning finishes, instead of being swapped for a freshly rolled
         * one — the player shouldn't lose the piece they were lining up
         * just because a dev skipped the zone/level out from under them.
         */
        const heldPiece = this.blocks.getHeldBlock()?.piece;

        if (heldPiece) {
            this.blocks.discardHeldBlock();
        }

        const advance = this.levels.advanceZone();
        const zoneConfig = this.levels.getCurrentZoneConfig();

        this.currentZoneWorldHeight = zoneConfig.height * this.config.blockHeight;
        this.currentWallHeight = this.currentZoneWorldHeight * zoneConfig.polePercent;

        const result = this.zones.completeZone(this.currentZoneWorldHeight);

        /*
         * Everything built so far becomes the permanent base, and a
         * fresh floor is placed exactly on the line it just reached —
         * the tower effectively restarts on top of its own progress.
         */
        this.blocks.freezeAll();
        const activeIsland = resolveIslandForZone(this.levels.getLevelIndex(), this.levels.getZoneIndexInLevel()).island;
        this.blocks.addBase(result.lineWorldY, activeIsland.basePieceId);
        this.deadZones.rebuild(result.lineWorldY, this.currentWallHeight);

        const newOffsetY =
            this.config.floorScreenY - result.lineWorldY;

        this.camera.panTo(newOffsetY);
        this.drawTargetLine(this.zones.getTargetLineWorldY());

        this.events.onMilestoneReached?.(result.zoneIndex);

        if (advance.leveledUp) {
            this.pendingLevelUpHold = true;
            this.events.onLevelProgressed?.(advance.levelIndex);
        }

        /*
         * The zone bump means rollPiece()'s level (and thus its pool)
         * just changed — re-roll right away so the "next piece" preview
         * reflects what will ACTUALLY spawn once panning finishes,
         * instead of staying stale on whatever was rolled under the old
         * zone's level. Unless a piece was just discarded off the drop
         * area above — that one takes priority over a fresh roll, for
         * continuity.
         */
        this.nextPiece = heldPiece ?? this.rollPiece();
        this.events.onNextPieceChanged?.(this.nextPiece);

        /*
         * Held block spawns only once the pan finishes, so it never
         * appears mid-scroll. See PanningCamera handling in update().
         */
        this.state = FaceTowerState.PanningCamera;
    }

    /**
     * Dev-only: force-completes the current zone right away, exactly as
     * if the player had reached its target line — see
     * IslandViewScene.setupLevelDevGui(). A no-op once the run has ended.
     */
    public devSkipZone(): void {
        if (this.state === FaceTowerState.GameOver) {
            return;
        }

        this.advanceToNextZone();
    }

    /**
     * Dev-only: repeatedly force-completes zones until the level tier
     * itself advances — i.e. as many devSkipZone() calls as the current
     * level's remaining zoneCount needs. On the final level there's no
     * next level to reach, so this just force-completes the one
     * (repeating) zone instead. A no-op once the run has ended.
     */
    public devSkipLevel(): void {
        if (this.state === FaceTowerState.GameOver) {
            return;
        }

        if (this.levels.isFinalLevel()) {
            this.advanceToNextZone();
            return;
        }

        const startingLevel = this.levels.getLevelIndex();

        // Guarded against a misconfigured levels-config.json (e.g.
        // zoneCount <= 0) looping forever — no legitimate level needs
        // anywhere near this many zones to roll over.
        for (let i = 0; i < 1000 && this.levels.getLevelIndex() === startingLevel; i++) {
            this.advanceToNextZone();
        }
    }

    private spawnNextBlock(): void {
        if (this.state === FaceTowerState.GameOver) {
            return;
        }

        /*
         * The powerup effect must finish (every queued piece frozen and
         * greyed) before the next piece appears — mirrors the
         * PanningCamera deferred-spawn pattern: park in PowerupEffect and
         * let update()'s branch above call back in once isBusy() clears.
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
    /** Piece pool tier fed to PieceManager.getPieceForLevel() — the actual level tier (see TowerLevelController), NOT the ever-incrementing zone counter, so pieces-config.json's own small `level` values (1, 2, 3…) unlock one full level's worth of zones at a time instead of unlocking on every single zone. */
    private rollPiece(): PieceDefinition {
        const level = this.levels.getLevelIndex() + 1;
        return this.pieces.getPieceForLevel(level);
    }

    private gameOver(): void {
        if (this.state === FaceTowerState.GameOver) {
            return;
        }

        this.state = FaceTowerState.GameOver;
        this.events.onGameOver?.(this.score);
    }

    /** Dev-only: force-ends the run right away, exactly as if the tower had actually collapsed — see IslandViewScene.setupLevelDevGui(). A no-op once already GameOver. */
    public devTriggerGameOver(): void {
        this.gameOver();
    }

    private drawTargetLine(worldY: number): void {
        const halfWidth = this.config.floorWidth * 0.5;
        const startX = this.config.floorX - halfWidth;
        const endX = this.config.floorX + halfWidth;

        const dash = 14;
        const gap = 8;

        this.targetLine.clear();
        this.targetLine.lineStyle(3, 0xffe066, 0.9);

        for (let x = startX; x < endX; x += dash + gap) {
            const segmentEnd = Math.min(x + dash, endX);

            this.targetLine
                .moveTo(x, worldY)
                .lineTo(segmentEnd, worldY);
        }
    }
}
