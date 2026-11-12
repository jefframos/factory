// mob-grade-key.js
//
// What a level's difficulty grade (tools/grade-levels.ts, the robot players) was worked out from, as short hashes, so the
// editor can tell a grade that no longer holds (it greys it out):
//   levelHash   — the level itself (its JSON, keys in any order);
//   contextHash — where it is and what the player has by then: its place in the play order, the reward and houses of
//                 every level before it (the coins and cards they give), and the settings that set the upgrades' prices
//                 and strength and the retries' easing. (Grades made before loadoutKey: newer ones use that.)
//   loadoutKey  — what the player has by the level, not where it is: the story cards they have (settings.json
//                 storyCards, by how many levels are before it) and those settings; with their coins by then (the
//                 start's and every level's reward before it: coinsAt), kept beside it and allowed COIN_SLACK either way.
//                 A level moved a place or two, or one put in or taken out before it, keeps its grade unless that
//                 changes what the player has there.
//   gradeHolds  — whether a stored grade still holds for a level where it is now: the level the same, and its loadoutKey
//                 (or, an older grade, its contextHash).
// Shared, as is, by the grader (bundled by esbuild) and the editor (a plain ES module): both must hash the same way.

/** JSON with every object's keys sorted (the same data always gives the same text). */
export function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

/** A short hash of a string (FNV-1a, 32 bits, as 8 hex digits). */
export function hashString(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

export const levelHash = (level) => hashString(stableStringify(level));

/** The settings a grade depends on (not the cards' pictures or colours, nor anything else only for looks). */
function economySettings(settings) {
    const cards = Object.fromEntries(Object.entries(settings?.cards ?? {}).map(([kind, card]) => [kind, { maxLevel: card.maxLevel, cost: card.cost, hp: card.hp, damage: card.damage, seconds: card.seconds }]));
    const upgrades = Object.fromEntries(Object.entries(settings?.upgrades ?? {}).map(([kind, upgrade]) => [kind, { max: upgrade.max, perLevel: upgrade.perLevel, cost: upgrade.cost }]));
    return { startCoins: settings?.startCoins, retry: settings?.retry, housesBlockReds: settings?.housesBlockReds, cards, upgrades };
}

/** `index`: the level's place in the play order (0-based); `before`: the levels played before it, in order. */
export function contextHash(index, before, settings) {
    return hashString(stableStringify({
        index,
        before: before.map((level) => ({ reward: level?.reward ?? 0, houses: (level?.pads ?? []).map((pad) => pad.kind ?? 'giant').sort() })),
        settings: economySettings(settings),
    }));
}

/** How far the coins by a level may be from those it was graded with (either way, as a share): a level or two's
 *  reward more or less is the same. */
const COIN_SLACK = 1.25;

/** The player's coins by a level: the start's and the reward of every level before it. */
export function coinsAt(before, settings) {
    return (settings?.startCoins ?? 0) + before.reduce((sum, level) => sum + (level?.reward ?? 0), 0);
}

/** What the player has by level `index` (0-based; `before`: the levels before it), but its coins (coinsAt). */
export function loadoutKey(index, before, settings) {
    const cards = (settings?.storyCards ?? []).filter((card) => index >= card.after).map((card) => card.kind).sort();
    return hashString(stableStringify({ cards, settings: economySettings(settings) }));
}

const coinsClose = (then, now) => Math.abs(Math.log((now + 200) / (then + 200))) <= Math.log(COIN_SLACK);

/** Whether `grade` (as stored) still holds for `level`, at `index` with `before` before it. */
export function gradeHolds(grade, level, index, before, settings) {
    if (!grade || levelHash(level) !== grade.levelHash) return false;
    if (grade.loadoutKey) return grade.loadoutKey === loadoutKey(index, before, settings) && (grade.coins === undefined || coinsClose(grade.coins, coinsAt(before, settings)));
    if (grade.index === index && grade.contextHash === contextHash(index, before, settings)) return true;
    // A grade from before loadoutKey: it holds if the player had about the same where it was graded as they have here
    // (its old place's loadout, from the levels now before it: the ones that were, near enough).
    const old = Number.isInteger(grade.index) ? grade.index : index;
    const then = old <= index ? before.slice(0, old) : [...before, ...Array.from({ length: old - index }, () => before[before.length - 1])];
    return loadoutKey(old, then, settings) === loadoutKey(index, before, settings) && coinsClose(coinsAt(then, settings), coinsAt(before, settings));
}

/** The 0..100 grade's colour: green (easy) through yellow to red (hard). */
export function gradeColour(score) {
    const t = Math.max(0, Math.min(100, score)) / 100;
    return `hsl(${Math.round((1 - t) * 120)}, 70%, 42%)`;
}

/** The 0..100 grade in a word. */
export function gradeWord(score) {
    return score < 20 ? 'Trivial' : score < 40 ? 'Easy' : score < 60 ? 'Fair' : score < 80 ? 'Hard' : 'Brutal';
}
