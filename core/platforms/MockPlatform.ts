import { IPlatformConnection } from "./IPlatformConnection";

export default class MockPlatform implements IPlatformConnection {
    async showBanner(type: any): Promise<void> {
        await Promise.resolve();//throw new Error("Method not implemented.");
    }
    async hideBanner(): Promise<void> {
        await Promise.resolve();//throw new Error("Method not implemented.");
    }
    async happyTime(): Promise<void> {
        await Promise.resolve();//throw new Error("Method not implemented.");
    }
    public isGameplayActive = false;

    public async startLoadSDK(): Promise<void> {
        await Promise.resolve();
    }

    public async startLoad(): Promise<void> {
        console.debug("Mock Platform: Starting load...");
        // Insert Poki SDK logic for load start if available
        await Promise.resolve();
    }

    public async loadFinished(): Promise<void> {
        console.debug("Mock Platform: Load finished.");
        return Promise.resolve();
    }

    public async initialize(): Promise<void> {
        console.debug("Mock Platform: Initializing...");
        // Insert Poki SDK initialization logic
        await this.startLoadSDK();
        return Promise.resolve();
    }

    public async showCommercialBreak(): Promise<void> {
        console.debug("Mock Platform: Showing commercial break...");
        return Promise.resolve();
    }

    public async showRewardedVideo(): Promise<void> {
        console.debug("Mock Platform: Showing rewarded video...");
        return Promise.resolve();
    }

    public async setPlayerScore(score: number): Promise<void> {
        console.debug("Mock Platform: Setting player score:", score);
        // Insert logic to save the player's score, if Poki provides it
        await Promise.resolve();
    }

    public async getLeaderboard(): Promise<void> {
        console.debug("Mock Platform: Getting leaderboard...");
        // Insert Poki SDK leaderboard logic if available
        return await Promise.resolve();
    }

    public async getFriends(): Promise<void> {
        console.debug("Mock Platform: Getting friends list...");
        // Insert Poki SDK friend list logic if available
        return await Promise.resolve();
    }

    public async gameplayStart(): Promise<void> {
        if (!this.isGameplayActive) {
            await Promise.resolve();
        } else {
            console.debug("Mock Platform: Gameplay already active.");
        }
    }

    public async gameplayStop(): Promise<void> {
        if (this.isGameplayActive) {
            await Promise.resolve();
        } else {
            console.debug("Mock Platform: Gameplay already inactive.");
        }
    }
}
