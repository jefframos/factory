// DigConfig.ts
//
// Typed access to ui/dig.json — every tuning value (terrain, materials, zones, tools, backpack sizes,
// finds, the wardrobe catalogue) lives in that file, not in code (GDD §17).

import data from '../../ui/dig.json';

export interface MaterialDef {
    id: string;
    name: string;
    color: string;
    /** Hit points: tool power is subtracted per hit. */
    durability: number;
    /** Weakest tool power that can dig it at all. */
    minPower: number;
    /** Sell price per item. */
    value: number;
    /** Items dropped per block. */
    drops: number;
    /** Ore blocks (the drop is worth collecting; used for hints). */
    ore: boolean;
    /** Block model drawn for it (KayKit Block Bits), under public/dig/models/. */
    block: string;
    /** Optional colour multiplied over the block model (a material without its own model, like obsidian). */
    tint?: string;
    /** What flies into the backpack when it breaks. */
    pickup: string;
    /** Optional pieces poking out of the block top (nuggets, gems). */
    decor?: string;
    /** Optional colour multiplied over the decor and the pickup (the amethyst's purple gems on the crystal's model). */
    decorTint?: string;
}

/** A material mixed into a zone, as a share of its blocks. */
export interface ZoneMix {
    id: string;
    chance: number;
}

