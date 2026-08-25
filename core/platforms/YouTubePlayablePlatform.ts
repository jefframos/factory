import SoundManager from "core/audio/SoundManager";
import { IPlatformConnection } from "./IPlatformConnection";

// Real ambient types for the global `ytgame` namespace — see ./ytgame.d.ts (copied from
// Google's own SDK typings). `window.ytgame` itself is still optional: the SDK script
// (see startLoadSDK()) may not have loaded yet, or this may be running outside the
// YouTube Playables environment entirely (see isPlayablesEnv()).
declare global {
    interface Window {
        ytgame?: typeof ytgame;
    }
}

function log(event: string, ...args: any[]) {
    //console.log(`[YT_PLATFORM] ${event}`, ...args);
}

export default class YouTubePlayablePlatform implements IPlatformConnection {

    public isGameplayActive = false;

    // YouTube certification requires pause/resume to come exclusively from
    // ytgame.system.onPause/onResume — using the Page Visibility API instead
    // (or in addition) causes incorrect pause/resume behavior during ad breaks.
    public usesPageVisibilityApi = false;

    private saveData: Record<string, string> = {};

    private first = false;

    private isPlayablesEnv(): boolean {
        return Boolean(window.ytgame?.IN_PLAYABLES_ENV);
    }


    private async waitForYTGame(): Promise<void> {
        if (window.ytgame?.system) {
            return;
        }

        await new Promise<void>((resolve) => {
            const timer = setInterval(() => {
                if (window.ytgame?.system) {
                    clearInterval(timer);
                    resolve();
                }
            }, 10);
        });
    }
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
        await this.waitForYTGame();
        // await this.startLoadSDK(); // intentionally disabled per your setup

        if (!this.isPlayablesEnv()) {
            log("Not in YouTube Playables environment - using browser localStorage backend");
            this.saveData = {};
            return;
        }

        if (window.ytgame?.game?.loadData) {
            log("loadData available - requesting save state");

            try {
                // loadData() is typed as Promise<string> (see ytgame.d.ts) — always a
                // serialized string per the SDK's own contract, never a pre-parsed object.
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
    private savePromise: Promise<void> = Promise.resolve();
    // -------------------------
    // STORAGE
    // -------------------------
    private async flushSaveData(): Promise<void> {
        await window.ytgame?.game?.saveData?.(
            JSON.stringify(this.saveData)
        );
    }

    public async setItem(key: string, value: string): Promise<void> {

        // Mirrors getItem's local/localStorage fallback — without this,
        // local dev (and any run outside the real Playables iframe, e.g.
        // merge1 always resolving to this platform, see its index.ts)
        // wrote only to the in-memory `saveData` object (flushSaveData's
        // ytgame.game.saveData?.() call silently no-ops when window.ytgame
        // isn't the real SDK), which is reset on every page load — nothing
        // was ever actually persisted, so progress/mute state always reset
        // to defaults on reload despite getItem correctly reading real
        // localStorage right after.
        if (!this.isPlayablesEnv()) {
            localStorage.setItem(key, value);
            log("setItem (localStorage)", key, value);
            return;
        }

        this.saveData[key] = value;

        // Chain onto savePromise for ordering, but never let a rejection poison
        // it — ytgame.game.saveData() can reject (e.g. API_UNAVAILABLE) per the
        // SDK's own docs, and an uncaught rejection here would permanently break
        // every future save for the rest of the session (.then() on an already-
        // rejected promise never runs its callback again).
        const next = this.savePromise.catch(() => {}).then(() => this.flushSaveData());
        this.savePromise = next;

        try {
            await next;
        } catch (e) {
            log("saveData failed", e);
        }
    }

    public async getItem(key: string): Promise<string | null> {
        log("getItem", key);

        if (!this.isPlayablesEnv()) {
            const localValue = localStorage.getItem(key);
            log("getItem result (localStorage)", key, localValue);
            return localValue;
        }

        const value = this.saveData[key] ?? null;

        //log("getItem result", key, value);

        return value;
    }

    public async removeItem(key: string): Promise<void> {

        if (!this.isPlayablesEnv()) {
            localStorage.removeItem(key);
            log("removeItem (localStorage)", key);
            return;
        }

        delete this.saveData[key];

        const next = this.savePromise.catch(() => {}).then(() => this.flushSaveData());
        this.savePromise = next;

        try {
            await next;
        } catch (e) {
            log("saveData failed", e);
        }
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

    public async onPause(callback: () => void): Promise<void> {
        await this.waitForYTGame();

        window.ytgame.system.onPause(() => {
            log("pause event triggered");
            callback();
        });

        log("Pause handler registered");

    }


    public async onResume(callback: () => void): Promise<void> {
        await this.waitForYTGame();

        window.ytgame.system.onResume(() => {
            log("resume event triggered");
            callback();
        });

        log("Resume handler registered");
    }


    public async onAudioChanged(callback: (enabled: boolean) => void): Promise<void> {
        await this.waitForYTGame();

        // Outside the real Playables iframe (e.g. local dev — merge1 always
        // resolves to this platform, see its index.ts), the SDK's reported
        // audio-enabled state can't be trusted: it may report `false` once
        // as a safe default and never fire again, since there's no real
        // YouTube chrome to ever send a "user unmuted" event. Combined with
        // SoundManager's platform-mute always winning over the in-game
        // toggle (required for real certification), that stuck `false`
        // would permanently mute local test builds with no way to clear it.
        if (!this.isPlayablesEnv()) {
            log("not in Playables env - skipping onAudioChanged subscription");
            return;
        }

        window.ytgame.system.onAudioEnabledChange((enabled: boolean) => {
            log("audio change event", enabled);
            callback(enabled);
        });

        log("Audio handler registered");
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

    public async setPlayerScore(_score: number): Promise<void> {
        log("setPlayerScore (noop)");
    }
}