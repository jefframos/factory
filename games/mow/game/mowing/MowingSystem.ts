// MowingSystem.ts
//
// Automatic mowing: while the player moves, everything in a circle the tool's width across, at the tool's cutting
// point (MowPlayer.cutPoint) and all the way back to the player's feet, is cut — what the tool's power handles
// (GrassField.cutCapsule), so no grass is left trapped between the player and the tool. Each cut cell's
// clippings go into the container (MowProgress.addClippings); a full container stops the cutting (the player has to
// sell): said once, the moment it fills (walking on with it full says nothing more: the FULL tag and the arrows to
// SELL already do). Grass one power too tough resists, like dig's rock: the mower is held back (the player's `drag`)
// while it chews through, throwing chips with each hit, until it gives; tougher still is a wall until a better mower
// (with a hint now and then). Cutting throws green chips and a soft swish.

import * as THREE from 'three';
import { GrassField } from '../world/GrassField';
import { MowProgress } from '../data/MowProgress';
import type MowPlayer from '../player/MowPlayer';
import type { MowEffects } from '../vfx/MowEffects';
import { MowAudio } from '../audio/MowAudio';
import { GrassDef } from '../data/MowConfig';

/** Below this the stick / keys count as not moving. */
const MOVE_THRESHOLD = 0.2;
/** Chips per cut cell (capped per step). */
const CHIPS_PER_CELL = 1;
const MAX_CHIPS = 8;
const HINT_COOLDOWN_SEC = 6;
/** Walking speed share while chewing through tough grass, and against grass the tool can't cut at all. */
const CHEW_DRAG = 0.22;
const WALL_DRAG = 0.04;
/** A hit on tough grass (chips and a swish) every this many seconds. */
const CHEW_HIT_SEC = 0.16;

export class MowingSystem {
    private hintCooldown = 0;
    private chewHit = 0;
    private readonly point = new THREE.Vector3();

    public constructor(
        private readonly grass: GrassField,
        private readonly player: MowPlayer,
        private readonly effects: MowEffects,
        /** Whether a district can be mowed (it's open). */
        private readonly canMow: (district: number) => boolean,
        /** The container just filled up (once per fill). */
        private readonly onFull: () => void,
        /** Grass the tool can't cut (at most once per hint). */
        private readonly onBlocked: (grass: GrassDef) => void,
        /** Cells were cut this step. */
        private readonly onCut: (cells: number) => void,
    ) {}

    public fixedUpdate(delta: number): void {
        this.hintCooldown = Math.max(0, this.hintCooldown - delta);
        this.chewHit = Math.max(0, this.chewHit - delta);
        this.player.drag = 1;
        const controller = this.player.movementController;
        if (!controller?.enabled || controller.input.length() < MOVE_THRESHOLD) return;
        if (MowProgress.full) return;
        // A ridden mower cuts only from the tractor (in the sections not restored yet).
        if (MowProgress.tool.ride && !this.player.riding) return;
        this.player.cutPoint(this.point);
        const feet = this.player.transform.position;
        const result = this.grass.cutCapsule(feet.x, feet.z, this.point.x, this.point.z, MowProgress.width / 2, MowProgress.power,
            // Sharp Blades: tough grass takes less contact to chew through.
            delta * MowProgress.chewRate, this.canMow);
        if (result.cells === 0 && result.chewing) {
            this.player.drag = CHEW_DRAG;
            if (this.chewHit <= 0) {
                this.chewHit = CHEW_HIT_SEC;
                this.effects.burst(result.chewing.at, result.chewing.color, 5, 3);
                MowAudio.play('cut');
            }
        } else if (result.cells === 0 && result.blocked) {
            this.player.drag = WALL_DRAG;
        }
        if (result.blocked && result.cells === 0) {
            const blocked = result.blocked;
            this.hint(() => this.onBlocked(blocked));
        }
        if (result.cells === 0) return;
        for (let i = 0; i < result.cells; i++) MowProgress.recordCut();
        MowProgress.addClippings(result.clippings);
        MowProgress.grassChanged();
        if (result.at && result.color) {
            const chips = Math.min(MAX_CHIPS, result.cells * CHIPS_PER_CELL);
            this.effects.burst(result.at, result.color, chips, 2.2);
        }
        MowAudio.play('cut');
        this.onCut(result.cells);
        if (MowProgress.full) this.onFull();
    }

    private hint(say: () => void): void {
        if (this.hintCooldown > 0) return;
        this.hintCooldown = HINT_COOLDOWN_SEC;
        say();
    }
}
