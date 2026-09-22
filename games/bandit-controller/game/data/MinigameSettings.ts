// MinigameSettings.ts
//
// Data for the two dedicated minigame scenes (RunnerMinigameScene,
// SwipeMinigameScene) — read live, same "data/ is the single source of
// truth" convention as PlayerSettings.ts/WorldSettings.ts.

import * as THREE from 'three';

/**
 * Shared world-forward direction both runner-style minigames move along —
 * matches every runner-flavored camera preset's own yawDeg: 0 convention
 * (GameSettings.ts) — the camera and the lane's own forward have to agree,
 * or the camera looks the wrong way down the lane.
 */
export const RUNNER_LANE_DIRECTION = new THREE.Vector3(0, 0, -1);

export interface RunnerMinigameSettings {
    /** World units from the start gate to the finish gate — reaching it ends the minigame (see RunnerMinigameScene). */
    laneLength: number;
    /**
     * World-units/second constant forward pace for THIS minigame specifically —
     * deliberately separate from PlayerSettings.walkSpeed/runSpeedMultiplier
     * (which still govern the hub's own free-roam walk/run). Passed into
     * MainPlayer as a `getMoveSpeed` override (see WorldEnvironment.spawnPlayer()'s
     * own doc) rather than sharing the hub's speed function, so tuning one
     * never accidentally changes the other.
     */
    forwardSpeed: number;
}

export const RUNNER_MINIGAME_SETTINGS: RunnerMinigameSettings = {
    laneLength: 400,
    forwardSpeed: 13,
};

export interface SwipeMinigameSettings {
    /** Fixed real-time seconds the swipe-lane minigame runs before it ends and returns to the hub — a timer rather than a finish line, so a session always has a known, short length regardless of how well the player dodges/paces themselves. */
    durationSec: number;
    /** How many discrete lanes, and how wide (world units) each one is — same values LANE_SETTINGS.ts used to hold back when this ran as a corridor inside the hub. */
    laneCount: number;
    laneWidth: number;
    /** One color per lane, by index — cycles (via modulo) if there are more lanes than colors. */
    laneColors: number[];
    /** Same idea as RunnerMinigameSettings.forwardSpeed — this minigame's own constant forward pace, independent of both the hub AND RunnerMinigameScene's own speed. */
    forwardSpeed: number;
}

export const SWIPE_MINIGAME_SETTINGS: SwipeMinigameSettings = {
    durationSec: 25,
    laneCount: 3,
    laneWidth: 2.5,
    laneColors: [0xff5252, 0x4caf50, 0x448aff],
    forwardSpeed: 15,
};

export interface RunnerFloorSettings {
    /** World units — the LOGICAL/physics-collider floor size (WorldEnvironment's own floorSize param), must comfortably exceed whichever minigame's own lane length/duration*speed runs the farthest, or the player runs off the edge of the ground collider before reaching the finish gate / the timer running out. This is NOT how big the VISIBLE floor mesh is — see patchSize/patchSegments. */
    size: number;
    /** World units per side of the small, densely-tessellated visual floor patch that stays snapped/centered under the player as they move (see WorldEnvironment.recenterFloorPatch()'s own doc) — independent of `size` above, and can be far smaller since it only ever needs to cover the ground actually visible around the player. */
    patchSize: number;
    /** Vertices per side of that patch — much higher than a full-level floor mesh could ever afford. patchSize/patchSegments is also the world-unit size of the patch's own grid cell, i.e. the increment it snaps by each time it recenters — keeping that equal to FloorBuilder's 1-world-unit grid-texture repeat (patchSize === patchSegments) is what keeps the snap itself invisible. */
    patchSegments: number;
    /** World units wide, each of the two raised sidewalk boxes running alongside the patch (see WorldEnvironment.VisualFloorPatch.sidewalks' own doc) — recenters in lockstep with the main patch, Z-only. */
    sidewalkWidth: number;
    /** World units of clearance from the lane's own edge out to the near edge of each sidewalk box. */
    sidewalkOffset: number;
    /** World units each sidewalk box sits ABOVE street level (its own base is at y=0, top at y=sidewalkHeight) — see FloorBuilder.buildBox()'s own doc on why it needs real height to read as a distinct shape. */
    sidewalkHeight: number;
}

