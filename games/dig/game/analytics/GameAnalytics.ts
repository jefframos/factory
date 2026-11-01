// GameAnalytics.ts
//
// Every analytics event Dig & Discover sends — one place, so names stay consistent and stable across versions.
// Goes through PlatformHandler.measure() (Poki: PokiSDK.measure(); see https://developers.poki.com/guide/game-events;
// the local MockPlatform logs them to the console), which cleans the values and never throws. Values are ids, not
// display text, so they compare across languages and versions.
//
//   category     what                              action     when
//   session      new | returning                   start      the player's first input this session
//   playtime     min-<n>                           reached    n minutes of active play this session (1,2,3,5,8,12,
//                                                             20,30,45,60): where sessions end
//   tutorial     campaign                          start      a brand-new game's first input
//   tutorial     <nn>-<step>                       complete   each tutorial step, once per player, in order (TUTORIAL):
//                                                             the last one reached is where a player stopped
//   tutorial     campaign                          complete   the tutorial's end (the first hub piece built)
//   forced       backpack | tool | hat             visible    a forced tutorial purchase's screen appears (once)
//   upgrade      tool-<nn>-<toolId>                complete   a tool bought (nn = its level)
//   upgrade      bag-<nn>-<capacity>               complete   a backpack bought (nn = its level)
//   upgrade      count-<n>                         complete   the player's nth upgrade (tool or bag), for the first 10
//   shop         hat-<id> | face-<id> | color-<nn> bought     a wardrobe item bought with cash (colours by their
//                                                             place in wardrobe.colors, 01 = the first)
//   shop         hat-<id> | face-<id> | color-<nn> equip      an owned wardrobe item put on
//   build        <buildableId>                     complete   a hub piece bought
//   hub          set-<areaId>                      complete   every piece of a hub room bought (its set bonus on)
//   area         <areaId>                          visible    a hidden hub area appears
//   bag          full-<capacity>                   complete   the backpack fills up
//   sell         atm | boost | anywhere            complete   the backpack is sold (at the ATM / boost machine / SELL button)
//   sell         count-<n>                         complete   the player's nth sale, for the first 10
//   blocked      <materialId>                      fail       the miner pushes into rock the tool can't dig (once per
//                                                             material per session)
//   zone         <zoneId>                          start      a zone reached for the first time
//   find         <findId>                          complete   an artifact dug up
//   find         <findId>                          interact   its reward claimed in the Trophy Room
//   find         count-<n>                         complete   the nth artifact dug up in this mine, for the first 10
//   find         claimed-<n>                       interact   the nth artifact reward claimed in this mine, first 10
//   hunt         relic-<n>                         visible    the nth relic after the tutorial's named (RelicHunt: the
//                                                             next objective, shown right after a claim)
//   hunt         relic-<n>                         complete   that relic dug up
//   achievement  <achievementId>-<level>           complete   an achievement level claimed
//   settings     lang-<code>                       interact   a language picked
//   phone        sell-x2                           visible    the phone (sell at x2 for a video) appears
//   phone        sell-x2                           interact   the phone tapped (the video starts)
//   phone        sell-x2                           complete   the video was watched: the backpack sold at x2
//   phone        sell-x2                           fail       the video was closed / failed: nothing sold
//   boost        <boostId>-<nn>                    complete   a boost level bought (nn = the level reached)
//   prestige     mine-<n>                          visible    "open mine #n?" asked (the confirmation shows)
//   prestige     mine-<n>                          complete   mine #n opened (a fresh run there, the bonus up everywhere)
//   travel       mine-<n>                          complete   the player went back (or on) to mine #n from the MAP
//   ad           commercial-break                  start      a commercial break starts (after a BUY tap only)
//   ad           commercial-break                  complete   it ended (played, skipped by the platform or failed)
//   chest        power-shown-<n>                   visible    the power chest faded in ahead of the miner, the nth
//                                                             time this session (5 = 5 or more: it keeps coming back
//                                                             until it's dug)
//   chest        power-<zoneId> | cash-<zoneId>    complete   a chest dug up (in that zone)
//   power        <toolId>                          start      a power chest's surge starts (the tool it lends)
//   power        <toolId>                          complete   the surge ran out
//
// Time stamps: every event except the frequent ones (UNTIMED) is sent a second time under category `time`, with
// what = <category>-<what>-<bucket> and the same action, where <bucket> is the player's active play time so far, all
// sessions together (DigProgress.playSeconds), as the minute its TIME_BUCKETS range starts at: m00 (0-1 min), m01,
// m02, m03, m05, m08, m12, m20, m30, m45, m60, m90 (90 and over). So `time / upgrade-tool-03-drill-m08 / complete` =
// the Power Drill bought 8 to 12 minutes in. The plain events stay as they were (the funnel), and the `time` ones
// split each by when it happened.
//
// PokiSDK.measure() drops an event whose three values hold more than MAX_NUMBERS runs of digits in all, and any value
// with characters outside A-Z a-z 0-9 space - _ : . + |. send() keeps every event within that: a time stamp gives up
// its what's trailing numbers first (`upgrade-bag-02-12-m08` -> `upgrade-bag-02-m08`), and anything still over is
// skipped (with a warning) rather than sent to be dropped.
//
// Add an event here (and to the table) rather than calling PlatformHandler.measure() directly.

