// DepositPacer.ts
//
// How fast a "stand here and pay" loop sends the next unit — every zone that
// drains the player one coin/resource at a time (BuildingZone, ShopZone,
// QueueZone, CraftZone, GateDropZone, FarmZone, StoragePurchaseZone, DropZone,
// StorageZone) schedules its next unit through its own pacer (schedule())
// instead of a fixed stagger.
//
// A session starts at the zone's normal stagger and eases up to
// DEPOSIT_MAX_SPEEDUP times faster over DEPOSIT_RAMP_SEC of continuous
// depositing, so a small cost still reads one-by-one while a 100-unit one
// doesn't drag. The session resets once no unit has been sent for
// DEPOSIT_RESET_GAP_SEC (the player stepped out, ran out, the level
// completed, ...). One pacer per zone: a zone draining several resource types
// at once (a building needing wood AND stone) shares one ramp across them.
//
// All of it runs on GAME time (core Game.elapsedSec — follows the game speed,
// stops while paused). And it's frame-rate independent: a frame longer than
// the delay (a slow device, or a playtest at 10x) sends every unit that fell
// due in it — up to MAX_CATCH_UP_UNITS per frame — instead of one per frame,
// which made paying take far longer in game time than designed.

import gsap from 'gsap';
import { Game } from 'core/Game';

/** Top speed, as a multiple of the zone's normal rate (3 = a third of the delay). */
export const DEPOSIT_MAX_SPEEDUP = 3;
/** Seconds of continuous depositing to reach top speed. */
export const DEPOSIT_RAMP_SEC = 3;
/** A pause longer than this (no unit sent) starts the next deposit back at normal speed. */
export const DEPOSIT_RESET_GAP_SEC = 0.6;
/** Most units one late frame sends at once — bounds the burst (and the recursion) after a long hitch. */
const MAX_CATCH_UP_UNITS = 20;

export default class DepositPacer {
    private readonly baseDelaySec: number;
    private sessionStartSec = Number.NEGATIVE_INFINITY;
    private lastStepSec = Number.NEGATIVE_INFINITY;
    /** Game seconds the last timer fired late by — owed to the next units. */
    private lateSec = 0;
    private catchUpDepth = 0;

    /** `baseDelaySec` — the zone's normal time between two units (its old fixed stagger). */
    public constructor(baseDelaySec: number) {
        this.baseDelaySec = baseDelaySec;
    }

    /** Call once per unit sent; returns how long to wait (game seconds) before sending the next one. */
    public nextDelaySec(): number {
        const now = Game.elapsedSec;
        if (now - this.lastStepSec > DEPOSIT_RESET_GAP_SEC) {
            this.sessionStartSec = now;
            this.lateSec = 0;
        }
        this.lastStepSec = now;
        const t = Math.min(1, Math.max(0, (now - this.sessionStartSec) / DEPOSIT_RAMP_SEC));
        const eased = t * t * (3 - 2 * t);
        return this.baseDelaySec / (1 + (DEPOSIT_MAX_SPEEDUP - 1) * eased);
    }

    /**
     * Runs `step` (send one unit, then call schedule(step) again to continue) after the next delay.
     * If the previous timer fired so late that this unit is already due, `step` runs right away —
     * see this file's own doc.
     */
    public schedule(step: () => void): void {
        let delay = this.nextDelaySec();
        if (this.lateSec >= delay && this.catchUpDepth < MAX_CATCH_UP_UNITS) {
            this.lateSec -= delay;
            this.catchUpDepth++;
            try {
                step();
            } finally {
                this.catchUpDepth--;
            }
            return;
        }
        delay = Math.max(0, delay - this.lateSec);
        this.lateSec = 0;
        const dueAt = Game.elapsedSec + delay;
        gsap.delayedCall(delay, () => {
            this.lateSec = Math.max(0, Game.elapsedSec - dueAt);
            step();
        });
    }
}
