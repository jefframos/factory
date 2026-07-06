import { rollFoodValue } from '../world/LinearConfig';
import { NPC_IDLE_SIM_CONFIG, NPC_POPULATION_CONFIG } from './NpcConfig';
import { collapseMerges } from './NpcRecord';

/** Bare {value, tailValues} shape — same fields NpcRecord uses for growth, without the roster bookkeeping (id, state, position) that doesn't apply to a throwaway simulation entity. */
export type GrowthOutcome = {
    value: number;
    tailValues: number[];
};

/**
 * Simulates one entity feeding for `seconds` of world time — same
 * feedInterval and food-value weights the live idle population uses (see
 * NpcRoster.update) — and returns its resulting {value, tailValues}. Used by
 * NpcRoster.seedPopulation to pre-age the roster instead of every NPC
 * starting at respawnValue, or a hand-authored curve pretending to know the
 * answer: running the real feed/merge mechanic gives an organic total (a sum
 * of accumulated food/merged cubes) instead of a suspiciously clean power of
 * two.
 *
 * Deliberately no combat here — an earlier version had every seeded record
 * fight over a shared pool via size-weighted kill events, modeling "bigger
 * entities are more effective hunters and more visible targets." That
 * snowballed instead: winning raises an entity's weight, which raises its
 * win odds next round, which raises its weight further, so one record ran
 * away with nearly the whole population's growth while the rest stayed
 * flat — not the "few big, many small" spread it was meant to produce. What
 * actually produces that spread cleanly is NpcRoster.seedPopulation giving
 * each record a different simulated feeding-time budget (most short, a few
 * long) instead of everyone racing the same clock — see that method's doc.
 */
export class GrowthSimulator {
    static run(seconds: number, step: number = NPC_IDLE_SIM_CONFIG.feedInterval): GrowthOutcome {
        const entity: GrowthOutcome = { value: NPC_POPULATION_CONFIG.respawnValue, tailValues: [] };

        let feedClock = 0;
        for (let elapsed = 0; elapsed < seconds; elapsed += step) {
            feedClock += step;
            while (feedClock >= NPC_IDLE_SIM_CONFIG.feedInterval) {
                feedClock -= NPC_IDLE_SIM_CONFIG.feedInterval;
                entity.tailValues.push(rollFoodValue());
                entity.tailValues.sort((a, b) => b - a);
                collapseMerges(entity);
            }
        }

        return entity;
    }
}
