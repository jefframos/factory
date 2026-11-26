import SoundManager from "core/audio/SoundManager";
import { IPlatformConnection } from "./IPlatformConnection";

/** How long the SDK's script and its init() may take before the game goes on without it (ms). */
const SDK_WAIT = { load: 8000, init: 8000 };

/** The browser's own storage, never throwing (blocked storage, private windows). */
const local = {
    get(key: string): string | null {
        try {
            return window.localStorage.getItem(key);
        } catch {
            return null;
        }
    },
    set(key: string, value: string): void {
        try {
            window.localStorage.setItem(key, value);
        } catch {
            // (Nowhere to keep it but the SDK.)
        }
    },
    remove(key: string): void {
        try {
            window.localStorage.removeItem(key);
        } catch {
            // (Nothing to remove.)
        }
    },
};

/** A promise, or `fallback` once `ms` have gone by (an SDK call that never answers mustn't hang the game). */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return new Promise<T>((resolve) => {
        const timer = setTimeout(() => resolve(fallback), ms);
        promise.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (error) => { clearTimeout(timer); console.warn("CrazyGames Platform:", error); resolve(fallback); },
        );
    });
}

/**
 * CrazyGames (SDK v3). Saves go through its data module (SDK.data: localStorage's API, kept with the player's CrazyGames account
 * and synced across their devices when they're logged in, on the device for guests), with localStorage as the fallback: before
 * the SDK's up, if it never loads (an ad blocker, a timeout) or if a call throws. Every save is copied to localStorage as well,
 * so a session without the SDK still finds the latest on that device, and a save from before the data module was used (only in
 * localStorage) is moved into it the first time it's read. The platform's mute (SDK.game.settings.muteAudio) reaches the game
 * through onAudioChanged, and wins over the game's own sound toggle (SoundManager.setPlatformMuted).
 */
export default class CrazyGamesPlatform implements IPlatformConnection {
    public isGameplayActive = false;
    private crazygamesSDK: any = null;

    constructor() {
    }

    /** The data module, once the SDK's up (null before, or without it). */
    private get data(): any {
        return this.crazygamesSDK?.data ?? null;
    }

    public async setItem(key: string, value: string): Promise<void> {
        const data = this.data;
        if (data) {
            try {
                await data.setItem(key, value);
            } catch (error) {
                console.warn("CrazyGames Platform: data.setItem failed, kept in localStorage", error);
            }
        }
        local.set(key, value);
    }

    public async getItem(key: string): Promise<string | null> {
        const kept = local.get(key);
        const data = this.data;
        if (!data) return kept;
        try {
            const saved = await data.getItem(key);
            if (saved !== null && saved !== undefined) return String(saved);
            // (Not in the data module yet: a save from before it was used, moved over.)
            if (kept !== null) await data.setItem(key, kept);
            return kept;
        } catch (error) {
            console.warn("CrazyGames Platform: data.getItem failed, read from localStorage", error);
            return kept;
        }
    }

    public async removeItem(key: string): Promise<void> {
        const data = this.data;
        if (data) {
            try {
                await data.removeItem(key);
            } catch (error) {
                console.warn("CrazyGames Platform: data.removeItem failed", error);
            }
        }
        local.remove(key);
    }

    /** The platform's mute: told now, and whenever the player changes it on CrazyGames (without the SDK: never, the game's own toggle stands). */
    public async onAudioChanged(callback: (enabled: boolean) => void): Promise<void> {
        const game = this.crazygamesSDK?.game;
        if (!game) return;
        const tell = (settings: any): void => {
            try {
                callback(!settings?.muteAudio);
            } catch (error) {
                console.warn("CrazyGames Platform: audio change handler failed", error);
            }
        };
        try {
            tell(game.settings);
            game.addSettingsChangeListener?.(tell);
        } catch (error) {
            console.warn("CrazyGames Platform: settings unavailable", error);
        }
    }

    /** Only returns a name when the player is actually logged into a CrazyGames account (isUserAccountAvailable) — most players aren't, so null here is the common case, not a failure. */
    public async getPlayerName(): Promise<string | null> {
        if (!this.crazygamesSDK?.user?.isUserAccountAvailable) return null;
        try {
            const user = await this.crazygamesSDK.user.getUser();
            return user?.username ?? null;
        } catch (error) {
            console.error("CrazyGames Platform: Error fetching player name:", error);
            return null;
        }
    }

    /** A moment of joy (a boss beaten, a record): CrazyGames may celebrate it. Use it sparingly. */
    public happyTime(): Promise<void> {
        try {
            this.crazygamesSDK?.game?.happytime?.();
        } catch (error) {
            console.warn("CrazyGames Platform: happytime failed", error);
        }
        return Promise.resolve();
    }

    public showBanner(): Promise<void> {
        if (this.crazygamesSDK) {
            this.crazygamesSDK.banner.show();
        }
        return Promise.resolve();
    }

