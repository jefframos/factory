// GameAnalytics.ts
//
// Every analytics event Mow Town sends — one place, so names stay stable across versions. Goes through
// PlatformHandler.measure() (Poki: PokiSDK.measure(); the mock platform logs them). Values are ids, not display text.
// Actions: only `start` and `complete` have shown up in Poki's progress export (data/progress-events-mow.csv), so
// anything we want to read there uses them, and an event's name says what happened.
//
//   category     what                         action     when
//   session      new | returning              start      the player's first move this session (new: their first ever)
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
//   level        <nn>                         complete   a player level reached (the farm game; once per player each)
//   unlock       <districtId>                 complete   an area bought on its unlock square (level + cash)
//   den          <denId>-found                complete   a den reached and opened (once per player each)
//   den          <denId>-<what>               complete   bought in a den: hen-<nn>, dock, belt, helper, truck-helper,
//                                                        gold, gold-belt; tutorial: its first-visit lesson done
//                                                        (once per player each)
//
// Gameplay (Gameplay.ts: the platform's gameplayStart / gameplayStop): starts on the player's first move, stops while a
// panel that stops play is open (the map, Trophies, the language, the cities), starts again on the next move once it's
// closed (MowScene.updateGameplay()). playtime counts only while it's on.
//
// THE FARM GAME (farmTest(): the one big map) reads like mob's levels in Poki's PROGRESS export: only its progression
// is there, as start / complete pairs, so Poki shows the time spent on each step and where players leave (`lefts`).
//   step     <nn>-<name>   start      that step became the goal: the one after the furthest done (FARM_STEPS, play order),
//                                     again at each session's start while it's still the goal (total_starts: retries)
//   step     <nn>-<name>   complete   done (once per player); then the next step's start. One done out of order gets
//                                     its start right before its complete, so every complete has a start.
//   level    <nn>          complete   a player level reached
//   session  new|returning start      the session (the base: players who started)
// Everything else is sent with an action of its own (found, bought, equip, reached, hit, interact, visible), which keeps
// it out of the progress export (it lands in Poki's other exports): trophies (`treasure / <id> / found`; no claim,
// they pay with the find), the wardrobe, playtime (`playtime / min-<n> / reached`), upgrade levels, more hens, sales,
// blocked grass. A milestone that's a step isn't sent again under its old name (no tutorial-*, tool-*, district-*,
// area-first-*, unlock-*, bag-*, city-*). data/funnel.mjs prints an export as the funnel.
//
// Add an event here (and to the table) rather than calling PlatformHandler.measure() directly.

import PlatformHandler from 'core/platforms/PlatformHandler';
import { MowProgress } from '../data/MowProgress';
import { MODE } from '../data/GameMode';
import { CITY, farmTest } from '../data/MowConfig';

/**
 * The farm game's funnel, in play order: `step` / `<nn>-<name>` (nn = its place here, from 01). New steps go where they
 * happen in play only before a build's first release; after that, renumbering breaks the comparison with older exports.
 */
export const FARM_STEPS = [
    'move', 'first-cut', 'bag-full', 'station', 'mower-01', 'yard-done', 'bag-01', 'mower-02', 'blades-01', 'park-done',
    'mower-03', 'den-found', 'den-egg', 'den-pack', 'den-sale', 'den-lesson', 'hen-02', 'trucks', 'wilds-done', 'mower-04',
    'belt', 'helper', 'gold', 'section-4-bought', 'truck-helper', 'gold-belt', 'mower-05', 'section-4-done', 'mower-06',
] as const;

/** A step's event value: `<nn>-<name>`. */
const stepId = (index: number): string => `${String(index + 1).padStart(2, '0')}-${FARM_STEPS[index]}`;
/** The session's started (sessionStart()): steps done before it wait in pendingSteps. */
let sessionOpen = false;
const pendingSteps: string[] = [];
/** The steps started this session (each start sent once a session). */
const startedSteps = new Set<number>();

/** The goal now (the step after the furthest one done: an early one skipped never stalls it), started if it isn't yet this session. */
function startCurrentStep(): void {
    let furthest = -1;
    FARM_STEPS.forEach((name, i) => {
        if (MowProgress.sentBefore(`step-${name}`)) furthest = i;
    });
    const index = furthest + 1;
    if (index >= FARM_STEPS.length || startedSteps.has(index)) return;
    startedSteps.add(index);
    send('step', stepId(index), 'start');
}

