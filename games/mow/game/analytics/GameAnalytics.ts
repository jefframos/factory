// GameAnalytics.ts
//
// Every analytics event Mow Town sends — one place, so names stay stable across versions. Goes through
// PlatformHandler.measure() (Poki: PokiSDK.measure(); the mock platform logs them). Values are ids, not display text.
// Actions: only `start` and `complete` have shown up in Poki's progress export (data/progress-events-mow.csv), so
// anything we want to read there uses them, and an event's name says what happened.
//
//   category     what                         action     when
//   session      new | returning              start      the player's first input this session (new: their first ever)
//   playtime     min-<n>                      complete   n minutes of active play this session
//   playtime     <cityId>-min-<n>             complete   n minutes of active play in that city this session
//   mode         calm | rush                  start      with session/start: which mode is played (GameMode)
//   mode         <mode>-min-<n>               complete   with each playtime event, per mode (to compare them)
//   tutorial     <nn>-<step>                  complete   each first-session step, once per player, in order
//   tool         <cityId>-<nn>-<toolId>       complete   a tool / mower bought (each city starts over but the tutorial's next)
//   upgrade      <cityId>-<upgradeId>-<nn>    complete   an upgrade level bought
//   treasure     <treasureId>                 complete   a treasure found in the grass (or handed over on restoring its area)
//   claim        <treasureId> | area-<id>     complete   its reward (or an area's bonus) claimed in the Trophies panel
//   secret       <secretId>                   complete   a secret patch's chest found (it pays at once)
//   panel        map | town | trophies | cities complete  the MAP button's map, the town icon's big view, the Trophies
//                                                        panel, the cities panel opened (once per player each)
//   shop         bought-<hat|face|color>-<id> complete   a wardrobe item bought with cash
//   shop         equip-<hat|face|color>-<id>  complete   an owned wardrobe item put on
//   tab          wardrobe-<tab> | atm-<tab>   complete   a panel tab opened by the player (once per player each)
//   gift         colors | faces               visible    a wardrobe gift's FREE badge seen (once per player each)
//   gift         <kind>-badge | <kind>-unbadged complete a wardrobe gift claimed, after its badge showed or before
//   sell         <cityId>-count-<n>           complete   the city's nth sale, for the first 10
//   bag          <cityId>-full                complete   the container fills up (once a session in each city)
//   district     <districtId>                 complete   a district restored (ids are unique across cities)
//   area-first   <cityId>-<districtId>        complete   the first area a player restored in that city (where they chose to go)
//   blocked      <cityId>-<grassId>           complete   pushed into grass the mower can't cut at all (once a session each)
//   part         <cityId>-<partId>            start      a part's areas opened together (a city in parts)
//   goal         <cityId>-<n>                 complete   the nth area restored towards the city's goal (once per player each)
//   city         <cityId>                     start      a city played for the first time (once per player each)
//   city         <cityId>                     complete   a city finished: its goal, or every area (once per player each)
//   travel       <fromId>-to-<toId>           complete   a city's PLAY in the cities panel
//   settings     lang-<code>                  complete   a language picked
//
// Add an event here (and to the table) rather than calling PlatformHandler.measure() directly.

import PlatformHandler from 'core/platforms/PlatformHandler';
import { MowProgress } from '../data/MowProgress';
import { MODE } from '../data/GameMode';
import { CITY } from '../data/MowConfig';

/** The first-session steps, in order (the GDD's first five minutes). */
// New steps go at the end (even when they come earlier in play), so the numbers of the ones before never change.
export const TUTORIAL = ['move', 'cut', 'bag-full', 'sell', 'first-mower', 'first-upgrade', 'park-restored', 'wardrobe', 'hat', 'yard-restored'] as const;
export type TutorialStep = (typeof TUTORIAL)[number];

const PLAYTIME_MINUTES = [1, 2, 3, 5, 8, 12, 20, 30];

function send(category: string, what: string | number, action: string): void {
    PlatformHandler.instance.measure(category, what, action);
}

const pad = (n: number) => String(n).padStart(2, '0');
let playSeconds = 0;
let nextMinute = 0;
/** The same, in the city being played (from 0 again in each city this session). */
const cityPlay = new Map<string, { seconds: number; next: number }>();
/** Cities whose bag has filled up this session. */
const fullIn = new Set<string>();
/** The tough grass already reported blocking the mower this session (city and grass). */
const blockedBy = new Set<string>();

