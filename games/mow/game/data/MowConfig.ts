// MowConfig.ts
//
// Typed access to the design data, none of it in code: ui/mow.json (grass types, tools, upgrades, prices) and
// levels/town.json (the town's layout: sections = districts with their grass mix, bonus, stations and separator;
// props; pavements), which the editor writes (npm run editor). MOW.districts is the level's sections.

import data from '../../ui/mow.json';
import town from '../../levels/town.json';

export interface GrassDef {
    id: string;
    name: string;
    /** Uncut height (world units). */
    height: number;
    color: string;
    /** The mowed stub's colour. */
    cutColor: string;
    /** Cutting power needed; a tool one below cuts it slowly, further below not at all. */
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
    /** Held in the hands (the scissors), not pushed along the ground on a handle. */
    handheld?: boolean;
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
 * middle. A pushed mower's handle crossbar sits there (rails down to the deck's back corners); a held tool hangs there.
 */
export interface GripDef {
    forward: number;
    height: number;
    spread: number;
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
     * Its grass's size (default 1): the tufts' height and the effort to chew through grass one power too tough both
     * scale by it — under 1 an easier section, over 1 a harder one. Clippings per cell stay the same.
     */
    grassScale?: number;
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
    /** The island's sides: colour, and how deep they go (below the water). */
    sideColor: string;
    sideDepth: number;
    /** The island's shape: a polygon on the ground (any order, no self-crossing). Without one, the ground's rect. */
    outline?: { x: number; z: number }[];
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

export interface TownLevel {
    id: string;
    name: string;
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
}

export interface MowDesign {
    cell: number;
    seed: number;
    clippingPrice: number;
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

/** How a ridden mower's tractor is painted: 'grey', a colour, or undefined (its own colours). Same as dig's toolPaint. */
export function toolPaint(tool: ToolDef): string | undefined {
    return tool.tint ?? (tool.greyscale ? 'grey' : undefined);
}

export const TOWN: TownLevel = town as unknown as TownLevel;
export const MOW: MowDesign = { ...(data as unknown as Omit<MowDesign, 'districts' | 'start'>), districts: TOWN.sections, start: TOWN.start };
