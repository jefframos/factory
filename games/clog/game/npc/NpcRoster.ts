import { NPC_IDLE_SIM_CONFIG, NPC_POPULATION_CONFIG } from './NpcConfig';
import { createFreshRecord, type NpcRecord } from './NpcRecord';
import { rollFoodValue } from '../world/LinearConfig';

/**
 * Owns the persistent 24-NPC world population as plain data. Records in
 * `state: 'idle'` are advanced here (fed on a timer using the weighted food
 * pool above, occasionally killed/merged or nibbled by each other); records
 * flipped to `state: 'active'` by NpcDirector are skipped — a real
 * BotController is driving those, and re-simulating them here would double
 * up on their growth.
 *
 * No THREE/scene/rendering dependencies — safe to unit-test or run headless.
 */
export class NpcRoster {
    readonly records: NpcRecord[];

    private killTimer = 0;
    private stealTimer = 0;
    private nextId = 1;

    constructor(size: number = NPC_POPULATION_CONFIG.rosterSize) {
        this.records = Array.from(
            { length: size },
            () => createFreshRecord(this.nextId++, NPC_POPULATION_CONFIG.respawnValue),
        );
    }

    update(delta: number): void {
        for (const record of this.records) {
            if (record.state !== 'idle') continue;

            record.idleSince += delta;
            while (record.idleSince >= NPC_IDLE_SIM_CONFIG.feedInterval) {
                record.idleSince -= NPC_IDLE_SIM_CONFIG.feedInterval;
                this.feed(record, rollFoodValue());
            }
        }

        this.killTimer += delta;
        if (this.killTimer >= NPC_IDLE_SIM_CONFIG.killEventInterval) {
            this.killTimer = 0;
            this.rollKillEvent();
        }

        this.stealTimer += delta;
        if (this.stealTimer >= NPC_IDLE_SIM_CONFIG.stealEventInterval) {
            this.stealTimer = 0;
            this.rollStealEvent();
        }
    }

    private feed(record: NpcRecord, value: number): void {
        record.tailValues.push(value);
        record.tailValues.sort((a, b) => b - a);
        this.collapseMerges(record);
    }

    /**
     * Plain-data equivalent of PlayerEntity.scheduleMerges: absorb a
     * head-matching front cube into the head first (same priority reason as
     * the real one — otherwise a tail merge can double past the head and
     * permanently orphan it), then collapse adjacent equal pairs closest to
     * the head first, re-checking head-absorb after each collapse since a
     * tail merge can produce a new head match.
     */
    private collapseMerges(record: NpcRecord): void {
        let changed = true;
        while (changed) {
            changed = false;

            while (record.tailValues.length > 0 && record.tailValues[0] === record.value) {
                record.value *= 2;
                record.tailValues.shift();
                changed = true;
            }

            for (let i = 0; i < record.tailValues.length - 1; i++) {
                if (record.tailValues[i] === record.tailValues[i + 1]) {
                    record.tailValues[i] *= 2;
                    record.tailValues.splice(i + 1, 1);
                    changed = true;
                    break;
                }
            }
        }
    }

    /**
     * Picks two distinct idle records at random; whichever has the higher
     * HEAD VALUE wins (ties go to either — same `a.value >= b.value` rule as
     * the real head-eats-head check in EntityEating.ts) and absorbs the
     * other's whole tail + head-as-a-cube. The loser resets to a fresh
     * minimum record instead of being removed, keeping the roster at a
     * constant size.
     *
     * Deliberately compares head value, NOT total score: a real kill only
     * ever happens head-to-body, so a record with a small head but a big
     * tail (high score) can never actually eat a bigger head in the real
     * game either. An earlier version of this compared scoreOf() instead,
     * which let a head=2 record with a heavy tail "win" against a bare
     * head=128 record and splice that 128 straight into its own tail —
     * producing exactly the "enemy has head 2 but a tail entry of 128"
     * result that's impossible in real gameplay.
     *
     * Deliberately no "is this worth it" ceiling like chaseWeakerPrey's
     * preyValueCeiling: idle records all feed from the same distribution, so
     * their head values converge tightly, and gating on a ceiling meant
     * almost no kill ever found a qualifying victim. A live bot's chase
     * decision needs that gate (it's choosing whether to bother); background
     * population churn doesn't.
     */
    private rollKillEvent(): void {
        const idle = this.records.filter(r => r.state === 'idle');
        if (idle.length < 2) return;

        const i = Math.floor(Math.random() * idle.length);
        let j = Math.floor(Math.random() * (idle.length - 1));
        if (j >= i) j++;

        const [winner, loser] = idle[i].value >= idle[j].value ? [idle[i], idle[j]] : [idle[j], idle[i]];

        winner.tailValues.push(loser.value, ...loser.tailValues);
        winner.tailValues.sort((a, b) => b - a);
        this.collapseMerges(winner);

        loser.value = NPC_POPULATION_CONFIG.respawnValue;
        loser.tailValues = [];
        loser.idleSince = 0;
    }

    /** One idle record's weakest tail cube (or its whole self, if tailless — mirrors head-eats-head being an option too) moves to another, without resetting the donor. */
    private rollStealEvent(): void {
        const idle = this.records.filter(r => r.state === 'idle' && r.tailValues.length > 0);
        if (idle.length === 0) return;

        const donor = idle[Math.floor(Math.random() * idle.length)];
        const receivers = this.records.filter(r => r.state === 'idle' && r !== donor);
        if (receivers.length === 0) return;
        const receiver = receivers[Math.floor(Math.random() * receivers.length)];

        const stolen = donor.tailValues.pop(); // weakest, since sorted descending
        if (stolen === undefined) return;

        receiver.tailValues.push(stolen);
        receiver.tailValues.sort((a, b) => b - a);
        this.collapseMerges(receiver);
    }
}
