// CapacitorPlatform.ts
//
// The game as a phone app (Capacitor: the web build inside an Android / iOS app). VITE_PLATFORM=android picks it
// (PlatformFactory). The how-to: native/README.md.
//
// - Saves: @capacitor/preferences (the app's own storage, kept till the app's uninstalled); localStorage in a browser.
// - Ads: AdMob (@capacitor-community/admob), each kind only when its ad unit is set (PlatformHandler.ADMOB, from the game's
//   platforms.config.json `admob`); a kind that isn't, or every kind outside the app, plays MockPlatform's stand-in. So
//   a build with no AdMob account works: ads are mocked. `test: true` asks AdMob for test ads (keep it on till the store:
//   tapping live ads of your own gets the account closed).
// - Interstitials are paced here (AdMob doesn't): none in the first INTERSTITIAL.first seconds, then one every
//   INTERSTITIAL.every at most.
// - Pause / resume: the app going to the background and back. The Android back button: PlatformHandler.backButton (the
//   game closes what's open), else the app goes to the background.

import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { AdMob, AdmobConsentStatus, InterstitialAdPluginEvents, RewardAdPluginEvents } from '@capacitor-community/admob';
import SoundManager from '../audio/SoundManager';
import { IPlatformConnection } from './IPlatformConnection';
import { fakePurchase, fakeRewardedVideo } from './MockPlatform';
import PlatformHandler from './PlatformHandler';

/** CSS px kept clear on every side in the app (Game.safeScreenData): phones' rounded corners, which no safe-area inset reports. */
const CORNER_MARGIN = 14;
/** Where the settings' choice of mock ads is kept. */
const MOCK_ADS = 'ads.mock';
/** Where the mocked purchases keep what's had for good. */
const MOCK_OWNED = 'mock.purchases';
/** Seconds: no interstitial before `first` into the session, then at most one every `every`. */
const INTERSTITIAL = { first: 90, every: 120 };
/** ms: how long a rewarded video may take to load when it's asked for, and the most an ad may stay up before it's given up on. */
const WAIT = { load: 6000, show: 120000 };

/** What's happened, for the settings' console (diagnostics): the last lines, each with its time. */
const REPORT: string[] = [];
const REPORT_MOST = 40;

/** An error's words: AdMob's code and message, or what it says of itself. */
function said(error: unknown): string {
    const e = error as { code?: unknown; message?: unknown } | undefined;
    if (e && (e.code !== undefined || e.message)) return `${e.code !== undefined ? `code ${String(e.code)}: ` : ''}${String(e.message ?? '')}`;
    return String(error);
}

/** Into the console (and the report the settings show): `bad`, a warning. */
function note(message: string, bad = false, error?: unknown): void {
    const line = `${new Date().toTimeString().slice(0, 8)} ${bad ? '✖ ' : ''}${message}${error !== undefined ? ` (${said(error)})` : ''}`;
    REPORT.push(line);
    if (REPORT.length > REPORT_MOST) REPORT.shift();
    (bad ? console.warn : console.log)(`[Capacitor] ${line}`);
}

function log(message: string, ...args: unknown[]): void {
    console.log(`[Capacitor] ${message}`, ...args);
}

/** The browser's storage, never throwing. */
const local = {
    get(key: string): string | null {
        try {
            return window.localStorage.getItem(key);
        } catch {
            return null;
        }
    },
    set(key: string, value: string): void {
        try {
            window.localStorage.setItem(key, value);
        } catch {
            // (Nowhere to keep it.)
        }
    },
    remove(key: string): void {
        try {
            window.localStorage.removeItem(key);
        } catch {
            // (Nothing to remove.)
        }
    },
};

