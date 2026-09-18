// CitySettings.ts
//
// Data for CityBuilder's decorative low-detail-building rows lining both
// minigames' lanes — read live, same "data/ is the single source of truth"
// convention as PlayerSettings.ts/MinigameSettings.ts.
//
// The MODELS.World.LowDetailBuilding* set isn't modeled at one consistent
// real-world scale or footprint — some are noticeably smaller/larger than
// others. `scale` is a single flat multiplier applied to every one of them
// (deliberately not normalized to a common height — a flat multiplier
// keeps each model's own natural proportions instead of stretching a short,
// wide one to match a tall, narrow one). CityBuilder still measures each
// building's own bounding box after loading (at that same scale) to know
// exactly how much room its footprint needs — see
// CityBuilder.buildCityRow()'s own doc.

export interface CitySettings {
    /** Uniform scale multiplier applied to every building, on top of its own native size. */
    scale: number;
    /** World units of open air kept between the lane's own play area (as given by each scene's own laneHalfWidth — see CityBuilder.buildCityRow()'s own doc) and the nearest edge of a building's actual (scaled, bounding-box) footprint. */
    padding: number;
    /** World units of gap left between one building's footprint and the next one's, along the lane — kept small so the row reads as a tightly-packed alley wall rather than scattered background props. */
    gap: number;
    /** World units of clear space before the first building, past the start line. */
    startOffset: number;
    /**
     * World units each building's own base sinks below y=0 — buildings use
     * the plain BendService (see CityBuilder.buildCityRow()'s own doc on
     * why), which only translates them rigidly, while the ground right in
     * front of them uses RunnerBendService's own sink/hill effect and can
     * dip away underneath. Sinking the building down by this much masks
     * that gap instead of leaving a visible sliver of empty air under it.
     */
    verticalOffset: number;
}

export const CITY_SETTINGS: CitySettings = {
    scale: 30,
    padding: 3,
    gap: 5,
    startOffset: 5,
    verticalOffset: 5,
};
