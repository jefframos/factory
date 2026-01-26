// rooms/RoomService.ts
import { Signal } from "signals";
import { InGameProgress } from "../data/InGameProgress";
import { GameSaveManager, IRoomMergeSaveState } from "../manager/GameSaveManager";
import { ProgressionType } from "../storage/GameStorage";
import { RoomId, RoomRegistry } from "./RoomRegistry";

export interface RoomServiceDeps {
    saver: GameSaveManager;
    canSwitchNow: () => boolean; // e.g., !mediator.isDragging and !uiOpen
}

export class RoomService {
    public readonly onRoomChanged: Signal = new Signal();  // dispatch(roomId: RoomId)
    public readonly onRoomDenied: Signal = new Signal();   // dispatch(roomId: RoomId, reason: "locked" | "busy")

    private currentRoomId: RoomId = "room_0";

    public constructor(private readonly deps: RoomServiceDeps) { }

    public get activeRoomId(): RoomId {
        return this.currentRoomId;
    }

    /**
     * Must be called once on boot.
     * Loads active room from storage and restores it into runtime.
     */
    public boot(): void {
        const room = this.deps.saver.loadActiveRoom();
        if (room) {
            this.currentRoomId = (room.id as RoomId) ?? "room_0";
            this.deps.saver.setActiveRoomId(this.currentRoomId);

            this.deps.saver.restoreRoom(room, { shufflePositions: false });
            this.onRoomChanged.dispatch(this.currentRoomId);
            return;
        }

        // No save yet -> ensure defaults
        this.currentRoomId = "room_0";
        this.deps.saver.setActiveRoomId(this.currentRoomId);

        this.ensureRoomExistsAndRestore(this.currentRoomId, false);
        this.onRoomChanged.dispatch(this.currentRoomId);
    }

    /**
     * Request a room switch (from HUD or elsewhere).
     * Saves current room, restores new room (with shuffle).
     */
    public requestSwitch(roomId: RoomId): void {
        if (roomId === this.currentRoomId) {
            return;
        }

        if (!this.deps.canSwitchNow()) {
            this.onRoomDenied.dispatch(roomId, "busy");
            return;
        }

        const playerLevel = InGameProgress.instance.getProgression(ProgressionType.MAIN).level;
        if (!RoomRegistry.isUnlocked(roomId, playerLevel)) {
            this.onRoomDenied.dispatch(roomId, "locked");
            return;
        }

        // 1) Save current
        this.deps.saver.saveRoom(this.currentRoomId);

        // 2) IMPORTANT: set new active room BEFORE restore triggers dirty/autosave
        this.deps.saver.setActiveRoomId(roomId);

        // 3) Restore new room
        this.ensureRoomExistsAndRestore(roomId, true);

        this.currentRoomId = roomId;
        this.onRoomChanged.dispatch(this.currentRoomId);

    }

    /**
     * Call on level-up to potentially unlock UI states (HUD can re-render).
     * This service does not directly modify HUD; it only offers state.
     */
    public isUnlocked(roomId: RoomId): boolean {
        const playerLevel = InGameProgress.instance.getProgression(ProgressionType.MAIN).level;
        return RoomRegistry.isUnlocked(roomId, playerLevel);
    }

    // -------------------------
    // internals
    // -------------------------

    private ensureRoomExistsAndRestore(roomId: RoomId, shuffleOnEnter: boolean): void {
        const next = this.deps.saver.loadRoom(roomId);

        if (next) {
            this.deps.saver.restoreRoom(next, { shufflePositions: shuffleOnEnter });
            return;
        }

        const empty: IRoomMergeSaveState = {
            id: roomId,
            entities: [],
            coinsOnGround: [],
            lastSimulatedAtMs: Date.now()
        };

        this.deps.saver.restoreRoom(empty, { shufflePositions: shuffleOnEnter });

        // Persist it once so it exists after refresh
        this.deps.saver.saveRoom(roomId);
    }
}
