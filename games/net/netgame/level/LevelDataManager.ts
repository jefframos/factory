import * as PIXI from "pixi.js";
import { LevelConfig } from "./LevelTypes";

export interface WorldDefinition {
    id: string;
    name: string;
    icon: string;
    background: string;
    enabled: boolean;
    levelFile: string;
    customData: any;
    levels?: LevelConfig[]; // Populated during load
}

export class LevelDataManager {
    private static _instance: LevelDataManager;
    private _worlds: WorldDefinition[] = [];
    private _baseUrl: string = "assets/data/"; // Base path for JSONs

    private constructor() { }

    public static get instance(): LevelDataManager {
        if (!this._instance) this._instance = new LevelDataManager();
        return this._instance;
    }

    /**
     * Loads the world list and all associated level files
     */
    public init(worldsManifestKey: string): void {
        try {
            // 1. Get the main world manifest from PIXI Cache
            const manifest = PIXI.Cache.get(worldsManifestKey);

            if (!manifest) {
                console.error(`LevelDataManager: Manifest not found in cache for key: ${worldsManifestKey}`);
                return;
            }

            // 2. Map and filter enabled worlds
            this._worlds = manifest.worlds.filter((w: WorldDefinition) => w.enabled);

            // 3. Populate levels for each world from the cache
            this._worlds.forEach((world) => {
                // We use the levelFile filename (or the key you used in Assets.add)
                // If you loaded them via Assets.load(world.levelFile), the key is the path/filename
                const lvlData = PIXI.Cache.get(world.levelFile);

                if (lvlData) {
                    world.levels = lvlData.levels;
                } else {
                    console.warn(`LevelDataManager: Level data missing in cache for: ${world.levelFile}`);
                    world.levels = [];
                }
            });

            console.log("LevelDataManager: Successfully initialized from PIXI Cache.");
        } catch (e) {
            console.error("LevelDataManager: Initialization failed", e);
        }
    }

    /**
     * Get a level using World Index and Level Index
     * Example: getLevel(0, 5) -> World 1, Level 6
     */
    public getLevel(worldIdx: number, levelIdx: number): LevelConfig | null {
        return this._worlds[worldIdx]?.levels?.[levelIdx] || null;
    }

    /**
     * Get a level by its Global Index (Total sum of all levels)
     * Useful for a linear "Level 1 to 100" progression
     */
    public getLevelByGlobalIndex(globalIdx: number): LevelConfig | null {
        let count = 0;
        for (const world of this._worlds) {
            const levels = world.levels || [];
            if (globalIdx < count + levels.length) {
                return levels[globalIdx - count];
            }
            count += levels.length;
        }
        return null;
    }
    // Inside LevelDataManager
    public getAddressFromGlobalIndex(globalIdx: number): { worldIdx: number, levelIdx: number } | null {
        let count = 0;
        for (let w = 0; w < this._worlds.length; w++) {
            const len = this._worlds[w].levels?.length || 0;
            if (globalIdx < count + len) {
                return { worldIdx: w, levelIdx: globalIdx - count };
            }
            count += len;
        }
        return null;
    }
    /**
     * Returns the global display number for a level
     */
    public getGlobalId(worldIdx: number, levelIdx: number): number {
        let total = 0;
        for (let i = 0; i < worldIdx; i++) {
            total += this._worlds[i].levels?.length || 0;
        }
        return total + levelIdx + 1;
    }

    public get worlds(): WorldDefinition[] { return this._worlds; }
}