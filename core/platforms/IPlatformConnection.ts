export interface IPlatformConnection {
    isGameplayActive: boolean;
    startLoadSDK(): Promise<void>;
    startLoad(): Promise<void>;
    loadFinished(): Promise<void>;
    initialize(): Promise<void>;
    showCommercialBreak(): Promise<void>;
    showRewardedVideo(): Promise<void>;
    setPlayerScore(score: number): Promise<void>;
    getLeaderboard(): Promise<void>;
    getFriends(): Promise<void>;
    gameplayStart(): Promise<void>;
    gameplayStop(): Promise<void>;
    showBanner(type: any): Promise<void>;
    hideBanner(): Promise<void>;
    happyTime(): Promise<void>;
}