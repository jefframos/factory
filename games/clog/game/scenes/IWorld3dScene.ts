import type { BotParams } from '../ai/Blackboard';
import type { DeathSnapshot } from '../ui-dom/PlayerFlowController';

/**
 * One live floating-HUD target — the player or a materialized NPC, treated
 * identically here regardless of which. `id` is stable for as long as the
 * entity is alive, so EntityIndicatorManager can key a Map to it and recycle
 * its floating UI container (name tag + boost bar) the moment the id stops
 * appearing — entity eaten/despawned, or the player mid-death awaiting a
 * respawn choice — instead of leaking one per entity that ever existed.
 */
export interface EntityUiTarget {
    id: string;
    /** Shown above the entity's head and set as the recycled container's PIXI `.name` — 'YOU' for the player, an NPC label otherwise. */
    name: string;
    boostT: number;
    screenAnchor: { x: number; y: number } | null;
}

export interface IWorld3dScene {
    moveInput: { x: number; z: number };
    cameraZoom: number;
    readonly playerValue: number;
    readonly playerScore: number;
    readonly playerPosition: { x: number; z: number };
    /** 0..1 — fraction of the player's tap-start speed boost still remaining; 0 when not boosting. See PlayerEntity.boostT. */
    readonly playerBoostT: number;
    readonly currentRoomIndex: number;
    readonly nextGateValue: number;
    /** Non-null exactly while the player is dead, awaiting a respawn choice from the UI — holds the value/tail captured right before death (so a "watch a video" respawn can restore it) plus a leaderboard snapshot for the End Game screen's rank/rows. */
    readonly deathInfo: DeathSnapshot | null;
    build(): Promise<void>;
    update(delta: number): void;
    destroy(): void;
    debugDoublePlayerValue(): void;
    /** Held-boost switch for the pointer-follow control scheme (see PointerFollowInput) — boosted for exactly as long as the pointer/finger stays down. See PlayerEntity.setBoosting. */
    setPlayerBoosting(active: boolean): void;
    /** Debug-only: kills the player exactly as if eaten (drops their tail, triggers the normal death/respawn UI flow). No-op in modes without a death flow (see LinearWorld3dScene). */
    debugKillPlayer(): void;
    spawnBot(value: number, params?: Partial<BotParams>): void;
    spawnFood(count: number): void;
    /** Flat dump of the player + every live bot's value/score, for the in-game leaderboard (and the dev debug panel). */
    listEntities(): { name: string; value: number; score: number }[];
    /** Raw CSS-pixel screen position of a point just above the player's head — see ThreeScene.worldToScreen. Null when the player doesn't exist yet or is behind the camera. Used to position screen-space UI that tracks the 3D player (e.g. the boost indicator). */
    getPlayerScreenAnchor(): { x: number; y: number } | null;
    /** Player + every live, materialized NPC's name/boost state, for the floating per-entity HUD — see EntityUiTarget and EntityIndicatorManager. */
    listEntityUiTargets(): EntityUiTarget[];
    /** Re-creates the player entity after death — pass the captured deathInfo to keep their size, or {value: 2, tailValues: []} for a fresh respawn. */
    respawnPlayer(value: number, tailValues: number[]): void;
    /** Starts the NPC population (idle growth + active-window spawning) — dormant until the player actually joins, so the menu screen shows just the player alone in the world. Safe to call more than once. */
    startNpcPopulation(): void;
    /** Shows/hides the player's forward-facing direction triangle — hidden while parked on the boot/death menu, since there's no live control to indicate a direction for yet. */
    setPlayerIndicatorVisible(visible: boolean): void;
}
