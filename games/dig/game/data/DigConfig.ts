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
    /** Its tint this much brighter (magma rock). */
    glow?: number;
    /** Size of the decor on the block (1 = normal): the better ores show bigger nuggets and gems. */
    decorScale?: number;
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
    /** Fog colour while the miner is in this zone: the far view fades into it (DigScene.updateFog). */
    fog?: string;
    /** How high its ground stands (it ramps up over terrain.zoneRamp at its border). */
    height?: number;
    /** Pools of lava in it: the share of its ground, and the pools' size (noise frequency). */
    lava?: { share: number; scale: number };
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
    /**
     * A gift: claimed for nothing (its price is only what it's worth). Unclaimed, it gets a FREE badge in the wardrobe
     * from the visit after the first hat's (DigProgress.freeLookBadge).
     */
    free?: boolean;
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
    /** World units across a tractor digs (its blades). */
    width: number;
    /** The bag it comes with (items; the capacity upgrade and boost add to it). */
    capacity: number;
    /** Past the last tractor: which of them it is (MK 2, 3...). */
    mark?: number;
    /** A tractor's size (1 = the base height), and how much faster than the first it chews. */
    rideScale?: number;
    rate?: number;
    price: number;
    /** UI atlas icon: ToolIcon_<icon> (a vehicle shows its model instead). */
    icon: string;
    /** Ridden in the mine (TractorRide, ui/dig.json `tractor`): every tool after the pickaxe. */
    vehicle?: boolean;
    /** A vehicle drawn in grey (the tractor's model and icon desaturated): the Digger, the weaker one. */
    greyscale?: boolean;
    /** A vehicle repainted in this colour (the tractor's shading kept): the Red Tractor. */
    tint?: string;
    /** A vehicle's speed multiplier on walking speed (unset: the tractor's `speedMultiplier`). */
    rideSpeed?: number;
    /** Frame colour once owned (same colours as the collection); not-owned tools show grey. */
    rarity: Rarity;
}

/** The tractor the miner rides outside the hub (TractorRide) once its tool (`vehicle`) is bought; positions are tractor-local, world units. */
export interface TractorDef {
    /** Under public/dig/models/. */
    model: string;
    /** Tractor height at its base size, world units (everything below is in that frame, x the tool's rideScale). */
    height: number;
    /** Its body: half across, behind and ahead of its middle. All of it digs. */
    body: { side: number; back: number; front: number };
    /** What the rock stops: a circle round its middle, and one at its blades. Always inside what digs. */
    collide: { radius: number; noseRadius: number };
    /** Turns the model so its front faces +Z (the miner's forward). */
    rotationY: number;
    /** Where the miner's feet go at the base size, and how far over them they sit (that doesn't grow with the tractor). */
    seat: { x: number; y: number; z: number; lift: number };
    /** Where parts (ui/tractor.json) go: off the frame they were made in. */
    partsAt: { x: number; y: number; z: number };
    /** Its blades: how high, and how far past its front (a share of a blade's radius). */
    blades: { lift: number; ahead: number };
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
export type BoostId = 'digSpeed' | 'sellPrice' | 'oreLuck' | 'moveSpeed' | 'bagSize' | 'width' | 'animalPower' | 'xpGain';

/**
 * A repeatable upgrade track (the HUD's POWER-UPS), level 0..maxLevel, each level `perLevel` more:
 * digSpeed = hits that much quicker (compounding), sellPrice = +that share of the sell value, oreLuck = that chance
 * more of an extra item from an ore block, moveSpeed = +that share of walking speed, bagSize = +that share of the bag,
 * width = +that share of what the tractor digs across. Level n costs
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
    /** Its whole effect doubles at each of these levels. */
    milestones?: number[];
}

/** A dungeon's layout: its seed is the first one's + seedStep x its number. */
export interface PrestigeDef {
    seedStep: number;
}

/** Dungeon n (from 0): rock takes `power` x n more, what's in it is worth x `value` ^ n, XP x `xp` ^ n; the portal's price. */
export interface DungeonsDef {
    power: number;
    value: number;
    xp: number;
    portal: { price: number; growth: number };
}

export interface AnimalDef {
    id: string;
    name: string;
    size: number;
}

/** The crew of animals (ui/dig.json animals says what each is). */
export interface AnimalsDef {
    price: number;
    growth: number;
    perKind: number;
    shown: number;
    every: number;
    bite: number;
    biteGrowth: number;
    radius: number;
    reach: number;
    kinds: AnimalDef[];
}

export type PerkId = 'cash' | 'dig' | 'animals' | 'tools' | 'blades' | 'bag' | 'crew' | 'xp' | 'luck' | 'speed' | 'portal';

/** Something bought with medals, for good. */
export interface PerkDef {
    id: PerkId;
    name: string;
    icon: string;
    per: number;
    max: number;
    cost: number;
    growth: number;
}

