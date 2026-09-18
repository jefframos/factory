// RoadSettings.ts
//
// Data for RoadDetailsBuilder's decorative props (electricity poles, street
// lights) lining a runner-style minigame's lane — read live, same
// "data/ is the single source of truth" convention as
// MinigameSettings.ts/CitySettings.ts.
//
// The sidewalk itself is NOT here anymore — it's a plain recentering rect
// (WorldEnvironment's own VisualFloorPatch.sidewalks, configured via
// MinigameSettings.RUNNER_FLOOR_SETTINGS), same "infinite" trick as the
// lane's own floor patch, instead of a road-tile model.

export interface RoadSettings {
    /** World units between each detail prop (alternating electricity pole / street light) placed along one side of the lane. */
    detailSpacing: number;
    /** World units of clearance from the lane's own edge out to where detail props sit. */
    detailOffset: number;
    /** Uniform scale multiplier applied to every detail prop, on top of its own native size. */
    detailScale: number;
}

export const ROAD_SETTINGS: RoadSettings = {
    detailSpacing: 20,
    detailOffset: 1.5,
    detailScale: 10,
};
