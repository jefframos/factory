// ResourceRegistry.ts
//
// Maps a gameplay ResourceType to its visual entry in AssetLibraryRegistry's
// ASSET_LIBRARY — the actual models/scale/rotation config lives there, kept
// separate from ResourceTypes.ts's RESOURCE_CONFIG (gameplay numbers: life,
// yield, respawn time) since visual variance grows independently of
// gameplay balance. See ResourceNode.awake() for how this gets consumed.

import { AssetLibraryKey } from '../world/AssetLibraryRegistry';
import { ResourceType } from './ResourceTypes';

export const RESOURCE_ASSET_KEYS: Record<ResourceType, AssetLibraryKey> = {
    [ResourceType.Tree]: 'tree',
    [ResourceType.Stone]: 'stone',
    [ResourceType.Berries]: 'berries',
    [ResourceType.Bark]: 'bark',
};
