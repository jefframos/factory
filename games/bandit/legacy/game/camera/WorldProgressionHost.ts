// WorldProgressionHost.ts
//
// Hook point for chaining a world-progression check onto the END of a game
// milestone's own event — same structural-interface pattern as
// CameraFocusHost. BuildingZone calls notifyBuildingLevelUp() only AFTER its
// own popup+camera-visit+panel-refresh sequence has fully resolved (see
// BuildingZone.playLevelUpSequence()); CraftZone calls notifyItemCrafted()
// right after handing out a recipe's item — either way, the caller awaits
// this before considering itself done.
//
// This can't just be a second independent BuildingStorage.onLevelUp/
// ItemStorage.onChange listener (e.g. a GateManager subscribing directly) —
// that would fire at the exact same tick as the triggering zone's own
// listener, and two consumers both calling CameraFocusHost.focusCameraOn()
// around the same time would fight over the same cameraFocusPoint. Routing
// it through this callback instead guarantees "the triggering zone's own
// camera trip (if any) is fully done" happens before "check whether that
// milestone unlocked a gate" even starts.

import { BuildingId } from '../data/BuildingTypes';
import { ItemType } from '../crafting/ItemTypes';

export interface WorldProgressionHost {
    /**
     * `buildingId` just reached `level`, and its own level-up sequence (popup, camera visit,
     * panel refresh) has already fully played out. Resolves once any follow-up event this
     * triggers — e.g. a gate whose requirement `buildingId`/`level` just satisfied playing its
     * own camera-visit-and-collapse sequence — has ALSO fully resolved.
     */
    notifyBuildingLevelUp(buildingId: BuildingId, level: number): Promise<void>;

    /**
     * The player just received `item` from a completed craft recipe (see CraftZone.ts) —
     * ItemStorage has already been credited by the time this is called. Resolves once any
     * follow-up event this triggers — e.g. a gate whose requirement is owning `item` playing
     * its own unlock sequence — has ALSO fully resolved.
     */
    notifyItemCrafted(item: ItemType): Promise<void>;
}
