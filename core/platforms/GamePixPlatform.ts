import SoundManager from "@core/audio/SoundManager";
import { IPlatformConnection } from "./IPlatformConnection";

export default class GamePixPlatform implements IPlatformConnection {
    public isGameplayActive = false;
    private gamepix: any = null;

    constructor() { }
    public async removeItem(key: string): Promise<void> {
        console.debug(`GamePix Platform: Removing item ${key}`);

        if (this.gamepix && this.gamepix.localStorage) {
            // GamePix SDK v3 removeItem returns a Promise
            return await this.gamepix.localStorage.removeItem(key);
        } else {
            localStorage.removeItem(key);
            return Promise.resolve();
        }
    }

    public async setItem(key: string, value: string): Promise<void> {
        if (this.gamepix && this.gamepix.localStorage) {
            // GamePix SDK v3 uses a Promise-based storage
            return await this.gamepix.localStorage.setItem(key, value);
        } else {
            localStorage.setItem(key, value);
            return Promise.resolve();
        }
    }

    public async getItem(key: string): Promise<string | null> {
        if (this.gamepix && this.gamepix.localStorage) {
            return await this.gamepix.localStorage.getItem(key);
        } else {
            return Promise.resolve(localStorage.getItem(key));
        }
    }

    public happyTime(): Promise<void> {
        // GamePix doesn't have a direct 'happyTime' equivalent like CrazyGames,
        // but it's often used for "cheers" or level completions.
        console.debug("GamePix Platform: happyTime called (No direct mapping).");
        return Promise.resolve();
    }

    public async showBanner(): Promise<void> {
        // GamePix typically handles banners through their own UI wrapper, 
        // but if they provide a specific display method, it's usually automatic.
        console.debug("GamePix Platform: showBanner (Usually handled by GamePix UI).");
        return Promise.resolve();
    }

    public async hideBanner(): Promise<void> {
        return Promise.resolve();
    }

    public async startLoadSDK(): Promise<void> {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            // GamePix V3 SDK
            script.src = "https://integration.gamepix.com/sdk/v3/gamepix.sdk.js";
            script.async = true;

            script.onload = () => {
                console.log("GamePix SDK loaded successfully");
                // GamePix is automatically attached to window.GamePix
                this.gamepix = (window as any).GamePix;
                resolve();
            };

            script.onerror = () => {
                console.error("Failed to load the GamePix SDK");
                reject(new Error("Failed to load GamePix SDK"));
            };

            document.head.appendChild(script);
        });
    }

    public async startLoad(): Promise<void> {
        console.debug("GamePix Platform: Starting load...");
        // GamePix doesn't require a specific "start loading" call, 
        // as the SDK load itself is the trigger.
        return Promise.resolve();
    }

    public async loadFinished(): Promise<void> {
        console.debug("GamePix Platform: Load finished.");
        if (this.gamepix) {
            // Signal to GamePix that the game is ready to be played
            this.gamepix.loaded();
        }
        return Promise.resolve();
    }

    public async initialize(): Promise<void> {
        console.debug("GamePix Platform: Initializing...");
        await this.startLoadSDK();

        if (!this.gamepix) {
            throw new Error("GamePix SDK not found");
        }

        return Promise.resolve();
    }

    public async showCommercialBreak(): Promise<void> {
        console.debug("GamePix Platform: Showing interstitial...");

        if (this.gamepix) {
            SoundManager.instance.muteAllSounds();

            return new Promise((resolve) => {
                this.gamepix.interstitialAd().then(() => {
                    console.log("Interstitial finished");
                    SoundManager.instance.restoreSound();
                    resolve();
                }).catch((err: any) => {
                    console.error("Interstitial error:", err);
                    SoundManager.instance.restoreSound();
                    resolve();
                });
            });
        }
    }

    public async showRewardedVideo(): Promise<void> {
        console.debug("GamePix Platform: Showing rewarded video...");

        if (this.gamepix) {
            SoundManager.instance.muteAllSounds();

            return new Promise((resolve, reject) => {
                this.gamepix.rewardAd().then((res: any) => {
                    // GamePix returns a success boolean in the promise
                    if (res && res.success) {
                        console.log("Rewarded ad finished - granting reward");
                        SoundManager.instance.restoreSound();
                        resolve();
                    } else {
                        console.log("Rewarded ad skipped or failed");
                        SoundManager.instance.restoreSound();
                        reject(new Error("Reward not granted"));
                    }
                }).catch((error: any) => {
                    console.error("Rewarded ad error:", error);
                    SoundManager.instance.restoreSound();
                    reject(error);
                });
            });
        }
    }

    public async setPlayerScore(score: number): Promise<void> {
        console.debug("GamePix Platform: Setting player score:", score);
        if (this.gamepix) {
            this.gamepix.updateScore(score);
        }
    }

    public async getLeaderboard(): Promise<void> {
        console.debug("GamePix Platform: Getting leaderboard...");
        // GamePix usually handles leaderboards via their overlay.
        return Promise.resolve();
    }

    public async getFriends(): Promise<void> {
        return Promise.resolve();
    }

    public async gameplayStart(): Promise<void> {
        if (!this.isGameplayActive) {
            console.debug("GamePix Platform: Starting gameplay...");
            this.isGameplayActive = true;
            // No specific start method in GamePix; handled by internal logic.
        }
    }

    public async gameplayStop(): Promise<void> {
        if (this.isGameplayActive) {
            console.debug("GamePix Platform: Stopping gameplay...");
            this.isGameplayActive = false;
        }
    }
}