/** A promise, or `fallback` after `ms`. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return new Promise<T>((resolve) => {
        const timer = setTimeout(() => resolve(fallback), ms);
        promise.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (error) => { clearTimeout(timer); console.warn('[Capacitor]', error); resolve(fallback); },
        );
    });
}

export default class CapacitorPlatform implements IPlatformConnection {
    public isGameplayActive = false;

    private readonly native = Capacitor.isNativePlatform();
    /** AdMob's up, and which kinds are real (an ad unit set, in the app). */
    private admob = false;
    private realInterstitial = false;
    private realRewarded = false;
    private interstitialLoaded = false;
    private rewardedLoaded = false;
    private readonly startedAt = Date.now();
    private lastInterstitial = 0;

    // ---------------------------------------------------------------- start

    public async startLoadSDK(): Promise<void> {}

    public async initialize(): Promise<void> {
        note(this.native ? `in the app (${Capacitor.getPlatform()})` : 'in a browser: ads mocked, saves in localStorage');
        if (!this.native) return;
        document.documentElement.style.setProperty('--safe-area-min', `${CORNER_MARGIN}px`);
        void App.addListener('backButton', () => {
            const handled = PlatformHandler.backButton?.() ?? false;
            if (!handled) void App.minimizeApp();
        });
        await this.startAds();
    }

    /** AdMob, if there's an ad unit to show: consent first (Europe, the UK), then each kind loaded ahead. */
    private async startAds(): Promise<void> {
        const config = PlatformHandler.ADMOB;
        // (An ad unit's id has a slash: ca-app-pub-…/…. One with a tilde is the app's id, put there by mistake: no ads load from it.)
        const unit = (kind: 'interstitial' | 'rewarded'): boolean => {
            const id = config?.[kind] ?? '';
            if (!id) return false;
            if (/^ca-app-pub-\d+\/\d+$/.test(id)) return true;
            note(`the ${kind} id isn't an ad unit id (ca-app-pub-…/…${id.includes('~') ? '; this one is the app id' : ''}): ${kind} mocked`, true);
            return false;
        };
        const interstitial = unit('interstitial');
        const rewarded = unit('rewarded');
        if (!PlatformHandler.ENABLE_VIDEO_ADS || (!interstitial && !rewarded)) {
            note(PlatformHandler.ENABLE_VIDEO_ADS ? 'no AdMob ad units set: ads mocked' : 'ads off for this build');
            return;
        }
        try {
            await AdMob.initialize({ initializeForTesting: !!config?.test });
            note('AdMob starting…');
            // The consent message (Europe, the UK): its failing doesn't stop the ads. Most often it's that none's been made
            // in AdMob yet (Privacy & messaging); the ads load all the same, and where consent's needed AdMob decides.
            try {
                const consent = await AdMob.requestConsentInfo();
                note(`consent: ${consent.status}${consent.canRequestAds ? '' : ' (no ads till it’s answered)'}`);
                if (consent.status === AdmobConsentStatus.REQUIRED && consent.isConsentFormAvailable) await AdMob.showConsentForm();
            } catch (error) {
                note('consent message not set up in AdMob (Privacy & messaging): ads go on without it', true, error);
            }
            this.admob = true;
            this.realInterstitial = interstitial;
            this.realRewarded = rewarded;
            void AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => void this.loadInterstitial());
            void AdMob.addListener(RewardAdPluginEvents.Dismissed, () => void this.loadRewarded());
            void this.loadInterstitial();
            void this.loadRewarded();
            note(`AdMob up${config?.test ? ' (test ads)' : ' (LIVE ads)'}: interstitial ${interstitial ? 'real' : 'mocked'}, rewarded ${rewarded ? 'real' : 'mocked'}`);
        } catch (error) {
            note('AdMob failed to start: ads mocked', true, error);
        }
    }

    private async loadInterstitial(): Promise<void> {
        const adId = PlatformHandler.ADMOB?.interstitial;
        if (!this.realInterstitial || !adId) return;
        this.interstitialLoaded = false;
        try {
            await AdMob.prepareInterstitial({ adId, isTesting: !!PlatformHandler.ADMOB?.test });
            this.interstitialLoaded = true;
            note('interstitial loaded');
        } catch (error) {
            note('interstitial failed to load', true, error);
        }
    }

    private async loadRewarded(): Promise<boolean> {
        const adId = PlatformHandler.ADMOB?.rewarded;
        if (!this.realRewarded || !adId) return false;
        this.rewardedLoaded = false;
        try {
            await AdMob.prepareRewardVideoAd({ adId, isTesting: !!PlatformHandler.ADMOB?.test });
            this.rewardedLoaded = true;
            note('rewarded video loaded');
        } catch (error) {
            note('rewarded video failed to load', true, error);
        }
        return this.rewardedLoaded;
    }

    /** What's happened with the ads (and the rest), the last lines first last: the settings' console. */
    public diagnostics(): string[] {
        return [...REPORT];
    }

    /** Mock ads by choice (the settings), kept on the phone: AdMob stays up, its ads just aren't asked for. */
    private chosenMock = local.get(MOCK_ADS) === '1';

    public adsMocked(): boolean {
        return this.chosenMock;
    }

    public setAdsMocked(mocked: boolean): void {
        this.chosenMock = mocked;
        local.set(MOCK_ADS, mocked ? '1' : '0');
        note(mocked ? 'ads: mocked (settings)' : `ads: ${this.admob ? 'AdMob' : 'AdMob not up, still mocked'} (settings)`);
    }

    public async startLoad(): Promise<void> {}
    public async firstFrameReady(): Promise<void> {}
    public async loadFinished(): Promise<void> {}

    // ---------------------------------------------------------------- ads

    /** An interstitial, if it's time for one (paced) and one's loaded; otherwise nothing (or the mock's nothing). */
    public async showCommercialBreak(): Promise<void> {
        const now = Date.now();
        if (now - this.startedAt < INTERSTITIAL.first * 1000 || now - this.lastInterstitial < INTERSTITIAL.every * 1000) return;
        if (!this.admob || !this.realInterstitial || this.chosenMock) {
            note('commercial break (mocked)');
            this.lastInterstitial = now;
            return;
        }
        if (!this.interstitialLoaded) {
            void this.loadInterstitial();
            return;
        }
        this.lastInterstitial = now;
        this.interstitialLoaded = false;
        SoundManager.instance.muteAllSounds();
        const handles: PluginListenerHandle[] = [];
        try {
            // (Listening before it's shown, so its end isn't missed.)
            let done = (): void => {};
            const closed = new Promise<void>((resolve) => { done = resolve; });
            handles.push(await AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => done()));
            handles.push(await AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, () => done()));
            await AdMob.showInterstitial();
            await within(closed, WAIT.show, undefined);
        } catch (error) {
            note('interstitial failed to show', true, error);
            void this.loadInterstitial();
        } finally {
            for (const handle of handles) void handle.remove();
            SoundManager.instance.restoreSound();
        }
    }

    /** A rewarded video; true once it's been watched to its reward. Mocked (the placeholder, always rewarded) without AdMob. */
    public async showRewardedVideo(rewardId?: string): Promise<boolean> {
        if (!this.admob || !this.realRewarded || this.chosenMock) {
            note(`rewarded video${rewardId ? ` "${rewardId}"` : ''} (mocked)`);
            SoundManager.instance.muteAllSounds();
            try {
                await fakeRewardedVideo();
            } finally {
                SoundManager.instance.restoreSound();
            }
            return true;
        }
        if (!this.rewardedLoaded && !(await within(this.loadRewarded(), WAIT.load, false))) return false;
        this.rewardedLoaded = false;
        SoundManager.instance.muteAllSounds();
        const handles: PluginListenerHandle[] = [];
        let rewarded = false;
        try {
            let done = (): void => {};
            const closed = new Promise<void>((resolve) => { done = resolve; });
            handles.push(await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => { rewarded = true; }));
            handles.push(await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => done()));
            handles.push(await AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => done()));
            await AdMob.showRewardVideoAd();
            await within(closed, WAIT.show, undefined);
        } catch (error) {
            note('rewarded video failed to show', true, error);
            void this.loadRewarded();
        } finally {
            for (const handle of handles) void handle.remove();
            SoundManager.instance.restoreSound();
        }
        return rewarded;
    }

    public async showBanner(): Promise<void> {}
    public async hideBanner(): Promise<void> {}
    public async happyTime(): Promise<void> {}
    public async setPlayerScore(): Promise<void> {}

    // ---------------------------------------------------------------- purchases

    /**
     * Purchases: Google Play's (through RevenueCat) once its key's set in platforms.config.json `iap.revenuecat`; till then
     * mocked, as the ads are: the BUY / CANCEL screen, and what's had for good kept in the app's storage, so the shop can be
     * tried on the phone with no store account.
     */
    public canBuy(): boolean {
        return true;
    }

    private get realStore(): boolean {
        return this.native && !!PlatformHandler.IAP?.revenuecat;
    }

    public async productPrices(): Promise<Record<string, string>> {
        // (Mocked: the game's own prices. RevenueCat's come with it.)
        return {};
    }

    public async purchase(id: string): Promise<boolean> {
        if (this.realStore) {
            console.warn('[Capacitor] RevenueCat is not wired yet: mocked purchase');
        }
        log(`purchase "${id}" (mocked)`);
        SoundManager.instance.muteAllSounds();
        try {
            const bought = await fakePurchase(id);
            if (bought) {
                const owned = await this.restorePurchases();
                if (!owned.includes(id)) await this.setItem(MOCK_OWNED, JSON.stringify([...owned, id]));
            }
            return bought;
        } finally {
            SoundManager.instance.restoreSound();
        }
    }

    public async restorePurchases(): Promise<string[]> {
        try {
            return JSON.parse((await this.getItem(MOCK_OWNED)) ?? '[]') as string[];
        } catch {
            return [];
        }
    }

    // ---------------------------------------------------------------- saves

    public async setItem(key: string, value: string): Promise<void> {
        if (!this.native) return local.set(key, value);
        try {
            await Preferences.set({ key, value });
        } catch (error) {
            console.warn('[Capacitor] save failed, kept in localStorage', error);
            local.set(key, value);
        }
    }

    public async getItem(key: string): Promise<string | null> {
        if (!this.native) return local.get(key);
        try {
            const { value } = await Preferences.get({ key });
            return value ?? local.get(key);
        } catch (error) {
            console.warn('[Capacitor] read failed, from localStorage', error);
            return local.get(key);
        }
    }

    public async removeItem(key: string): Promise<void> {
        local.remove(key);
        if (!this.native) return;
        try {
            await Preferences.remove({ key });
        } catch (error) {
            console.warn('[Capacitor] remove failed', error);
        }
    }

    // ---------------------------------------------------------------- the rest

    public async getLanguage(): Promise<string> {
        return navigator.language?.split('-')[0] ?? 'en';
    }

    /** No analytics service yet (Firebase / GameAnalytics later): logged only. */
    public measure(category: string, what: string, action: string): void {
        log(`measure ${category} / ${what} / ${action}`);
    }

    public onPause(callback: () => void): void {
        if (this.native) void App.addListener('pause', callback);
    }

    public onResume(callback: () => void): void {
        if (this.native) void App.addListener('resume', callback);
    }

    public async gameplayStart(): Promise<void> {
        this.isGameplayActive = true;
    }

    public async gameplayStop(): Promise<void> {
        this.isGameplayActive = false;
    }
}
