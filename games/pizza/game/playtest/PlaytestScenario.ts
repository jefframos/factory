// PlaytestScenario.ts
//
// Save-state snapshots, so a playtest can start at a later point of the game (e.g. with the diner
// already built) instead of replaying 20 minutes to get there:
//
//   - captureSaveState(): every save key (localStorage "PIZZA_*" plus the shared "CLOG_*" ones —
//     the same set PlayerDataReset.wipeAllPlayerData() clears) as one JSON object. The playtest
//     panel's "Save state" button downloads it; __pizzaPlaytest.saveState() returns it (the terminal
//     runner's --snapshot-at writes it to a file).
//   - ?scenario=<name>: index.ts calls loadScenarioFromUrl() before any storage loads — it fetches
//     games/pizza/playtest-scenarios/<name>.json (served by the dev server), wipes the save and
//     writes the snapshot's keys back. The game then boots exactly where the snapshot was taken.
//
// Dev only: the scenarios folder isn't part of a build.

import { wipeAllPlayerData } from '../data/PlayerDataReset';

/** Save keys a snapshot covers — see this file's own doc. */
const SAVE_KEY = /^(PIZZA_|CLOG_)/;
/** Where scenario files live, relative to the game's page (games/pizza/). */
const SCENARIO_DIR = './playtest-scenarios';

export interface SaveStateSnapshot {
    version: 1;
    savedAtIso: string;
    /** Free text — what moment of the game this is (e.g. "diner built, Lv8"). */
    note?: string;
    keys: Record<string, string>;
}

/** Every save key right now — see this file's own doc. */
export function captureSaveState(note?: string): SaveStateSnapshot {
    const keys: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && SAVE_KEY.test(key)) {
            keys[key] = localStorage.getItem(key) ?? '';
        }
    }
    return { version: 1, savedAtIso: new Date().toISOString(), ...(note ? { note } : {}), keys };
}

/** The `?scenario=` name, if any. */
export function getScenarioName(): string | undefined {
    return new URLSearchParams(window.location.search).get('scenario') ?? undefined;
}

/**
 * ?scenario=<name> — replaces the whole save with that snapshot before anything loads. Returns
 * whether one was applied (false: no scenario in the URL, or it couldn't be read — logged).
 */
export async function loadScenarioFromUrl(): Promise<boolean> {
    const name = getScenarioName();
    if (!name) {
        return false;
    }
    let snapshot: SaveStateSnapshot;
    try {
        const response = await fetch(`${SCENARIO_DIR}/${encodeURIComponent(name)}.json`, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        snapshot = await response.json() as SaveStateSnapshot;
    } catch (error) {
        console.error(`[PlaytestScenario] couldn't load scenario "${name}" (${SCENARIO_DIR}/${name}.json): ${String(error)} — starting from the current save`);
        return false;
    }
    await wipeAllPlayerData();
    for (const [key, value] of Object.entries(snapshot.keys ?? {})) {
        localStorage.setItem(key, value);
    }
    console.log(`[PlaytestScenario] loaded "${name}"${snapshot.note ? ` — ${snapshot.note}` : ''} (${Object.keys(snapshot.keys ?? {}).length} keys, saved ${snapshot.savedAtIso})`);
    return true;
}
