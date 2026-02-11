import { Signal } from "signals";
import { GameplayProgressStorage } from "../GameplayProgressStorage";
import { AvatarItem, AvatarRegistry } from "./AvatarRegistry";

export class AvatarManager {
    private static _instance: AvatarManager;

    // This signal will now send the full AvatarItem object to listeners
    public readonly onAvatarChanged = new Signal();

    private _currentAvatarId: number = 0;

    private constructor() {
        // Get saved ID from storage, default to 0
        const savedData = GameplayProgressStorage.getData();
        this._currentAvatarId = savedData.currentAvatarId !== undefined ? savedData.currentAvatarId : 0;
    }

    public static get instance(): AvatarManager {
        return this._instance || (this._instance = new AvatarManager());
    }

    /**
     * Returns the full data for the currently equipped avatar
     */
    public get currentAvatar(): AvatarItem {
        return AvatarRegistry.getAvatar(this._currentAvatarId);
    }

    /**
     * Updates the avatar, saves to local storage, and notifies the HUD
     */
    public setAvatar(id: number): void {
        this._currentAvatarId = id;

        // 1. Sync with your existing GameplayProgressStorage
        const data = GameplayProgressStorage.getData();
        data.currentAvatarId = id;

        // We use the same key your storage class uses
        localStorage.setItem("HEX_GAME_PROGRESS", JSON.stringify(data));

        // 2. Get the full data from Registry and notify listeners (like HexHUD)
        const avatarData = AvatarRegistry.getAvatar(id);
        this.onAvatarChanged.dispatch(avatarData);
    }
}