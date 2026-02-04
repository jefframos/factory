import { InGameProgress } from "../data/InGameProgress";
import GameStorage, { ProgressionType } from "../storage/GameStorage";

export type RoomId = "room_0" | "room_1" | "room_2";

export interface IRoomConfig {
    id: RoomId;
    unlockLevel: number;
    mapId: string;
    icon: string;
    entityType: string;
    displayName: string;
}

export class RoomRegistry {
    private static readonly ROOMS: Record<RoomId, IRoomConfig> = {
        "room_0": {
            id: "room_0",
            unlockLevel: 0,
            mapId: 'Garden',
            entityType: 'cats',
            icon: 'garden-icon',
            displayName: "Garden"
        },
        "room_1": {
            id: "room_1",
            unlockLevel: 5,
            mapId: 'LivingRoom',
            entityType: 'dogs',
            icon: 'livin-room-icon',
            displayName: "Living Room"
        },
        "room_2": {
            id: "room_2",
            unlockLevel: 10,
            mapId: 'Bedroom',
            entityType: 'dogs',
            icon: 'bedroom-icon',
            displayName: "Bedroom"
        }
    };
    public static anyRoomAvailableAndEmpty(ignore: RoomId[] = []): boolean {
        const playerLevel = InGameProgress.instance.getProgression(ProgressionType.MAIN).level;

        // Get all Room IDs defined in the record
        const roomIds = Object.keys(this.ROOMS) as RoomId[];

        // Return true if any room satisfies the condition and isn't ignored
        return roomIds.some(id => {
            const roomId = id as RoomId;

            // 1. Skip if the room is in the ignore list
            if (ignore.includes(roomId)) {
                return false;
            }

            // 2. Perform the availability and emptiness tests
            const unlocked = this.isUnlocked(roomId, playerLevel);
            const empty = GameStorage.instance.getRoomEntityCount(roomId) === 0;


            return unlocked && empty;
        });
    }
    /**
     * Checks if a specific room is both unlocked for the player 
     * and currently contains zero entities.
     */
    public static isThisRoomAvailableAndEmpty(roomId: RoomId): boolean {
        const playerLevel = InGameProgress.instance.getProgression(ProgressionType.MAIN).level;

        // 1. Check if unlocked
        const unlocked = this.isUnlocked(roomId, playerLevel);
        if (!unlocked) return false;

        // 2. Check if empty in storage
        const entityCount = GameStorage.instance.getRoomEntityCount(roomId);

        return entityCount === 0;
    }
    /**
     * Finds the first room that is:
     * 1. Unlocked based on player level.
     * 2. Has zero entities in storage.
     */
    public static findEmptyAvailableRoom(): RoomId | null {
        const playerLevel = InGameProgress.instance.getProgression(ProgressionType.MAIN).level;
        const storage = GameStorage.instance;

        for (const id in this.ROOMS) {
            const roomId = id as RoomId;

            // Check if unlocked
            if (this.isUnlocked(roomId, playerLevel)) {

                // Check entity count from storage
                const entityCount = storage.getRoomEntityCount(roomId);

                if (entityCount === 0) {
                    return roomId;
                }
            }
        }

        return null; // No empty unlocked rooms found
    }

    public static get(id: RoomId): IRoomConfig {
        return this.ROOMS[id];
    }

    public static isUnlocked(id: RoomId, currentLevel: number): boolean {
        return this.ROOMS[id] ? currentLevel >= this.ROOMS[id].unlockLevel : false;
    }

    public static getAllRoomIds(): RoomId[] {
        return Object.keys(this.ROOMS) as RoomId[];
    }
    /**
     * Gets the room that becomes unlocked at the specified level.
     * @param level - The level to check for newly unlocked room
     * @returns The room config that unlocks at this level, or null if no room unlocks
     */
    public static getRoomUnlockedAtLevel(level: number): IRoomConfig | null {
        const roomEntry = Object.entries(this.ROOMS).find(
            ([_, room]) => room.unlockLevel === level
        );

        return roomEntry ? roomEntry[1] : null;
    }
}