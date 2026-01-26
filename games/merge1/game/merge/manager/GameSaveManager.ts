import { CurrencyType } from "../data/InGameEconomy";
import { IEntityData } from "../data/MergeSaveTypes";
import GameStorage, { IFarmSaveData } from "../storage/GameStorage";
import { CoinManager } from "./CoinManager";
import { EntityManager } from "./EntityManager";

// Room save slice (keep local to avoid circular dependencies)
export interface IRoomMergeSaveState {
    id: string;
    entities: IEntityData[];
    coinsOnGround: {
        x: number;
        y: number;
        value: number;
        ownerId: string;
        currencyType: CurrencyType;
    }[];
    lastSimulatedAtMs?: number;
}

export class GameSaveManager {
    private dirty: boolean = false;
    private saveCooldownMs: number = 500;
    private saveTimerMs: number = 0;
    private activeRoomId: string = "room_0";

    // Default room if state is legacy
    private readonly DEFAULT_ROOM_ID: string = "room_0";

    public constructor(
        private readonly entities: EntityManager,
        private readonly coins: CoinManager
    ) { }

    public markDirty(): void {
        this.dirty = true;
    }

    public update(deltaSeconds: number): void {
        if (!this.dirty) {
            return;
        }

        this.saveTimerMs += deltaSeconds * 1000;

        if (this.saveTimerMs >= this.saveCooldownMs) {
            this.flushNow();
        }
    }

    /**
     * Flush current active room into GameStorage.
     * Does NOT overwrite currencies/progress/missions.
     */
    public flushNow(): void {
        this.saveTimerMs = 0;
        this.dirty = false;

        const full = this.ensureRoomsExist(GameStorage.instance.getFullState());
        const roomId = this.activeRoomId ?? full.activeRoomId ?? this.DEFAULT_ROOM_ID;
        full.activeRoomId = roomId;


        full.rooms![roomId] = this.buildRoomState(roomId);
        full.activeRoomId = roomId;

        GameStorage.instance.saveFullState(full);
    }
    public setActiveRoomId(roomId: string): void {
        this.activeRoomId = roomId;

        const full = (this as any).ensureRoomsExist
            ? (this as any).ensureRoomsExist(GameStorage.instance.getFullState())
            : (GameStorage.instance.getFullState() as any);

        full.activeRoomId = roomId;

        // Ensure room exists
        full.rooms ??= {};
        full.rooms[roomId] ??= {
            id: roomId,
            entities: [],
            coinsOnGround: [],
            lastSimulatedAtMs: Date.now()
        };

        GameStorage.instance.saveFullState(full);
    }

    /**
     * Load the active room save slice.
     * (This replaces your old IMergeSaveState root load.)
     */
    public loadActiveRoom(): IRoomMergeSaveState | null {
        const full = this.ensureRoomsExist(GameStorage.instance.getFullState());
        const roomId = full.activeRoomId ?? this.DEFAULT_ROOM_ID;
        this.activeRoomId = roomId;
        const room = full.rooms?.[roomId];
        return room ? { ...room } : null;
    }

    /**
     * Load a specific room by id.
     */
    public loadRoom(roomId: string): IRoomMergeSaveState | null {
        const full = this.ensureRoomsExist(GameStorage.instance.getFullState());
        const room = full.rooms?.[roomId];
        return room ? { ...room } : null;
    }

    /**
     * Save current runtime into a specific room.
     * Useful when switching rooms: save old room, then restore new room.
     */
    public saveRoom(roomId: string): void {
        const full = this.ensureRoomsExist(GameStorage.instance.getFullState());

        full.rooms![roomId] = this.buildRoomState(roomId);
        full.activeRoomId = roomId;

        GameStorage.instance.saveFullState(full);

        this.dirty = false;
        this.saveTimerMs = 0;
    }