/** Shared by both minigame scenes (see WorldEnvironment's own floorSize/visualFloorPatch constructor params) — the hub keeps WorldEnvironment's plain default (a single static, FLOOR_SIZE-wide floor, no recentering, no sidewalks). */
export const RUNNER_FLOOR_SETTINGS: RunnerFloorSettings = {
    size: 900,
    patchSize: 120,
    patchSegments: 120,
    sidewalkWidth: 50,
    sidewalkOffset: 1,
    sidewalkHeight: 0.25,
};

/**
 * Layout only (spacing/offset down the lane) — see OBSTACLE_KINDS below for what actually
 * gets PLACED at each of those spots (shape/height/color).
 */
export interface ObstacleLayoutSettings {
    /** World units from the start line to the first obstacle — gives the player a moment to get moving before anything can hit them. */
    startOffset: number;
    /** World units between one obstacle and the next along the lane. */
    spacing: number;
    /** RunnerMinigameScene only: how far (world units) alternating obstacles sit from the lane's own centerline — leaves room to steer around on the opposite side each time (see RunnerMinigameScene's own placement code). */
    runnerLateralOffset: number;
}

export const OBSTACLE_SETTINGS: ObstacleLayoutSettings = {
    startOffset: 30,
    spacing: 40,
    runnerLateralOffset: 2,
};

/**
 * Layout for the floating coins both minigame scenes scatter down the lane (see
 * CollectibleBuilder.spawnCollectible(), CollectibleSettings.COIN) — deliberately a much
 * tighter grid than OBSTACLE_SETTINGS' own, so there's several to grab per obstacle rather
 * than one every 40 units.
 */
export interface CoinLayoutSettings {
    /** World units from the start line to the first coin. */
    startOffset: number;
    /** World units between one coin and the next along the lane. */
    spacing: number;
    /** World units off the ground each coin floats at — comfortably within the attract radius (COLLECTIBLE_TUNING.attractRadius) of a player standing, running, or sliding underneath. */
    height: number;
}

export const COIN_SETTINGS: CoinLayoutSettings = {
    startOffset: 10,
    spacing: 20,
    height: 1.2,
};

/**
 * One box within an ObstacleKind (see below) — ObstacleBuilder.buildObstacle() gets called
 * once per piece, all at the same (x, z), so a kind with more than one piece is several
 * independent boxes stacked/offset in Y, each with its own color and its own top-landing
 * platform + hit trigger. `baseY` is ObstacleBuilder's own `baseY` option — 0 sits on the
 * ground (jump over/land on), a positive value floats it with open air (no collider at all)
 * below, e.g. for a duck-under bar or a walk-under tunnel roof.
 */
export interface ObstaclePiece {
    baseY: number;
    halfExtents: THREE.Vector3;
    color: number;
    /** ObstacleBuilder's own `hazard` option — false for a piece that's purely a landable bonus platform (e.g. TUNNEL), never something that ends the run on contact. Omitted (undefined) means true, same as ObstacleOptions' own default. */
    hazard?: boolean;
}

/** One placeable obstacle "design" — one or more ObstaclePiece boxes together. See buildObstacleKind() in ObstacleBuilder.ts, and OBSTACLE_KINDS below for the actual catalog both minigame scenes cycle through. */
export interface ObstacleKind {
    id: string;
    label: string;
    pieces: ObstaclePiece[];
    /**
     * True for a kind that's placed ONCE, centered across the FULL width of the lane/corridor
     * — RunnerMinigameScene places it on the centerline instead of alternating left/right,
     * and SwipeMinigameScene places one copy spanning every lane (including the "open" one)
     * instead of one copy per blocked lane. Only makes sense paired with `hazard: false`
     * pieces (see TUNNEL) — a spans-all-lanes piece a player could actually be HIT by would
     * leave no way through at all. Default false (every other kind occupies one lane/spot).
     */
    spansAllLanes?: boolean;
}

