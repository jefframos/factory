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
//   shop         hat-<id> | face-<id> | color-<id> bought     a wardrobe item bought with cash
//   shop         hat-<id> | face-<id> | color-<id> equip      an owned wardrobe item put on
//   build        <buildableId>                     complete   a hub piece bought
//   area         <areaId>                          visible    a hidden hub area appears
//   bag          full-<capacity>                   complete   the backpack fills up
//   sell         atm | anywhere                    complete   the backpack is sold (at the ATM pad / the SELL button)
//   sell         count-<n>                         complete   the player's nth sale, for the first 10
//   blocked      <materialId>                      fail       the miner pushes into rock the tool can't dig (once per
//                                                             material per session)
//   zone         <zoneId>                          start      a zone reached for the first time
//   find         <findId>                          complete   an artifact dug up
//   find         <findId>                          interact   its banner's CLAIM (tapped or on its own)
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
//
// Add an event here (and to the table) rather than calling PlatformHandler.measure() directly.

import PlatformHandler from 'core/platforms/PlatformHandler';
import { DigProgress } from '../data/DigProgress';

/** The tutorial steps, in the order a new player meets them (the funnel). */
export const TUTORIAL = ['move', 'dig', 'bag-full', 'sell', 'tool-upgrade', 'bag-upgrade', 'wardrobe', 'hat', 'find', 'claim', 'collection', 'build'] as const;
export type TutorialStep = (typeof TUTORIAL)[number];

const PLAYTIME_MINUTES = [1, 2, 3, 5, 8, 12, 20, 30, 45, 60];

function send(category: string, what: string | number, action: string): void {
    PlatformHandler.instance.measure(category, what, action);
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
    },

    backpackBought(level: number, capacity: number): void {
        send('upgrade', `bag-${pad(level)}-${capacity}`, 'complete');
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

    areaRevealed(areaId: string): void {
        send('area', areaId, 'visible');
    },

    backpackFull(capacity: number): void {
        send('bag', `full-${capacity}`, 'complete');
    },

    sold(where: 'atm' | 'anywhere', count: number): void {
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

    findDug(findId: string): void {
        send('find', findId, 'complete');
    },

    findClaimed(findId: string): void {
        send('find', findId, 'interact');
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
};

/** Faces are image paths (skins/face-x.webp) and colours hex codes: just the name part. */
function lookId(kind: string, id: string): string {
    const prefix = kind === 'hats' ? 'hat' : kind === 'faces' ? 'face' : 'color';
    const name = id.split('/').pop()!.replace(/\.[^.]+$/, '').replace('#', '');
    return `${prefix}-${name}`;
}
