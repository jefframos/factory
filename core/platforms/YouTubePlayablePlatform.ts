import SoundManager from "@core/audio/SoundManager";
import { IPlatformConnection } from "./IPlatformConnection";

declare global {
    interface Window {
        ytgame?: any;
    }
}

function log(event: string, ...args: any[]) {
    console.log(`[YT_PLATFORM] ${event}`, ...args);
}

export default class YouTubePlayablePlatform implements IPlatformConnection {

    public isGameplayActive = false;

    private saveData: Record<string, string> = {};

    private first = false;

    // -------------------------
    // SDK LOADING
    // -------------------------
    public async startLoadSDK(): Promise<void> {
        log("startLoadSDK - injecting script");

        return new Promise((resolve, reject) => {
            const script = document.createElement("script");

            script.src = "https://www.youtube.com/game_api/v1";

            script.onload = () => {
                log("SDK script loaded (onload fired)");

                const check = () => {
                    if (window.ytgame) {
                        log("window.ytgame detected ✔");
                        resolve();
                    } else {
                        log("waiting for window.ytgame...");
                        setTimeout(check, 10);
                    }
                };

                check();
            };

            script.onerror = (err) => {
                log("SDK script failed to load ❌", err);
                reject(err);
            };

            document.head.appendChild(script);
        });
    }

    // -------------------------
    // INITIALIZATION
    // -------------------------
    public async initialize(): Promise<void> {
        log("initialize - start");

        // await this.startLoadSDK(); // intentionally disabled per your setup

        if (window.ytgame?.game?.loadData) {
            log("loadData available - requesting save state");

            try {
                const raw = await window.ytgame.game.loadData();
                log("loadData result", raw);

                this.saveData = raw ? JSON.parse(raw) : {};

                log("saveData parsed", this.saveData);
            }
            catch (e) {
                log("loadData failed", e);
                this.saveData = {};
            }
        } else {
            log("loadData not available");
        }
    }

    // -------------------------
    // GAME FLOW
    // -------------------------
    public async startLoad(): Promise<void> {
        log("startLoad");
    }

    public async firstFrameReady(): Promise<void> {
        log("firstFrameReady called");

        window.ytgame?.game?.firstFrameReady?.();
        log("firstFrameReady sent to SDK");
    }

    public async loadFinished(): Promise<void> {
        log("loadFinished called");

        if (!this.first) {
            log("first loadFinished -> calling firstFrameReady");
            await this.firstFrameReady();
            this.first = true;
        }

        window.ytgame?.game?.gameReady?.();
        log("gameReady sent to SDK");
    }

    // -------------------------
    // ADS
    // -------------------------
    public async showCommercialBreak(): Promise<void> {
        log("showCommercialBreak");

        if (!window.ytgame?.ads?.requestInterstitialAd) {
            log("interstitial not available");
            return;
        }

        SoundManager.instance.muteAllSounds();
        log("audio muted for interstitial");

        try {
            await window.ytgame.ads.requestInterstitialAd();
            log("interstitial completed");
        }
        catch (e) {
            log("interstitial failed", e);
        }
        finally {
            SoundManager.instance.restoreSound();
            log("audio restored after interstitial");
        }
    }

    public async showRewardedVideo(rewardId = "default-reward"): Promise<boolean> {
        log("showRewardedVideo", rewardId);

        if (!window.ytgame?.ads?.requestRewardedAd) {
            log("rewarded ads not available");
            return false;
        }

        SoundManager.instance.muteAllSounds();
        log("audio muted for rewarded ad");

        try {
            const result = await window.ytgame.ads.requestRewardedAd(rewardId);
            log("rewarded result", result);
            return result;
        }
        catch (e) {
            log("rewarded failed", e);
            return false;
        }
        finally {
            SoundManager.instance.restoreSound();
            log("audio restored after rewarded");
        }
    }

    // -------------------------
    // STORAGE
    // -------------------------
    public async setItem(key: string, value: string): Promise<void> {
        log("setItem", key, value);

        this.saveData[key] = value;

        await window.ytgame?.game?.saveData?.(
            JSON.stringify(this.saveData)
        );

        log("saveData updated", this.saveData);
    }

    public async getItem(key: string): Promise<string | null> {
        log("getItem", key);

        const value = this.saveData[key] ?? null;

        log("getItem result", key, value);

        return value;
    }

    public async removeItem(key: string): Promise<void> {
        log("removeItem", key);

        delete this.saveData[key];

        await window.ytgame?.game?.saveData?.(
            JSON.stringify(this.saveData)
        );

        log("saveData updated after remove", this.saveData);
    }

    // -------------------------
    // SYSTEM
    // -------------------------
    public async getLanguage(): Promise<string> {
        log("getLanguage");

        const lang =
            (await window.ytgame?.system?.getLanguage?.()) ?? "en-US";

        log("language result", lang);

        return lang;
    }

    public onPause(callback: () => void): void {
        log("onPause registered");

        window.ytgame?.system?.onPause?.(() => {
            log("pause event triggered");
            callback();
        });
    }

    public onResume(callback: () => void): void {
        log("onResume registered");

        window.ytgame?.system?.onResume?.(() => {
            log("resume event triggered");
            callback();
        });
    }

    public onAudioChanged(callback: (enabled: boolean) => void): void {
        log("onAudioChanged registered");

        window.ytgame?.system?.onAudioEnabledChange?.((enabled: boolean) => {
            log("audio change event", enabled);
            callback(enabled);
        });
    }

    // -------------------------
    // REQUIRED HOOKS (no-op but logged)
    // -------------------------
    public async gameplayStart(): Promise<void> {
        log("gameplayStart");
    }

    public async gameplayStop(): Promise<void> {
        log("gameplayStop");
    }

    public async showBanner(): Promise<void> {
        log("showBanner (noop)");
    }

    public async hideBanner(): Promise<void> {
        log("hideBanner (noop)");
    }

    public async happyTime(): Promise<void> {
        log("happyTime (noop)");
    }

    public async getLeaderboard(): Promise<void> {
        log("getLeaderboard (noop)");
    }

    public async getFriends(): Promise<void> {
        log("getFriends (noop)");
    }
}