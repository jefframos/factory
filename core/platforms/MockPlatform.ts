import { IPlatformConnection } from "./IPlatformConnection";
import SoundManager from "../audio/SoundManager";

/**
 * The platform for local runs and cached/demo builds (PlatformFactory's fallback, or VITE_PLATFORM=mock): no SDK,
 * every call logged to the console (`[Mock]`, visible at the default log level) so a build can be checked for what
 * it would send a real platform. Commercial breaks resolve at once; a rewarded video shows a dark placeholder
 * screen with a fake loading bar for REWARDED_MS, sound muted, then pays out — so reward flows can be played
 * through without an ad network.
 */
const REWARDED_MS = 1000;

function log(message: string, ...args: unknown[]): void {
    console.log(`%c[Mock]%c ${message}`, 'color:#b46cff;font-weight:bold', 'color:inherit', ...args);
}

/** The rewarded-video stand-in: a dark full-screen layer with a filling bar; resolves once it's done and gone. */
function fakeRewardedVideo(): Promise<void> {
    return new Promise((resolve) => {
        const layer = document.createElement('div');
        Object.assign(layer.style, {
            position: 'fixed', inset: '0', zIndex: '10000', background: 'rgba(5, 5, 8, 0.94)', display: 'flex',
            flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '18px',
            fontFamily: 'sans-serif', color: '#e8e4f0', pointerEvents: 'all', userSelect: 'none',
            opacity: '0', transition: 'opacity 150ms ease-out',
        } satisfies Partial<CSSStyleDeclaration>);
        const title = document.createElement('div');
        title.textContent = 'AD PLACEHOLDER';
        Object.assign(title.style, { fontSize: '22px', fontWeight: 'bold', letterSpacing: '3px' } satisfies Partial<CSSStyleDeclaration>);
        const note = document.createElement('div');
        note.textContent = 'Rewarded video (mock platform)';
        Object.assign(note.style, { fontSize: '14px', opacity: '0.6' } satisfies Partial<CSSStyleDeclaration>);
        const track = document.createElement('div');
        Object.assign(track.style, { width: 'min(260px, 70vw)', height: '8px', borderRadius: '4px', background: '#2a2733', overflow: 'hidden' } satisfies Partial<CSSStyleDeclaration>);
        const bar = document.createElement('div');
        Object.assign(bar.style, { width: '0%', height: '100%', background: '#b46cff', transition: `width ${REWARDED_MS}ms linear` } satisfies Partial<CSSStyleDeclaration>);
        track.appendChild(bar);
        layer.append(title, track, note);
        for (const event of ['pointerdown', 'pointerup', 'click', 'touchstart', 'keydown']) layer.addEventListener(event, (e) => e.stopPropagation());
        document.body.appendChild(layer);
        requestAnimationFrame(() => {
            layer.style.opacity = '1';
            bar.style.width = '100%';
        });
        window.setTimeout(() => {
            layer.style.opacity = '0';
            window.setTimeout(() => {
                layer.remove();
                resolve();
            }, 160);
        }, REWARDED_MS);
    });
}

export default class MockPlatform implements IPlatformConnection {
    public isGameplayActive = false;

    async showBanner(type: any): Promise<void> {
        log('showBanner', type);
    }

    async hideBanner(): Promise<void> {
        log('hideBanner');
    }

    async happyTime(): Promise<void> {
        log('happyTime');
    }

    public async startLoadSDK(): Promise<void> {
        log('startLoadSDK');
    }

    public async firstFrameReady(): Promise<void> {
        log('firstFrameReady');
    }

    /**
     * Backed by plain browser localStorage — same recipe Poki/CrazyGames/GameDistribution's own
     * platform wrappers use, just without a real SDK to defer to. Every *Storage.ts here calls
     * PlatformHandler.instance.platform.getItem/setItem unconditionally, so these must exist for
     * local/dev progress to persist across reloads.
     */
    public async setItem(key: string, value: string): Promise<void> {
        log(`setItem "${key}" (${value.length} chars)`);
        localStorage.setItem(key, value);
    }

    public async getItem(key: string): Promise<string | null> {
        const value = localStorage.getItem(key);
        log(`getItem "${key}" -> ${value === null ? 'null' : `${value.length} chars`}`);
        return value;
    }

    public async removeItem(key: string): Promise<void> {
        log(`removeItem "${key}"`);
        localStorage.removeItem(key);
    }

    public async startLoad(): Promise<void> {
        log('startLoad');
    }

    public async loadFinished(): Promise<void> {
        log('loadFinished');
    }

    public async initialize(): Promise<void> {
        log('initialize');
        await this.startLoadSDK();
    }

    /** No ad network: logged and resolved at once. */
    public async showCommercialBreak(): Promise<void> {
        log('showCommercialBreak -> resolved (no ad)');
    }

    /** The placeholder screen for REWARDED_MS (sound muted, like a real ad), then the reward is granted. */
    public async showRewardedVideo(rewardId?: string): Promise<boolean> {
        log(`showRewardedVideo${rewardId ? ` "${rewardId}"` : ''} -> placeholder ${REWARDED_MS}ms`);
        SoundManager.instance.muteAllSounds();
        try {
            await fakeRewardedVideo();
        } finally {
            SoundManager.instance.restoreSound();
        }
        log('showRewardedVideo -> rewarded');
        return true;
    }

    /** No analytics backend locally — just logs what a real platform would receive (see PlatformHandler.measure()). */
    public measure(category: string, what: string, action: string): void {
        log(`measure ${category} / ${what} / ${action}`);
    }

    public async setPlayerScore(score: number): Promise<void> {
        log('setPlayerScore', score);
    }

    public async getLeaderboard(): Promise<void> {
        log('getLeaderboard');
    }

    public async getFriends(): Promise<void> {
        log('getFriends');
    }

    public async gameplayStart(): Promise<void> {
        log(this.isGameplayActive ? 'gameplayStart (already active)' : 'gameplayStart');
        this.isGameplayActive = true;
    }

    public async gameplayStop(): Promise<void> {
        log(this.isGameplayActive ? 'gameplayStop' : 'gameplayStop (already inactive)');
        this.isGameplayActive = false;
    }
}
