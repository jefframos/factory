// DepositPacer.ts
//
// How fast a "stand here and pay" loop sends the next unit — every zone that
// drains the player one coin/resource at a time (BuildingZone, ShopZone,
// QueueZone, CraftZone, GateDropZone, FarmZone, StoragePurchaseZone, DropZone,
// StorageZone) asks its own pacer for the delay before the next unit instead
// of using a fixed stagger.
//
// A session starts at the zone's normal stagger and eases up to
// DEPOSIT_MAX_SPEEDUP times faster over DEPOSIT_RAMP_SEC of continuous
// depositing, so a small cost still reads one-by-one while a 100-unit one
// doesn't drag. The session resets once no unit has been sent for
// DEPOSIT_RESET_GAP_SEC (the player stepped out, ran out, the level
// completed, ...). One pacer per zone: a zone draining several resource types
// at once (a building needing wood AND stone) shares one ramp across them.

/** Top speed, as a multiple of the zone's normal rate (3 = a third of the delay). */
export const DEPOSIT_MAX_SPEEDUP = 3;
/** Seconds of continuous depositing to reach top speed. */
export const DEPOSIT_RAMP_SEC = 3;
/** A pause longer than this (no unit sent) starts the next deposit back at normal speed. */
export const DEPOSIT_RESET_GAP_SEC = 0.6;

export default class DepositPacer {
    private readonly baseDelaySec: number;
    private sessionStartMs = Number.NEGATIVE_INFINITY;
    private lastStepMs = Number.NEGATIVE_INFINITY;

    /** `baseDelaySec` — the zone's normal time between two units (its old fixed stagger). */
    public constructor(baseDelaySec: number) {
        this.baseDelaySec = baseDelaySec;
    }

    /** Call once per unit sent; returns how long to wait before sending the next one. */
    public nextDelaySec(): number {
        const now = performance.now();
        if (now - this.lastStepMs > DEPOSIT_RESET_GAP_SEC * 1000) {
            this.sessionStartMs = now;
        }
        this.lastStepMs = now;
        const t = Math.min(1, Math.max(0, (now - this.sessionStartMs) / (DEPOSIT_RAMP_SEC * 1000)));
        const eased = t * t * (3 - 2 * t);
        return this.baseDelaySec / (1 + (DEPOSIT_MAX_SPEEDUP - 1) * eased);
    }
}
