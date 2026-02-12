import SoundManager from "@core/audio/SoundManager";
import { IPlatformConnection } from "./IPlatformConnection";

export default class CrazyGamesPlatform implements IPlatformConnection {
    public isGameplayActive = false;
    private crazygamesSDK: any = null;

    constructor() {
    }

    public async setItem(key: string, value: string): Promise<void> {
        localStorage.setItem(key, value);
        return Promise.resolve();
    }

    public async getItem(key: string): Promise<string | null> {
        const value = localStorage.getItem(key);
        return Promise.resolve(value);
    }
    public async removeItem(key: string): Promise<void> {
        localStorage.removeItem(key);
        return Promise.resolve();
    }

    public happyTime(): Promise<void> {
        if (this.crazygamesSDK) {
            this.crazygamesSDK.game.happytime();
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

    public async loadFinished(): Promise<void> {
        if (this.crazygamesSDK) {
            this.crazygamesSDK.game.loadingStop();
        }
        await Promise.resolve();
    }

    public async initialize(): Promise<void> {
        console.debug("CrazyGames Platform: Initializing...");

        await this.startLoadSDK();

        // Wait for SDK to be available on window
        await new Promise(resolve => setTimeout(resolve, 100));

        // Initialize the SDK properly
        if (window['CrazyGames'] && window['CrazyGames'].SDK) {
            try {
                // Call init() to initialize the SDK
                await window['CrazyGames'].SDK.init();
                this.crazygamesSDK = window['CrazyGames'].SDK;
                console.log("CrazyGames SDK initialized successfully");
            } catch (error) {
                console.error("Failed to initialize CrazyGames SDK:", error);
                throw error;
            }
        } else {
            console.error("CrazyGames SDK not found on window object");
            throw new Error("CrazyGames SDK not found");
        }

        return Promise.resolve();
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

    public async showRewardedVideo(): Promise<void> {
        console.debug("CrazyGames Platform: Showing rewarded video...");

        if (this.crazygamesSDK) {
            SoundManager.instance.muteAllSounds();

            return new Promise((resolve, reject) => {
                this.crazygamesSDK.ad.requestAd("rewarded", {
                    adFinished: () => {
                        console.log("Rewarded ad finished - granting reward");
                        SoundManager.instance.restoreSound();
                        resolve();
                    },
                    adError: (error: any) => {
                        console.error("Rewarded ad error:", error);
                        SoundManager.instance.restoreSound();
                        reject(error);
                    },
                    adStarted: () => {
                        console.log("Rewarded ad started");
                    }
                });
            });
        } else {
            await Promise.resolve();
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