/**
 * Every jump-over/land-on HAZARD piece (baseY: 0, or any piece a player is expected to CLEAR
 * by jumping rather than walking/sliding under) MUST stay tuned against PlayerSettings.
 * jumpSpeed/WorldSettings.gravity and both minigames' own forwardSpeed, or a "clean" jump
 * becomes impossible to land: at the apex of a jump, the player is only above a given height
 * for a short window — time_above_height = (2 / |gravity|) * sqrt(jumpSpeed^2 - 2 * |gravity|
 * * height) — and during that whole window they're still moving forward at whichever
 * minigame's forwardSpeed, so they need to fully CROSS the piece's own depth (2 *
 * halfExtents.z) before that window closes. With this file's numbers (jumpSpeed 16.4, apex
 * ~4.48, gravity -30): a height-2 piece gives time_above_height = 0.814s, covering ~12 world
 * units at the faster minigame's own 15 u/s forwardSpeed — BOX/STACKED below stay well under
 * that (1-2 unit depths), so an ordinary jump timed anywhere reasonably close still clears
 * them, not just a frame-perfect one. TRAIN is the one exception: even at height 4 (time_
 * above_height only 0.359s, ~5.4 units) it's still deliberately much deeper (12 units) than
 * that window could ever cover, so a jump onto it always either lands on top (the intent) or
 * hits its face — never a clean fly-over. Meant to be LANDED ON and ridden across, not flown
 * over in one bound — see its own comment below.
 *
 * A floating piece (baseY > 0) has a DIFFERENT constraint depending on `hazard`: a duck-under
 * HAZARD (SLIDE_BAR) needs its own `bottomY` to clear the player's full SLIDE height (2 *
 * PlayerSettings.slideHalfHeight = 0.7) so ducking always passes under it, while staying
 * below their full STAND height (2 * PlayerSettings.standHalfHeight = 1.8) so standing tall
 * never sneaks under by accident. A non-hazard bonus platform (TUNNEL) instead wants its own
 * TOP reachable only from an elevated start (see TUNNEL's own comment) — nothing stops a
 * plain jump from physically touching its underside since `hazard: false` means that can
 * never end the run either way.
 *
 * Colors are deliberately distinct per kind so they're easy to tell apart at a glance while
 * tuning — swap freely, this is a first pass meant to be played with.
 */
