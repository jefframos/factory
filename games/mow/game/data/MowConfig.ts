// MowConfig.ts
//
// Typed access to the design data, none of it in code: ui/mow.json (grass types, tools, upgrades, prices) and
// the current city's level (levels/<level>.json: the layout: sections = districts with their grass mix, bonus,
// stations and separator; props; pavements), which the editor writes (npm run editor). MOW.districts is the level's
// sections. The cities (levels/cities.json, CITIES) are each their own level; which one is played is saved
// (MowProgress, CURRENT_CITY_KEY) and read here, before anything is built: travelling reloads the game into it.

import { RoadCells, RoadKit, roadNetwork, solveRoads } from 'core/roads/RoadGrid';
import data from '../../ui/mow.json';
import cities from '../../levels/cities.json';
import tutorial from '../../levels/tutorial.json';
import town from '../../levels/town.json';
import city2 from '../../levels/city2.json';

export interface GrassDef {
    id: string;
    name: string;
    /** Uncut height (world units). */
    height: number;
    color: string;
    /** The mowed stub's colour. */
    cutColor: string;
    /** Cutting power needed; a tool below it chews through it slowly (MowDesign.chewSec), too far below not at all. */
    resistance: number;
    /** Clippings per cell. */
    value: number;
}

/**
 * What grows past grass (ui/mow.json `growth`): a bush to dig out or a tree to chop down, on the same ladder as the
 * grass (its `resistance` the cutting power it takes, `value` its clippings), placed per section (DistrictDef.growth).
 */
export interface GrowthDef extends GrassDef {
    kind: 'bush' | 'tree' | 'rock';
    /** Its models (under models/): one picked per plant. */
    models: string[];
    /** How wide it stands (its solid core is part of it), at its height. */
    radius: number;
    /** Seconds of chewing to clear it with a mower as tough as it (more power: quicker; one short: much slower). */
    chewSec: number;
    /** A colour multiplied into its model's (a darker dense bush, an older tree). */
    tint?: string;
}

export interface ToolDef {
    id: string;
    name: string;
    /** The camera's distance (x the section's zoom) while mowing with it (the farm test); unset: from its cut width. */
    cameraZoom?: number;
    /** Cutting width (world units). */
    width: number;
    /** Walking speed. */
    speed: number;
    power: number;
    /** Clippings the container holds. */
    capacity: number;
    price: number;
    /** The placeholder cube: width, height, length (world units), colour. */
    size: [number, number, number];
    color: string;
    /** Runs an engine (sound). */
    engine?: boolean;
    /** A manual reel mower (the first tool): a spinning bladed barrel between two wheels instead of a deck. */
    reel?: boolean;
    /** Driven: the tractor (`tractor`), mounted in sections not restored yet (TractorRide). */
    ride?: boolean;
    /** The tractor's size for this mower (1 = `tractor.height`). */
    rideScale?: number;
    /** Ridden mowers: the tractor in grey (dig's Digger). */
    greyscale?: boolean;
    /** Ridden mowers: the tractor repainted in this colour (dig's Tractor / Red Tractor; wins over `greyscale`). */
    tint?: string;
    /** Walked tools: where the hands hold it (edited in the editor's Mowers tab; MowPlayer's defaults without). */
    grip?: GripDef;
    /** Pushed tools: the gap between the feet and the deck's back edge. */
    gap?: number;
}

/**
 * Where the hands hold a walked tool, from the player's feet: `forward` ahead, `height` up, each hand `spread` off the
 * middle. The mower's handle crossbar sits there (rails down to the deck's back corners, or a reel's axle).
 */
export interface GripDef {
    forward: number;
    height: number;
    spread: number;
    /** The hands' turn on the bar (degrees, on top of their rest pose; the left hand's, mirrored for the right). */
    hand?: { x: number; y: number; z: number };
    /** Where the hands reach, moved off the bar (player space: x outward for each hand, y up, z forward). */
    offset?: { x: number; y: number; z: number };
    /** The right hand mirrors the left's turn (default); off: both take the same turn. */
    mirror?: boolean;
}

/** The ridden mowers' tractor (dig's tractor config; edited in the editor's Tractor tab). */
export interface TractorConfig {
    /** Path under public/mow/models/. */
    model: string;
    /** Fitted to this height, turned by rotationY so its front faces +Z. */
    height: number;
    rotationY: number;
    /** The player's footprint against obstacles while riding. */
    bodyRadius: number;
    /** It cuts from under it to this far ahead (x the mower's rideScale). */
    cutAhead: number;
    /** Where the player's feet go (in its frame, x rideScale). */
    seat: { x: number; y: number; z: number };
    /** The puff on getting on / off. */
    smoke: { count: number; size: number; color: string };
    /** Puffs from the exhaust while it moves. */
    exhaust: { x: number; y: number; z: number; interval: number; size: number };
    /**
     * The steering wheel the hands hold (in its frame, x rideScale): its middle, the hands `spread` either side, turned
     * by `hand` (degrees, like a mower's grip). None: the hands stay as the sitting pose has them.
     */
    steer?: { x: number; y: number; z: number; spread: number; hand?: { x: number; y: number; z: number } };
    /**
     * Where the bag rides (in its frame, x rideScale: the same spot on every tractor; the rucksack's bottom middle there).
     * Edited in the Tractor tab. None: behind the seat.
     */
    bag?: { x: number; y: number; z: number };
    /**
     * Where each blade level's blades sit on it (index = the Blades level; in its frame, x rideScale: the same on every
     * tractor): their middle, and `width`, how far across they span. Edited in the Tractor tab (pick a level, place it).
     * A level without one: against the front, across the cut.
     */
    blades?: ({ x: number; y: number; z: number; width: number } | null)[];
}

/**
 * A level of the blades under the mower (ui/mow.json `bladeLevels`, one per level of the Blades upgrade, from level 0):
 * how many side by side across the cut, and how long each is (1 = its full share of the cutting width). They're the
 * cutting power: each level is one more (MowProgress.power). README_PROGRESSION.md, "Blades".
 */
export interface BladeLevelDef {
    count: number;
    size: number;
    /**
     * How they're laid out: `alternate` (the default: `count` across, neighbours staggered ahead / behind) or `grid`
     * (`rows` x `cols`, evenly spaced: 1 x 4 is four in a straight line, 2 x 2 a square). In a grid `count` is ignored.
     */
    layout?: 'alternate' | 'grid';
    rows?: number;
    cols?: number;
    /** The saw's colour at this level (else MowerBlades' own progression: steel, bronze, copper... gold, ruby, diamond). */
    color?: string;
}

