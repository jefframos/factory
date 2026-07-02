import * as THREE from "three";

/**
 * Static personality knobs for one AI entity. Set at spawn (or tuned live via
 * dev tools) and read by behaviour-tree nodes to bias decisions.
 */
export type BotParams = {
    /** 0-1. How willing this entity is to chase prey close to its own size — 0 barely chases, 1 chases anything smaller. */
    aggressiveness: number;
    /** World-units radius of the SimWorld query used to sense food/entities/threats. */
    awarenessRadius: number;
    /** 0-1. A threat is fled from once its value exceeds `value / fleeThreshold` — lower = braver (flees only much bigger threats). */
    fleeThreshold: number;
    /** 0-1 input-strength used while wandering with no food/threat/prey in range. */
    wanderSpeed: number;
    /** World-units from spawn a bot is allowed to wander before being steered back — keeps it inside the terrain that's always streamed in around the player, so it can't drift into an unloaded chunk and get trapped when that chunk's obstacles are later generated on top of it. */
    leashRadius: number;
};

export const DEFAULT_BOT_PARAMS: BotParams = {
    aggressiveness: 0.5,
    awarenessRadius: 32,
    fleeThreshold: 0.6,
    wanderSpeed: 0.6,
    leashRadius: 55,
};

/**
 * Per-entity working memory for the behaviour tree: static `params` plus
 * whatever runtime state nodes read/write between ticks (current heading,
 * timers, target refs). Deliberately independent of any live PlayerEntity —
 * it's the piece that should keep existing for an off-screen/simulated-only
 * entity slot even when there's no mesh to drive.
 */
export class Blackboard {
    params: BotParams;

    /** Mirrors the live entity's position when one exists. */
    position = new THREE.Vector3();
    /** Mirrors the live entity's value when one exists. */
    value = 2;

    /** Debug-only: when true, flee/chase queries pretend the registered player doesn't exist. */
    ignorePlayer = false;

    private data = new Map<string, unknown>();

    constructor(params: Partial<BotParams> = {}) {
        this.params = { ...DEFAULT_BOT_PARAMS, ...params };
    }

    get<T>(key: string): T | undefined {
        return this.data.get(key) as T | undefined;
    }
    set<T>(key: string, value: T): void {
        this.data.set(key, value);
    }
    has(key: string): boolean {
        return this.data.has(key);
    }
    delete(key: string): void {
        this.data.delete(key);
    }
}
