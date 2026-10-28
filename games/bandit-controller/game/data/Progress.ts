// Progress.ts
//
// Replayability layer: per-level stars, completion rewards, world star gates and the daily reward.
// Stars: 1 = finish, 2 = grab every piece of loot, 3 = never be seen by a guard or camera.

import type { LevelData } from './LevelData';
import { GameState } from './GameState';
import { LevelCatalog, worldGateStars } from './LevelCatalog';

const STARS_KEY = 'bandit-controller.stars';
const DAILY_KEY = 'bandit-controller.daily';
/** Day the game was first played: the daily reward is for returning players, never the very first session. */
const FIRST_PLAY_KEY = 'bandit-controller.firstPlayDay';

export const MAX_STARS = 3;
export interface LevelResult {
    stars: number;
    /** Stars earned for the first time on this run. */
    newStars: number;
    firstClear: boolean;
    clearBonus: number;
    starBonus: number;
    total: number;
}

function readStars(): Record<string, number> {
    try {
        return JSON.parse(window.localStorage.getItem(STARS_KEY) ?? '{}') as Record<string, number>;
    } catch {
        return {};
    }
}

function worldNumber(level: LevelData): number {
    return LevelCatalog.locate(level)?.world.number ?? 1;
}

export const Progress = {
    starsFor(level: LevelData): number {
        return readStars()[level.id] ?? 0;
    },

    totalStars(): number {
        return Object.values(readStars()).reduce((sum, value) => sum + value, 0);
    },

    worldStars(levels: LevelData[]): { earned: number; max: number } {
        const stars = readStars();
        return { earned: levels.reduce((sum, level) => sum + (stars[level.id] ?? 0), 0), max: levels.length * MAX_STARS };
    },

    worldGate: worldGateStars,

    /** Records a finished run, pays the completion rewards and returns the breakdown. */
    complete(level: LevelData, earned: { loot: boolean; unseen: boolean }): LevelResult {
        const stars = 1 + (earned.loot ? 1 : 0) + (earned.unseen ? 1 : 0);
        const previous = Progress.starsFor(level);
        const firstClear = previous === 0;
        const newStars = Math.max(0, stars - previous);
        const scale = 1 + (worldNumber(level) - 1) * 0.5;
        const clearBonus = firstClear ? Math.round(100 * scale) : 0;
        const starBonus = Math.round(newStars * 75 * scale);
        if (stars > previous) {
            window.localStorage.setItem(STARS_KEY, JSON.stringify({ ...readStars(), [level.id]: stars }));
        }
        const total = clearBonus + starBonus;
        if (total > 0) {
            GameState.addMoney(total);
        }
        return { stars, newStars, firstClear, clearBonus, starBonus, total };
    },

    /** Daily reward: grows with the streak (capped at 7 days) and resets after a missed day. */
    /** Call once per boot; remembers the first day the game was ever played. */
    notePlayed(): void {
        if (!window.localStorage.getItem(FIRST_PLAY_KEY)) {
            window.localStorage.setItem(FIRST_PLAY_KEY, new Date().toDateString());
        }
    },

    dailyReward(): { available: boolean; streak: number; amount: number } {
        const saved = JSON.parse(window.localStorage.getItem(DAILY_KEY) ?? '{"day":"","streak":0}') as { day: string; streak: number };
        const today = new Date().toDateString();
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        const streak = saved.day === yesterday ? Math.min(7, saved.streak + 1) : saved.day === today ? saved.streak : 1;
        const returning = (window.localStorage.getItem(FIRST_PLAY_KEY) ?? today) !== today;
        return { available: returning && saved.day !== today, streak, amount: Progress.dailyAmount(streak) };
    },

    dailyAmount(streak: number): number {
        return 100 + (Math.min(7, Math.max(1, streak)) - 1) * 50;
    },

    /** Debug: makes today's daily reward claimable again as streak day `streak` (1–7). */
    debugPrimeDaily(streak: number): void {
        const day = Math.min(7, Math.max(1, Math.round(streak)));
        const saved = day > 1
            ? { day: new Date(Date.now() - 86400000).toDateString(), streak: day - 1 }
            : { day: '', streak: 0 };
        window.localStorage.setItem(DAILY_KEY, JSON.stringify(saved));
        window.localStorage.setItem(FIRST_PLAY_KEY, new Date(Date.now() - 86400000).toDateString());
    },

    claimDaily(): number {
        const reward = Progress.dailyReward();
        if (!reward.available) {
            return 0;
        }
        window.localStorage.setItem(DAILY_KEY, JSON.stringify({ day: new Date().toDateString(), streak: reward.streak }));
        GameState.addMoney(reward.amount);
        return reward.amount;
    },
};
