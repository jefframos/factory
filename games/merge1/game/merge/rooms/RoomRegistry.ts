// rooms/RoomRegistry.ts
export type RoomId = "room_0" | "room_1";

export interface IRoomConfig {
    id: RoomId;
    unlockLevel: number;
    mapId: string;     // e.g., 'garden', 'kitchen'
    icon: string;      // e.g., 'cats', 'dogs'
    entityType: string;      // e.g., 'cats', 'dogs'
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
            displayName: "The Garden"
        },
        "room_1": {
            id: "room_1",
            unlockLevel: 5,
            mapId: 'LivingRoom',
            entityType: 'dogs',
            icon: 'livin-room-icon',
            displayName: "The Kitchen"
        }
    };

    public static get(id: RoomId): IRoomConfig {
        return this.ROOMS[id];
    }

    public static isUnlocked(id: RoomId, currentLevel: number): boolean {
        return currentLevel >= this.ROOMS[id].unlockLevel;
    }
}