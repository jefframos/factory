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
    /** What flies into the backpack when it breaks. */
    pickup: string;
    /** Optional pieces poking out of the block top (nuggets, gems). */
    decor?: string;
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
    patches: ZoneMix[];
    ores: ZoneMix[];
    /** Share of the zone's blocks hiding a find. */
    findChance: number;
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

/** A buried artifact (GDD §11): shows once its block is on a tunnel edge, pays `reward` when dug. */
export interface FindDef {
    id: string;
    name: string;
    model: string;
    /** Size of the model, in blocks. */
    size: number;
    reward: number;
    /** The zone (index) it's buried in. */
    zone: number;
    /** Relative odds among the zone's finds. */
    weight: number;
    rarity: Rarity;
}

/** Something to wear, bought with cash. */
export interface WardrobeItem {
    /** Colour hex, face image path (skins/...webp) or hat model key (MODELS.Hats). */
    id: string;
    name?: string;
    price: number;
    /** Not for sale: earned (`collection` = completing the artifact collection). */
    unlock?: 'collection';
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
    price: number;
    /** UI atlas icon: ToolIcon_<icon>. */
    icon: string;
}

export interface BackpackLevel {
    capacity: number;
    price: number;
}

export interface DigDesign {
    terrain: { radius: number; blockHeight: number; seed: number; bedrockBlock: string; zoneWobble: number };
    materials: MaterialDef[];
    zones: ZoneDef[];
    finds: FindDef[];
    /** Paid once when every find has been collected. */
    collectionReward: { money: number; hat: string };
    wardrobe: WardrobeCatalog;
    tools: ToolDef[];
    backpack: BackpackLevel[];
}

export const DIG: DigDesign = data as DigDesign;

/** Material index 0 is air in the terrain grid, so a cell's material is DIG.materials[value - 1]. */
export const materialOf = (cell: number): MaterialDef | undefined => DIG.materials[cell - 1];

/** Grid value (index + 1) of a material id. */
export const materialValue = (id: string): number => DIG.materials.findIndex((m) => m.id === id) + 1;
