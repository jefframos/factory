// WorldProgressionHost.ts
//
// Hook point for chaining a world-progression check onto the END of a
// building's own level-up sequence — same structural-interface pattern as
// CameraFocusHost. BuildingZone calls notifyBuildingLevelUp() only AFTER its
// own popup+camera-visit+panel-refresh sequence has fully resolved (see
// BuildingZone.playLevelUpSequence()), and awaits it before considering
// itself done.
//
// This can't just be a second independent BuildingStorage.onLevelUp
// listener (e.g. a GateManager subscribing directly) — that would fire at
// the exact same tick as BuildingZone's own listener, and two consumers
// both calling CameraFocusHost.focusCameraOn() around the same time would
// fight over the same cameraFocusPoint. Routing it through this callback
// instead guarantees "the building's own camera trip is fully done" happens
// before "check whether that level-up unlocked a gate" even starts.

import { BuildingId } from '../data/BuildingTypes';

export interface WorldProgressionHost {
    /**
     * `buildingId` just reached `level`, and its own level-up sequence (popup, camera visit,
     * panel refresh) has already fully played out. Resolves once any follow-up event this
     * triggers — e.g. a gate whose requirement `buildingId`/`level` just satisfied playing its
     * own camera-visit-and-collapse sequence — has ALSO fully resolved.
     */
    notifyBuildingLevelUp(buildingId: BuildingId, level: number): Promise<void>;
}
