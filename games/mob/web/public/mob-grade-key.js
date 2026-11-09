// mob-grade-key.js
//
// What a level's difficulty grade (tools/grade-levels.ts, the robot players) was worked out from, as short hashes, so the
// editor can tell a grade that no longer holds (it greys it out):
//   levelHash   — the level itself (its JSON, keys in any order);
//   contextHash — where it is and what the player has by then: its place in the play order, the reward and houses of
//                 every level before it (the coins and cards they give), and the settings that set the upgrades' prices
//                 and strength and the retries' easing.
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

/** The 0..100 grade's colour: green (easy) through yellow to red (hard). */
export function gradeColour(score) {
    const t = Math.max(0, Math.min(100, score)) / 100;
    return `hsl(${Math.round((1 - t) * 120)}, 70%, 42%)`;
}

/** The 0..100 grade in a word. */
export function gradeWord(score) {
    return score < 20 ? 'Trivial' : score < 40 ? 'Easy' : score < 60 ? 'Fair' : score < 80 ? 'Hard' : 'Brutal';
}
