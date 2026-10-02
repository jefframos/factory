// SaveDataVersion.ts
//
// One version number for the WHOLE save — every *Storage.ts key plus the debug zone cookie
// (see PlayerDataReset.wipeAllPlayerData()'s list). Checked once at boot, before any
// *Storage.load() runs (see index.ts): if the stored version doesn't match SAVE_DATA_VERSION
// (including a save from before this existed, which has none), the entire save is wiped and
// the game boots exactly like a first-ever visit, then the current version is written.
//
// Bump SAVE_DATA_VERSION whenever a change makes older saves unsafe to load as-is — a
// storage's shape changing, zones/gates being re-numbered or moved on the Tiled map (a saved
// PlayerPositionStorage spot can land in a zone the rest of the save never unlocked), etc.
// Wiping is deliberately all-or-nothing: these storages gate each other (see
// PlayerDataReset.ts's own doc), so partially migrating one can leave the save
// self-inconsistent in exactly the way a full wipe can't.

import PlatformHandler from 'core/platforms/PlatformHandler';
import { wipeAllPlayerData } from './PlayerDataReset';

export const SAVE_DATA_VERSION = 1;

const STORAGE_KEY = 'PIZZA_SAVE_DATA_VERSION';

/** Call once at boot, after PlatformHandler is initialized and BEFORE any *Storage.load(). */
export async function ensureSaveDataVersion(): Promise<void> {
    const platform = PlatformHandler.instance.platform;
    const stored = await platform.getItem(STORAGE_KEY);
    if (stored === String(SAVE_DATA_VERSION)) {
        return;
    }

    console.warn(`[SaveDataVersion] save version ${stored ?? '(none)'} != ${SAVE_DATA_VERSION} — wiping save data and starting fresh`);
    await wipeAllPlayerData();
    await platform.setItem(STORAGE_KEY, String(SAVE_DATA_VERSION));
}
