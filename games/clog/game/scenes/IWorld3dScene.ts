import type { BotParams } from '../ai/Blackboard';
import type { DeathSnapshot } from '../ui-dom/PlayerFlowController';

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
    /** Debug-only: kills the player exactly as if eaten (drops their tail, triggers the normal death/respawn UI flow). No-op in modes without a death flow (see LinearWorld3dScene). */
    debugKillPlayer(): void;
    spawnBot(value: number, params?: Partial<BotParams>): void;
    spawnFood(count: number): void;
    /** Flat dump of the player + every live bot's value/score, for the in-game leaderboard (and the dev debug panel). */
    listEntities(): { name: string; value: number; score: number }[];
    /** Raw CSS-pixel screen position of a point just above the player's head — see ThreeScene.worldToScreen. Null when the player doesn't exist yet or is behind the camera. Used to position screen-space UI that tracks the 3D player (e.g. the boost indicator). */
    getPlayerScreenAnchor(): { x: number; y: number } | null;
    /** Re-creates the player entity after death — pass the captured deathInfo to keep their size, or {value: 2, tailValues: []} for a fresh respawn. */
    respawnPlayer(value: number, tailValues: number[]): void;
    /** Starts the NPC population (idle growth + active-window spawning) — dormant until the player actually joins, so the menu screen shows just the player alone in the world. Safe to call more than once. */
    startNpcPopulation(): void;
    /** Shows/hides the player's forward-facing direction triangle — hidden while parked on the boot/death menu, since there's no live control to indicate a direction for yet. */
    setPlayerIndicatorVisible(visible: boolean): void;
}
