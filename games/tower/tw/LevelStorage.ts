// LevelStorage.ts

import * as PIXI from 'pixi.js';

/** One zone (section) within a level — see LevelConfig. */
export interface LevelZoneConfig {
    /** How many blocks tall this zone is — converted to world px via FaceTowerConfig.blockHeight. */
    height: number;
    /** Fraction (0..1) of the zone's own world height the containment poles stand — see TowerDeadZoneController.rebuild(). */
    polePercent: number;
}

/**
 * One level's worth of zones. `zoneCount` may exceed `zones.length` — every
 * zone past the authored array reuses `zones`' own last entry (see
 * TowerLevelController.getCurrentZoneConfig()).
 */
export interface LevelConfig {
    /** Which IslandStorage.IslandConfig this level's visuals (texture/water/sky) come from — see TowerIslandProgression.resolveIslandForZone(). */
    islandId: string;
    /** Flavor-text destination name for this level's arrival — not read by any game logic, just along for the ride from levels-config.json. */
    destination?: string;
    /** Flavor-text distance for this level's leg of the trip — same as `destination`, display-only. */
    distanceFromPreviousKm?: number;
    zoneCount: number;
    zones: LevelZoneConfig[];
}

/**
 * Root shape of raw-assets/json/levels-config.json — `progression` is the
 * actual level list (see LevelConfig); `poleSize` is a standalone top-level
 * tuning value, not currently read by any game logic.
 */
interface LevelsConfigFile {
    poleSize?: number;
    progression: LevelConfig[];
}

/**
 * Populated in place from the 'json' PIXI bundle (raw-assets/json/levels-config.json)
 * once it finishes loading — see MyGame.loadAssets() in index.ts. Kept as a
 * mutated const array (rather than reassigned) so existing imports of
 * LEVELS stay valid references.
 */
export const LEVELS: LevelConfig[] = [];

/** Call once the 'json' PIXI.Assets bundle has loaded — see index.ts loadAssets(). */
export function loadLevels(): void {
    const config = PIXI.Assets.get('levels-config.json') as LevelsConfigFile;
    LEVELS.splice(0, LEVELS.length, ...config.progression);
}
