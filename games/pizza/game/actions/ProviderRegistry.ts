// ProviderRegistry.ts
//
// Resolves a ProviderType (the world dispenser — tree, stone deposit, berry
// bush, see ProviderTypes.ts) to its visual entry in AssetLibraryRegistry's
// ASSET_LIBRARY — same split ResourceRegistry.ts already does for items
// (gameplay numbers stay in *Types.ts, visual variance lives in
// AssetLibraryRegistry.ts, independent of either). See ResourceNode.awake()
// for how this gets consumed.
//
// This used to be a hand-maintained `Record<ProviderType, AssetLibraryKey>`
// — every entry in it (tree->tree, stone->stone, berryBush->berryBush) was
// already an identity mapping, because the pizza web editor's Providers tab
// writes a provider's icon/models/scale/rotationDeg into AssetLibraryRegistry
// under the SAME id as the provider itself (see entityMap.mjs's
// `externalFields` on the `providers` tab). A hand-maintained table just
// meant every NEW provider silently had no entry until someone remembered to
// add one here — exactly what happened creating a "palm" provider: its
// ASSET_LIBRARY entry existed (the editor wrote it fine), but this table
// didn't know about it, so ResourceNode.awake() indexed ASSET_LIBRARY with
// `undefined` and crashed reading `.models` off it. resolveProviderAssetKey()
// below is now a plain identity mapping instead, so a new provider Just
// Works the moment its AssetLibraryRegistry entry exists (which happens
// automatically the first time its Providers tab entry is saved) — no
// second manual registration step, here or anywhere else.

import { AssetLibraryKey } from '../world/AssetLibraryRegistry';
import { ProviderType } from './ProviderTypes';

export function resolveProviderAssetKey(providerType: ProviderType): AssetLibraryKey {
    return providerType as unknown as AssetLibraryKey;
}
