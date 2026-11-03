// MowConfig.ts
//
// Typed access to the design data, none of it in code: ui/mow.json (grass types, tools, upgrades, prices) and
// the current city's level (levels/<level>.json: the layout: sections = districts with their grass mix, bonus,
// stations and separator; props; pavements), which the editor writes (npm run editor). MOW.districts is the level's
// sections. The cities (levels/cities.json, CITIES) are each their own level; which one is played is saved
// (MowProgress, CURRENT_CITY_KEY) and read here, before anything is built: travelling reloads the game into it.

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

export interface ToolDef {
    id: string;
    name: string;
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
}

export type UpgradeId = 'capacity' | 'speed' | 'money' | 'width' | 'blades';

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
}

export interface DistrictDef {
    id: string;
    name: string;
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
     * The toughest grass that grows in it (a grass id): anything tougher (the noise's, a patch's) grows as this one
     * instead, so the section can be finished with the mower that cuts it. None = no cap.
     */
    maxGrass?: string;
    /** The camera's distance multiplier while it's the section being worked on (default 1; under 1 = closer). */
    zoom?: number;
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

export interface TownLevel {
    id: string;
    name: string;
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
    /** How loud and how far the traffic is heard. */
    soundSettings?: SoundSettings;
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
     * Seconds of contact to chew through one cell of grass n powers too tough (entry n - 1); grass more powers too
     * tough than it has entries can't be cut at all (a lock until a better mower).
     */
    chewSec: number[];
    traffic?: TrafficDef;
    grass: GrassDef[];
    tools: ToolDef[];
    upgrades: UpgradeDef[];
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

/** Whether section `d` is open: its part is the first, or every section of the part before it is restored. */
export function sectionOpen(d: number, restored: (id: string) => boolean): boolean {
    const index = partsInOrder().indexOf(partOf(d));
    if (index <= 0) return true;
    const before = partsInOrder()[index - 1];
    return MOW.districts.every((district, i) => partOf(i) !== before || restored(district.id));
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

/** Whether a mower of `power` can cut `grass` at all (at once, or chewing through it). */
export function canCutGrass(grass: GrassDef, power: number): boolean {
    return grass.resistance - power <= chewReach();
}

/** The first mower (shop order) that can cut `grass` at all. */
export function firstToolFor(grass: GrassDef): ToolDef | undefined {
    return MOW.tools.find((tool) => canCutGrass(grass, tool.power));
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

/** Plays `city` from now on (travelling: the scene is rebuilt after, everything reads these live). */
export function setCity(city: CityDef): void {
    CITY = city;
    NEXT_CITY = CITIES[CITIES.indexOf(city) + 1];
    TOWN = LEVELS[city.level!] as unknown as TownLevel;
    MOW = { ...(data as unknown as Omit<MowDesign, 'districts' | 'start'>), districts: TOWN.sections, start: TOWN.start };
    partOrder = undefined;
}
