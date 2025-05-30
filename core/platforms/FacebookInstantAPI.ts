import { IPlatformConnection } from "./IPlatformConnection";

class FacebookInstantAPI implements IPlatformConnection {
    private contextId: string | null = null;
    private contextType: string | null = null;
    private playerId: string | null = null;
    private playerName: string | null = null;
    private isGameplayActive: boolean = false;

    public async initialize(): Promise<void> {
        try {
            await FBInstant.initializeAsync();
            this.contextId = FBInstant.context.getID();
            this.contextType = FBInstant.context.getType();
            this.playerId = FBInstant.player.getID();
            this.playerName = FBInstant.player.getName();

            await FBInstant.startGameAsync();
            console.log("Facebook Instant Games SDK initialized successfully.");
        } catch (error) {
            console.error("Error initializing Facebook Instant Games SDK:", error);
        }
    }

    public async showCommercialBreak(): Promise<void> {
        try {
            const interstitialAd = await FBInstant.getInterstitialAdAsync('YOUR_PLACEMENT_ID');
            await interstitialAd.loadAsync();
            await interstitialAd.showAsync();
            console.log('Interstitial ad shown successfully.');
        } catch (error) {
            console.error("Error showing commercial break:", error);
        }
    }

    public async showRewardedVideo(): Promise<void> {
        try {
            const rewardedVideo = await FBInstant.getRewardedVideoAsync('YOUR_PLACEMENT_ID');
            await rewardedVideo.loadAsync();
            await rewardedVideo.showAsync();
            console.log('Rewarded video ad shown successfully.');
        } catch (error) {
            console.error("Error showing rewarded video:", error);
        }
    }

    public async setPlayerScore(score: number): Promise<void> {
        try {
            const leaderboard = await FBInstant.getLeaderboardAsync('YOUR_LEADERBOARD_NAME');
            const entry = await leaderboard.setScoreAsync(score);
            console.log('Score set successfully. Rank:', entry.getRank());
        } catch (error) {
            console.error("Error setting player score:", error);
        }
    }

    public async getLeaderboard(): Promise<void> {
        try {
            const leaderboard = await FBInstant.getLeaderboardAsync('YOUR_LEADERBOARD_NAME');
            const entries = await leaderboard.getEntriesAsync(10, 0);
            entries.forEach(entry => {
                console.log(entry.getRank() + '. ' + entry.getPlayer().getName() + ': ' + entry.getScore());
            });
        } catch (error) {
            console.error("Error retrieving leaderboard:", error);
        }
    }

    public async getFriends(): Promise<void> {
        try {
            const players = await FBInstant.player.getConnectedPlayersAsync();
            players.forEach(player => {
                console.log(player.getName());
            });
        } catch (error) {
            console.error("Error retrieving friends list:", error);
        }
    }

    public async gameplayStart(): Promise<void> {
        if (!this.isGameplayActive) {
            this.isGameplayActive = true;
            try {
                await FBInstant.logEvent('gameplay_start');
                console.log("Gameplay started.");
            } catch (error) {
                console.error("Error starting gameplay:", error);
            }
        } else {
            console.log("Gameplay is already active.");
        }
    }

    public async gameplayStop(): Promise<void> {
        if (this.isGameplayActive) {
            this.isGameplayActive = false;
            try {
                await FBInstant.logEvent('gameplay_stop');
                console.log("Gameplay stopped.");
            } catch (error) {
                console.error("Error stopping gameplay:", error);
            }
        } else {
            console.log("Gameplay is not active.");
        }
    }
}

// Example usage
// const platformConnection: IPlatformConnection = new FacebookInstantAPI();
// platformConnection.initialize().then(() => {
//     platformConnection.showCommercialBreak();
// });

// // Usage example:
// const fbApi = new FacebookInstantAPI();
// fbApi.showCommercialBreak();
// fbApi.setPlayerScore(1000);
// fbApi.getLeaderboard();
// fbApi.getFriends();
