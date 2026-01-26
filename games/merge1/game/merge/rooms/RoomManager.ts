// rooms/RoomManager.ts
import * as PIXI from "pixi.js";
import { CoinManager } from "../manager/CoinManager";
import { EntityManager } from "../manager/EntityManager";
import GameStorage, { IFarmSaveData, IRoomStateSaveData } from "../storage/GameStorage";

export interface RoomManagerConfig {
    defaultRoomId: string;          // "room_0"
    unlockEveryLevels: number;      // e.g. 5
    maxRooms?: number;              // optional cap
    shuffleOnEnter: boolean;        // true
    coinMinDistPx?: number;         // anti-cluster spacing
    coinSpawnTries?: number;        // rejection-sampling tries
}

export default class RoomManager {
    private readonly cfg: Required<RoomManagerConfig>;
    private activeRoomId: string;

    public constructor(
        private readonly entities: EntityManager,
        private readonly coins: CoinManager,
        private readonly walkBounds: PIXI.Rectangle,
        cfg: RoomManagerConfig
    ) {
        this.cfg = {
            maxRooms: cfg.maxRooms ?? 99,
            coinMinDistPx: cfg.coinMinDistPx ?? 55,
            coinSpawnTries: cfg.coinSpawnTries ?? 18,
            ...cfg
        };

        const state = this.ensureRoomsExist(GameStorage.instance.getFullState());
        this.activeRoomId = state.activeRoomId ?? this.cfg.defaultRoomId;
    }

    public getActiveRoomId(): string {
        return this.activeRoomId;
    }

    /** Call when player level changes; creates rooms if newly unlocked. */
    public ensureUnlockedRooms(playerLevel: number): void {
        const state = this.ensureRoomsExist(GameStorage.instance.getFullState());
        const shouldHave = Math.min(
            this.cfg.maxRooms,
            1 + Math.floor(playerLevel / Math.max(1, this.cfg.unlockEveryLevels))
        );

        for (let i = 0; i < shouldHave; i++) {
            const id = `room_${i}`;
            if (!state.rooms![id]) {
                state.rooms![id] = {
                    id,
                    entities: [],
                    coinsOnGround: [],
                    lastSimulatedAtMs: Date.now()
                };
            }
        }

        GameStorage.instance.saveFullState(state);
    }

    /** Switch active room. This will persist current room, simulate others, and hydrate the new room. */
    public switchTo(roomId: string): void {
        const state = this.ensureRoomsExist(GameStorage.instance.getFullState());

        // Persist current active room (dehydrate)
        this.persistActiveRoomToState(state);

        // Update activeRoomId
        this.activeRoomId = roomId;
        state.activeRoomId = roomId;

        // Simulate inactive rooms “catch up” before we enter new room
        this.simulateInactiveRooms(state);

        // Hydrate target room
        this.hydrateRoomFromState(state, roomId, this.cfg.shuffleOnEnter);

        GameStorage.instance.saveFullState(state);
    }

    /** Call every frame from your mediator update. This keeps active room live, and you can optionally do light background simulation. */
    public update(_dtSeconds: number): void {
        // No-op by default. We simulate inactive rooms only on room switches (cheapest and deterministic).
        // If you want always-running background sim for inactive rooms, you can add a timer here.
    }

    // -------------------------
    // Persistence / Hydration
    // -------------------------

    private ensureRoomsExist(state: IFarmSaveData): IFarmSaveData {
        if (!state.rooms) {
            const legacyEntities = state.entities ?? [];
            const legacyCoins = state.coinsOnGround ?? [];

            state.rooms = {
                [this.cfg.defaultRoomId]: {
                    id: this.cfg.defaultRoomId,
                    entities: legacyEntities,
                    coinsOnGround: legacyCoins,
                    lastSimulatedAtMs: Date.now()
                }
            };

            state.activeRoomId = this.cfg.defaultRoomId;

            // Optional: remove legacy roots to avoid confusion
            delete (state as any).entities;
            delete (state as any).coinsOnGround;

            GameStorage.instance.saveFullState(state);
        }

        if (!state.activeRoomId) {
            state.activeRoomId = this.cfg.defaultRoomId;
            GameStorage.instance.saveFullState(state);
        }

        if (!state.rooms![state.activeRoomId]) {
            state.rooms![state.activeRoomId] = {
                id: state.activeRoomId,
                entities: [],
                coinsOnGround: [],
                lastSimulatedAtMs: Date.now()
            };
            GameStorage.instance.saveFullState(state);
        }

        return state;
    }

    private persistActiveRoomToState(state: IFarmSaveData): void {
        const room = this.getRoomOrCreate(state, this.activeRoomId);

        room.entities = this.entities.exportEntities();
        room.coinsOnGround = this.coins.exportCoins();
        room.lastSimulatedAtMs = Date.now();
        state.rooms![this.activeRoomId] = room;

        // Clear visuals/managers for clean swap
        this.entities.clearAll();
        this.coins.clearAll();
    }

