// LaneSettings.ts
//
// Data for the discrete-lane swipe-runner corridor (see SwipeRunnerController
// and ControllerScene's swipe-lane trigger pair) — how many lanes, how wide
// each one is, and what color marks each one on the floor. ControllerScene
// reads this directly for both the visible lane rectangles AND the values
// passed to SwipeRunnerController.activate(), so the two can never drift
// out of alignment (see LaneMath.ts's own doc on that).

export interface LaneSettings {
    /** Number of discrete lanes. */
    count: number;
    /** World units between adjacent lane centers — also each lane's own rectangle width, so adjacent lanes tile edge-to-edge with no gaps. */
    width: number;
    /** One color per lane, by index — cycles (via modulo) if there are more lanes than colors. */
    colors: number[];
}

export const LANE_SETTINGS: LaneSettings = {
    count: 3,
    width: 2.5,
    colors: [0xff5252, 0x4caf50, 0x448aff],
};
