// export interface IPlatformConnection {
//     isGameplayActive: boolean;
//     startLoadSDK(): Promise<void>;
//     startLoad(): Promise<void>;
//     loadFinished(): Promise<void>;
//     initialize(): Promise<void>;
//     showCommercialBreak(): Promise<void>;
//     showRewardedVideo(): Promise<void>;
//     setPlayerScore(score: number): Promise<void>;
//     getLeaderboard(): Promise<void>;
//     getFriends(): Promise<void>;
//     gameplayStart(): Promise<void>;
//     gameplayStop(): Promise<void>;
//     showBanner(type: any): Promise<void>;
//     hideBanner(): Promise<void>;
//     happyTime(): Promise<void>;
//     setItem(key: string, value: string): Promise<void>;
//     getItem(key: string): Promise<string | null>;
//     removeItem(key: string): Promise<void>;
// }

export interface IPlatformConnection {
    isGameplayActive: boolean;

    startLoadSDK(): Promise<void>;
    startLoad(): Promise<void>;

    firstFrameReady(): Promise<void>;
    loadFinished(): Promise<void>;

    initialize(): Promise<void>;

    showCommercialBreak(): Promise<void>;
    showRewardedVideo(rewardId?: string): Promise<boolean>;

    setPlayerScore(score: number): Promise<void>;

    gameplayStart(): Promise<void>;
    gameplayStop(): Promise<void>;

    showBanner(type?: any): Promise<void>;
    hideBanner(): Promise<void>;

    happyTime(): Promise<void>;

    setItem(key: string, value: string): Promise<void>;
    getItem(key: string): Promise<string | null>;
    removeItem(key: string): Promise<void>;

    getLanguage?(): Promise<string>;

    /** Real account display name from the platform's own SDK, when it exposes one (e.g. a logged-in CrazyGames user) — null/undefined if unavailable or the user isn't logged in. Not every platform can supply this (Poki and GameDistribution don't expose player identity), so this stays optional; callers should fall back to a locally saved or randomly generated name. */
    getPlayerName?(): Promise<string | null>;

    onPause?(callback: () => void): void;
    onResume?(callback: () => void): void;
    onAudioChanged?(callback: (enabled: boolean) => void): void;
}