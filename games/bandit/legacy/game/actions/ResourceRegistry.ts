// ResourceRegistry.ts
//
// Resolves a gameplay ResourceType to its visual entry in AssetLibraryRegistry's
// ASSET_LIBRARY — the actual models/scale/rotation config lives there, kept
// separate from ResourceTypes.ts's RESOURCE_CONFIG (gameplay numbers: life,
// yield, respawn time) since visual variance grows independently of
// gameplay balance. See ResourceNode.awake()/LooseResourceNode.awake() for
// how this gets consumed.
//
// This used to be a hand-maintained `Record<ResourceType, AssetLibraryKey>`
// — every entry (wood->wood, stone->stone, ...) was already an identity
// mapping, because the pizza web editor's Resources tab writes a resource's
// icon/models/scale/rotationDeg into AssetLibraryRegistry under the SAME id
// as the resource itself (see entityMap.mjs's `externalFields` on the
// `resources` tab). A hand-maintained table just meant every NEW resource
// type had no entry here until someone remembered to add one — see
// ProviderRegistry.ts's own doc for the exact crash this caused when the
// same pattern bit a newly-added provider. resolveResourceAssetKey() below
// is a plain identity mapping instead, so a new resource type Just Works
// the moment its AssetLibraryRegistry entry exists (created automatically
// the first time its Resources tab entry is saved).

import { AssetLibraryKey } from '../world/AssetLibraryRegistry';
import { ResourceType } from './ResourceTypes';

export function resolveResourceAssetKey(resourceType: ResourceType): AssetLibraryKey {
    return resourceType as unknown as AssetLibraryKey;
}
