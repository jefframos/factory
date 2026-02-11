import { Signal } from "signals";
import { GameplayProgressStorage } from "../GameplayProgressStorage";
import { AvatarItem, AvatarRegistry } from "./AvatarRegistry";

export class AvatarManager {
    private static _instance: AvatarManager;

    public readonly onAvatarChanged = new Signal();
    public readonly onAvatarUnlocked = new Signal(); // Notify UI when a new skin is unlocked

    private _currentAvatarId: number = 0;

    private constructor() {
        const savedData = GameplayProgressStorage.getData();
        this._currentAvatarId = savedData.currentAvatarId !== undefined ? savedData.currentAvatarId : 0;

        // Auto-unlock free avatars on startup
        this.checkFreeAvatars();
    }

    public static get instance(): AvatarManager {
        return this._instance || (this._instance = new AvatarManager());
    }

    /**
     * Loops through registry and unlocks anything with 0 cost 
     * that isn't already in the unlocked list.
     */
    private checkFreeAvatars(): void {
        const freeAvatars = AvatarRegistry.AVATARS.filter(a => a.cost === 0);
        freeAvatars.forEach(a => {
            if (!this.isUnlocked(a.id)) {
                this.unlockAvatar(a.id, 0); // Cost is 0
            }
        });
    }

    public get currentAvatar(): AvatarItem {
        return AvatarRegistry.getAvatar(this._currentAvatarId);
    }

    /**
     * Checks if ID exists in the storage array
     */
    public isUnlocked(id: number): boolean {
        const data = GameplayProgressStorage.getData();
        if (!data.unlockedAvatars) return id === 0; // Default fallback
        return data.unlockedAvatars.includes(id);
    }

    /**
     * Unlocks an avatar, deducts cost, and saves to storage
     */
    public unlockAvatar(id: number, cost: number): boolean {
        const data = GameplayProgressStorage.getData();

        // Initialize the array if it doesn't exist
        if (!data.unlockedAvatars) {
            data.unlockedAvatars = [0]; // Ensure default is there
        }

        // Prevent double unlocking
        if (data.unlockedAvatars.includes(id)) return true;

        // Logic for currency deduction (assuming data.currency exists)
        if (data.currency !== undefined && data.currency < cost) {
            console.warn("Not enough currency to unlock avatar");
            return false;
        }

        // 1. Deduct cost and add to list
        if (data.currency !== undefined) data.currency -= cost;
        data.unlockedAvatars.push(id);

        // 2. Persist to LocalStorage
        this.saveToStorage(data);

        // 3. Notify listeners
        this.onAvatarUnlocked.dispatch(id);

        return true;
    }

    public setAvatar(id: number): void {
        if (!this.isUnlocked(id)) {
            console.error("Cannot set locked avatar!");
            return;
        }

        this._currentAvatarId = id;
        const data = GameplayProgressStorage.getData();
        data.currentAvatarId = id;

        this.saveToStorage(data);

        const avatarData = AvatarRegistry.getAvatar(id);
        this.onAvatarChanged.dispatch(avatarData);
    }

    private saveToStorage(data: any): void {
        localStorage.setItem("HEX_GAME_PROGRESS", JSON.stringify(data));
    }
}