/** How many blades a level has (a grid's rows x cols, else its count). */
export const bladeCount = (look: BladeLevelDef): number => (look.layout === 'grid' ? Math.max(1, look.rows ?? 1) * Math.max(1, look.cols ?? 1) : look.count);

export type UpgradeId = 'capacity' | 'speed' | 'money' | 'width' | 'blades' | 'grass' | 'chew' | 'farm';

export interface UpgradeDef {
    id: UpgradeId;
    /** The shop tab it's on: GEAR (with the mowers) or BOOSTS. */
    tab: 'gear' | 'boosts';
    name: string;
    /** UI atlas frame. */
    icon: string;
    perLevel: number;
    maxLevel: number;
    basePrice: number;
    growth: number;
    /** Each level's price one by one (level n: prices[n]), instead of basePrice x growth^n. */
    prices?: number[];
    /** `perLevel` is a share of the mower's own (the bag: +25% of the mower's bag a level), not an amount. */
    share?: boolean;
    /** Levels at which the whole effect doubles (an incremental's milestones: POWER-UPS' money tracks). */
    milestones?: number[];
}

export interface DistrictDef {
    id: string;
    name: string;
    /**
     * The city's goal: opens once this many of its other sections are restored (whichever), the HUD counting them down
     * (GoalTimeline); restoring it finishes the city.
     */
    opensAfter?: number;
    /**
     * The goal's mesh (path under public/mow/models/, chosen in the editor, which places it in `props`): what its
     * Map shots zone shoots, and the HUD's picture until there's a snapshot.
     */
    goalModel?: string;
    /** Its rect's corners are rounded this much: no grass past them (a pitch inside a running track). */
    cornerRadius?: number;
    /** Done from the start (a city's areas the tutorial already did): restored, no bonus, no treasures to find. */
    startRestored?: boolean;
    /**
     * The part of the city it's in (TownLevel.parts): a part's areas open together — the player picks which to mow —
     * once every area of the part before is restored. None: it's a part on its own (areas open one after another).
     */
    part?: string;
    /** Centre and size of the overgrown rectangle. */
    x: number;
    z: number;
    width: number;
    depth: number;
    /** What grows over its rect before the patches: `auto` (the town's grass noise), a grass id, or `none`. */
    fill?: string;
    /** Restored share that completes it (the last stragglers are cleared for the player). */
    completeAt: number;
    bonus: number;
    /** Ground colour before / after restoration. */
    ground: string;
    restoredGround: string;
    /** The fence (with its sign) closing it off until the previous section is restored: centre, length, turn. */
    separator?: { x: number; z: number; width: number; rotationY?: number };
    /** What happens when it opens: the camera glides over to show it (its ATMs and fence come with it anyway). */
    onUnlock?: { pan?: boolean };
    /**
     * A fence all round this rect (centre, size) keeping the player inside it until the section is restored (the
     * first one: the yard and the plaza with its ATM), sinking away then. Drawn by Town, edited in the editor.
     */
    pen?: { x: number; z: number; width: number; depth: number };
    /**
     * Its grass's size (default 1): the tufts' height and the effort to chew through grass too tough both
     * scale by it — under 1 an easier section, over 1 a harder one. Clippings per cell stay the same.
     */
    grassScale?: number;
    /**
     * Clippings a cell here gives, times its grass's `value` (default 1): over 1 a richer section (the Front Yard: x2,
     * so clearing it pays for the first two mowers).
     */
    valueScale?: number;
    /**
     * The toughest grass that grows in it (a grass id): anything tougher (the noise's, a patch's) grows as this one
     * instead, so the section can be finished with the mower that cuts it. None = no cap.
     */
    maxGrass?: string;
    /**
     * Clumps of another grass over its fill (`grass`, usually the next tougher one: one step tougher only chews slowly),
     * covering about `share` of it, shaped by the town's grass noise (grassNoise.scale) — the spots that keep a lawn of
     * one grass type from looking flat. They may be tougher than `maxGrass`.
     */
    spots?: { grass: string; share: number };
    /** The camera's distance multiplier while it's the section being worked on (default 1; under 1 = closer). */
    zoom?: number;
    /**
     * Bought to open (the farm test): once the part before it is restored, a square at (x, z) takes money (poured in a
     * bit at a time, kept between visits) and needs `level`; paid, the area opens. None: it opens by itself.
     */
    unlock?: { price: number; level: number; x: number; z: number };
    /**
     * Opens at this player level too, even before the part before it is restored (so nobody's stuck on an area they
     * can't finish): restored OR this level, whichever comes first. Until then a fence runs all round it with a sign
     * saying both. None: only when the part before it is restored.
     */
    openLevel?: number;
    /** What grows here past its grass (Growth.ts): a type from ui/mow.json `growth` and how many per square unit. */
    growth?: { type: string; density: number }[];
}

/**
 * A station's spot — an ATM or a wardrobe: its pad (the machine / closet stands `back` behind it: on the -Z side when
 * rotationY is 0); `section` = it only appears once that section is open. Every ATM sells the bag and opens the shop;
 * every wardrobe opens the wardrobe.
 */
export interface AtmSpot {
    x: number;
    z: number;
    rotationY?: number;
    section?: string;
    /** It only appears once the bag has been sold this many times (the first wardrobe: the tutorial's second sale). */
    appearsAfterSales?: number;
    /**
     * It only appears once the bag is full for the first time (the first ATM: the yard is mowed in one bag, nothing to
     * sell there; it pops up in the park when there is). Once anything's been sold, it's always there.
     */
    appearsWhenFull?: boolean;
    /** It only appears once this den (an id) has been found (the ATM: once the Chicken Den's open). */
    afterDen?: string;
}

