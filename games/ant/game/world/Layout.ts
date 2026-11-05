// Layout.ts
//
// Where everything goes on the board, measured off the reference (a 1080 x 1920 portrait screen) at 40 px per world
// unit: x across from the screen's middle, z down from its top. The camera frames exactly that screen (SCREEN), so on a
// phone the board lands where it does in the reference: the picture's tray across the top, the anthill under it, the
// slots, then the tile columns running off the bottom.

const PX = 1 / 40;

export const LAYOUT = {
    /** The screen the camera frames (world units) and its middle (z). */
    screen: { width: 1080 * PX, height: 1920 * PX, centreZ: 960 * PX },
    /** The tray: its middle (z), and the most the picture inside it can take (width, depth). */
    trayZ: ((180 + 925) / 2) * PX,
    pictureMax: { width: 768 * PX, depth: 664 * PX },
    /** The cream rim between the picture and the tray's edge, where the ants walk. */
    rim: 46 * PX,
    /** The anthill (and its wooden lid beside it). */
    holeZ: 1030 * PX,
    holeRadius: 62 * PX,
    lidX: 112 * PX,
    /** The slots' row, and the gap between two slots' middles. */
    slotsZ: 1270 * PX,
    slotGap: 162 * PX,
    /** The tiles: first row, gap between rows and columns, a tile's footprint. */
    gridZ: 1455 * PX,
    rowGap: 170 * PX,
    columnGap: 162 * PX,
    tile: 128 * PX,
};