import PlatformHandler from 'core/platforms/PlatformHandler';
import { DIG } from '../data/DigConfig';
import { DigProgress } from '../data/DigProgress';

/** The tutorial steps, in the order a new player meets them (the funnel). */
export const TUTORIAL = ['move', 'dig', 'bag-full', 'sell', 'tool-upgrade', 'bag-upgrade', 'wardrobe', 'hat', 'find', 'claim', 'build'] as const;
export type TutorialStep = (typeof TUTORIAL)[number];

const PLAYTIME_MINUTES = [1, 2, 3, 5, 8, 12, 20, 30, 45, 60];

/** Minutes of total play where a time stamp's bucket starts (the last one is open-ended). */
const TIME_BUCKETS = [0, 1, 2, 3, 5, 8, 12, 20, 30, 45, 60, 90];
/** Categories (or category-what) sent too often to be worth a time stamp each. */
const UNTIMED = new Set(['playtime', 'settings', 'ad', 'bag', 'sell-atm', 'sell-anywhere', 'shop-equip']);

/** The time-stamp bucket of a moment `seconds` of total play in: the minute its range starts at, m05 (5-8 min). */
function timeBucket(seconds: number): string {
    const minutes = seconds / 60;
    let i = 0;
    while (i + 1 < TIME_BUCKETS.length && minutes >= TIME_BUCKETS[i + 1]) i++;
    return `m${pad(TIME_BUCKETS[i])}`;
}

/** PokiSDK.measure(): at most this many runs of digits across category, what and action together. */
const MAX_NUMBERS = 2;
const INVALID_CHARS = /[^A-Za-z0-9_: .+|-]/g;

/** Runs of digits across the values, counted the way PokiSDK.measure() does. */
function numbers(...values: string[]): number {
    return values.join(' ').match(/\d+/g)?.length ?? 0;
}

/** Sends one event, or skips it (with a warning) if PokiSDK.measure() would drop it anyway. */
function measure(category: string, what: string, action: string): void {
    what = what.replace(INVALID_CHARS, '-');
    if (numbers(category, what, action) > MAX_NUMBERS) {
        console.warn('[GameAnalytics] skipped, too many numbers for PokiSDK.measure():', category, what, action);
        return;
    }
    PlatformHandler.instance.measure(category, what, action);
}

