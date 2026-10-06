// poki-sdk.d.ts
//
// Types for the parts of the Poki SDK (https://game-cdn.poki.com/scripts/v2/poki-sdk.js, loaded
// at runtime by PokiPlatform.startLoadSDK()) this codebase calls. Optional on `window` because the
// script may fail to load; the bare global is only touched after init().

interface PokiSDKApi {
    init(): Promise<void>;
    gameLoadingFinished(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    commercialBreak(): Promise<void>;
    rewardedBreak(): Promise<boolean>;
    /** Game analytics event — https://developers.poki.com/guide/game-events. */
    measure(category: string, what: string, action: string): void;
}

declare const PokiSDK: PokiSDKApi;

interface Window {
    PokiSDK?: PokiSDKApi;
}
