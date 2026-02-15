import SoundManager from "@core/audio/SoundManager";
import { IPlatformConnection } from "./IPlatformConnection";
import PlatformHandler from "./PlatformHandler";

export default class GameDistributionPlatform implements IPlatformConnection {
    public isGameplayActive = false;
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
        console.debug(`Platform: Removing item ${key}`);
        localStorage.removeItem(key);
        return Promise.resolve();
    }

    public happyTime(): Promise<void> {
        // GD doesn't have a direct "happyTime" equivalent; usually used for mid-game flair
        return Promise.resolve();
    }

    public showBanner(): Promise<void> {
        // GD Banners are usually handled via div injection; implementation varies by placement
        return Promise.resolve();
    }

    public hideBanner(): Promise<void> {
        return Promise.resolve();
    }

    public async startLoadSDK(): Promise<void> {
        return new Promise((resolve, reject) => {
            // GD requires global options to be set before the script loads
            window["GD_OPTIONS"] = {
                gameId: PlatformHandler.GAME_ID,
                onEvent: (event: any) => {
                    switch (event.name) {
                        case "SDK_READY":
                            console.log("GD SDK loaded successfully");
                            resolve();
                            break;
                        case "SDK_ERROR":
                            console.error("Failed to load GD SDK");
                            reject(new Error("GD SDK Error"));
                            break;
                    }
                },
            };

            const script = document.createElement("script");
            script.src = "https://html5.api.gamedistribution.com/main.min.js";
            script.async = true;
            document.head.appendChild(script);
        });
    }

    public async startLoad(): Promise<void> {
        console.debug("GD Platform: Starting load...");
        await Promise.resolve();
    }

    public async loadFinished(): Promise<void> {
        console.debug("GD Platform: Load finished.");
        // GD doesn't have a mandatory 'loadingFinished' call like Poki, 
        // but it's good practice to ensure everything is ready.
        await Promise.resolve();
    }

    public async initialize(): Promise<void> {
        console.debug("GD Platform: Initializing...");
        await this.startLoadSDK();
    }

    public async showCommercialBreak(): Promise<void> {
        console.debug("GD Platform: Showing commercial break...");
        if (window["gdsdk"] && typeof window["gdsdk"].showAd === "function") {
            SoundManager.instance.muteAllSounds();

            return new Promise((resolve) => {
                window["gdsdk"].showAd()
                    .then(() => {
                        SoundManager.instance.restoreSound();
                        resolve();
                    })
                    .catch(() => {
                        SoundManager.instance.restoreSound();
                        resolve(); // Resolve anyway to not break game flow
                    });
            });
        }
        return Promise.resolve();
    }

    public async showRewardedVideo(): Promise<void> {
        console.debug("GD Platform: Showing rewarded video...");
        if (window["gdsdk"] && typeof window["gdsdk"].preloadAd === "function") {
            SoundManager.instance.muteAllSounds();

            return new Promise((resolve) => {
                window["gdsdk"].showAd("rewarded")
                    .then(() => {
                        SoundManager.instance.restoreSound();
                        resolve();
                    })
                    .catch(() => {
                        SoundManager.instance.restoreSound();
                        resolve();
                    });
            });
        }
        return Promise.resolve();
    }

    public async setPlayerScore(score: number): Promise<void> {
        console.debug("GD Platform: Setting player score:", score);
        await Promise.resolve();
    }

    public async getLeaderboard(): Promise<void> {
        console.debug("GD Platform: Getting leaderboard...");
        return await Promise.resolve();
    }

    public async getFriends(): Promise<void> {
        console.debug("GD Platform: Getting friends list...");
        return await Promise.resolve();
    }

    public async gameplayStart(): Promise<void> {
        if (!this.isGameplayActive) {
            console.debug("GD Platform: Starting gameplay...");
            this.isGameplayActive = true;
            // GD does not have a specific 'gameplayStart' analytics call like Poki
            await Promise.resolve();
        }
    }

    public async gameplayStop(): Promise<void> {
        if (this.isGameplayActive) {
            console.debug("GD Platform: Stopping gameplay...");
            this.isGameplayActive = false;
            await Promise.resolve();
        }
    }
}