function send(category: string, what: string | number, action: string): void {
    measure(category, String(what), action);
    if (UNTIMED.has(category) || UNTIMED.has(`${category}-${what}`) || UNTIMED.has(`${category}-${action}`)) return;
    const bucket = timeBucket(DigProgress.playSeconds);
    let timed = `${category}-${what}`;
    // The bucket's number comes first: drop the what's trailing numbers until it fits.
    while (numbers('time', timed, bucket, action) > MAX_NUMBERS && /-\d+$/.test(timed)) timed = timed.replace(/-\d+$/, '');
    measure('time', `${timed}-${bucket}`, action);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Per session: materials already reported as blocked. */
const blockedSent = new Set<string>();
let playSeconds = 0;
let nextMinute = 0;

export const GameAnalytics = {
    sessionStart(newGame: boolean): void {
        send('session', newGame ? 'new' : 'returning', 'start');
        if (newGame && DigProgress.once('tutorial-start')) send('tutorial', 'campaign', 'start');
    },

    /** Active play time (call every frame while gameplay is active): sends each minute milestone once a session. */
    playTime(delta: number): void {
        playSeconds += delta;
        DigProgress.addPlayTime(delta);
        while (nextMinute < PLAYTIME_MINUTES.length && playSeconds >= PLAYTIME_MINUTES[nextMinute] * 60) {
            send('playtime', `min-${PLAYTIME_MINUTES[nextMinute]}`, 'reached');
            nextMinute++;
        }
    },

    /** A tutorial step done: sent once per player. The last step ('build') also completes the tutorial. */
    tutorialStep(step: TutorialStep): void {
        if (!DigProgress.once(`tutorial-${step}`)) return;
        send('tutorial', `${pad(TUTORIAL.indexOf(step) + 1)}-${step}`, 'complete');
        if (step === TUTORIAL[TUTORIAL.length - 1]) send('tutorial', 'campaign', 'complete');
    },

    /**
     * Marks the steps already done as sent, without sending them: a save from before analytics existed would
     * otherwise report its whole past tutorial at once on its next load.
     */
    primeTutorial(done: (step: TutorialStep) => boolean): void {
        for (const step of TUTORIAL) if (done(step)) DigProgress.once(`tutorial-${step}`);
    },

    forcedShown(kind: string): void {
        if (DigProgress.once(`forced-${kind}`)) send('forced', kind, 'visible');
    },

    toolBought(level: number, toolId: string): void {
        send('upgrade', `tool-${pad(level)}-${toolId}`, 'complete');
        upgradeCount();
    },

    backpackBought(level: number, capacity: number): void {
        send('upgrade', `bag-${pad(level)}-${capacity}`, 'complete');
        upgradeCount();
    },

    /** `kind` is the wardrobe tab (hats / faces / colors). */
    lookBought(kind: string, id: string): void {
        send('shop', lookId(kind, id), 'bought');
    },

    lookEquipped(kind: string, id: string): void {
        send('shop', lookId(kind, id), 'equip');
    },

    built(buildableId: string): void {
        send('build', buildableId, 'complete');
    },

    hubSetComplete(areaId: string): void {
        send('hub', `set-${areaId}`, 'complete');
    },

    areaRevealed(areaId: string): void {
        send('area', areaId, 'visible');
    },

    backpackFull(capacity: number): void {
        send('bag', `full-${capacity}`, 'complete');
    },

    sold(where: 'atm' | 'boost' | 'anywhere', count: number): void {
        send('sell', where, 'complete');
        if (count <= 10) send('sell', `count-${count}`, 'complete');
    },

    blocked(materialId: string): void {
        if (blockedSent.has(materialId)) return;
        blockedSent.add(materialId);
        send('blocked', materialId, 'fail');
    },

    zoneReached(zoneId: string): void {
        send('zone', zoneId, 'start');
    },

    /** Call after DigProgress.addFind(). */
    findDug(findId: string): void {
        send('find', findId, 'complete');
        const count = DigProgress.collectedCount;
        if (count <= 10 && DigProgress.once(`find-count-${DigProgress.currentMine}-${count}`)) send('find', `count-${count}`, 'complete');
    },

    /** Call after DigProgress.claimReward(). */
    findClaimed(findId: string): void {
        send('find', findId, 'interact');
        const count = DIG.finds.filter((find) => DigProgress.found[find.id] && DigProgress.unclaimedFor(find.id) === 0).length;
        if (count <= 10 && DigProgress.once(`find-claimed-${DigProgress.currentMine}-${count}`)) send('find', `claimed-${count}`, 'interact');
    },

    /** The relic hunt's nth relic named (`visible`) or dug up (`complete`). */
    relicHunt(n: number, action: 'visible' | 'complete'): void {
        if (DigProgress.once(`hunt-${DigProgress.currentMine}-${n}-${action}`)) send('hunt', `relic-${n}`, action);
    },

    achievementClaimed(achievementId: string, level: number): void {
        send('achievement', `${achievementId}-${level}`, 'complete');
    },

    phoneShown(): void {
        send('phone', 'sell-x2', 'visible');
    },

    phoneTapped(): void {
        send('phone', 'sell-x2', 'interact');
    },

    phoneResult(watched: boolean): void {
        send('phone', 'sell-x2', watched ? 'complete' : 'fail');
    },

    boostBought(boostId: string, level: number): void {
        send('boost', `${boostId}-${pad(level)}`, 'complete');
    },

    /** The new-mine confirmation shows (for the mine it would open). */
    newMineOffered(): void {
        send('prestige', `mine-${DigProgress.prestige + 2}`, 'visible');
    },

    /** Call after DigProgress.openNewMine(): `mine` is the new mine's number. */
    newMineOpened(): void {
        send('prestige', `mine-${DigProgress.prestige + 1}`, 'complete');
    },

    /** Call after DigProgress.travelTo(): the mine arrived at. */
    travelled(): void {
        send('travel', `mine-${DigProgress.currentMine + 1}`, 'complete');
    },

    adBreak(action: 'start' | 'complete'): void {
        send('ad', 'commercial-break', action);
    },

    languagePicked(code: string): void {
        send('settings', `lang-${code}`, 'interact');
    },

    /** The power chest faded in ahead of the miner, the `count`th time this session (5 = 5 or more). */
    powerChestShown(count: number): void {
        send('chest', `power-shown-${Math.min(count, 5)}`, 'visible');
    },

    /** A buried chest dug up, `zoneId` where. */
    chestDug(kind: string, zoneId: string): void {
        send('chest', `${kind}-${zoneId}`, 'complete');
    },

    /** A power surge started (`start`, the tool it lends) or ran out (`complete`). */
    powerSurge(toolId: string, action: 'start' | 'complete'): void {
        send('power', toolId, action);
    },
};

/** The player's nth upgrade (tool or bag), for the first 10: call after the purchase. */
function upgradeCount(): void {
    const count = DigProgress.upgradesBought;
    if (count <= 10 && DigProgress.once(`upgrade-count-${count}`)) send('upgrade', `count-${count}`, 'complete');
}

/**
 * Faces are image paths (skins/face-x.webp): just the name part. Colours are hex codes, whose digits would count as
 * several numbers for PokiSDK.measure(): their place in wardrobe.colors instead (color-01 = the first).
 */
function lookId(kind: string, id: string): string {
    if (kind === 'hats') return `hat-${id}`;
    if (kind === 'faces') return `face-${id.split('/').pop()!.replace(/\.[^.]+$/, '')}`;
    const index = DIG.wardrobe.colors.findIndex((color) => color.id === id);
    return `color-${index >= 0 ? pad(index + 1) : id.replace('#', '')}`;
}