/** A station kind's look (the ATMs', the wardrobes'): the model (path under models/, fitted to `height`), how far behind the pad, the label's height. */
export interface AtmLook {
    model: string;
    height: number;
    back: number;
    label: number;
    color: string;
    icon: string;
    collider: { halfX: number; halfZ: number };
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

/** A treasure hidden in an area's grass. */
export interface TreasureDef {
    id: string;
    name: string;
    /** Path under models/ (Dig's relics, in treasures/). */
    model: string;
    /** Its size popping out and on its card (world units across). */
    size: number;
    /** The section (levels/town.json) whose grass hides it. */
    area: string;
    /** Cash claimed in the Trophies panel. */
    reward: number;
    rarity: Rarity;
    /** A locked chest (the farm test): found, it waits on the HUD until a rewarded video opens it (LockedChests). */
    locked?: boolean;
}

export interface TreasuresDef {
    /** A hidden treasure's beam shows within this many units of the player. */
    beamRange: number;
    items: TreasureDef[];
    /** Finding all of an area's treasures pays this (by section id), claimed in the panel. */
    areaBonus: Record<string, number>;
}

/** Something to wear, bought with cash. */
export interface WardrobeItem {
    /** Colour hex, face image path (skins/...webp) or hat model key (MODELS.Hats). */
    id: string;
    name?: string;
    price: number;
    /**
     * A gift (one colour and one face): claimed for nothing. If it's still unclaimed when the player comes back to
     * the wardrobe after buying the first hat, its tab and card get a FREE badge (MowProgress.freeLookBadge).
     */
    free?: boolean;
}

export interface WardrobeCatalog {
    colors: WardrobeItem[];
    faces: WardrobeItem[];
    hats: WardrobeItem[];
}

/** A model in the town (dig's hub prop format, so the editor places both the same way). */
export interface TownProp {
    /** Path under public/mow/models/. */
    model: string;
    x: number;
    z: number;
    rotationY: number;
    /** Fitted to this height (world units). */
    height: number;
    /** Extra stretch along its own width (x) and depth (z), on top of the height fit. */
    stretch?: { x: number; z: number };
    /** Its base this high (negative sinks it: the road tiles). */
    elevation?: number;
    /** The box it blocks, world axes (null = walk through it). */
    collider?: { halfX: number; halfZ: number } | null;
    /** Dithers out while it stands between the camera and the player (trees, buildings). */
    fade?: boolean;
}

/**
 * A patch of grass painted over the sections' fill (only inside a section; never under a collider): a rect or an
 * ellipse (`round`), turned by rotationY; `grass` = a grass id, `auto` (the town's grass noise) or `none` (carves it).
 */
export interface GrassPatch {
    x: number;
    z: number;
    width: number;
    depth: number;
    rotationY?: number;
    shape: 'rect' | 'round';
    grass: string;
}

/** The town-wide grass noise for `auto` grass: rings around `centre`, each with its mix (shares per grass id). */
export interface GrassNoise {
    centre: { x: number; z: number };
    /** Noise frequency (bigger = smaller clumps). */
    scale: number;
    rings: { upTo: number; mix: Record<string, number> }[];
}

/** A paved rectangle: drawn in its colour, walkable, no grass on it. */
export interface Pavement {
    id: string;
    x: number;
    z: number;
    width: number;
    depth: number;
    color: string;
}

/**
 * The town as an island (like hole.io's cities): the ground's rect stands out of a sea (the pizza game's water) on
 * cliff-like sides, with a fence round its edge. Each town (a later city too) is its own island.
 */
export interface IslandDef {
    /** The sea: its colour, how far below the ground it lies, how far it reaches past the island. */
    water: string;
    waterLevel: number;
    margin: number;
    /** The island's sides (stone blocks, tinted this colour) and how deep they go (below the water). */
    sideColor: string;
    sideDepth: number;
    /** The island's shape: a polygon on the ground (any order, no self-crossing). Without one, the ground's rect. */
    outline?: { x: number; z: number }[];
    /** How round the outline's corners are drawn (radius, default 3.5; 0: sharp). The points stay where they are. */
    cornerRadius?: number;
    /** A wooden deck round the edge: `width` in from the shore, planks across it, pilings into the sea. */
    deck?: DeckDef;
    /** The fence round the edge: posts every `spacing`, rails, a kerb under them (with `kerbColor`); `inset` in from the edge. */
    fence?: { color: string; kerbColor?: string; height: number; inset: number; spacing: number };
}

export interface DeckDef {
    width: number;
    color: string;
    /** The pilings standing in the sea along the shore: their colour and the gap between them. */
    pilingColor: string;
    pilingSpacing: number;
}

/** A part of a city (its areas open together: DistrictDef.part): its name, for the signs and the NEW AREA message. */
export interface PartDef {
    id: string;
    name: string;
}

/** A shape cube: its middle on the ground (x, z; lifted by `y`), its size, its turn, its colour. */
export interface ShapeCube {
    x: number;
    z: number;
    y?: number;
    width: number;
    depth: number;
    height: number;
    rotationY?: number;
    color: string;
}

export interface TownLevel {
    id: string;
    name: string;
    /** Every section open from the start, the player choosing where to go (no unlocking in order). */
    openAll?: boolean;
    /**
     * The sections' lawns lie over the pavements, and grass grows on them: a level whose paving runs under its lawns.
     * Otherwise a pavement carves its way through a lawn (a park's paths: no grass on it).
     */
    grassOverPavement?: boolean;
    /** Collider cubes placed by hand (the editor): for a model its bounds fit badly (a stadium). */
    colliders?: ColliderCube[];
    /**
     * Plain coloured boxes (placed in the editor: ⬛ Shape cube), unlit so a dark one reads as a hole: the inside of a
     * tunnel the customers come out of, a doorway, anything that hides where things pop in. Not solid.
     */
    shapes?: ShapeCube[];
    parts?: PartDef[];
    ground: { x: number; z: number; width: number; depth: number; color: string };
    island?: IslandDef;
    start: { x: number; z: number };
    pavements: Pavement[];
    atm: AtmLook;
    atms: AtmSpot[];
    /** The wardrobes: Dig's closet, same pad and label as the ATMs (in its own colour and icon). */
    wardrobe: AtmLook;
    wardrobes: AtmSpot[];
    props: TownProp[];
    grassNoise: GrassNoise;
    grassPatches: GrassPatch[];
    sections: DistrictDef[];
    /** Sound zones (the sea round the island, …): edited in the editor's town, played by SpatialAudio. */
    sounds?: SoundZone[];
    /** Secret patches: a clump of lush grass anywhere in town hiding a chest (SecretPatches), placed in the editor. */
    secrets?: SecretDef[];
    /** Where the cars drive (Traffic): waypoints, the roads linking them, the cars. Edited in the editor. */
    traffic?: TownTraffic;
    /** Road cells (the editor's road builder): laid as MowDesign.roadKit's pieces, and the cars' waypoints and links. */
    roads?: RoadCells;
    /** How loud and how far the traffic is heard. */
    soundSettings?: SoundSettings;
    /** The farm test (the starter level only): upgrade pads fed with grass instead of the shop, and dens to find. */
    farm?: FarmTestDef;
    /**
     * Places the player walks without the mower (it's parked, nothing's cut: the customers' path, a market...), as in a
     * den. Drawn in the editor (🚶 No-mower area).
     */
    footAreas?: { x: number; z: number; width: number; depth: number }[];
    /**
     * Where people and trucks come from (placed in the editor): rects on the ground they pop in at, as if arriving from
     * somewhere, and pop out at again when they leave.
     */
    spawns?: SpawnArea[];
}

/** An upgrade pad: stand on it and the bag's grass pours in; paid in full, the upgrade happens there and then. */
export interface UpgradePadDef {
    kind: 'tool' | 'capacity' | 'blades';
    x: number;
    z: number;
    /** Which way the stand is from the square: behind it (north) turned by this (radians; -1.5708: east). */
    rotationY?: number;
    /** Only there once this section is open. */
    section?: string;
    /**
     * Only there once the bag has been full (the first station: the player starts with none around, mows, fills the bag,
     * and the mower station pops up). Once anything's been upgraded it stays.
     */
    appearsWhenFull?: boolean;
    /** Only there once the player has this mower (tool level): the bag station with the push mower, the blades with the tractor. */
    afterTool?: number;
}

/** A den hidden in the grass (a mock for now): mowed up to its entrance, it opens. */
export interface DenDef {
    id: string;
    name: string;
    x: number;
    z: number;
    width: number;
    depth: number;
    /** The gap in its fence, on its south side, this wide. */
    gate: number;
    /** The player level it opens at: below it, its gate is boarded up and its sign says the level. Unset: any level. */
    level?: number;
    /**
     * Where its parts are, placed in the editor (den-local: from its middle, +Z toward the gate); a part left out goes
     * where the den's own layout puts it (ChickenDen layout()). The gold machine's are planned: shown in the editor only.
     */
    parts?: DenParts;
}

/** A point in a den (from its middle, +Z toward the gate); a square's own size (`w` across, `d` deep), set in the editor. */
export interface DenPoint {
    x: number;
    z: number;
    w?: number;
    d?: number;
}

export interface DenParts {
    /** Each hen's egg spot (where its eggs pile up and are picked up), by hen. */
    eggs?: (DenPoint | null)[];
    /**
     * The conveyor belt's path, start to end (drawn in the editor: the start, points in between, the end): eggs from the
     * egg spots join it where it passes nearest and ride it to its end, into the packing machine. Its buy square is at
     * the start. None: along the front of the egg spots to the EGGS drop.
     */
    belt?: DenPoint[];
    /** Where the conveyor's buy square is (none: at the belt's start). */
    beltBuy?: DenPoint;
    /** The helper's hire square (none: by the packs), and the trucks' helper's (none: by the truck dock). */
    helperHire?: DenPoint;
    truckHelperHire?: DenPoint;
    /** The gold machine's buy square (none: in front of it), and the gold belt's (none: at the belt's start). */
    goldBuy?: DenPoint;
    goldBeltBuy?: DenPoint;
    /** The gold belt's path, packing machine to gold machine (drawn in the editor; none: a straight run between them). */
    goldBelt?: DenPoint[];
    /** The packing machine, the square eggs are dropped on (EGGS), and its grid of packs (out). */
    machine?: DenPoint;
    input?: DenPoint;
    grid?: DenPoint;
    /** The sell counter, its SELL square, and the cash square. */
    counter?: DenPoint;
    sell?: DenPoint;
    cash?: DenPoint;
    /** Planned (the editor only, for laying out the conveyor line): the gold machine, its drop square and its grid. */
    goldMachine?: DenPoint;
    goldInput?: DenPoint;
    goldGrid?: DenPoint;
}

/** Restored areas growing some grass back (the farm test): `share` of each one's cells every `everySec` of play. */
export interface RegrowDef {
    everySec: number;
    share: number;
}

export interface FarmTestDef {
    /** Restored areas grow some grass back now and then, at their value (a field to come back to). */
    regrow?: RegrowDef;
    pads: UpgradePadDef[];
    dens: DenDef[];
    eggs: EggLoopDef;
    levels: LevelsDef;
    trucks?: TruckDockDef;
    /** The farm's second shop: the cow barn (CowDen). */
    cowDen?: CowDenDef;
    /** The crop farms (CropFarm.ts): plots of a crop, its machine, a counter, and a harbour its boats come to. */
    cropFarms?: CropFarmDef[];
    /**
     * The trucks' path (placed in the editor: 🚚 Truck path point): they pop in at its first point, drive point to
     * point, park at the last (by the dock) and drive it back. Without one: from a `trucks` spawn area over the roads.
     */
    truckPath?: TruckPathPoint[];
    /**
     * The customers' way (the editor's 🧍 points): in from the first point through the rest to the queue at the counter,
     * and out from the counter along `peopleOut`, popping out at its last point (2+ points each; without them: a
     * `people` spawn area and straight up the den's path).
     */
    peopleIn?: { x: number; z: number }[];
    peopleOut?: { x: number; z: number }[];
}

/**
 * A point of the trucks' path (the editor's 🚚 Truck path points): they come in at the first, drive point to point to
 * the one marked `park` (they stop there, by the dock, and load; the next ones queue behind), then drive on through the
 * rest and pop out at the last. No point marked: they park at the last and drive back the same way.
 */
/**
 * A crop (ui/mow.json `crops`): plots of it ripen every `growSec` (sped up by Farm Speed), giving `perPick` fresh ones
 * (sold at `price`); its machine turns `product.per` of them into one product every `product.sec`. Its look: the fruit
 * in `color` on `leaf` green plants; the product a jar (or a box) of `product.color` with a `product.lid` top.
 * Another crop is another entry here and a farm in the level (`farm.cropFarms`).
 */
export interface CropDef {
    id: string;
    name: string;
    growSec: number;
    perPick: number;
    price: number;
    color: string;
    leaf: string;
    product: { id: string; name: string; per: number; sec: number; max: number; price: number; color: string; lid?: string; shape?: 'jar' | 'box' };
}

/**
 * A crop farm (the level's `farm.cropFarms`): a fenced yard (gate south) of `plots` (the first free, the rest bought
 * with money and a level, `cols` to a row) growing `crop`, its machine (the product) and fresh crate, a counter on its
 * east side (customers from the people spawn areas, or `peopleIn` / `peopleOut`), and its `harbour`: a drop point on
 * the shore that boats sail to along their own path (`path` in, parking at its end; `out` away), bought like the trucks'
 * dock. Its helpers make it run alone: the `picker` (ripe plots to the machine and the crate), the counter's `helper`
 * and the `boatHelper` (to the docked boat); each takes its cash to the player.
 */
export interface CropFarmDef {
    id: string;
    name: string;
    crop: string;
    x: number;
    z: number;
    width: number;
    depth: number;
    gate: number;
    level?: number;
    /** Of each of its goods, the backpack holds this many. */
    carryMax: number;
    plots: { price: number; level: number }[];
    cols?: number;
    wants: [number, number];
    queue: number;
    customerEverySec: number;
    harbour?: TruckDockDef & { path: TruckPathPoint[]; out?: TruckPathPoint[]; parkFacing?: number };
    picker?: BarnHelperDef;
    helper?: BarnHelperDef;
    boatHelper?: BarnHelperDef;
    peopleIn?: { x: number; z: number }[];
    peopleOut?: { x: number; z: number }[];
    /** Its pieces placed in the editor (farm-local); `plots`: the first plot's middle (the rest follow it in rows). */
    parts?: Partial<Record<CropFarmPartKey, DenPoint>>;
}

export interface TruckPathPoint {
    x: number;
    z: number;
    park?: boolean;
}

/**
 * The cow barn (CowDen): where it is and its gate and level (as a den), its loop (CowLoopDef), its own truck dock and
 * path, and its customers' paths in and out (2+ points each; without, they come from the people spawn areas).
 */
/** The cow barn's own parts (placed in the editor, barn-local): each machine, its MILK square and its grid. */
export interface BarnParts {
    butterMachine?: DenPoint;
    butterInput?: DenPoint;
    butterGrid?: DenPoint;
    cheeseMachine?: DenPoint;
    cheeseInput?: DenPoint;
    cheeseGrid?: DenPoint;
}

/** A place a farm piece goes (placed in the editor, farm-local), by key: see CropFarm layout(). */
export type CropFarmPartKey = 'plots' | 'machine' | 'input' | 'grid' | 'fresh' | 'counter' | 'sell' | 'cash' | 'pickerHire' | 'helperHire' | 'boatHelperHire';

export interface CowDenDef extends DenDef {
    /** Its parts placed in the editor (barn-local): the den's (counter, sell, cash, belt, its buy and hire squares) and its machines'. */
    parts?: DenParts & BarnParts;
    loop: CowLoopDef;
    trucks?: TruckDockDef;
    truckPath?: TruckPathPoint[];
    peopleIn?: { x: number; z: number }[];
    peopleOut?: { x: number; z: number }[];
}

/** One of the barn's machines: milk it takes per thing made, seconds per thing, milk it holds, its grid's layers, a thing's price. */
export interface DairyMachineDef {
    milkPer: number;
    sec: number;
    max: number;
    layers?: number;
    price: number;
}

/** The cow barn's loop: the cows (milk on their spots), the butter churn and the cheese press, the orders, the belt. */
export interface CowLoopDef {
    /** Of each good (milk, butter, cheese), the backpack holds this many. */
    carryMax: number;
    milkEverySec: number;
    floorMax: number;
    /** Milk waiting on the first stall's spot on the first visit (unset: a full spot). */
    startMilk?: number;
    /** The stalls, in order: the first free, the others bought (money and a level). */
    cows: { price: number; level: number }[];
    butter: DairyMachineDef;
    cheese: DairyMachineDef;
    /** Goods a customer orders (lowest, highest: butter, cheese or a mix), how many queue, how soon the next comes. */
    wants: [number, number];
    queue: number;
    customerEverySec: number;
    /** The conveyor belt (every cow owned): bought on its square; milk rides it to the machines, split between them. */
    belt?: { price: number; level: number; speed: number; spacing: number; takeSec: number };
    /**
     * Helpers (hired on their squares): the counter's (after the belt: butter and cheese to the customers) and the
     * trucks' (after the dock: to the parked truck). Each also takes its cash square's money to the player. With both,
     * the barn runs on its own.
     */
    helper?: BarnHelperDef;
    truckHelper?: BarnHelperDef;
}

export interface BarnHelperDef {
    price: number;
    level: number;
    /** Goods carried at once. */
    carry: number;
    walkSpeed: number;
}

/** A spawn area: a rect people (customers) or trucks pop in at, and out at when they leave. */
export interface SpawnArea {
    id: string;
    kind: 'people' | 'trucks';
    x: number;
    z: number;
    width: number;
    depth: number;
}

/**
 * The den's truck dock: its square inside the den (x, z: world), bought with money and a level like a hen. Once open,
 * trucks come along the level's roads (pavements whose id starts with `road`) from a `trucks` spawn area, park at the
 * road nearest the square, and ask for a big load of trays; handed over on the square, they pay `trayPrice` a tray
 * (onto the den's cash square) and drive back.
 */
export interface TruckDockDef {
    x: number;
    z: number;
    price: number;
    level: number;
    wants: [number, number];
    trayPrice: number;
    /** Seconds between one truck leaving and the next arriving. */
    everySec: number;
    /** Where the truck's cash lands (its own square and pile, world); unset: just north of the dock's square. */
    cash?: { x: number; z: number };
    /** The truck's model (under models/) and its length in the world. */
    model: string;
    length: number;
    /** Its trucks' models, taken in turn (small cargo trucks now; container trucks later): `model` without. */
    models?: string[];
    /** The most trucks on their way in at once (the parked one and those queuing behind it; default 3). */
    queue?: number;
    speed: number;
}

/**
 * The chicken den's loop: hens lay eggs on the floor in front of their nests, the player carries them to the packing
 * machine, which packs trays out onto its grid; trays carried to the SELL counter go to the customers, whose cash
 * piles up on the cash square to be picked up — and buys more hens.
 */
export interface EggLoopDef {
    /** The eggs already waiting on the first hen's spot on the first visit (the lesson). Unset: a full spot (floorMax). */
    startEggs?: number;
    /** Den goods (eggs and trays) the backpack holds. */
    carryMax: number;
    /** A hen lays an egg every this many seconds, onto its floor pile (at most floorMax eggs there). */
    layEverySec: number;
    floorMax: number;
    /** The machine packs eggsPerTray eggs into a tray every packSec, holding at most machineMax eggs. */
    eggsPerTray: number;
    packSec: number;
    machineMax: number;
    /** The packs' grid by the machine: its slots, two across (4: a 2 x 2). */
    traySlots: number;
    /** How many packs pile up on each slot (default 2): the grid holds traySlots x trayLayers. */
    trayLayers?: number;
    /**
     * The conveyor belt (eggs from the egg spots straight into the packing machine): bought on its square at its start
     * once every hen is owned, for `price` and `level`. Eggs ride it at `speed` (units a second), `spacing` apart, each
     * egg spot sending one every `takeSec`.
     */
    belt?: { price: number; level: number; speed: number; spacing: number; takeSec: number };
    /**
     * The first helper (a worker in a cap and uniform), hired on its square once the conveyor runs: carries up to
     * `carry` packs from the grids (gold first) to the customers at SELL, then takes the cash pile to the player.
     */
    helper?: { price: number; level: number; carry: number; walkSpeed: number };
    /**
     * The trucks' helper, hired on its square once the truck dock's open: packs from the fullest grid to the parked
     * truck, and the truck's cash pile to the player.
     */
    truckHelper?: { price: number; level: number; carry: number; walkSpeed: number };
    /**
     * The gold machine (bought once the helper's hired): packs dropped on its square become gold packs, one every
     * `packSec`, onto its grid (`slots` x `layers`); it holds `max` packs. A gold pack sells for `trayPrice`.
     */
    gold?: { price: number; level: number; packSec: number; max: number; slots: number; layers: number; trayPrice: number };
    /**
     * The belt linking the two machines (bought once the gold machine's there): every pack packed rides it into the gold
     * machine — no more packs on the packing grid, no more dropping them in by hand: everything's gold.
     */
    goldBelt?: { price: number; level: number; speed: number; spacing: number };
    /** Cash per tray sold. */
    trayPrice: number;
    /** Trays a customer asks for (lowest, highest), how many wait at most, and how soon the next one comes. */
    wants: [number, number];
    queue: number;
    customerEverySec: number;
    /** The nests, in order: the first is free (it comes with the den), the others cost money and a level. */
    hens: { price: number; level: number }[];
}

/** The player's level: XP needed for each next level (level 2, 3, ...; past the list each takes `growth` x more), and what gives XP. */
export interface LevelsDef {
    next: number[];
    growth: number;
    /** The floor arrows guide the player up to this level; past it they're gone (by then the player knows the way). Unset: always. */
    guideUntil?: number;
    xp: {
        /** One XP per this many clippings mowed. */
        clippingsPerXp: number;
        upgrade: number;
        denFound: number;
        areaRestored: number;
        egg: number;
        tray: number;
        traySold: number;
        hen: number;
    };
}

/**
 * A looping sound over a box on the ground: full `volume` inside it, fading to nothing `fade` units out from its
 * edges, heard from the box's nearest point (left / right of the screen). Zones playing the same `sound` share one
 * loop (the loudest zone wins), so they can overlap at the corners.
 */
export interface SoundZone {
    id: string;
    /** The file in raw-assets/audio, without its extension (`ocean-ambient`). */
    sound: string;
    x: number;
    z: number;
    width: number;
    depth: number;
    fade: number;
    volume: number;
}

/**
 * The traffic's network: waypoints (on the roads' middles), links between them (two-way roads; cars keep to the
 * right-hand lane), and the cars, each starting at a waypoint (and roaming the waypoints linked to it, so a network
 * of its own keeps a car to its area).
 */
export interface TownTraffic {
    waypoints: { id: string; x: number; z: number }[];
    links: [string, string][];
    cars: { at: string; model?: string }[];
}

/**
 * A box placed by hand, drawn only in the editor. `solid`: it blocks walking (and no grass grows under it). `fades`: a
 * prop's model: the player in or touching this cube makes it see-through, and only such cubes do (not the usual test of
 * the camera's line against its whole bounds, too blunt for a model that big).
 */
export interface ColliderCube {
    x: number;
    z: number;
    width: number;
    depth: number;
    solid: boolean;
    fades?: string;
}

/** A secret patch's chest model (under public/mow/models; one of the treasures uses it too: loaded with them). */
export const SECRET_CHEST_MODEL = 'treasures/chest.glb';

/** A secret patch: its rect (centre, size) of lush grass, and the cash in the chest mowing it through uncovers. */
export interface SecretDef {
    id: string;
    x: number;
    z: number;
    width: number;
    depth: number;
    reward: number;
}

export interface SoundSettings {
    /** Each car's engine: `volume` within `near` of it, nothing from `far`. */
    cars: { volume: number; near: number; far: number };
    /** This level's soundtrack, instead of MowDesign.music. */
    music?: MusicDef;
}

/** A soundtrack: a file in raw-assets/audio (without its extension), and its volume (0-1). */
export interface MusicDef {
    sound: string;
    volume: number;
}

/**
 * Rush mode's combo (GameMode): cutting keeps it alive (it ends `window` seconds after the last cut, or when the bag
 * fills); every `stepSec` of it the multiplier grows by `step`, up to `max`. Meanwhile each cut's money x (multiplier - 1)
 * goes into a pot, paid out when it ends.
 */
export interface ComboDef {
    window: number;
    stepSec: number;
    step: number;
    max: number;
}

/** A few cars driving the roads (world/Traffic.ts): the town's road tiles (props whose model has `road_`) are the lanes. */
/** How the cars drive (ui/mow.json); where they drive is the level's (TownTraffic). */
export interface TrafficDef {
    /** Car models (paths under models/; front facing +Z), picked in turn for a car without its own. */
    models: string[];
    /** Cruising speed (units / s), and how fast they speed up / brake. */
    speed: number;
    accel: number;
    brake: number;
    /** The cars' length (fitted). */
    length: number;
    /** A lane's middle off the road's middle (driving on the right). */
    lane: number;
    /** The road tiles' size (they sit on this grid): the editor's "waypoints from road tiles" links tiles this far apart. */
    tile: number;
    /** The road's top (the cars' wheels sit on it). */
    roadY: number;
    /** Clear road a car keeps in front of it (to the player, to the car ahead); it stops short of that. */
    gap: number;
}

export interface MowDesign {
    /** Which game it is unless the URL says (?mode=calm|rush): GameMode.ts. */
    mode?: 'calm' | 'rush';
    combo: ComboDef;
    cell: number;
    seed: number;
    /**
     * The player's size against the town (1 = the rig as authored): the character, a pushed mower's length and height
     * (not its width: that's what it cuts), where the hands hold it, and the tractor. Gameplay (cut widths, speeds,
     * the body's footprint) doesn't change with it.
     */
    playerScale?: number;
    clippingPrice: number;
    /**
     * The world's curve (BendService: ground dropping away from the player, per unit squared). 0 = flat: anything
     * bent is drawn somewhere other than where it's culled and where the labels are placed (they don't bend).
     */
    bend?: number;
    /**
     * Seconds of contact to chew through one cell of grass n powers too tough (entry n - 1); grass more powers too
     * tough than it has entries can't be cut at all (a lock until a better mower).
     */
    chewSec: number[];
    traffic?: TrafficDef;
    /** The soundtrack, unless the level has its own (SoundSettings.music). */
    music: MusicDef;
    /** The grass cut's sound: each cut picks a volume and a pitch between these (the editor's Mowers tab). */
    cutSound: { volume: [number, number]; pitch: [number, number] };
    /** The road builder's pieces (a level's `roads`): their base (`elevation`) and the asphalt's top (`roadY`, for the cars). */
    roadKit?: RoadKit & { elevation: number; roadY: number };
    grass: GrassDef[];
    tools: ToolDef[];
    upgrades: UpgradeDef[];
    /** The blades' look at each level of the Blades upgrade (the last one stands for any past it). */
    bladeLevels: BladeLevelDef[];
    /** What grows past grass: bushes, then trees (Growth.ts). */
    growth?: GrowthDef[];
    /** What the crop farms grow (CropFarm.ts): each a crop, its fresh price and what its machine makes of it. */
    crops?: CropDef[];
    /** The shop's BOOSTS tab opens with this mower (tool level). */
    boostsUnlockToolLevel: number;
    tractor: TractorConfig;
    /** What the wardrobes sell (Dig's catalogue and assets). */
    wardrobe: WardrobeCatalog;
    /** Treasures hidden in the grass (found by mowing them, claimed in the Trophies panel). */
    treasures: TreasuresDef;
    /** The level's sections, in unlock order. */
    districts: DistrictDef[];
    start: { x: number; z: number };
}

/** The part a section is in (its own when it has none), and the parts in unlock order (by their first section). */
export const partOf = (d: number): string => MOW.districts[d].part ?? `#${MOW.districts[d].id}`;
let partOrder: string[] | undefined;
const partsInOrder = (): string[] => (partOrder ??= MOW.districts.map((_, d) => partOf(d)).filter((part, i, all) => all.indexOf(part) === i));

/** A part's name: TownLevel.parts', or (a section on its own) the section's. */
export function partName(part: string): string {
    return TOWN.parts?.find((entry) => entry.id === part)?.name ?? MOW.districts.find((_, d) => partOf(d) === part)?.name ?? part;
}

/**
 * Whether section `d` is open: its part is the first, or every section of the part before it is restored, or (with an
 * `openLevel`) the player's `level` has reached it.
 */
export function sectionOpen(d: number, restored: (id: string) => boolean, bought: (id: string) => boolean = () => true, level = 0): boolean {
    const { opensAfter, unlock, id, openLevel } = MOW.districts[d];
    // Bought to open: not before its square's paid.
    if (unlock && !bought(id)) return false;
    if (openLevel && level >= openLevel) return true;
    if (opensAfter) return goalCount(restored) >= opensAfter;
    if (TOWN.openAll) return true;
    const index = partsInOrder().indexOf(partOf(d));
    if (index <= 0) return true;
    const before = partsInOrder()[index - 1];
    return MOW.districts.every((district, i) => partOf(i) !== before || restored(district.id));
}

/** The Map shots zone of a city's goal: its model alone, for the HUD (`<zone>-small`). */
export const goalZone = (city: CityDef): string => `${city.map ?? 'town'}-goal`;

/** How far this level's lawns and what lies on them are lifted: clear of the pavements' stack (TownLevel.grassOverPavement). */
export const lawnLift = (): number => (TOWN.grassOverPavement ? 0.08 : 0);

/** The city's goal, if it has one (a section with `opensAfter`). */
export function goalSection(): DistrictDef | undefined {
    return MOW.districts.find((district) => district.opensAfter);
}

/** How many sections other than the goal are restored. */
export function goalCount(restored: (id: string) => boolean): number {
    return MOW.districts.filter((district) => !district.opensAfter && restored(district.id)).length;
}

/** Whether (x, z), inside a section's rect, is past one of its rounded corners. */
export function pastCorner(district: DistrictDef, x: number, z: number): boolean {
    const radius = district.cornerRadius ?? 0;
    if (radius <= 0) return false;
    const dx = Math.abs(x - district.x) - (district.width / 2 - radius);
    const dz = Math.abs(z - district.z) - (district.depth / 2 - radius);
    return dx > 0 && dz > 0 && dx * dx + dz * dz > radius * radius;
}

/** What opens section `d` (for its fence's sign): the part before its own. */
export function openedBy(d: number): string | undefined {
    const index = partsInOrder().indexOf(partOf(d));
    return index > 0 ? partName(partsInOrder()[index - 1]) : undefined;
}

/** How a ridden mower's tractor is painted: 'grey', a colour, or undefined (its own colours). Same as dig's toolPaint. */
export function toolPaint(tool: ToolDef): string | undefined {
    return tool.tint ?? (tool.greyscale ? 'grey' : undefined);
}

/** How many powers short a mower can still chew through (MowDesign.chewSec). */
export function chewReach(): number {
    return MOW.chewSec.length;
}

/** Whether section `d`'s unlock square is up: it's bought to open, not bought yet, and the part before it is restored. */
export function sectionUnlockable(d: number, restored: (id: string) => boolean, bought: (id: string) => boolean): boolean {
    const district = MOW.districts[d];
    return !!district.unlock && !bought(district.id) && sectionOpen(d, restored, () => true);
}

/**
 * A price made readable: two significant figures in steps of half the second one (247430 -> 245000, 1234 -> 1250),
 * at least steps of 5 (87 -> 85). Incremental prices otherwise read like 247430.
 */
export function nicePrice(value: number): number {
    if (value <= 0) return 0;
    const digits = Math.floor(Math.log10(value));
    const step = Math.max(5, Math.pow(10, digits - 1) / 2);
    return Math.max(step, Math.round(value / step) * step);
}

/** Whether a mower of `power` can cut `grass` at all (at once, or chewing through it). */
export function canCutGrass(grass: GrassDef, power: number): boolean {
    return grass.resistance - power <= chewReach();
}

/** The first mower (shop order) that can cut `grass` at all. */
export function firstToolFor(grass: GrassDef): ToolDef | undefined {
    return MOW.tools.find((tool) => canCutGrass(grass, tool.power));
}

/**
 * The blade level (Blades upgrade) a mower of `toolPower` needs to cut `grass` at full speed, or undefined when no
 * level reaches it (power = the mower's own + the blade level: MowProgress.power).
 */
export function bladesFor(grass: GrassDef, toolPower: number): number | undefined {
    const max = MOW.upgrades.find((u) => u.id === 'blades')?.maxLevel ?? 0;
    // Full speed: power above the grass's toughness (as tough as the power, it's cut but labours).
    const level = Math.max(0, grass.resistance - toolPower + 1);
    return level <= max ? level : undefined;
}

/** A city (levels/cities.json): its level and map shot, whether travelling on keeps the gear, or not playable yet. */
export interface CityDef {
    id: string;
    name: string;
    level?: string;
    map?: string;
    keepGear?: boolean;
    comingSoon?: boolean;
    /** false: no guide arrows (the shop's hand still shows). */
    guide?: boolean;
}

export const CITIES: CityDef[] = cities.cities;
/** Each finished city (not the tutorial) adds this to every sale's money, in every city after (prestige). */
export const PRESTIGE_BONUS: number = cities.prestigeBonus;
/** The localStorage key holding the city being played (MowProgress writes it on travel). */
export const CURRENT_CITY_KEY = 'mow.city';

/** The farm test's setup, when the level being played has one. */
export const farmTest = (): FarmTestDef | undefined => TOWN.farm;

/** Grass (clippings) an upgrade pad takes for something priced in money (the old shop's prices, at the selling rate). */
export const grassFor = (price: number): number => Math.ceil(price / MOW.clippingPrice);

/**
 * The farm test's hand-placed trees and bushes inside an area (library nature models): choppable growth (Growth: a
 * tree or a bush, once the blades are up to it) instead of fixed props. Ones outside every area stay scenery.
 */
export function choppableKind(prop: TownProp): 'tree' | 'bush' | undefined {
    if (!TOWN.farm) return undefined;
    const kind = /\/nature\/Tree_/.test(prop.model) ? 'tree' : /\/nature\/Bush_/.test(prop.model) ? 'bush' : undefined;
    if (!kind) return undefined;
    return districtAt(prop.x, prop.z) >= 0 ? kind : undefined;
}

/** The area (district index) whose rectangle holds (x, z), or -1. */
export const districtAt = (x: number, z: number): number =>
    MOW.districts.findIndex((d) => Math.abs(x - d.x) <= d.width / 2 && Math.abs(z - d.z) <= d.depth / 2);

/** A number as the game shows it: whole to 999, then 6.8k, 12.3k, 450k, 4.5M, 20B, 1.2T (bigger numbers are coming). */
export function shortNumber(value: number): string {
    const v = Math.floor(Math.max(0, value));
    if (v < 1000) return `${v}`;
    const units: [number, string][] = [[1e15, 'Q'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
    for (const [size, suffix] of units) {
        if (v >= size) {
            const n = v / size;
            return `${n >= 100 ? Math.floor(n) : Math.floor(n * 10) / 10}${suffix}`;
        }
    }
    return `${v}`;
}

/** Money as the game shows it: $999, then $6.8k, $4.5M, $20B... */
export const shortMoney = (value: number): string => `$${shortNumber(value)}`;

/** A district's money per clipping: the selling price times its area value (DistrictDef.valueScale). */
export const worthPerClipping = (district: number): number => MOW.clippingPrice * (MOW.districts[district]?.valueScale ?? 1);

const LEVELS: Record<string, unknown> = { tutorial, town, city2 };

function currentCity(): CityDef {
    let id: string | null = null;
    try {
        // `?city=<id>` (the editor's ▶ Play, testing): that city, from now on.
        const asked = new URLSearchParams(window.location.search).get('city');
        if (asked && CITIES.some((city) => city.id === asked)) window.localStorage.setItem(CURRENT_CITY_KEY, asked);
        id = window.localStorage.getItem(CURRENT_CITY_KEY);
    } catch {
        // No storage: the first city.
    }
    return CITIES.find((city) => city.id === id && city.level && LEVELS[city.level]) ?? CITIES[0];
}

/** The city being played, and the next one (undefined after the last); its level and design. Swapped by setCity(). */
export let CITY: CityDef = currentCity();
export let NEXT_CITY: CityDef | undefined;
export let TOWN: TownLevel;
export let MOW: MowDesign;
setCity(CITY);

/** The city's soundtrack (its level's, else the game's). */
export const cityMusic = (): MusicDef => TOWN.soundSettings?.music ?? MOW.music;

/** Every soundtrack any level plays (kept out of the sound effects' background download: each streams when played). */
export const MUSIC_TRACKS: ReadonlySet<string> = new Set([(data as unknown as MowDesign).music.sound,
    ...Object.values(LEVELS).map((level) => (level as TownLevel).soundSettings?.music?.sound).filter((sound): sound is string => !!sound)]);

/** A level with its road cells laid: their pieces as flat props (walked over), their network as the traffic's. */
function withRoads(level: TownLevel, kit: MowDesign['roadKit']): TownLevel {
    if (!level.roads?.cells.length || !kit) return level;
    // At their own size (the kit's pieces are 0.2 thick).
    const pieces: TownProp[] = solveRoads(level.roads, kit).map((road) => ({
        model: road.model, x: road.x, z: road.z, rotationY: road.rotationY, height: 0.2, elevation: kit.elevation, collider: null,
    }));
    return { ...level, props: [...pieces, ...level.props], traffic: { ...roadNetwork(level.roads, kit.tile), cars: level.traffic?.cars ?? [] } };
}

/** Plays `city` from now on (travelling: the scene is rebuilt after, everything reads these live). */
export function setCity(city: CityDef): void {
    CITY = city;
    NEXT_CITY = CITIES[CITIES.indexOf(city) + 1];
    const design = data as unknown as Omit<MowDesign, 'districts' | 'start'>;
    TOWN = withRoads(LEVELS[city.level!] as unknown as TownLevel, design.roadKit);
    MOW = { ...design, districts: TOWN.sections, start: TOWN.start };
    partOrder = undefined;
}