    private hydrateRoomFromState(state: IFarmSaveData, roomId: string, shufflePositions: boolean): void {
        const room = this.getRoomOrCreate(state, roomId);

        // Load entities + coins into live managers
        this.entities.importEntities(room.entities, { shufflePositions });
        this.coins.importCoins(room.coinsOnGround);

        // Mark “now” for future catch-up
        room.lastSimulatedAtMs = Date.now();
        state.rooms![roomId] = room;
    }

    private getRoomOrCreate(state: IFarmSaveData, roomId: string): IRoomStateSaveData {
        const rooms = (state.rooms ??= {});
        const existing = rooms[roomId];
        if (existing) {
            return existing;
        }

        const created: IRoomStateSaveData = {
            id: roomId,
            entities: [],
            coinsOnGround: [],
            lastSimulatedAtMs: Date.now()
        };
        rooms[roomId] = created;
        return created;
    }

    // -------------------------
    // Inactive rooms simulation
    // -------------------------

    private simulateInactiveRooms(state: IFarmSaveData): void {
        const now = Date.now();
        const rooms = state.rooms ?? {};
        for (const id of Object.keys(rooms)) {
            if (id === this.activeRoomId) {
                continue;
            }

            const room = rooms[id];
            const last = room.lastSimulatedAtMs ?? now;
            const elapsedSec = Math.max(0, (now - last) / 1000);

            if (elapsedSec <= 0.05) {
                room.lastSimulatedAtMs = now;
                continue;
            }

            // Simulate: for each entity with a generator, compute how many coins it would have produced
            // and add those coins to room.coinsOnGround with anti-cluster placement.
            // IMPORTANT: This requires your entity save data to include generator state and pendingCoins.
            this.simulateRoomGenerators(room, elapsedSec);

            room.lastSimulatedAtMs = now;
            rooms[id] = room;
        }

        state.rooms = rooms;
    }

    private simulateRoomGenerators(room: IRoomStateSaveData, elapsedSec: number): void {
        if (!room.entities || room.entities.length <= 0) {
            return;
        }

        const coins = room.coinsOnGround ?? [];
        const minDist = this.cfg.coinMinDistPx;

        for (let i = 0; i < room.entities.length; i++) {
            const e = room.entities[i];

            // Your saved entity format needs to expose these:
            // e.type === "animal"
            // e.pendingCoins (cap applies)
            // e.generator: { cooldownSec: number, t: number } where t is “time accumulator / time left”
            if (!e || e.type !== "animal" || !e.generator) {
                continue;
            }

            const maxPending = 3;
            const pending = typeof e.pendingCoins === "number" ? e.pendingCoins : 0;

            if (pending >= maxPending) {
                continue;
            }

            const produced = this.advanceGeneratorAndCount(e.generator, elapsedSec, maxPending - pending);
            if (produced <= 0) {
                continue;
            }

            e.pendingCoins = pending + produced;

            // Add produced coins to ground randomly (avoid clustering)
            for (let k = 0; k < produced; k++) {
                const p = this.sampleNonClusteringPoint(coins, minDist, this.cfg.coinSpawnTries);
                coins.push({
                    x: p.x,
                    y: p.y,
                    value: e.coinValue ?? 1,    // store coinValue in entity save, or derive by level elsewhere
                    ownerId: e.id ?? "",
                    createdAtMs: Date.now()
                });
            }
        }

        room.coinsOnGround = coins;
    }

    private advanceGeneratorAndCount(gen: any, elapsedSec: number, maxCount: number): number {
        // You control this structure; keep it simple and stable:
        // gen.cooldownSec: number
        // gen.t: number (accumulator 0..cooldownSec)
        const cd = Math.max(0.1, gen.cooldownSec ?? 5);
        let t = typeof gen.t === "number" ? gen.t : 0;

        t += elapsedSec;

        const count = Math.min(maxCount, Math.floor(t / cd));
        if (count > 0) {
            t -= count * cd;
        }

        gen.t = t;
        return count;
    }

    private sampleNonClusteringPoint(existingCoins: any[], minDist: number, tries: number): PIXI.Point {
        const minD2 = minDist * minDist;

        for (let t = 0; t < tries; t++) {
            const x = this.walkBounds.x + Math.random() * this.walkBounds.width;
            const y = this.walkBounds.y + Math.random() * this.walkBounds.height;

            let ok = true;
            for (let i = 0; i < existingCoins.length; i++) {
                const c = existingCoins[i];
                const dx = (c.x ?? 0) - x;
                const dy = (c.y ?? 0) - y;
                if ((dx * dx + dy * dy) < minD2) {
                    ok = false;
                    break;
                }
            }

            if (ok) {
                return new PIXI.Point(x, y);
            }
        }

        // Fallback: just random
        return new PIXI.Point(
            this.walkBounds.x + Math.random() * this.walkBounds.width,
            this.walkBounds.y + Math.random() * this.walkBounds.height
        );
    }
}