    /**
     * Restore runtime state from a room slice.
     * shufflePositions should be controlled by RoomManager.
     */
    public restoreRoom(saved: IRoomMergeSaveState, opts?: { shufflePositions?: boolean }): void {
        const shufflePositions = opts?.shufflePositions === true;

        // Clear runtime first (silent during room switches)
        this.coins.clearAll({ silent: true } as any);
        this.entities.clearAll({ silent: true } as any);

        // Make a cleaned copy: pendingCoins must start at 0 (we will rebuild from coins on ground)
        const cleanedEntities = (saved.entities ?? []).map((e: any) => {
            const copy = { ...e };
            copy.pendingCoins = 0;
            return copy;
        });

        // Import entities (this restores genTimer too, from your EntityManager patch)
        this.entities.importEntities(cleanedEntities as any, { shufflePositions });

        // Restore coins + reconstruct pendingCoins
        const coins = saved.coinsOnGround ?? [];
        for (let i = 0; i < coins.length; i++) {
            const c = coins[i];
            this.coins.dropCoin(c.x, c.y, c.value, c.ownerId, true, c.currencyType);
            this.incrementPendingCoin(c.ownerId);
        }

        this.dirty = false;
        this.saveTimerMs = 0;
    }


    /**
     * Legacy support: if older saves wrote entities/coins at root, migrate them into rooms.
     */
    private ensureRoomsExist(full: IFarmSaveData): IFarmSaveData {
        const anyFull: any = full as any;

        if (!full.rooms) {
            const legacyEntities = (anyFull.entities ?? []) as IEntityData[];
            const legacyCoins = (anyFull.coinsOnGround ?? []) as any[];

            full.rooms = {
                [this.DEFAULT_ROOM_ID]: {
                    id: this.DEFAULT_ROOM_ID,
                    entities: legacyEntities,
                    coinsOnGround: legacyCoins,
                    lastSimulatedAtMs: Date.now()
                }
            };

            full.activeRoomId = full.activeRoomId ?? this.DEFAULT_ROOM_ID;

            // Remove legacy roots to prevent future overwrites
            delete anyFull.entities;
            delete anyFull.coinsOnGround;

            GameStorage.instance.saveFullState(full);
        }

        if (!full.activeRoomId) {
            full.activeRoomId = this.DEFAULT_ROOM_ID;
        }

        if (!full.rooms[full.activeRoomId]) {
            full.rooms[full.activeRoomId] = {
                id: full.activeRoomId,
                entities: [],
                coinsOnGround: [],
                lastSimulatedAtMs: Date.now()
            };
        }

        return full;
    }

    private buildRoomState(roomId: string): IRoomMergeSaveState {
        return {
            id: roomId,
            entities: this.buildEntitySaveList(),
            coinsOnGround: this.coins.exportCoins() as any,
            lastSimulatedAtMs: Date.now()
        };
    }

    private incrementPendingCoin(ownerId: string): void {
        this.entities.forEach((logic) => {
            if (logic.data.id === ownerId) {
                logic.data.pendingCoins++;
            }
        });
    }

    private buildEntitySaveList(): IEntityData[] {
        // Export includes generator timer (genTimer) from the patched EntityManager
        const list = this.entities.exportEntities();

        // IMPORTANT:
        // Do NOT mutate runtime data in-place here. Save should be a snapshot, not a side-effect.
        // If you still want to persist "lastCoinTimestamp", compute it per-entity copy.
        for (let i = 0; i < list.length; i++) {
            const d: any = list[i];

            // If you rely on lastCoinTimestamp for any offline logic, keep it coherent:
            // lastCoinTimestamp = now - remainingMsUntilNextCoin
            // Here, genTimer is assumed to be "time since last spawn" or "accumulator".
            // Your CoinGenerator semantics are not fully shown, so keep lastCoinTimestamp stable unless known.
            // We will only ensure it exists.
            if (typeof d.lastCoinTimestamp !== "number") {
                d.lastCoinTimestamp = Date.now();
            }
        }

        return list;
    }
}
