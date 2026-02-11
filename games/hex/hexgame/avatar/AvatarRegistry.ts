
export interface AvatarItem {
    id: number;
    name: string;
    texture: string;
    cost: number;
}

export class AvatarRegistry {
    public static readonly AVATARS: AvatarItem[] = [
        { id: 0, name: "avatar1", texture: "avatar1", cost: 0 },
        { id: 1, name: "avatar2", texture: "avatar2", cost: 0 },
        { id: 2, name: "avatar3", texture: "avatar3", cost: 200 },
        { id: 3, name: "avatar4", texture: "avatar4", cost: 300 },
        { id: 4, name: "avatar5", texture: "avatar5", cost: 400 },
    ];

    public static getAvatar(id: number): AvatarItem {
        return this.AVATARS.find(a => a.id === id) || this.AVATARS[0];
    }
}