export const GameAnalytics = {
    sessionStart(newGame: boolean): void {
        send('session', newGame ? 'new' : 'returning', 'start');
        send('mode', MODE, 'start');
    },

    /** Active play time (call every frame while gameplay is active). */
    playTime(delta: number): void {
        playSeconds += delta;
        while (nextMinute < PLAYTIME_MINUTES.length && playSeconds >= PLAYTIME_MINUTES[nextMinute] * 60) {
            send('playtime', `min-${PLAYTIME_MINUTES[nextMinute]}`, 'complete');
            send('mode', `${MODE}-min-${PLAYTIME_MINUTES[nextMinute]}`, 'complete');
            nextMinute++;
        }
        const city = cityPlay.get(CITY.id) ?? { seconds: 0, next: 0 };
        cityPlay.set(CITY.id, city);
        city.seconds += delta;
        while (city.next < PLAYTIME_MINUTES.length && city.seconds >= PLAYTIME_MINUTES[city.next] * 60) {
            send('playtime', `${CITY.id}-min-${PLAYTIME_MINUTES[city.next]}`, 'complete');
            city.next++;
        }
    },

    /** A first-session step done: sent once per player. */
    tutorialStep(step: TutorialStep): void {
        if (!MowProgress.once(`tutorial-${step}`)) return;
        send('tutorial', `${pad(TUTORIAL.indexOf(step) + 1)}-${step}`, 'complete');
    },

    treasureFound(id: string): void {
        send('treasure', id, 'complete');
    },

    /** `key` is a treasure id, or `area:<id>` for an area's bonus. */
    treasureClaimed(key: string): void {
        send('claim', key.replace('area:', 'area-'), 'complete');
    },

    /** `kind` is the wardrobe tab (hats / faces / colors). */
    lookBought(kind: string, id: string): void {
        send('shop', `bought-${lookId(kind, id)}`, 'complete');
    },

    lookEquipped(kind: string, id: string): void {
        send('shop', `equip-${lookId(kind, id)}`, 'complete');
    },

    /** A panel's tab opened by the player (wardrobe colors / faces / hats, ATM mowers / boosts), once per player each. */
    tabOpened(panel: 'wardrobe' | 'atm', tab: string): void {
        if (MowProgress.once(`tab-${panel}-${tab}`)) send('tab', `${panel}-${tab}`, 'complete');
    },

    /** A wardrobe gift's FREE badge seen (the return visit after the first hat, still unclaimed), once per kind. */
    giftBadgeShown(kind: string): void {
        if (MowProgress.once(`gift-badge-${kind}`)) send('gift', kind, 'visible');
    },

    /** A wardrobe gift claimed: on its own (no badge yet) or after its FREE badge showed. */
    giftClaimed(kind: string, afterBadge: boolean): void {
        send('gift', `${kind}-${afterBadge ? 'badge' : 'unbadged'}`, 'complete');
    },

    toolBought(level: number, toolId: string): void {
        send('tool', `${CITY.id}-${pad(level)}-${toolId}`, 'complete');
    },

    upgradeBought(upgradeId: string, level: number): void {
        send('upgrade', `${CITY.id}-${upgradeId}-${pad(level)}`, 'complete');
    },

    sold(count: number): void {
        if (count <= 10) send('sell', `${CITY.id}-count-${count}`, 'complete');
    },

    bagFull(): void {
        if (fullIn.has(CITY.id)) return;
        fullIn.add(CITY.id);
        send('bag', `${CITY.id}-full`, 'complete');
    },

    districtRestored(districtId: string): void {
        send('district', districtId, 'complete');
        if (MowProgress.once(`area-first-${CITY.id}`)) send('area-first', `${CITY.id}-${districtId}`, 'complete');
    },

    /** The nth area restored towards the city's goal, once per player each. */
    goalProgress(count: number): void {
        if (MowProgress.once(`goal-${CITY.id}-${count}`)) send('goal', `${CITY.id}-${count}`, 'complete');
    },

    /** A part's areas opened (the one before all restored), once per player each. */
    partOpened(partId: string): void {
        if (MowProgress.once(`part-${CITY.id}-${partId}`)) send('part', `${CITY.id}-${partId}`, 'start');
    },

    /** Pushed into grass the mower can't cut at all: the wall a free choice of areas can run into. */
    blocked(grassId: string): void {
        const key = `${CITY.id}-${grassId}`;
        if (blockedBy.has(key)) return;
        blockedBy.add(key);
        send('blocked', key, 'complete');
    },

    /** A city entered for the first time. */
    cityStarted(cityId: string): void {
        if (MowProgress.once(`city-${cityId}`)) send('city', cityId, 'start');
    },

    cityCompleted(cityId: string): void {
        if (MowProgress.once(`city-complete-${cityId}`)) send('city', cityId, 'complete');
    },

    cityTravel(from: string, to: string): void {
        send('travel', `${from}-to-${to}`, 'complete');
    },

    secretFound(id: string): void {
        send('secret', id, 'complete');
    },

    /** A panel opened by the player (the map, the town's big view, Trophies), once per player each. */
    panelOpened(panel: 'map' | 'town' | 'trophies' | 'cities'): void {
        if (MowProgress.once(`panel-${panel}`)) send('panel', panel, 'complete');
    },

    languagePicked(code: string): void {
        send('settings', `lang-${code}`, 'complete');
    },
};

/** Faces are image paths (skins/face-x.webp) and colours hex codes: just the name part. */
function lookId(kind: string, id: string): string {
    const prefix = kind === 'hats' ? 'hat' : kind === 'faces' ? 'face' : 'color';
    const name = id.split('/').pop()!.replace(/\.[^.]+$/, '').replace('#', '');
    return `${prefix}-${name}`;
}