    public hideBanner(): Promise<void> {
        if (this.crazygamesSDK) {
            this.crazygamesSDK.banner.hide();
        }
        return Promise.resolve();
    }

    public async startLoadSDK(): Promise<void> {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://sdk.crazygames.com/crazygames-sdk-v3.js";
            script.async = true;

            script.onload = () => {
                console.log("CrazyGames SDK loaded successfully");
                resolve();
            };

            script.onerror = () => {
                console.error("Failed to load the CrazyGames SDK");
                reject(new Error("Failed to load CrazyGames SDK"));
            };

            document.head.appendChild(script);
        });
    }

    public async startLoad(): Promise<void> {
        console.debug("CrazyGames Platform: Starting load...");
        await Promise.resolve();
    }

    /** (Nothing to tell CrazyGames here: loadingStop is sent from loadFinished.) */
    public async firstFrameReady(): Promise<void> {}

    public async loadFinished(): Promise<void> {
        if (this.crazygamesSDK) {
            this.crazygamesSDK.game.loadingStop();
        }
        await Promise.resolve();
    }

    /**
     * Loads and inits the SDK (init also reads the player's saved data, so it's done before the game's save is read). If it
     * can't (blocked, broken, too slow), the game still runs: no ads, saves in localStorage, its own sound toggle.
     */
    public async initialize(): Promise<void> {
        console.debug("CrazyGames Platform: Initializing...");

        const loaded = await within(this.startLoadSDK().then(() => true), SDK_WAIT.load, false);
        // (A moment for the SDK to be on window.)
        if (loaded) await new Promise(resolve => setTimeout(resolve, 100));
        const sdk = (window as any).CrazyGames?.SDK;
        if (!sdk) {
            console.warn("CrazyGames Platform: SDK not available, running without it (localStorage saves, no ads)");
            return;
        }
        const ready = await within(Promise.resolve(sdk.init()).then(() => true), SDK_WAIT.init, false);
        if (!ready) {
            console.warn("CrazyGames Platform: SDK init failed or timed out, running without it");
            return;
        }
        this.crazygamesSDK = sdk;
        console.log("CrazyGames SDK initialized successfully");
    }

    public async showCommercialBreak(): Promise<void> {
        console.debug("CrazyGames Platform: Showing commercial break...");

        if (this.crazygamesSDK) {
            SoundManager.instance.muteAllSounds();

            return new Promise((resolve) => {
                this.crazygamesSDK.ad.requestAd("midgame", {
                    adFinished: () => {
                        console.log("Ad finished");
                        SoundManager.instance.restoreSound();
                        resolve();
                    },
                    adError: (error: any) => {
                        console.error("Ad error:", error);
                        SoundManager.instance.restoreSound();
                        resolve();
                    },
                    adStarted: () => {
                        console.log("Ad started");
                    }
                });
            });
        } else {
            await Promise.resolve();
        }
    }

    public async showRewardedVideo(): Promise<boolean> {
        console.debug("CrazyGames Platform: Showing rewarded video...");

        if (this.crazygamesSDK) {
            SoundManager.instance.muteAllSounds();

            try {
                return await new Promise<boolean>((resolve, reject) => {
                    this.crazygamesSDK.ad.requestAd("rewarded", {
                        adFinished: () => {
                            console.log("Rewarded ad finished - granting reward");
                            resolve(true);
                        },
                        adError: (error: unknown) => {
                            console.error("Rewarded ad error:", error);
                            reject(error);
                        },
                        adStarted: () => {
                            console.log("Rewarded ad started");
                        }
                    });
                });
            } finally {
                SoundManager.instance.restoreSound();
            }
        } else {
            console.warn("CrazyGames Platform: Rewarded video unavailable; SDK not loaded.");
            return false;
        }
    }

    public async setPlayerScore(score: number): Promise<void> {
        console.debug("CrazyGames Platform: Setting player score:", score);
        await Promise.resolve();
    }

    public async getLeaderboard(): Promise<void> {
        console.debug("CrazyGames Platform: Getting leaderboard...");
        return await Promise.resolve();
    }

    public async getFriends(): Promise<void> {
        console.debug("CrazyGames Platform: Getting friends list...");
        return await Promise.resolve();
    }

    public async gameplayStart(): Promise<void> {
        if (!this.isGameplayActive) {
            console.debug("CrazyGames Platform: Starting gameplay...");
            this.isGameplayActive = true;

            if (this.crazygamesSDK) {
                this.crazygamesSDK.game.gameplayStart();
            }

            await Promise.resolve();
        } else {
            console.debug("CrazyGames Platform: Gameplay already active.");
        }
    }

    public async gameplayStop(): Promise<void> {
        if (this.isGameplayActive) {
            console.debug("CrazyGames Platform: Stopping gameplay...");
            this.isGameplayActive = false;

            if (this.crazygamesSDK) {
                this.crazygamesSDK.game.gameplayStop();
            }

            await Promise.resolve();
        } else {
            console.debug("CrazyGames Platform: Gameplay already inactive.");
        }
    }
}