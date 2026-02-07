import * as PIXI from "pixi.js";
import { LevelData, WorldData, WorldManifestEntry } from "./HexTypes";

export class LevelDataManager {
    private static manifest: WorldManifestEntry[] = [];
    private static worlds: Map<string, WorldData> = new Map();
    private static flatLevels: LevelData[] = [];

    private static levelToWorldMap: Map<string, string> = new Map();
    private static _currentLevel: LevelData | null = null;
    private static _currentWorldId: string = "";

    /**
     * Standard init for multi-file loading (Manifest + separate world files)
     */
    public static init(manifestData: any, worldFilesData: Record<string, any>): void {
        const worlds: WorldData[] = [];
        const manifestEntries = manifestData.worlds || [];

        manifestEntries.forEach((entry: WorldManifestEntry) => {
            const levels = worldFilesData[entry.levelFile]?.levels || [];
            worlds.push({
                ...entry,
                levels: levels
            });
        });

        this.initFromWorlds(worlds);
    }

    /**
     * Direct init from an array of full WorldData objects.
     * Use this when the server sends the fully merged data.
     */
    public static initFromWorlds(worldsMetadata: any[]): void {
        this.worlds.clear();
        this.manifest = [];
        this.flatLevels = [];

        worldsMetadata.forEach(meta => {
            // 1. Determine the filename for the levels (e.g., "world_forest.json")
            const fileName = meta.levelFile || `${meta.id}.json`;

            // 2. Grab the actual levels from PIXI cache using that filename
            // This assumes the level files were loaded with these exact names
            const worldFileContent = PIXI.Assets.get('game/' + fileName);
            const levels = worldFileContent?.levels || [];

            // 3. Construct the full WorldData object
            const worldData: WorldData = {
                id: meta.id,
                name: meta.name,
                enabled: meta.enabled ?? true,
                icon: meta.icon || "",
                background: meta.background || "",
                levelFile: fileName,
                customData: meta.customData || {},
                levels: levels
            };

            // 4. Store manifest metadata
            this.manifest.push({
                id: worldData.id,
                name: worldData.name,
                icon: worldData.icon,
                background: worldData.background,
                enabled: worldData.enabled,
                levelFile: worldData.levelFile,
                customData: worldData.customData
            });

            // 5. Store in Map
            this.worlds.set(worldData.id, worldData);

            // 6. Build flat array for random access
            levels.forEach(lvl => {
                this.levelToWorldMap.set(lvl.id, meta.id);
                this.flatLevels.push(lvl);
            });
        });

        console.log(`LevelDataManager initialized: ${this.worlds.size} worlds, ${this.flatLevels.length} total levels.`);
    }

    public static getRandomLevel(): LevelData | null {
        let level: LevelData | null = null;
        if (this.flatLevels.length > 0) {
            const index = Math.floor(Math.random() * this.flatLevels.length);
            level = this.flatLevels[index];
        }

        if (!level) {
            const firstWorld = this.getWorlds()[0];
            if (firstWorld?.levels?.length > 0) {
                level = firstWorld.levels[0];
            }
        }

        if (level) {
            this._currentLevel = level;
            this._currentWorldId = this.levelToWorldMap.get(level.id) || "unknown";
        }
        return level;
    }
    public static getCurrentLevelInfo() {
        return {
            worldId: this._currentLevel,
            level: this._currentWorldId
        };
    }

    public static getWorlds(): WorldData[] {
        return Array.from(this.worlds.values());
    }

    public static getWorld(worldId: string): WorldData | null {
        return this.worlds.get(worldId) || null;
    }
    // Add this inside the LevelDataManager class
    public static moveLevel(worldId: string, index: number, direction: -1 | 1): number {
        const world = this.worlds.get(worldId);
        if (!world || !world.levels) return index;

        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= world.levels.length) return index;

        // Swap levels
        const temp = world.levels[index];
        world.levels[index] = world.levels[newIndex];
        world.levels[newIndex] = temp;

        // Since flatLevels is used for random access, rebuild it
        this.rebuildFlatLevels();

        return newIndex;
    }
    // Add to LevelDataManager class
    public static moveWorld(worldId: string, direction: -1 | 1): void {
        const worldList = this.getWorlds();
        const index = worldList.findIndex(w => w.id === worldId);
        const newIndex = index + direction;

        if (newIndex < 0 || newIndex >= worldList.length) return;

        // Swap in the internal Map requires rebuilding the map to maintain order 
        // since JS Maps iterate in insertion order
        const entries = Array.from(this.worlds.entries());
        const temp = entries[index];
        entries[index] = entries[newIndex];
        entries[newIndex] = temp;

        this.worlds = new Map(entries);

        // Update manifest to match new order
        this.manifest = entries.map(([id, data]) => ({
            id: data.id,
            name: data.name,
            icon: data.icon,
            background: data.background,
            enabled: data.enabled,
            levelFile: data.levelFile,
            customData: data.customData
        }));
    }
    public static updateWorld(worldId: string, data: Partial<WorldData>) {
        const world = this.worlds.get(worldId);
        if (world) {
            Object.assign(world, data);
            this.rebuildFlatLevels();
        }
    }

    private static rebuildFlatLevels(): void {
        this.flatLevels = [];
        this.worlds.forEach(w => {
            if (w.levels) this.flatLevels.push(...w.levels);
        });
    }


    public static addWorld(world: WorldData) {
        this.worlds.set(world.id, world);
        this.rebuildFlatLevels();
    }



    public static deleteWorld(worldId: string) {
        const world = this.worlds.get(worldId);
        if (world) {
            // Remove level IDs from the lookup map
            world.levels.forEach(lvl => this.levelToWorldMap.delete(lvl.id));

            // Remove the world itself
            this.worlds.delete(worldId);

            // Rebuild the flat levels array for the gameplay side
            this.rebuildFlatLevels();
        }
    }


    public static getEnabledWorlds(): WorldData[] {
        return this.getWorlds().filter(w => w.enabled);
    }


}