import { IPlatformConnection } from "./IPlatformConnection";

export default class PokiPlatform implements IPlatformConnection {
    public isGameplayActive = false;

    constructor() {
    }
    public happyTime(): Promise<void> {
        return Promise.resolve();
    }
    public showBanner(): Promise<void> {
        return Promise.resolve()
    }
    public hideBanner(): Promise<void> {
        return Promise.resolve()
    }
    public async startLoadSDK(): Promise<void> {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://game-cdn.poki.com/scripts/v2/poki-sdk.js";
            script.async = true;

            script.onload = () => {
                console.log("Poki SDK loaded successfully");
                resolve();
            };

            script.onerror = () => {
                console.error("Failed to load the Poki SDK");
                reject(new Error("Failed to load Poki SDK"));
            };

            document.head.appendChild(script);
        });
    }
    public async startLoad(): Promise<void> {
        console.debug("Poki Platform: Starting load...");
        // Insert Poki SDK logic for load start if available
        await Promise.resolve();
    }

    public async loadFinished(): Promise<void> {
        console.debug("Poki Platform: Load finished.");
        PokiSDK.gameLoadingFinished();
        await Promise.resolve();
    }

    public async initialize(): Promise<void> {
        console.debug("Poki Platform: Initializing...");

        await this.startLoadSDK()
        return PokiSDK.init()

    }

    public async showCommercialBreak(): Promise<void> {
        console.debug("Poki Platform: Showing commercial break...");
        // Example Poki SDK commercial break
        if (window['PokiSDK']) {
            await window['PokiSDK'].commercialBreak();
        } else {
            await Promise.resolve();
        }
    }

    public async showRewardedVideo(): Promise<void> {
        console.debug("Poki Platform: Showing rewarded video...");
        // Example Poki SDK rewarded video
        if (window['PokiSDK']) {
            await window['PokiSDK'].rewardedBreak();
        } else {
            await Promise.resolve();
        }
    }

    public async setPlayerScore(score: number): Promise<void> {
        console.debug("Poki Platform: Setting player score:", score);
        // Insert logic to save the player's score, if Poki provides it
        await Promise.resolve();
    }

    public async getLeaderboard(): Promise<void> {
        console.debug("Poki Platform: Getting leaderboard...");
        // Insert Poki SDK leaderboard logic if available
        return await Promise.resolve();
    }

    public async getFriends(): Promise<void> {
        console.debug("Poki Platform: Getting friends list...");
        // Insert Poki SDK friend list logic if available
        return await Promise.resolve();
    }

    public async gameplayStart(): Promise<void> {
        if (!this.isGameplayActive) {
            console.debug("Poki Platform: Starting gameplay...");
            this.isGameplayActive = true;
            PokiSDK.gameplayStart();
            await Promise.resolve();
        } else {
            console.debug("Poki Platform: Gameplay already active.");
        }
    }

    public async gameplayStop(): Promise<void> {
        if (this.isGameplayActive) {
            console.debug("Poki Platform: Stopping gameplay...");
            this.isGameplayActive = false;
            PokiSDK.gameplayStop();
            await Promise.resolve();
        } else {
            console.debug("Poki Platform: Gameplay already inactive.");
        }
    }
}