/** A farm step done (once per player): its complete (a start first if it had none), then the next goal's start. False when `name` isn't a step. */
function stepOf(name: string): boolean {
    const index = (FARM_STEPS as readonly string[]).indexOf(name);
    if (index < 0) return false;
    // Before the session's start (the first cut comes with the first move): sent right after it.
    if (!sessionOpen) {
        if (!pendingSteps.includes(name)) pendingSteps.push(name);
        return true;
    }
    if (!MowProgress.once(`step-${name}`)) return true;
    if (!startedSteps.has(index)) {
        startedSteps.add(index);
        send('step', stepId(index), 'start');
    }
    send('step', stepId(index), 'complete');
    startCurrentStep();
    return true;
}

/** The progress actions (Poki's progress export: start, complete, fail). */
const PROGRESS_ACTIONS: Record<string, string> = { start: 'opened', complete: 'reached', fail: 'hit' };
/** The farm game's progress categories: the rest is sent with another action (out of the progress export). */
const PROGRESS_CATEGORIES = new Set(['step', 'level', 'session']);

/** The old tutorial steps the farm game still calls, as its funnel's. */
/** The den's milestones (GameAnalytics.den()'s `what`) as the funnel's steps. */
const DEN_STEPS: Partial<Record<string, string>> = { found: 'den-found', egg: 'den-egg', pack: 'den-pack', sale: 'den-sale', tutorial: 'den-lesson', dock: 'trucks' };

const TUTORIAL_AS_STEP: Partial<Record<string, string>> = { move: 'move', cut: 'first-cut', 'bag-full': 'bag-full', sell: 'station' };

/** The first-session steps, in order (the GDD's first five minutes). */
// New steps go at the end (even when they come earlier in play), so the numbers of the ones before never change.
export const TUTORIAL = ['move', 'cut', 'bag-full', 'sell', 'first-mower', 'first-upgrade', 'park-restored', 'wardrobe', 'hat', 'yard-restored'] as const;
export type TutorialStep = (typeof TUTORIAL)[number];

const PLAYTIME_MINUTES = [1, 2, 3, 5, 8, 12, 20, 30];

