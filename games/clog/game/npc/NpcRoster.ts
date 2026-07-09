import { NPC_IDLE_SIM_CONFIG, NPC_POPULATION_CONFIG } from './NpcConfig';
import { collapseMerges, createFreshRecord, type NpcRecord } from './NpcRecord';
import { rollFoodValue } from '../world/LinearConfig';
import { GrowthSimulator } from './GrowthSimulator';
import { generateNpcName } from './NpcNames';

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

    /** @param seed Whether to run seedPopulation() on construction — defaults on; pass false for a truly fresh, everyone-at-respawnValue roster (e.g. in tests). */
    constructor(size: number = NPC_POPULATION_CONFIG.rosterSize, seed: boolean = true) {
        const takenNames = new Set<string>();
        this.records = Array.from({ length: size }, () => {
            const name = generateNpcName(takenNames);
            takenNames.add(name);
            return createFreshRecord(this.nextId++, NPC_POPULATION_CONFIG.respawnValue, name);
        });
        if (seed) this.seedPopulation();
    }

    /**
     * Gives each record its own simulated feeding-time budget out of
     * NPC_POPULATION_CONFIG.seedElapsedSeconds — most get a short one (stay
     * close to respawnValue, as if freshly killed/respawned), only the top
     * few ranks get close to the full duration (as if they'd been surviving
     * and feeding the whole time) — then runs GrowthSimulator for that
     * budget to get each record's actual value. This is what produces the
     * "few big, many small" spread: every record racing the same clock
     * (i.e. calling GrowthSimulator.run(seedElapsedSeconds) for all of them)
     * would make the whole roster grow at nearly the same organic rate,
     * since the underlying feed mechanic is time-driven, not luck-driven.
     * Shuffled so the "leader" isn't always the same record id run to run.
     */
    private seedPopulation(): void {
        const cfg = NPC_POPULATION_CONFIG;
        const shuffled = [...this.records].sort(() => Math.random() - 0.5);
        const n = shuffled.length;
        for (let i = 0; i < n; i++) {
            const t = n === 1 ? 1 : i / (n - 1); // 0 = weakest rank .. 1 = leader
            const simSeconds = cfg.seedElapsedSeconds * Math.pow(t, cfg.seedSkew);
            const outcome = GrowthSimulator.run(simSeconds);
            shuffled[i].value = outcome.value;
            shuffled[i].tailValues = outcome.tailValues;
        }
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
        collapseMerges(record);
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
        collapseMerges(winner);

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
        collapseMerges(receiver);
    }
}
