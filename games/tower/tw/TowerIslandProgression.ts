// TowerIslandProgression.ts

import { ISLANDS, type IslandConfig } from '../game/world/IslandStorage';
import { LEVELS } from './LevelStorage';

export interface LevelIslandResolution {
    island: IslandConfig;
    /** Hex color string (e.g. "#3a86ff") this zone's sky should show — the island's own skyGradient step if it defines one, else its plain skyColor. */
    skyColorHex: string;
}

/**
 * Resolves which island (texture/water/sky) applies at `levelIndex` (see
 * FaceTowerGameController.getLevelIndex()) and, for a gradient-sky island,
 * which step of its skyGradient `zoneIndexInLevel` (see
 * FaceTowerGameController.getZoneIndexInLevel()) lands on.
 *
 * The gradient steps through one color per ZONE, not per level — a level
 * can span many zones (levels-config.json's own `zoneCount`), and the sky
 * should visibly progress across all of them, not sit static until the
 * level as a whole finishes. It resets to the gradient's first color every
 * time the level itself changes (zoneIndexInLevel resets to 0 — see
 * TowerLevelController.advanceZone()), so two different levels sharing the
 * same island both start that island's sky arc from the top. A zone past
 * the end of the gradient array repeats its last color, same convention as
 * a level's own `zones`.
 */
export function resolveIslandForZone(levelIndex: number, zoneIndexInLevel: number): LevelIslandResolution {
    const clampedLevelIndex = Math.min(Math.max(levelIndex, 0), LEVELS.length - 1);
    const islandId = LEVELS[clampedLevelIndex]?.islandId;

    const island =
        ISLANDS.find(candidate => candidate.id === islandId) ??
        ISLANDS.find(candidate => candidate.isDefault) ??
        ISLANDS[0];

    if (!island.skyGradient || island.skyGradient.length === 0) {
        return { island, skyColorHex: island.skyColor };
    }

    const step = Math.min(Math.max(zoneIndexInLevel, 0), island.skyGradient.length - 1);
    return { island, skyColorHex: island.skyGradient[step] };
}
