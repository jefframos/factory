// LaneMath.ts
//
// Single source of truth for mapping a lane INDEX to a world-space lateral
// offset — shared by SwipeRunnerController (which drives the player toward
// it) and SwipeMinigameScene (which draws the lane markers at the same
// offsets), so the visible lanes and the ones the controller actually
// snaps to can never silently drift out of alignment.

/** `index` 0..laneCount-1, `laneWidth` world units between adjacent lane centers. Centered on 0 — for an odd laneCount the middle lane's own offset is exactly 0. */
export function laneOffset(index: number, laneCount: number, laneWidth: number): number {
    return (index - (laneCount - 1) / 2) * laneWidth;
}