function send(category: string, what: string | number, action: string): void {
    // The farm game: only its funnel in the progress export (anything else gets a non-progress action).
    if (farmTest() && !PROGRESS_CATEGORIES.has(category) && PROGRESS_ACTIONS[action]) action = PROGRESS_ACTIONS[action];
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
        if (MODE !== 'calm') send('mode', MODE, 'start');
        sessionOpen = true;
        if (farmTest()) {
            // The session starts with the first move: the funnel's first step; then whatever came with it (the first
            // cut), then the goal this session starts on.
            stepOf('move');
            pendingSteps.splice(0).forEach((name) => stepOf(name));
            startCurrentStep();
        }
    },

    /** Active play time (call every frame while gameplay is active). */
    playTime(delta: number): void {
        playSeconds += delta;
        while (nextMinute < PLAYTIME_MINUTES.length && playSeconds >= PLAYTIME_MINUTES[nextMinute] * 60) {
            send('playtime', `min-${PLAYTIME_MINUTES[nextMinute]}`, farmTest() ? 'reached' : 'complete');
            if (MODE !== 'calm') send('mode', `${MODE}-min-${PLAYTIME_MINUTES[nextMinute]}`, 'complete');
            nextMinute++;
        }
        // (One map in the farm game: no per-city copy.)
        if (farmTest()) return;
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
        if (farmTest()) {
            const name = TUTORIAL_AS_STEP[step];
            if (name) stepOf(name);
            return;
        }
        if (!MowProgress.once(`tutorial-${step}`)) return;
        send('tutorial', `${pad(TUTORIAL.indexOf(step) + 1)}-${step}`, 'complete');
    },

    treasureFound(id: string): void {
        send('treasure', id, farmTest() ? 'found' : 'complete');
    },

    /** `key` is a treasure id, or `area:<id>` for an area's bonus. */
    treasureClaimed(key: string): void {
        // (The farm game pays a trophy with its find: the claim's the same count again.)
        if (farmTest()) return;
        send('claim', key.replace('area:', 'area-'), 'interact');
    },

    /** `kind` is the wardrobe tab (hats / faces / colors). */
    lookBought(kind: string, id: string): void {
        send('shop', lookId(kind, id), 'bought');
    },

    lookEquipped(kind: string, id: string): void {
        send('shop', lookId(kind, id), 'equip');
    },

    /** A panel's tab opened by the player (wardrobe colors / faces / hats, ATM mowers / boosts), once per player each. */
    tabOpened(panel: 'wardrobe' | 'atm', tab: string): void {
        if (MowProgress.once(`tab-${panel}-${tab}`)) send('tab', `${panel}-${tab}`, 'interact');
    },

    /** A wardrobe gift's FREE badge seen (the return visit after the first hat, still unclaimed), once per kind. */
    giftBadgeShown(kind: string): void {
        if (MowProgress.once(`gift-badge-${kind}`)) send('gift', kind, 'visible');
    },

    /** A wardrobe gift claimed: on its own (no badge yet) or after its FREE badge showed. */
    giftClaimed(kind: string, afterBadge: boolean): void {
        send('gift', `${kind}-${afterBadge ? 'badge' : 'unbadged'}`, 'interact');
    },

    toolBought(level: number, toolId: string): void {
        if (farmTest() && stepOf(`mower-${pad(level)}`)) return;
        send('tool', `${CITY.id}-${pad(level)}-${toolId}`, 'complete');
    },

    upgradeBought(upgradeId: string, level: number): void {
        // The farm game: the first bag and blades are steps; every level is also sent as `upgrade` (the detail).
        if (farmTest() && level === 1) stepOf(`${upgradeId === 'capacity' ? 'bag' : upgradeId}-01`);
        send('upgrade', farmTest() ? `${upgradeId}-${pad(level)}` : `${CITY.id}-${upgradeId}-${pad(level)}`, farmTest() ? 'bought' : 'complete');
    },

    sold(count: number): void {
        if (count <= 10) send('sell', `${CITY.id}-count-${count}`, 'complete');
    },

    bagFull(): void {
        // (The farm game: its `bag-full` step.)
        if (farmTest() || fullIn.has(CITY.id)) return;
        fullIn.add(CITY.id);
        send('bag', `${CITY.id}-full`, 'complete');
    },

    districtRestored(districtId: string): void {
        if (farmTest()) {
            if (!stepOf(`${districtId}-done`)) send('district', districtId, 'complete');
            return;
        }
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
        send('blocked', key, 'fail');
    },

    /** A city entered for the first time. */
    cityStarted(cityId: string): void {
        if (farmTest()) return;
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
        if (MowProgress.once(`panel-${panel}`)) send('panel', panel, 'interact');
    },

    languagePicked(code: string): void {
        send('settings', `lang-${code}`, 'interact');
    },

    /** A player level reached (the farm game), once per player each. */
    levelReached(level: number): void {
        if (MowProgress.once(`level-${level}`)) send('level', pad(level), 'complete');
    },

    /** An area bought on its unlock square. */
    areaBought(districtId: string): void {
        if (!stepOf(`${districtId}-bought`)) send('unlock', districtId, 'complete');
    },

    /** A den's milestone: found, or something bought in it (hen-<nn>, dock, belt, helper…), once per player each. */
    den(denId: string, what: string): void {
        // The farm game's funnel has the den's milestones (found, the first egg / pack / sale, the lesson, the 2nd hen,
        // the trucks, the belt, the helpers, the gold machine and belt); the rest (more hens) as `den`.
        const asStep = DEN_STEPS[what] ?? what;
        if (stepOf(asStep)) return;
        if (MowProgress.once(`den-${denId}-${what}`)) send('den', `${denId}-${what}`, 'bought');
    },
};

/** Faces are image paths (skins/face-x.webp) and colours hex codes: just the name part. */
function lookId(kind: string, id: string): string {
    const prefix = kind === 'hats' ? 'hat' : kind === 'faces' ? 'face' : 'color';
    const name = id.split('/').pop()!.replace(/\.[^.]+$/, '').replace('#', '');
    return `${prefix}-${name}`;
}
