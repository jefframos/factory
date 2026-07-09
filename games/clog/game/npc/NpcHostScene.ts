import type { BotController } from '../ai/BotController';
import type { BotParams } from '../ai/Blackboard';

/**
 * The minimal surface NpcDirector needs from whatever 3D scene hosts it.
 * Deliberately not part of IWorld3dScene — NPCs only make sense in the open
 * boundless world, not the gated linear-room mode, and this way
 * LinearWorld3dScene never has to stub out spawn/despawn methods it has no
 * use for. BoundlessWorld3dScene implements this directly; NpcDirector only
 * ever depends on this interface, not the concrete class.
 */
export interface NpcHostScene {
    readonly playerPosition: { x: number; z: number };
    readonly playerValue: number;

    /**
     * Finds a walkable point in the ring [minDist, maxDist] around (cx, cz).
     * Falls back to the closest available cell if none land past minDist
     * (e.g. very early on, before many chunks have streamed in), and returns
     * null only if the area has no walkable cells at all yet.
     */
    findSpawnRing(cx: number, cz: number, minDist: number, maxDist: number): { x: number; z: number } | null;

    /** Spawns a real bot at `pos` with a preset tail composition (mirrors PlayerEntity.collect() per cube) instead of the single-cube default spawnBot() gives you. `name` carries the record's stable, non-translated display name through to the live BotController — see NpcNames.generateNpcName. */
    materializeNpc(pos: { x: number; z: number }, value: number, tailValues: number[], name: string, params?: Partial<BotParams>): BotController;

    /** Tears down a materialized bot and hands back its final value/tail so the caller can save it into persistent NPC data before the entity is gone. */
    dematerializeNpc(controller: BotController): { value: number; tailValues: number[] };
}
