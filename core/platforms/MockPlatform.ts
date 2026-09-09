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

    public async firstFrameReady(): Promise<void> {
        await Promise.resolve();
    }

    /**
     * Backed by plain browser localStorage — same recipe Poki/CrazyGames/GameDistribution's own
     * platform wrappers use, just without a real SDK to defer to. This was MISSING entirely
     * until now (the class declared `implements IPlatformConnection` without actually providing
     * these three required methods) — every *Storage.ts here calls PlatformHandler.instance.
     * platform.getItem/setItem unconditionally, no fallback, so on this platform every one of
     * them was silently failing its persist()/load() every time (caught by whichever ones wrap
     * the call in a try/catch, like QueueStorage.load(); an uncaught promise rejection for the
     * ones that don't, like QueueStorage.persist()) — the actual cause behind local/dev testing
     * losing all progress on every reload, not just queues.
     */
    public async setItem(key: string, value: string): Promise<void> {
        localStorage.setItem(key, value);
    }

    public async getItem(key: string): Promise<string | null> {
        return localStorage.getItem(key);
    }

    public async removeItem(key: string): Promise<void> {
        localStorage.removeItem(key);
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

    public async showRewardedVideo(): Promise<boolean> {
        console.debug("Mock Platform: Showing rewarded video...");
        return Promise.resolve(true);
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
            console.debug("Mock Platform: Gameplay started.");
            this.isGameplayActive = true;
            await Promise.resolve();
        } else {
            console.debug("Mock Platform: Gameplay already active.");
        }
    }

    public async gameplayStop(): Promise<void> {
        if (this.isGameplayActive) {
            console.debug("Mock Platform: Gameplay stopped.");
            this.isGameplayActive = false;
            await Promise.resolve();
        } else {
            console.debug("Mock Platform: Gameplay already inactive.");
        }
    }
}
