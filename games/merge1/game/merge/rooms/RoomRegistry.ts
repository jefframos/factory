// rooms/RoomRegistry.ts
export type RoomId = "room_0" | "room_1";

export interface RoomDefinition {
    id: RoomId;
    name: string;
    unlockLevel: number;
}

export class RoomRegistry {
    public static readonly rooms: RoomDefinition[] = [
        { id: "room_0", name: "Room 1", unlockLevel: 1 },
        { id: "room_1", name: "Room 2", unlockLevel: 1 }
    ];

    public static get(id: RoomId): RoomDefinition {
        const r = this.rooms.find((x) => x.id === id);
        return r ?? this.rooms[0];
    }

    public static isUnlocked(id: RoomId, playerLevel: number): boolean {
        return playerLevel >= this.get(id).unlockLevel;
    }
}
