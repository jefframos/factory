// QuestGiverTypes.ts
//
// Data-driven definition of the NPC/prop standing at a queue and offering
// its task — same "pure data, no engine imports" shape as QueueTypes.ts's
// QUEUE_CONFIG_BY_ID: an OPTIONAL per-queue-id override map, since a quest
// giver is purely decorative and most queues won't have one at all (see
// QuestGiverEntity.ts, the one consumer, and PizzaScene.setupQueues(),
// which just skips spawning one when getQuestGiverConfig() returns
// undefined).
//
// A queue giver comes in one or more VARIANTS — a look (an EntityViewRegistry
// id, same dropdown the pizza web editor's buildings/shops/gates tabs already
// use) paired with a LootTableRegistry id (see LootTableTypes.ts's own doc),
// so "a rare big ship gives better tasks than the common rowboat" is just
// two variants pointing at different loot tables with different weights,
// rather than a second config layer embedded inline. rollQuestGiverVariant()
// below is the one place that picks which variant shows up for a given
// cycle.

export interface QuestGiverVariant {
    /** EntityViewRegistry id — this variant's look, set from the pizza web editor's Entity Views tab (see EntityViewRegistry.ts's own doc). */
    view: string;
    /** Relative weight for how often this variant is picked — see rollQuestGiverVariant(). Lower = rarer, higher = more common; weights are relative, not required to sum to 100, same convention as ProviderConfig.drops' own weight. */
    weight: number;
    /** LootTableRegistry id — rolled when THIS variant's giver arrives at the queue (see QuestGiverEntity.onArrivedGoingIn()/LootTableTypes.getLootTable()), so whichever variant showed up this cycle determines the task pool. */
    lootTable: string;
}

export interface QuestGiverConfig {
    /** At least one entry — see rollQuestGiverVariant(). */
    variants: QuestGiverVariant[];
    /** World units per second the giver walks its waypoint path at — shared across every variant for this queue (the PATH's own pace, not tied to which variant happens to be walking it this cycle). See QuestGiverEntity.ts's own doc on why leg durations are DERIVED from this and each leg's real distance, not hand-tuned per queue. */
    moveSpeed: number;
}

/** Per-queue-id quest giver, keyed by the same string id the Tiled "queue" object uses (see WorldObjectRegistry.getAllOfType()/PizzaScene.setupQueues()). Empty/missing entry means that queue has no giver at all. */
export const QUEST_GIVER_CONFIG_BY_ID: Partial<Record<string, QuestGiverConfig>> = {
    queue1: {
        variants: [
            {
                "view": "ship1View",
                "weight": 1,
                "lootTable": "animalsRequests"
            }
        ],
        moveSpeed: 4,
    },
};

/** The config for `id`'s quest giver, or undefined if it has none — see this file's own doc. */
export function getQuestGiverConfig(id: string): QuestGiverConfig | undefined {
    return QUEST_GIVER_CONFIG_BY_ID[id];
}

/**
 * Weighted-random pick off `config.variants` — same relative-weight algorithm as
 * ProviderTypes.rollProviderDrop(). `forceLowestWeight` skips the roll entirely and returns
 * whichever variant has the lowest weight (ties broken by array order) — used only for a
 * giver's very first appearance this session (see QuestGiverEntity.ts's own doc), so a queue's
 * rarest look is guaranteed to be what a player sees the first time, rather than left to
 * chance; every later reshuffle rolls normally.
 */
export function rollQuestGiverVariant(config: QuestGiverConfig, forceLowestWeight: boolean): QuestGiverVariant {
    if (forceLowestWeight) {
        return config.variants.reduce((lowest, variant) => (variant.weight < lowest.weight ? variant : lowest));
    }

    const totalWeight = config.variants.reduce((sum, variant) => sum + variant.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const variant of config.variants) {
        if (roll < variant.weight) {
            return variant;
        }
        roll -= variant.weight;
    }
    // Floating-point rounding could theoretically leave `roll` fractionally over the last
    // entry's own weight after subtracting every prior one — falling back to the last entry
    // rather than undefined keeps this total, never "no variant picked."
    return config.variants[config.variants.length - 1];
}
