// TowerTrapdoorController.ts

import type { FaceTowerBlockController } from './FaceTowerBlockController';
import type { FaceTowerConfig } from './FaceTowerTypes';
import type { TowerCameraController } from './TowerCameraController';
import type { TowerDeadZoneController } from './TowerDeadZoneController';

export type TrapdoorPhase = 'idle' | 'opening' | 'falling';

/**
 * Drives the "trapdoor" beat that fires once a level's weight milestone is
 * reached (see TowerZoneController.hasReachedWeight/FaceTowerGameController):
 * destroys the current floor out from under the whole pile, lets gravity
 * take over (merges keep firing normally the entire time — see
 * TowerMergeController, which needs zero special-casing for this — pieces
 * slamming together mid-plunge cascading into bigger tiers is exactly the
 * "rearranges the pile" excitement this is meant to have), then places a
 * fresh floor `trapdoorDropHeight` below where the old one sat and pans the
 * camera down to follow. The fixed top game-over line never moves — this
 * only ever buys more room underneath it.
 *
 * FaceTowerGameController drives this once per frame via update() while
 * isActive() is true, and pauses the top-line game-over check and normal
 * MovingBlock/DroppingBlock flow for the same span.
 */
export class TowerTrapdoorController {
    private phase: TrapdoorPhase = 'idle';
    private openTimer = 0;
    private pendingNewFloorY = 0;
    private pendingWallHeight = 0;

    public constructor(
        private readonly blocks: FaceTowerBlockController,
        private readonly deadZones: TowerDeadZoneController,
        private readonly camera: TowerCameraController,
        private readonly config: FaceTowerConfig,
        /** Resolves the active island's own base-piece override (if any) at the moment the new floor is actually placed — see FaceTowerBlockController.addBase()'s own basePieceId param. */
        private readonly getBasePieceId: () => string | undefined,
    ) { }

    public isActive(): boolean {
        return this.phase !== 'idle';
    }

    public getPhase(): TrapdoorPhase {
        return this.phase;
    }

    /**
     * Kicks off the sequence — no-op if one's already running. `wallHeight`
     * is the NEW floor's own wall/pole height, applied once that floor is
     * actually placed.
     *
     * Disables the catch-sensors IMMEDIATELY, for the whole trapdoor-active
     * window (both 'opening' and 'falling') — not just once openFloor()
     * actually destroys the flaps. The 'opening' swing itself can easily
     * shove a resting piece sideways as the flaps tilt open, and the board
     * is expected to reshuffle/merge throughout this entire sequence — none
     * of that is a real "escaped the play area" failure, so there must be
     * no way for it to end the run at any point between here and the new
     * floor actually landing (see FaceTowerGameController.update(), which
     * separately pauses the top-line check for this same span). The walls
     * themselves are left alone here — they're still the real steady-state
     * span while the flaps are still the physical floor — and only get
     * re-spanned once openFloor() actually destroys them.
     */
    public begin(wallHeight: number): void {
        if (this.phase !== 'idle') {
            return;
        }

        this.phase = 'opening';
        this.openTimer = this.config.trapdoorOpenDuration;
        this.pendingWallHeight = wallHeight;

        this.deadZones.clearSensors();
    }

    /** Call once per frame while isActive() — returns true the instant the new floor is placed and play should resume. */
    public update(delta: number): boolean {
        if (this.phase === 'opening') {
            this.openTimer -= delta;

            // 0 at the very start of the swing, 1 once it's fully open —
            // eased (ease-out) so the swing starts fast and settles rather
            // than moving at a constant rate the whole time.
            const linearT = 1 - Math.max(0, this.openTimer) / this.config.trapdoorOpenDuration;
            const t = 1 - (1 - linearT) * (1 - linearT);
            const magnitude = this.config.floorFlapRestAngle +
                (this.config.floorFlapOpenAngle - this.config.floorFlapRestAngle) * t;

            for (const base of this.blocks.getBases()) {
                this.blocks.setFlapAngle(base, magnitude);
            }

            if (this.openTimer <= 0) {
                this.openFloor();
            }

            return false;
        }

        if (this.phase === 'falling' && !this.camera.isPanning()) {
            // The real floor was already placed back in openFloor() (see its
            // own doc for why) — this just restores the steady-state
            // (base-flush) wall span and re-arms the catch-sensors now that
            // the pile has actually landed on it.
            this.deadZones.rebuild(this.pendingNewFloorY, this.pendingWallHeight);
            this.phase = 'idle';
            return true;
        }

        return false;
    }

    /**
     * Destroys the current floor's two flaps (the swing animation has
     * already finished by the time this runs — see update()'s 'opening'
     * branch), immediately places the NEW floor at its final resting Y, and
     * starts the camera panning down to follow — camera.isPanning()
     * finishing (checked in update()) is what marks the fall as "done", so
     * the fall's real-time duration is exactly however long that pan takes
     * at cameraPanSpeed; the physical landing itself already happened by
     * then.
     *
     * The new floor is placed HERE, synchronously, rather than waited on
     * until the pan finishes — physics keeps simulating gravity on the
     * whole pile for that entire pan duration regardless of what the camera
     * is doing, so leaving a genuine gap with no floor collider at all for
     * that whole span let a piece with enough downward velocity fall clean
     * through where the new floor was ABOUT to go, past the (necessarily
     * finite) side-wall span below it, and out of the play area entirely —
     * visually reading as pieces vanishing off-screen. Placing it
     * immediately closes that gap: nothing below the camera's current view
     * yet (the pan hasn't caught up), so this is invisible either way, but
     * now there's always something solid to land on. update()'s 'falling'
     * branch only re-arms the steady-state wall span + catch-sensors once
     * the pan actually finishes — the floor itself is already there.
     *
     * Also does NOT clear the side walls (catch-sensors were already
     * cleared back in begin() — see its own doc). The walls are instead
     * RE-SPANNED to stay solid across the ENTIRE fall (from the same top
     * they already had — this.pendingWallHeight/config.wallOffsetY produce
     * the identical top edge rebuild() would have used — down to
     * comfortably past where the new floor lands), so the pile can never
     * drift sideways out of the column either.
     */
    private openFloor(): void {
        const reachedY = this.blocks.getCurrentFloorY();

        const topWorldY =
            reachedY - this.config.floorHeight * 0.5 - this.pendingWallHeight +
            this.config.wallOffsetY;

        // Snapshot before removing — removeBase() mutates the SAME array
        // getBases() returns, so iterating it directly while removing would
        // skip an entry.
        for (const base of [...this.blocks.getBases()]) {
            this.blocks.removeBase(base);
        }

        this.pendingNewFloorY = reachedY + this.config.trapdoorDropHeight;

        // Placed right away — see this method's own doc for why waiting
        // until the pan finished left a physics gap pieces could fall
        // through.
        this.blocks.addBase(this.pendingNewFloorY, this.getBasePieceId());

        this.deadZones.rebuildWallsSpan(
            topWorldY,
            this.pendingNewFloorY + this.config.containmentTopBuffer,
        );

        const newOffsetY = this.config.floorScreenY - this.pendingNewFloorY;
        this.camera.panTo(newOffsetY);

        this.phase = 'falling';
    }
}