export const OBSTACLE_KINDS: ObstacleKind[] = [
    {
        id: 'box',
        label: 'Box',
        pieces: [
            { baseY: 0, halfExtents: new THREE.Vector3(1, 1, 1), color: 0xb5342a }, // red
        ],
    },
    {
        id: 'train',
        label: 'Train',
        pieces: [
            // Height 4 (halfExtents.y 2) — tall enough that landing on its roof is a real,
            // deliberate jump (PlayerSettings.jumpSpeed is tuned for a ~4.48 apex specifically
            // so this is reachable with a bit of margin, not razor-precise), not an
            // incidental hop. Same width as before (halfExtents.x 1). MUCH longer than a
            // jump-over hazard would ever need (halfExtents.z 6, full length 12) — this is
            // deliberately un-clearable in one bound (see this file's own margin-math doc
            // above). Meant to be LANDED ON from the front (same platform-landing mechanic as
            // any other piece) and ridden/run across, most often as the elevated stepping
            // stone up to a following TUNNEL's own roof — see TUNNEL's own comment for why
            // that hop needs a boost like this to reach it.
            { baseY: 0, halfExtents: new THREE.Vector3(1, 2, 15), color: 0x2f6fd6 }, // blue
        ],
        // Placed adjacent to the TUNNEL entry below (see both scenes' buildObstacles()) —
        // reorder either entry here to change which pairs with which; nothing enforces the
        // pairing beyond sitting next to each other in this array.
    },
    {
        id: 'tunnel',
        label: 'Tunnel',
        spansAllLanes: true,
        pieces: [
            // `hazard: false` — this is a BONUS elevated platform, not something to dodge:
            // running straight underneath never ends the run, whether or not you're ducked.
            // topY (5.0) is TRAIN's own height (4) plus 1 — tall enough that a train sitting
            // right underneath (see TRAIN_TUNNEL_OVERLAP's own doc — the two overlap in Z)
            // never visually pokes through the roof, and well above a plain jump's own ~4.48
            // apex, so reaching the roof directly from the ground isn't possible — it needs
            // a boost, normally from landing on a TRAIN first (jump onto its own roof at
            // height 4, then jump AGAIN from there: apex is always the same ~4.48 above
            // wherever you jump FROM, so 4 + 4.48 = 8.48, comfortably clearing this roof's
            // own 5.0). halfExtents.x (3.6, full width 7.2) deliberately covers every lane at
            // once (see ObstacleKind.spansAllLanes's own doc) — a tunnel roof spanning only
            // part of the corridor wouldn't read as a tunnel. Kept just under
            // SwipeMinigameScene's own full corridor width (laneCount * laneWidth = 7.5) so
            // it doesn't overhang past the sidewalks there.
            { baseY: 5.5, halfExtents: new THREE.Vector3(3.6, 0.4, 20), color: 0x6b7c93, hazard: false }, // steel gray
        ],
    },
    {
        id: 'slide-bar',
        label: 'Slide Bar',
        pieces: [
            { baseY: 1, halfExtents: new THREE.Vector3(1, 0.5, 1), color: 0xf5c542 }, // gold
        ],
    },
    {
        id: 'stacked',
        label: 'Stacked (Box + Box)',
        pieces: [
            // Two independent pieces sharing one (x, z) footprint, each with its own color —
            // demonstrates that a kind isn't limited to one box. Combined height (2) and
            // depth (1 each) match plain Box's own jump-over margin exactly, so this is
            // still a clean, fair jump — only the two-tone silhouette is different. Swap
            // either piece's own baseY/halfExtents/color (or add a third) to build fancier
            // combos, e.g. a low base topped by a floating piece well above the ~2.8 jump
            // apex so it can never be clipped mid-jump.
            { baseY: 0, halfExtents: new THREE.Vector3(1, 0.5, 1), color: 0xb5342a }, // red base
            { baseY: 1, halfExtents: new THREE.Vector3(1, 0.5, 1), color: 0xe67e22 }, // orange top
        ],
    },
];

/** Widest single piece across every registered kind — RunnerMinigameScene uses this (rather than any one kind's own width) to size the lane/sidewalks so the WIDEST obstacle that could ever get placed still fits, regardless of which kind ends up at a given spot. */
export function maxObstacleHalfWidth(): number {
    return Math.max(...OBSTACLE_KINDS.flatMap(kind => kind.pieces.map(piece => piece.halfExtents.x)));
}

/**
 * World units of intentional overlap between a TRAIN and an immediately-following TUNNEL
 * (see both scenes' own buildObstacles()) — placed flush against the train's own far end
 * MINUS this, rather than exactly flush, so there's no seam of open air a player riding the
 * train across could catch a foot on or fall through right at the handoff. Only used for a
 * 'tunnel' entry that directly follows a 'train' entry in OBSTACLE_KINDS above; every other
 * pairing still uses the plain per-slot OBSTACLE_SETTINGS.spacing grid.
 */
export const TRAIN_TUNNEL_OVERLAP = 2;

/**
 * World units a RAMP (RampBuilder.buildRamp()) climbs across before reaching a TRAIN's own
 * front face — see both scenes' own buildObstacles(), which place one flush against the near
 * side of every 'train' entry so the player can walk straight up onto its roof (height 4) at
 * a run instead of needing to time a jump. 8 units over a rise of 4 is a ~27deg incline —
 * walkable-reading, not a wall. Only wired up for TRAIN specifically (the one kind tall enough
 * that reaching its own top by jumping alone is the point, not a given — see OBSTACLE_KINDS'
 * own margin-math doc above); nothing stops pairing a ramp with another kind by hand later.
 */
export const RAMP_LENGTH = 8;
/** Visual color for every ramp — same "distinct per kind" reasoning as OBSTACLE_KINDS' own colors, deliberately different from TRAIN's blue so the two read as separate pieces even though they're placed flush against each other. */
export const RAMP_COLOR = 0x9aa5b1;
