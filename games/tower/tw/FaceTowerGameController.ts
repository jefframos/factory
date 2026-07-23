// FaceTowerGameController.ts

import * as PIXI from 'pixi.js';
import { FaceTowerBlockController } from './FaceTowerBlockController';
import {
    FaceTowerInputController,
} from './FaceTowerInputController';
import {
    FaceTowerState,
    type FaceTowerBlock,
    type FaceTowerConfig,
} from './FaceTowerTypes';
import { PieceManager } from './PieceManager';
import type { PieceDefinition } from './PieceStorage';
import { getPowerup, powerupGreyColorNumber } from './PowerupStorage';
import { PowerupSystem } from './PowerupSystem';
import { TowerCameraController } from './TowerCameraController';
import { TowerDeadZoneController } from './TowerDeadZoneController';
import { TowerStabilityController } from './TowerStabilityController';
import { TowerZoneController } from './TowerZoneController';

export interface FaceTowerGameEvents {
    onScoreChanged?(score: number): void;
    onMilestoneReached?(zoneIndex: number): void;
    onGameOver?(score: number): void;
    /** Fired the instant a piece is released and physics takes over — the "shoot" moment. See dropBlock(). */
    onBlockDropped?(block: FaceTowerBlock): void;
    /** Fired once per block, on its first physical contact with anything — the "jiggle" moment. See FaceTowerBlockController.releaseHeldBlock. */
    onBlockFirstHit?(block: FaceTowerBlock): void;
    /** Fired once per block, the instant a powerup freezes-and-greys it — see PowerupSystem.drainQueue. */
    onBlockFrozen?(block: FaceTowerBlock, greyColorHex: number): void;
    /** Fired whenever the upcoming piece changes — see spawnNextBlock()/getNextPiece(). Powerups swapped in via spawnPowerup() don't count as "next" and never fire this. */
    onNextPieceChanged?(piece: PieceDefinition): void;
}

export class FaceTowerGameController {
    private readonly camera: TowerCameraController;
    private readonly blocks: FaceTowerBlockController;
    private readonly stability: TowerStabilityController;
    private readonly zones: TowerZoneController;
    private readonly deadZones: TowerDeadZoneController;
    private readonly pieces: PieceManager;
    private readonly powerups: PowerupSystem;
    private readonly input: FaceTowerInputController;
    private readonly targetLine: PIXI.Graphics;

    private state = FaceTowerState.Initialising;
    private score = 0;

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
            block => this.events.onBlockFirstHit?.(block),
        );

        this.powerups = new PowerupSystem(
            this.blocks,
            (block, greyColorHex) => this.events.onBlockFrozen?.(block, greyColorHex),
        );

        this.stability = new TowerStabilityController(config);

        this.zones = new TowerZoneController(
            config.zoneHeight,
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
        this.blocks.initialise();
        this.deadZones.rebuild(this.config.floorY, 0);

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
        this.zones.reset(this.config.floorY);
        this.nextPiece = undefined;

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
                this.spawnNextBlock();
            }

            return;
        }

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
        const zoneStartWorldY = targetWorldY + this.config.zoneHeight;
        const currentTopWorldY = this.getCurrentTopWorldY();

        const climbed = zoneStartWorldY - currentTopWorldY;
        return Math.max(0, Math.min(1, climbed / this.config.zoneHeight));
    }

    /** The side containment poles for the current zone — see TowerDeadZoneController. */
    public getWalls() {
        return this.deadZones.getWalls();
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
    public continueRun(): void {
        if (this.state !== FaceTowerState.GameOver) {
            return;
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
            const result = this.zones.completeZone();

            /*
             * Everything built so far becomes the permanent base, and a
             * fresh floor is placed exactly on the line it just reached —
             * the tower effectively restarts on top of its own progress.
             */
            this.blocks.freezeAll();
            this.blocks.addBase(result.lineWorldY);
            this.deadZones.rebuild(result.lineWorldY, this.getLevel());

            const newOffsetY =
                this.config.floorScreenY - result.lineWorldY;

            this.camera.panTo(newOffsetY);
            this.drawTargetLine(this.zones.getTargetLineWorldY());

            this.events.onMilestoneReached?.(result.zoneIndex);

            /*
             * The zone bump means rollPiece()'s level (and thus its pool)
             * just changed — re-roll right away so the "next piece" preview
             * reflects what will ACTUALLY spawn once panning finishes,
             * instead of staying stale on whatever was rolled under the old
             * zone's level.
             */
            this.nextPiece = this.rollPiece();
            this.events.onNextPieceChanged?.(this.nextPiece);

            /*
             * Held block spawns only once the pan finishes, so it never
             * appears mid-scroll. See PanningCamera handling in update().
             */
            this.state = FaceTowerState.PanningCamera;
            return;
        }

        this.spawnNextBlock();
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
    public getLevel(): number {
        return this.zones.getZoneIndex() || 0;
    }
    private rollPiece(): PieceDefinition {
        const level = this.zones.getZoneIndex() + 1;
        return this.pieces.getPieceForLevel(level);
    }

    private gameOver(): void {
        if (this.state === FaceTowerState.GameOver) {
            return;
        }

        this.state = FaceTowerState.GameOver;
        this.events.onGameOver?.(this.score);
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
