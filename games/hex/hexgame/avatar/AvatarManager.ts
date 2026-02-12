import { Signal } from "signals";
import { CurrencyType, EconomyStorage } from "../data/EconomyStorage";
import { GameplayProgressStorage } from "../data/GameplayProgressStorage";
import { AvatarItem, AvatarRegistry } from "./AvatarRegistry";

export class AvatarManager {
    private static _instance: AvatarManager;

    public readonly onAvatarChanged = new Signal();
    public readonly onAvatarUnlocked = new Signal();

    private _currentAvatarId: number = 0;
    private _isInitialized: boolean = false;

    private constructor() { }

    public static get instance(): AvatarManager {
        return this._instance || (this._instance = new AvatarManager());
    }

    /**
     * Call this during your game's boot sequence.
     */
    public async initialize(): Promise<void> {
        if (this._isInitialized) return;

        const savedData = await GameplayProgressStorage.getData();
        this._currentAvatarId = savedData.currentAvatarId !== undefined ? savedData.currentAvatarId : 0;

        // Auto-unlock free avatars on startup
        await this.checkFreeAvatars();

        this._isInitialized = true;
    }

    private async checkFreeAvatars(): Promise<void> {
        const freeAvatars = AvatarRegistry.AVATARS.filter(a => a.cost === 0);

        for (const a of freeAvatars) {
            const unlocked = await this.isUnlocked(a.id);
            if (!unlocked) {
                // Free avatars don't need economy checks, just unlock them
                await this.unlockAvatar(a.id);
            }
        }
    }

    /**
     * Checks if the user has enough currency to buy a specific avatar.
     */
    public async canAfford(id: number, currency: CurrencyType = CurrencyType.COINS): Promise<boolean> {
        const avatar = AvatarRegistry.getAvatar(id);
        if (!avatar) return false;

        const balance = await EconomyStorage.getBalance(currency);
        return balance >= avatar.cost;
    }

    /**
     * Checks if ID exists in the unlocked list in GameplayProgressStorage.
     */
    public async isUnlocked(id: number): Promise<boolean> {
        const data = await GameplayProgressStorage.getData();
        if (!data.unlockedAvatars) return id === 0;
        return data.unlockedAvatars.includes(id);
    }

    /**
     * The main purchase function. 
     * Uses EconomyStorage to handle the transaction.
     */
    public async buyAvatar(id: number, currency: CurrencyType = CurrencyType.COINS): Promise<boolean> {
        const avatar = AvatarRegistry.getAvatar(id);
        if (!avatar) return false;

        const alreadyUnlocked = await this.isUnlocked(id);
        if (alreadyUnlocked) return true;

        // Use the EconomyStorage to try and purchase the permanent ID
        // We use a prefix like "avatar_" to keep economy IDs unique
        const purchaseSuccess = await EconomyStorage.tryPurchaseItem(
            `avatar_${id}`,
            avatar.cost,
            currency
        );

        if (purchaseSuccess) {
            return await this.unlockAvatar(id);
        }

        console.warn(`AvatarManager: Purchase failed for ID ${id}. Insufficient ${currency}.`);
        return false;
    }

    /**
     * Internally adds the avatar to the unlocked list and persists state.
     */
    public async unlockAvatar(id: number): Promise<boolean> {
        const data = await GameplayProgressStorage.getData();

        if (!data.unlockedAvatars) {
            data.unlockedAvatars = [0];
        }

        if (data.unlockedAvatars.includes(id)) return true;

        data.unlockedAvatars.push(id);
        await GameplayProgressStorage.updateData({ unlockedAvatars: data.unlockedAvatars });

        this.onAvatarUnlocked.dispatch(id);
        return true;
    }

    public async setAvatar(id: number): Promise<void> {
        const unlocked = await this.isUnlocked(id);
        if (!unlocked) {
            console.error("AvatarManager: Cannot set locked avatar!");
            return;
        }

        this._currentAvatarId = id;
        await GameplayProgressStorage.updateData({ currentAvatarId: id });

        const avatarData = AvatarRegistry.getAvatar(id);
        this.onAvatarChanged.dispatch(avatarData);
    }

    public get currentAvatar(): AvatarItem {
        return AvatarRegistry.getAvatar(this._currentAvatarId);
    }
}