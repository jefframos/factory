// GameClock.ts
//
// The game's speed (1x / 2x — the top-left speed toggle, see
// SettingsUIService.ts) and the clock every wall-clock timer reads.
//
// Speed scales two things:
//   - every frame's delta (core Game.timeScale — movement, clients, workers,
//     physics, every update()-driven timer) and every gsap tween/delayedCall
//     (gsap.globalTimeline.timeScale — item flights, deposit staggers, ...);
//   - nowMs(): the timestamps crop growth, queue cooldowns and shop upgrade
//     cooldowns are saved against. It's real time PLUS extraMs — the game time
//     gained while sped up — so a crop planted at 2x grows twice as fast, and a
//     saved timestamp stays consistent after a reload (extraMs is persisted and
//     only ever grows). Offline time still counts at 1x.
//
// Speed itself isn't saved — every session starts at 1x. load() must be
// awaited at boot (see index.ts), before anything reads nowMs().

import gsap from 'gsap';
import { Game } from 'core/Game';
import PlatformHandler from 'core/platforms/PlatformHandler';

const STORAGE_KEY = 'PIZZA_GAME_CLOCK';
/** How often gained extraMs is saved while sped up. */
const PERSIST_INTERVAL_MS = 5000;

export class GameClock {
    private static speed = 1;
    /** Game time gained over real time from speeding up — see this file's own doc. */
    private static extraMs = 0;
    private static unsavedMs = 0;

    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            this.extraMs = typeof parsed.extraMs === 'number' && parsed.extraMs > 0 ? parsed.extraMs : 0;
        } catch (e) {
            console.error('GameClock: failed to load save data', e);
        }
    }

    /** Use instead of Date.now() for anything that should run faster at 2x. */
    static nowMs(): number {
        return Date.now() + this.extraMs;
    }

    static nowSec(): number {
        return this.nowMs() / 1000;
    }

    static getSpeed(): number {
        return this.speed;
    }

    static setSpeed(speed: number): void {
        this.speed = Math.max(1, speed);
        Game.timeScale = this.speed;
        gsap.globalTimeline.timeScale(this.speed);
        void this.persist();
    }

    /** Call once per frame with the (already scaled) frame delta — adds the time gained over real time this frame. */
    static tick(scaledDeltaSec: number): void {
        if (this.speed <= 1) {
            return;
        }
        const gainedMs = scaledDeltaSec * 1000 * (1 - 1 / this.speed);
        this.extraMs += gainedMs;
        this.unsavedMs += gainedMs;
        if (this.unsavedMs >= PERSIST_INTERVAL_MS / 2) {
            this.unsavedMs = 0;
            void this.persist();
        }
    }

    /** Debug/dev reset — same convention as every other *Storage.ts's own clearAll(). */
    static async clearAll(): Promise<void> {
        this.extraMs = 0;
        this.unsavedMs = 0;
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }

    private static async persist(): Promise<void> {
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify({ extraMs: this.extraMs }));
    }
}