/** Rebirth: what it pays in medals, and what they buy. */
export interface RebirthDef {
    from: number;
    div: number;
    power: number;
    zones: number;
    perks: PerkDef[];
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

/** A pad's upgrade: the next tractor, sharper blades (digging power), a bigger bag, the next animal, the way to the next dungeon. */
export type PadKind = 'tool' | 'blades' | 'capacity' | 'animals' | 'portal';

/** The blades drawn at a Blades level (MowerBlades). */
export interface BladeLevelDef {
    count: number;
    /** Each one's length, as a share of its part of the width. */
    size: number;
    layout?: 'grid';
    rows?: number;
    cols?: number;
    color?: string;
}

/** How many blades a level has. */
export const bladeCount = (look: BladeLevelDef): number => (look.layout === 'grid' ? Math.max(1, (look.rows ?? 1) * (look.cols ?? 1)) : Math.max(1, look.count));

/** The player's level (shared by every mine). */
export interface LevelsDef {
    /** XP from level 1, 2...; past the end the last x growth each. */
    next: number[];
    growth: number;
    xp: { block: number; upgrade: number; zone: number; find: number; build: number; chest: number };
    /** A level pays base x level ^ power. */
    cash: { base: number; power: number };
    /** POWER-UPS comes at this level. */
    powerUps: number;
}

export interface DigDesign {
    terrain: {
        radius: number; blockHeight: number; seed: number; bedrockBlock: string; zoneWobble: number;
        /** Zones' heights ramp up over this many blocks at their borders. */
        zoneRamp: number;
        /** Rock this near the miner is drawn, to begin with (then as far as the camera sees). */
        viewRange: number;
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
    /** The tractor's digging: seconds a block takes at just enough power, x falloff a power over; a power short (locked past the list). */
    digging: { chewSec: number; falloff: number; shortSec: number[] };
    upgrades: { blades: { prices: number[]; growth: number }; capacity: { perLevel: number; maxLevel: number; basePrice: number; growth: number } };
    bladeLevels: BladeLevelDef[];
    lava: { slow: number };
    /** Past the last tractor: the same again, better (MK 2, 3...). */
    toolMarks: { price: number; rate: number; capacity: number };
    dungeons: DungeonsDef;
    animals: AnimalsDef;
    rebirth: RebirthDef;
    levels: LevelsDef;
    tractor: TractorDef;
    achievements: AchievementDef[];
    boosts: BoostDef[];
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
    /** After the tutorial, the guide leads to the next relics, one at a time (RelicHunt). */
    relicHunt: RelicHuntDef;
    /** Buried power and cash chests (VoxelTerrain.chests), and how far their beacons show. */
    chests: ChestsDef;
    /** Rich veins: ore blocks in seeded patches drawn bigger and dropping more (VoxelTerrain.rich). */
    richOre: RichOreDef;
}

export interface RelicHuntDef {
    /** Off = no hunt (the baseline: the guide ends with the tutorial). */
    enabled: boolean;
    /** How many relics after the first are guided to (counted in the mine's collection). */
    guided: number;
    /** A relic buried further than this many blocks from the miner, or in rock their tool can't dig, is moved... */
    maxDistance: number;
    /** ...into a diggable block this many blocks [min, max] from them. */
    place: number[];
}

/** A kind of chest: its model (and tint) poking out of the block. */
export interface ChestKindDef {
    model: string;
    size: number;
    tint?: string;
}

export interface ChestsDef {
    /** Blocks around the miner where buried treasure (finds and chests) shows a light beam. */
    beaconRange: number;
    /** One fixed rewarded-video tractor offer per mine, unlocked in a deeper zone. */
    power: ChestKindDef & {
        /** Minimum tool power lent; one tier above the owned tool if higher. */
        tool: string;
        seconds: number;
        /** Digging power it adds. */
        powerBonus: number;
        /** Hits come this much faster than the tool's own. */
        speedMultiplier: number;
        offer: { zone: string; revealDistance: number; triggerDistance: number };
    };
    /** Cash on the spot: reward[zone] x (1 +- spread) x the sell bonus; perZone of them buried in each zone. */
    cash: ChestKindDef & { reward: number[]; spread: number; perZone: number[] };
}

export interface RichOreDef {
    /** Noise frequency (per block) and the level an ore block must reach to be rich. */
    scale: number;
    threshold: number;
    /** Rich ore decor: this much bigger, this many pieces. */
    decorScale: number;
    decorCount: number;
    /** Items a rich ore block drops, x its material's drops. */
    dropMultiplier: number;
}

export type ChestKind = 'power' | 'cash';

export const DIG: DigDesign = data as unknown as DigDesign;

/** The tool at a level: past the last one, it again and again, better each time (toolMarks). */
export function toolAt(level: number): ToolDef {
    const last = DIG.tools.length - 1;
    if (level <= last) return DIG.tools[Math.max(0, level)];
    const mark = level - last;
    const tool = DIG.tools[last];
    const { price, rate, capacity } = DIG.toolMarks;
    return {
        ...tool, id: `${tool.id}${mark + 1}`, mark: mark + 1, price: Math.round(tool.price * Math.pow(price, mark)),
        rate: (tool.rate ?? 1) * Math.pow(rate, mark), capacity: Math.round(tool.capacity * Math.pow(capacity, mark)),
    };
}

/** The kind of the n-th animal (from 0). */
export function animalKind(n: number): AnimalDef {
    const { kinds, perKind } = DIG.animals;
    return kinds[Math.min(kinds.length - 1, Math.floor(n / perKind))];
}

/** Material index 0 is air in the terrain grid, so a cell's material is DIG.materials[value - 1]. */
export const materialOf = (cell: number): MaterialDef | undefined => DIG.materials[cell - 1];

/** Grid value (index + 1) of a material id. */
export const materialValue = (id: string): number => DIG.materials.findIndex((m) => m.id === id) + 1;
