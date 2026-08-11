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
// `models`/`scale`/`rotationDeg` mirror AssetLibraryRegistry.AssetLibraryEntry's
// own shape (one of `models` is picked at random per spawn, scale/rotation
// rolled once from their own ranges) — reuses that file's pickRandom()/
// resolveRange()/NumberRange rather than duplicating them.

import { ModelDefinition } from '../../registry/assetsRegistry/modelsRegistry';
import MODELS from '../../registry/assetsRegistry/modelsRegistry';
import { NumberRange } from '../world/AssetLibraryRegistry';

export interface QuestGiverConfig {
    /** Candidate models for this queue's giver — one is picked at random per spawn (see pickRandom()). */
    models: ModelDefinition[];
    scale: NumberRange;
    /** A fixed CORRECTION offset applied on top of whichever way the giver is actually facing while walking (see QuestGiverEntity.ts's own doc) — tune this if the model's own "forward" isn't +Z, same reasoning AssetLibraryEntry.rotationDeg has for a stationary prop, just composed with a live facing angle here instead of being the only rotation. */
    rotationDeg: NumberRange;
    /** World units per second the giver walks its waypoint path at — see QuestGiverEntity.ts's own doc on why leg durations are DERIVED from this and each leg's real distance, not hand-tuned per queue. */
    moveSpeed: number;
}

/** Per-queue-id quest giver, keyed by the same string id the Tiled "queue" object uses (see WorldObjectRegistry.getAllOfType()/PizzaScene.setupQueues()). Empty/missing entry means that queue has no giver at all. */
export const QUEST_GIVER_CONFIG_BY_ID: Partial<Record<string, QuestGiverConfig>> = {
    // Test entry — a beached pirate ship standing in for queue1's giver until real art/an
    // actual NPC exists.
    queue1: {
        models: [MODELS.Pirate.ShipMedium],
        scale: 1,
        rotationDeg: 0,
        moveSpeed: 4,
    },
};

/** The config for `id`'s quest giver, or undefined if it has none — see this file's own doc. */
export function getQuestGiverConfig(id: string): QuestGiverConfig | undefined {
    return QUEST_GIVER_CONFIG_BY_ID[id];
}