/** A ring of the mine around the hub (GDD §6 progression by depth). */
export interface ZoneDef {
    id: string;
    name: string;
    /** Distance from the hub centre where the zone starts. */
    from: number;
    /** Base rock; its minPower is the tool tier needed to get in. */
    fill: string;
    /** Tunnel floor colour in this zone (DigScene shades the mine floor by zone, blending at the borders). */
    floor?: string;
    patches: ZoneMix[];
    ores: ZoneMix[];
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

/** A buried artifact (GDD §11): one per mine, shows once its block is on a tunnel edge, pays `reward` when dug. */
export interface FindDef {
    id: string;
    name: string;
    model: string;
    /** Size of the model, in blocks. */
    size: number;
    reward: number;
    /** The zone (index) it's buried in. */
    zone: number;
    rarity: Rarity;
}

/** Something to wear, bought with cash. */
export interface WardrobeItem {
    /** Colour hex, face image path (skins/...webp) or hat model key (MODELS.Hats). */
    id: string;
    name?: string;
    price: number;
    /** Not for sale: earned (`achievement` = an achievement whose `hat` it is: the Champion's Crown). */
    unlock?: 'achievement';
}

export interface WardrobeCatalog {
    colors: WardrobeItem[];
    faces: WardrobeItem[];
    hats: WardrobeItem[];
}

export interface ToolDef {
    id: string;
    name: string;
    /** Pizza ToolRegistry id shown in the right hand. */
    model: 'shovel' | 'pickaxe';
    /** Character clip played on the action layer while digging. */
    clip: string;
    power: number;
    /** Seconds between hits. */
    hitInterval: number;
    /** Blocks across the dig front (1 or 3). */
    area: number;
    /** Rows dug at once, straight ahead (unset: 2 for a wide tool, else 1). */
    depth?: number;
    price: number;
    /** UI atlas icon: ToolIcon_<icon> (a vehicle shows its model instead). */
    icon: string;
    /** Ridden in the mine (TractorRide, ui/dig.json `tractor`): the Digger and the Tractor, the last two tools. */
    vehicle?: boolean;
    /** A vehicle drawn in grey (the tractor's model and icon desaturated): the Digger, the weaker one. */
    greyscale?: boolean;
    /** A vehicle's speed multiplier on walking speed (unset: the tractor's `speedMultiplier`). */
    rideSpeed?: number;
    /** Frame colour once owned (same colours as the collection); not-owned tools show grey. */
    rarity: Rarity;
}

/** The tractor the miner rides outside the hub (TractorRide) once its tool (`vehicle`) is bought; positions are tractor-local, world units. */
export interface TractorDef {
    /** Under public/dig/models/. */
    model: string;
    /** Tractor height, world units. */
    height: number;
    /** Half-width of its footprint against the rock while riding (walking is 0.32), so the cab doesn't sink into blocks. */
    bodyRadius: number;
    /** Turns the model so its front faces +Z (the miner's forward). */
    rotationY: number;
    /** Where the miner sits. */
    seat: { x: number; y: number; z: number };
    /** Walking speed multiplier while riding. */
    speedMultiplier: number;
    /** The puff when the tractor appears / disappears. */
    smoke: { count: number; size: number; color: string };
    /** Small puffs from the exhaust while driving, every `interval` seconds. */
    exhaust: { x: number; y: number; z: number; interval: number; size: number };
}

/** What an achievement counts (DigProgress.achievementStat). */
export type AchievementStat = 'blocks' | 'ores' | 'earned' | 'finds' | 'claims';

/** Collect-X achievements with levels: each tier pays `reward` when claimed; the last also unlocks `decor` in the hub. */
export interface AchievementDef {
    id: string;
    name: string;
    stat: AchievementStat;
    /** UI atlas frame. */
    icon: string;
    /** The goal line, `{goal}` replaced by the tier's goal. */
    describe: string;
    tiers: { goal: number; reward: number }[];
    /** Name of the hub decoration a tier unlocks (placed in levels/hub.json achievementDecor), if any. */
    decor?: string;
    /** The tier (1-based) that unlocks `decor` (unset: the last). */
    decorAt?: number;
    /** A wardrobe hat the last tier unlocks for good (the Champion's Crown). */
    hat?: string;
}

/** What a boost track changes (DigProgress applies it). */
export type BoostId = 'digSpeed' | 'sellPrice' | 'oreLuck' | 'moveSpeed';

/**
 * A repeatable upgrade track bought at the ATM (BOOSTS tab), level 0..maxLevel, each level `perLevel` more:
 * digSpeed = hits that much quicker (compounding), sellPrice = +that share of the sell value, oreLuck = that chance
 * more of an extra item from an ore block, moveSpeed = +that share of walking speed. Level n costs
 * basePrice x growth^n.
 */
export interface BoostDef {
    id: BoostId;
    name: string;
    /** UI atlas frame. */
    icon: string;
    perLevel: number;
    maxLevel: number;
    basePrice: number;
    growth: number;
}

/** Opening a new mine (prestige): everything but the cosmetics, hub and collection resets, for a lasting bonus per mine. */
export interface PrestigeDef {
    /** Extra sell value per new mine opened. */
    sellBonus: number;
    /** Extra dig speed per new mine opened. */
    digBonus: number;
    /** Each new mine's terrain seed is the base seed + this x the mine number (a new layout, finds buried again). */
    seedStep: number;
}

/**
 * A mine's colours (ui/dig.json mineThemes): the first mine is the first theme, every later one the next in turn
 * (DigProgress.mineTheme). Anything unset keeps the default look.
 */
export interface MineTheme {
    name: string;
    /** Material id -> tint over its block (replacing its own `tint`). */
    tints?: Record<string, string>;
    /** Tunnel floor colour per zone, in zone order (replacing each zone's `floor`). */
    floors?: string[];
    /** The hub's checker floor, its two tones. */
    hubFloor?: [string, string];
    /** The hub's walls: the bottom band, the top. */
    hubWalls?: [string, string];
}

export interface BackpackLevel {
    capacity: number;
    price: number;
}

export interface DigDesign {
    terrain: {
        radius: number; blockHeight: number; seed: number; bedrockBlock: string; zoneWobble: number;
        /** Colour multiplied over the bedrock block: near black, so the mine's end reads as "no further", not as rock. */
        bedrockTint?: string;
        /**
         * Where the mine ends: a round wall of bedrock at `radius` from the hub, its line pushed in and out by up to
         * `wobble` blocks of smooth noise (big slow bends) plus up to `roughness` of finer bumps — never a perfect
         * circle. Everything beyond is bedrock too.
         */
        edge: { radius: number; wobble: number; roughness: number };
    };
    materials: MaterialDef[];
    zones: ZoneDef[];
    finds: FindDef[];
    /** Paid once when every find has been collected. */
    collectionReward: { money: number; hat: string };
    wardrobe: WardrobeCatalog;
    tools: ToolDef[];
    backpack: BackpackLevel[];
    tractor: TractorDef;
    achievements: AchievementDef[];
    boosts: BoostDef[];
    /** The BOOSTS tab opens with this many tool upgrades (or after the first new mine). */
    boostsUnlockToolLevel: number;
    prestige: PrestigeDef;
    mineThemes: MineTheme[];
    /**
     * What a find pays when claimed (DigProgress.findPayout): its rarity's base cash x (1 + perZone x the zone it was
     * dug up in), rounded to `roundTo`. The very first find pays at least the next upgrade. (A find's own `reward` is
     * no longer what it pays.)
     */
    findPayout: { rarity: Record<Rarity, number>; perZone: number; roundTo: number };
    /** The first artifact turns up on this many blocks dug, wherever the miner digs (MiningController). */
    firstFindAfterBlocks: number;
}

export const DIG: DigDesign = data as DigDesign;

/** Material index 0 is air in the terrain grid, so a cell's material is DIG.materials[value - 1]. */
export const materialOf = (cell: number): MaterialDef | undefined => DIG.materials[cell - 1];

/** Grid value (index + 1) of a material id. */
export const materialValue = (id: string): number => DIG.materials.findIndex((m) => m.id === id) + 1;
