// TowerLevelController.ts

import { LEVELS, type LevelZoneConfig } from './LevelStorage';

const FALLBACK_ZONE: LevelZoneConfig = { height: 6, polePercent: 0.6 };

export interface ZoneAdvanceResult {
    /** True the instant zoneIndexInLevel rolls over into a new level — fires onLevelProgressed. Never true once the last level is reached; its zones just keep repeating. */
    leveledUp: boolean;
    levelIndex: number;
}

/**
 * Tracks which level/zone-within-level the player is currently building,
 * against LEVELS (see LevelStorage, populated from raw-assets/json/levels-config.json).
 * A level's `zones` array may define fewer entries than its `zoneCount` —
 * every zone past the authored array reuses the last one (see
 * getCurrentZoneConfig()). Once the last level is reached, its own last zone
 * repeats forever instead of advancing further — there's nothing after it.
 */
export class TowerLevelController {
    private levelIndex = 0;
    private zoneIndexInLevel = 0;

    public getLevelIndex(): number {
        return this.levelIndex;
    }

    /** 0-based zone index WITHIN the current level — resets to 0 every time the level itself advances. See TowerIslandProgression.resolveIslandForZone(), which uses this to step through an island's own skyGradient one zone at a time (rather than once per full level). */
    public getZoneIndexInLevel(): number {
        return this.zoneIndexInLevel;
    }

    public isFinalLevel(): boolean {
        return this.levelIndex >= LEVELS.length - 1;
    }

    public getCurrentZoneConfig(): LevelZoneConfig {
        return TowerLevelController.resolveZoneConfig(this.levelIndex, this.zoneIndexInLevel);
    }

    /**
     * Sum of world-px zone heights from the CURRENT zone (inclusive) through
     * the rest of the current level — i.e. how much further the base has to
     * climb before the level tier itself changes. On the final level there's
     * no "next level" to reach, so this is just the current zone's own
     * height (which keeps repeating from here on).
     */
    public getRemainingLevelHeight(blockHeight: number): number {
        if (this.isFinalLevel()) {
            return this.getCurrentZoneConfig().height * blockHeight;
        }

        const level = LEVELS[this.levelIndex];
        let total = 0;

        for (let i = this.zoneIndexInLevel; i < level.zoneCount; i++) {
            total += TowerLevelController.resolveZoneConfig(this.levelIndex, i).height * blockHeight;
        }

        return total;
    }

    public reset(): void {
        this.levelIndex = 0;
        this.zoneIndexInLevel = 0;
    }

    /** Call once the current zone's target line has been reached. Advances to the next zone, rolling over into the next level once zoneCount is exhausted. */
    public advanceZone(): ZoneAdvanceResult {
        const level = LEVELS[Math.min(this.levelIndex, LEVELS.length - 1)];
        this.zoneIndexInLevel++;

        if (level && this.zoneIndexInLevel >= level.zoneCount && !this.isFinalLevel()) {
            this.levelIndex++;
            this.zoneIndexInLevel = 0;

            return { leveledUp: true, levelIndex: this.levelIndex };
        }

        return { leveledUp: false, levelIndex: this.levelIndex };
    }

    private static resolveZoneConfig(levelIndex: number, zoneIndexInLevel: number): LevelZoneConfig {
        const level = LEVELS[Math.min(levelIndex, LEVELS.length - 1)];

        if (!level || level.zones.length === 0) {
            return FALLBACK_ZONE;
        }

        return level.zones[Math.min(zoneIndexInLevel, level.zones.length - 1)];
    }
}
