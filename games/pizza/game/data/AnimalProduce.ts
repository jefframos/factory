// AnimalProduce.ts
//
// Which resources an animal stall makes (AnimalStallTypes.ts's resourceType) and which of them
// can actually be had right now — a stall producing it has been built (PizzaScene.
// setupAnimalStalls() calls markProducing()). Store.ts's isObtainable() asks this, so store clients
// don't start ordering eggs before the player has a chicken stall.

import { ResourceType } from '../actions/ResourceTypes';
import { ANIMAL_STALL_CONFIG_BY_ID, DEFAULT_ANIMAL_STALL_CONFIG } from './AnimalStallTypes';

const producing = new Set<ResourceType>();

export const AnimalProduce = {
    /** A built stall now makes `type`. */
    markProducing(type: ResourceType): void {
        producing.add(type);
    },

    /** True if any stall config (default or by id) produces `type`. */
    isAnimalProduce(type: ResourceType): boolean {
        return DEFAULT_ANIMAL_STALL_CONFIG.resourceType === type
            || Object.values(ANIMAL_STALL_CONFIG_BY_ID).some(config => config?.resourceType === type);
    },

    /** True once a built stall produces `type`. */
    isProducing(type: ResourceType): boolean {
        return producing.has(type);
    },
};
