import SoundManager from "../../../src/assets/SoundManager";
import { IPlatformConnection } from "./IPlatformConnection";

export default class CrazyGamesPlatform implements IPlatformConnection {
    public isGameplayActive = false;

    constructor() { }
    public happyTime(): Promise<void> {
        window.CrazyGames.SDK.game.happytime();
        return Promise.resolve();
    }

    public async showBanner(position: 'up' | 'down' | 'bottomLeft' = 'down'): Promise<void> {
        let bannerContainer = document.getElementById("banner-container");

        // Create the banner container if it doesn't exist
        if (!bannerContainer) {
            bannerContainer = document.createElement("div");
            bannerContainer.id = "banner-container";
            bannerContainer.style.width = "100%";
            bannerContainer.style.height = "90px";
            bannerContainer.style.position = "fixed";

            // Position the banner based on the passed parameter
            if (position === "up") {
                bannerContainer.style.left = "50%";
                bannerContainer.style.transform = "translateX(-50%)";
                bannerContainer.style.top = "0";
            } else if (position === "bottomLeft") {
                bannerContainer.style.left = "0";
                bannerContainer.style.bottom = "0";
                bannerContainer.style.width = "250px";
                bannerContainer.style.height = "250px";
                // No centering transform needed for bottom left.
                bannerContainer.style.transform = "";
            } else {
                // Default is "down"
                bannerContainer.style.left = "50%";
                bannerContainer.style.transform = "translateX(-50%)";
                bannerContainer.style.bottom = "0";
            }
            document.body.appendChild(bannerContainer);
        } else {
            // Update the container's style if it already exists
            bannerContainer.style.position = "fixed";
            if (position === "up") {
                bannerContainer.style.left = "50%";
                bannerContainer.style.transform = "translateX(-50%)";
                bannerContainer.style.top = "0";
                bannerContainer.style.bottom = "";
            } else if (position === "bottomLeft") {
                bannerContainer.style.width = "300px";
                bannerContainer.style.height = "250px";
                bannerContainer.style.left = "0";
                bannerContainer.style.bottom = "0";
                bannerContainer.style.top = "";
                bannerContainer.style.transform = "";
            } else {
                // Default is "down"
                bannerContainer.style.left = "50%";
                bannerContainer.style.transform = "translateX(-50%)";
                bannerContainer.style.bottom = "0";
                bannerContainer.style.top = "";
            }
        }

        try {
            await window.CrazyGames.SDK.banner.requestResponsiveBanner("banner-container");
            console.log("Banner displayed successfully");
        } catch (e) {
            console.error("Banner request error", e);
        }
    }

    public hideBanner(): Promise<void> {
        const bannerContainer = document.getElementById("banner-container");
        if (bannerContainer) {
            // Remove the banner container from the DOM to hide it
            bannerContainer.parentElement?.removeChild(bannerContainer);
            console.log("Banner hidden successfully");
        } else {
            console.warn("Banner container not found.");
        }
        return Promise.resolve()
    }

    public async startLoadSDK(): Promise<void> {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            // Updated SDK URL for CrazyGames
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
        window.CrazyGames.SDK.game.loadingStart();
        await Promise.resolve();
    }

    public async loadFinished(): Promise<void> {
        console.debug("CrazyGames Platform: Load finished.");
        // Call the CrazyGames function that marks game load completion
        window.CrazyGames.SDK.game.loadingStop();
        await Promise.resolve();
    }

    public async initialize(): Promise<void> {
        console.debug("CrazyGames Platform: Initializing...");
        await this.startLoadSDK();
        return window.CrazyGames.SDK.init();
    }

    public async showCommercialBreak(): Promise<void> {


        SoundManager.instance.muteAllSounds();
        console.debug("CrazyGames Platform: Showing commercial break...");
        const ad = window.CrazyGames.SDK.ad;
        const callbacks = {
            adFinished: () => {
                SoundManager.instance.restoreSound();
                Promise.resolve()
            },
            adError: (error) => console.log("Error midgame ad", error),
            adStarted: () => console.log("Start midgame ad"),
        };
        ad.requestAd("midgame", callbacks);
    }

    public async showRewardedVideo(): Promise<void> {
        SoundManager.instance.muteAllSounds();
        console.debug("CrazyGames Platform: Showing rewarded video...");
        const ad = window.CrazyGames.SDK.ad;
        const callbacks = {
            adFinished: () => {
                SoundManager.instance.restoreSound();
                Promise.resolve()
            },
            adError: (error) => console.log("Error midgame ad", error),
            adStarted: () => console.log("Start midgame ad"),
        };
        ad.requestAd("rewarded", callbacks);
    }

    public async setPlayerScore(score: number): Promise<void> {
        console.debug("CrazyGames Platform: Setting player score:", score);
        // Insert logic to save the player's score, if CrazyGames provides such functionality
        await Promise.resolve();
    }

    public async getLeaderboard(): Promise<void> {
        console.debug("CrazyGames Platform: Getting leaderboard...");
        // Insert CrazyGames SDK leaderboard logic if available
        return await Promise.resolve();
    }

    public async getFriends(): Promise<void> {
        console.debug("CrazyGames Platform: Getting friends list...");
        // Insert CrazyGames SDK friend list logic if available
        return await Promise.resolve();
    }

    public async gameplayStart(): Promise<void> {
        if (!this.isGameplayActive) {
            console.debug("CrazyGames Platform: Starting gameplay...");
            this.isGameplayActive = true;
            window.CrazyGames.SDK.game.gameplayStart();
            await Promise.resolve();
        } else {
            console.debug("CrazyGames Platform: Gameplay already active.");
        }
    }

    public async gameplayStop(): Promise<void> {
        if (this.isGameplayActive) {
            console.debug("CrazyGames Platform: Stopping gameplay...");
            this.isGameplayActive = false;
            window.CrazyGames.SDK.game.gameplayStop();
            await Promise.resolve();
        } else {
            console.debug("CrazyGames Platform: Gameplay already inactive.");
        }
    }
}
