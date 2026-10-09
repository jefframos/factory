// StoreUnlockHints.ts
//
// "What does the next store level bring?" — the data behind the HUD's next-unlocks strip
// (ui/NextUnlocksUI.ts). Built from what the game already knows, so a level designer never
// writes it twice:
//   - the level's `enables` (Stores tab): every map id, read by what it is on the map — a farm
//     shows its crop, a storage its item, an animal stall / mix station its product with the
//     config's name, a farm desk, a trash bin, a building;
//   - buildings whose appearRequirement is reaching that store level (e.g. the hire office);
//   - zones whose requirement is reaching that store level ("New Area");
//   - the level's own `hints` (Stores tab) — anything else worth teasing (e.g. "Pickaxe").
// One chip per item: a farm and its storage selling the same crop make one chip.
//
// Results are cached per (store, level) — none of this changes at runtime.

import * as PIXI from 'pixi.js';
import { getStoreConfig, StoreLevelConfig } from './StoreTypes';
import type WorldObjectRegistry from '../world/WorldObjectRegistry';
import { getFarmPlotConfig } from '../data/FarmTypes';
import { CROP_CONFIG } from '../data/CropTypes';
import { getStorageConfig } from '../data/StorageTypes';
import { ANIMAL_STALL_CONFIG_BY_ID, DEFAULT_ANIMAL_STALL_CONFIG } from '../data/AnimalStallTypes';
import { getMixStationConfig } from '../data/MixStationTypes';
import { getFarmDeskConfig } from '../data/FarmDeskTypes';
import { BUILDING_CONFIG } from '../data/BuildingTypes';
import { BuildingId } from '../data/BuildingId';
import { ZONE_CONFIG } from '../data/ZoneTypes';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import type { MilestoneRequirement } from '../data/MilestoneRequirement';

/** Icons for the chips that have no item of their own — tweak here. */
export const UNLOCK_HINT_ICONS = {
    newArea: 'wilderness-map',
    trash: 'trash',
    farmDesk: 'Slider_Level02_Icon_Up_Green',
    building: 'ItemIcon_Shop_old-2',
};

export interface UnlockHint {
    /** Dedupe key — one chip per key. */
    key: string;
    icon: PIXI.Texture;
    label: string;
}

/** Map object types a level's `enables` can name, in the order their chip wins a shared key. */
const ENABLE_TYPES = ['animalStall', 'mixStation', 'farmDesk', 'building', 'farm', 'storage'] as const;

export default class StoreUnlockHints {
    private readonly worldObjects: WorldObjectRegistry;
    private readonly cache = new Map<string, UnlockHint[]>();

    public constructor(worldObjects: WorldObjectRegistry) {
        this.worldObjects = worldObjects;
    }

    /**
     * The first level above `currentLevel` that brings anything, and what it brings — undefined
     * when no later level does (the strip hides).
     */
    public findNext(storeId: string, currentLevel: number): { level: number; hints: UnlockHint[] } | undefined {
        const levels = [...(getStoreConfig(storeId).levels ?? [])]
            .filter(entry => entry.level > currentLevel)
            .sort((a, b) => a.level - b.level);
        for (const entry of levels) {
            const hints = this.hintsFor(storeId, entry);
            if (hints.length > 0) {
                return { level: entry.level, hints };
            }
        }
        return undefined;
    }

    private hintsFor(storeId: string, entry: StoreLevelConfig): UnlockHint[] {
        const cacheKey = `${storeId}:${entry.level}`;
        const cached = this.cache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const hints = new Map<string, UnlockHint>();
        const add = (hint: UnlockHint | undefined): void => {
            if (hint && !hints.has(hint.key)) {
                hints.set(hint.key, hint);
            }
        };
        const reachesThisLevel = (requirement: MilestoneRequirement | undefined): boolean =>
            requirement?.type === 'store' && requirement.storeId === storeId && requirement.level === entry.level;

        // Ordered so a stall/station chip (with its name) wins over the plain storage selling the same item.
        const enabled = (entry.enables ?? []).map(e => e.entityId).filter(Boolean);
        for (const type of ENABLE_TYPES) {
            for (const id of enabled) {
                if (this.worldObjects.get(type, id)) {
                    add(this.hintForEnabled(type, id));
                }
            }
        }
        for (const [id, building] of Object.entries(BUILDING_CONFIG)) {
            if (reachesThisLevel(building.appearRequirement)) {
                add(this.buildingHint(id as BuildingId));
            }
        }
        if (Object.values(ZONE_CONFIG).some(zone => reachesThisLevel(zone?.requirement))) {
            add({ key: 'newArea', icon: PIXI.Texture.from(UNLOCK_HINT_ICONS.newArea), label: 'New Area' });
        }
        for (const hint of entry.hints ?? []) {
            if (hint.label) {
                add({ key: `hint:${hint.label}`, icon: PIXI.Texture.from(hint.icon || UNLOCK_HINT_ICONS.building), label: hint.label });
            }
        }

        const result = [...hints.values()];
        this.cache.set(cacheKey, result);
        return result;
    }

    private hintForEnabled(type: typeof ENABLE_TYPES[number], id: string): UnlockHint | undefined {
        switch (type) {
            case 'animalStall': {
                const config = ANIMAL_STALL_CONFIG_BY_ID[id] ?? DEFAULT_ANIMAL_STALL_CONFIG;
                return this.itemHint(config.resourceType, config.name);
            }
            case 'mixStation': {
                const config = getMixStationConfig(id);
                return this.itemHint(config.resourceType, config.name);
            }
            case 'farmDesk':
                return { key: 'farmDesk', icon: PIXI.Texture.from(UNLOCK_HINT_ICONS.farmDesk), label: getFarmDeskConfig(id).name ?? 'Farm Manager' };
            case 'building':
                return BUILDING_CONFIG[id as BuildingId] ? this.buildingHint(id as BuildingId) : undefined;
            case 'farm': {
                const cropId = getFarmPlotConfig(id).assignedCropId;
                return cropId ? this.itemHint(CROP_CONFIG[cropId].yield.resourceType, CROP_CONFIG[cropId].name) : undefined;
            }
            case 'storage': {
                const config = getStorageConfig(id);
                if (config.trash) {
                    return { key: 'trash', icon: PIXI.Texture.from(UNLOCK_HINT_ICONS.trash), label: 'Trash Bin' };
                }
                return config.resourceType !== undefined && !config.collect ? this.itemHint(config.resourceType) : undefined;
            }
        }
        return undefined;
    }

    /** A chip for an item — keyed by the item, so its farm, storage and producer share one. */
    private itemHint(type: ResourceType, label?: string): UnlockHint {
        return {
            key: `item:${type}`,
            icon: getAssetIcon(resolveResourceAssetKey(type)),
            label: label ?? RESOURCE_CONFIG[type]?.label ?? type,
        };
    }

    private buildingHint(id: BuildingId): UnlockHint {
        const config = BUILDING_CONFIG[id];
        return {
            key: `building:${id}`,
            icon: PIXI.Texture.from(config.icon || config.floorLabelIcon || UNLOCK_HINT_ICONS.building),
            label: config.name || id,
        };
    }
}
