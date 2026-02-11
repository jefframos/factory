import HexAssets from "../HexAssets";

export interface AvatarItem {
    id: number;
    name: string;
    texture: string;
    cost: number;
}

export class AvatarRegistry {
    public static readonly AVATARS: AvatarItem[] = [
        { id: 0, name: "Default", texture: HexAssets.Textures.Icons.Critter, cost: 0 },
        { id: 1, name: "Star", texture: HexAssets.Textures.Icons.Star, cost: 100 },
        { id: 2, name: "Helper", texture: HexAssets.Textures.Icons.Hint, cost: 200 },
        { id: 3, name: "Ghost", texture: HexAssets.Textures.Icons.Close, cost: 300 },
        { id: 4, name: "Gear", texture: HexAssets.Textures.Icons.Settings, cost: 400 },
    ];

    public static getAvatar(id: number): AvatarItem {
        return this.AVATARS.find(a => a.id === id) || this.AVATARS[0];
    }
}