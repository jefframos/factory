import type { PlayerEntity } from '../entities/PlayerEntity';
import type { BotController } from '../ai/BotController';
import type { BotParams } from '../ai/Blackboard';
import { NPC_DIFFICULTY_CONFIG, NPC_PERSONALITY_CONFIG, NPC_POPULATION_CONFIG, NPC_SPAWN_CONFIG } from './NpcConfig';
import { NpcRoster } from './NpcRoster';
import { scoreOf, type NpcRecord } from './NpcRecord';
import type { NpcHostScene } from './NpcHostScene';

/**
 * Orchestrates the persistent 24-NPC population against a live scene: keeps
 * an "active window" of ~activeMin-activeMax records materialized as real
 * bots near the player, dematerializes ones that wander too far, and folds a
 * real on-screen death back into the roster via onEntitiesRemoved.
 *
 * Everything idle (growth, offscreen kill/steal) is delegated to `roster` —
 * this class only ever touches the subset of records currently `active`.
 */
export class NpcDirector {
    readonly roster = new NpcRoster();

    private readonly active = new Map<NpcRecord, BotController>();
    private checkTimer = 0;

    update(delta: number, host: NpcHostScene): void {
        this.roster.update(delta);

        this.checkTimer += delta;
        if (this.checkTimer < NPC_SPAWN_CONFIG.checkInterval) return;
        this.checkTimer = 0;

        this.pruneFarNpcs(host);
        this.topUp(host);
    }

    /**
     * Called by the scene right after resolveEntityEating() removes real
     * bots — recycles whichever active record(s) that maps to immediately.
     * Distinct from pruneFarNpcs: the entity here is already destroyed (its
     * own onEaten() tore down visuals and SimWorld.unregister already ran),
     * so this only fixes up bookkeeping — it must NOT call
     * host.dematerializeNpc, which would try to read/destroy an
     * already-dead entity.
     */
    /**
     * Flat dump of the whole population for UI (e.g. LeaderboardPanel) —
     * active entries reflect live entity state, idle entries reflect the
     * record directly. Keyed by the record's own stable `id` throughout,
     * unlike naively mixing in BotController.id (which is a separate global
     * counter also shared with ad-hoc debug-spawned bots) — a UI reading
     * that would see a given NPC's identity/rank change every time it
     * materializes or dematerializes, and would leak debug bots into a
     * player-facing list.
     */
    listAll(): { id: number; value: number; score: number }[] {
        return this.roster.records.map(record => {
            const controller = this.active.get(record);
            return controller
                ? { id: record.id, value: controller.entity.value, score: controller.entity.score }
                : { id: record.id, value: record.value, score: scoreOf(record) };
        });
    }

    onEntitiesRemoved(removed: PlayerEntity[]): void {
        if (removed.length === 0) return;

        for (const [record, controller] of this.active) {
            if (!removed.includes(controller.entity)) continue;

            record.value = NPC_POPULATION_CONFIG.respawnValue;
            record.tailValues = [];
            record.state = 'idle';
            record.idleSince = 0;
            this.active.delete(record);
        }
    }

    private pruneFarNpcs(host: NpcHostScene): void {
        const { x: px, z: pz } = host.playerPosition;
        const despawnDist2 = NPC_SPAWN_CONFIG.despawnDistance * NPC_SPAWN_CONFIG.despawnDistance;

        for (const [record, controller] of this.active) {
            const dx = controller.entity.position.x - px;
            const dz = controller.entity.position.z - pz;
            if (dx * dx + dz * dz <= despawnDist2) continue;

            const snapshot = host.dematerializeNpc(controller);
            record.value = snapshot.value;
            record.tailValues = snapshot.tailValues;
            record.state = 'idle';
            record.idleSince = 0;
            this.active.delete(record);
        }
    }

    /**
     * Below activeMin, catches up immediately (spawns the whole deficit in
     * one pass) since the player is short on things to interact with right
     * now. Between activeMin and activeMax, trickles in one at a time per
     * check tick instead — there's no urgency, and spawning several at once
     * right on top of each other reads as a pop-in swarm rather than a
     * gradually repopulating world.
     */
    private topUp(host: NpcHostScene): void {
        if (this.active.size >= NPC_POPULATION_CONFIG.activeMax) return;

        const deficit = NPC_POPULATION_CONFIG.activeMin - this.active.size;
        const spawnCount = deficit > 0 ? deficit : 1;

        for (let i = 0; i < spawnCount && this.active.size < NPC_POPULATION_CONFIG.activeMax; i++) {
            this.materializeOne(host);
        }
    }

    private materializeOne(host: NpcHostScene): void {
        const idle = this.roster.records.filter(r => r.state === 'idle');
        if (idle.length === 0) return; // roster fully materialized already — shouldn't happen while rosterSize > activeMax

        const playerValue = host.playerValue;
        const record = this.pickRecordFor(idle, playerValue);

        const { x: px, z: pz } = host.playerPosition;
        const spot = host.findSpawnRing(px, pz, NPC_SPAWN_CONFIG.spawnMinDistance, NPC_SPAWN_CONFIG.spawnMaxDistance);
        if (!spot) return; // no walkable cell out there yet (chunks not streamed that far) — retried next check tick

        const controller = host.materializeNpc(spot, record.value, record.tailValues, this.rollParams(playerValue));
        record.state = 'active';
        this.active.set(record, controller);
    }

    /** See NPC_DIFFICULTY_CONFIG — while the player is low-level, prefer weak idle records over a uniform random pick so their first encounters aren't a coin flip against something huge. */
    private pickRecordFor(idle: NpcRecord[], playerValue: number): NpcRecord {
        if (playerValue > NPC_DIFFICULTY_CONFIG.lowLevelPlayerThreshold) {
            return idle[Math.floor(Math.random() * idle.length)];
        }

        const ceiling = playerValue * NPC_DIFFICULTY_CONFIG.lowLevelValueMultiplier;
        const weak = idle.filter(r => scoreOf(r) <= ceiling);
        const pool = weak.length > 0 ? weak : idle;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    /** Base BotParams from config, jittered per-NPC so the population isn't identical clones — see NPC_PERSONALITY_CONFIG. Aggressiveness is additionally capped while the player is low-level (NPC_DIFFICULTY_CONFIG). */
    private rollParams(playerValue: number): Partial<BotParams> {
        const cfg = NPC_PERSONALITY_CONFIG;
        const jitter = (base: number, variance: number, min: number, max: number) =>
            Math.max(min, Math.min(max, base + (Math.random() * 2 - 1) * variance));

        let aggressiveness = jitter(cfg.aggressiveness, cfg.aggressivenessVariance, 0, 1);
        if (playerValue <= NPC_DIFFICULTY_CONFIG.lowLevelPlayerThreshold) {
            aggressiveness = Math.min(aggressiveness, NPC_DIFFICULTY_CONFIG.lowLevelAggressivenessCap);
        }

        return {
            aggressiveness,
            awarenessRadius: jitter(cfg.awarenessRadius, cfg.awarenessRadiusVariance, 1, 500),
            fleeThreshold: cfg.fleeThreshold,
            wanderSpeed: cfg.wanderSpeed,
            leashRadius: cfg.leashRadius,
        };
    }
}
