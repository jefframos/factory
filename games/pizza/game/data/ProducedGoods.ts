// ProducedGoods.ts
//
// Resources that only a built PRODUCER makes — an animal stall (AnimalStallTypes.ts's
// resourceType: eggs, milk) or a mix station (MixStationTypes.ts's resourceType: butter, bread)
// — and which of them can actually be had right now: a producer making it has been built
// (PizzaScene.setupAnimalStalls() / setupMixStations() call markProducing()). Store.ts's
// isObtainable() asks this, so store clients don't order eggs before the player has a chicken
// stall, or bread before there's a bread station.

import { ResourceType } from '../actions/ResourceTypes';
import { ANIMAL_STALL_CONFIG_BY_ID, DEFAULT_ANIMAL_STALL_CONFIG } from './AnimalStallTypes';
import { MIX_STATION_CONFIG_BY_ID } from './MixStationTypes';

const producing = new Set<ResourceType>();

export const ProducedGoods = {
    /** A built producer now makes `type`. */
    markProducing(type: ResourceType): void {
        producing.add(type);
    },

    /** True if any animal stall or mix station config produces `type`. */
    isProduced(type: ResourceType): boolean {
        return DEFAULT_ANIMAL_STALL_CONFIG.resourceType === type
            || Object.values(ANIMAL_STALL_CONFIG_BY_ID).some(config => config?.resourceType === type)
            || Object.values(MIX_STATION_CONFIG_BY_ID).some(config => config?.resourceType === type && !config.disabled);
    },

    /** True once a built producer makes `type`. */
    isProducing(type: ResourceType): boolean {
        return producing.has(type);
    },
};
