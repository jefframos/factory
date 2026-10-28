// GameAnalytics.ts
//
// Every analytics event Bandit Controller sends — one place, so names stay consistent and stable
// across versions. Goes through PlatformHandler.measure() (Poki: PokiSDK.measure(); see
// https://developers.poki.com/guide/game-events), which cleans the values and never throws.
// Ads themselves are tracked by the platform's own ad calls; only the in-game offer is measured here.
//
//   category   what                       action      when
//   level      <levelId>                  start       a campaign level starts (every attempt)
//   level      <levelId>                  complete    the heist is complete
//   level      <levelId>                  fail        the player is busted
//   stars      <levelId>                  stars-<n>   stars earned on that completion (0-3)
//   busted     guard|camera|drone|trap    fail        what caught the player
//   world      <worldId>                  start       the first level of a world starts
//   world      <worldId>                  complete    the last level of a world is complete
//   tutorial   campaign                   start       the first tutorial level starts
//   tutorial   campaign                   complete    the last tutorial level is complete
//   bonus      x<multiplier>              visible     the bonus offer (CLAIM button) shows
//   bonus      x<multiplier>              interact    CLAIM pressed
//   bonus      x<multiplier>              complete    the bonus was paid out (after the video, or free)
//   bonus      x<multiplier>              skip        NO THANKS pressed
//   shop       hat-<id> | face-<id>       bought      a wardrobe item bought with cash
//   shop       hat-<id> | face-<id>       equip       an owned wardrobe item put on (hat-none = hat off)
//   shop       color-<hex>                equip       a squad colour picked
//   daily      day<streak>                visible     the daily reward popup shows
//   daily      day<streak>                complete    the daily reward is claimed
//
// Add an event here (and to the table) rather than calling PlatformHandler.measure() directly.

import PlatformHandler from 'core/platforms/PlatformHandler';
import type { LevelData } from '../data/LevelData';
import { LevelCatalog } from '../data/LevelCatalog';

export type BustedBy = 'guard' | 'camera' | 'drone' | 'trap';

function send(category: string, what: string | number, action: string): void {
    PlatformHandler.instance.measure(category, what, action);
}

/** Showcase/debug levels are not part of the campaign and never reported. */
const locate = (level: LevelData) => LevelCatalog.locate(level);

export const GameAnalytics = {
    levelStart(level: LevelData): void {
        const found = locate(level);
        if (!found) return;
        send('level', level.id, 'start');
        if (found.levelNumber === 1) {
            send(found.world.tutorial ? 'tutorial' : 'world', found.world.tutorial ? 'campaign' : found.world.id, 'start');
        }
    },

    levelComplete(level: LevelData, stars: number): void {
        const found = locate(level);
        if (!found) return;
        send('level', level.id, 'complete');
        send('stars', level.id, `stars-${stars}`);
        if (found.levelNumber === found.world.levels.length) {
            send(found.world.tutorial ? 'tutorial' : 'world', found.world.tutorial ? 'campaign' : found.world.id, 'complete');
        }
    },

    levelFail(level: LevelData, by: BustedBy): void {
        if (!locate(level)) return;
        send('level', level.id, 'fail');
        send('busted', by, 'fail');
    },

    bonusOffered(multiplier: number): void {
        send('bonus', `x${multiplier}`, 'visible');
    },
    bonusClaimPressed(multiplier: number): void {
        send('bonus', `x${multiplier}`, 'interact');
    },
    bonusPaid(multiplier: number): void {
        send('bonus', `x${multiplier}`, 'complete');
    },
    bonusSkipped(multiplier: number): void {
        send('bonus', `x${multiplier}`, 'skip');
    },

    itemBought(kind: 'hat' | 'face', id: string): void {
        send('shop', `${kind}-${id}`, 'bought');
    },
    itemEquipped(kind: 'hat' | 'face', id: string | undefined): void {
        send('shop', `${kind}-${id ?? 'none'}`, 'equip');
    },
    colorPicked(hex: string): void {
        send('shop', `color-${hex.replace('#', '')}`, 'equip');
    },

    dailyShown(streak: number): void {
        send('daily', `day${streak}`, 'visible');
    },
    dailyClaimed(streak: number): void {
        send('daily', `day${streak}`, 'complete');
    },
};
