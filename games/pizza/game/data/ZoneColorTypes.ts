// ZoneColorTypes.ts
//
// Centralizes every dotted-outline zone color (see DottedZoneVisualComponent.ts) that used to
// be a separate hardcoded DROPPER_ZONE_COLOR/DROP_ZONE_COLOR/etc constant duplicated across
// BuildingZone.ts/ShopZone.ts/GateDropZone.ts/DropZone.ts/Trigger.ts/CraftZone.ts/QueueZone.ts/
// FarmZone.ts/FarmPlotTile.ts (several of them coincidentally the SAME literal 0x3388ff, copied
// rather than shared) — one designer-editable place instead of hunting through nine files to
// re-theme what a dropper/trigger/queue zone looks like. Each entity type gets its OWN
// ZoneColorKind entry even where two currently share a color, since a level designer picking
// colors here should be free to make a building's dropper look different from a shop's without
// that also repainting every other kind that happened to match before.
//
// `color` is a CSS hex STRING (e.g. "#3388ff"), not a THREE-style 0xRRGGBB number — the
// editor's `type: 'color'` field (a native <input type="color"> picker) only exists for string
// fields today (see CharacterViewTypes.ts's own `color: string`/ParticleRegistry.ts's own
// `color: string`, the only two other precedents), so this follows the same convention rather
// than inventing a numeric-hex color field type just for this tab. getZoneColor() below is the
// one place that parses it into the number every DottedZoneVisualComponent call site actually
// needs — every consumer just calls that, never reads ZONE_COLOR_CONFIG directly.

export enum ZoneColorKind {
    BuildingDropper = 'buildingDropper',
    ShopDropper = 'shopDropper',
    MartDropper = 'martDropper',
    CraftingTableDropper = 'craftingTableDropper',
    GateDropper = 'gateDropper',
    DropZone = 'dropZone',
    Trigger = 'trigger',
    CraftTable = 'craftTable',
    Queue = 'queue',
    Farm = 'farm',
    FarmPlot = 'farmPlot',
}

export interface ZoneColorConfig {
    /** CSS-style hex color, e.g. "#3388ff" — see this file's own doc for why this is a string, not a number. */
    color: string;
}

export const ZONE_COLOR_CONFIG: Record<ZoneColorKind, ZoneColorConfig> = {
    [ZoneColorKind.BuildingDropper]: { color: "#3388ff" },
    [ZoneColorKind.ShopDropper]: { color: "#3388ff" },
    [ZoneColorKind.MartDropper]: { color: "#3388ff" },
    [ZoneColorKind.CraftingTableDropper]: { color: "#cc44cc" },
    [ZoneColorKind.GateDropper]: { color: "#3388ff" },
    [ZoneColorKind.DropZone]: { color: "#33cc66" },
    [ZoneColorKind.Trigger]: { color: "#1ed242" },
    [ZoneColorKind.CraftTable]: { color: "#cc44cc" },
    [ZoneColorKind.Queue]: { color: "#cc8800" },
    [ZoneColorKind.Farm]: { color: "#cc4444" },
    [ZoneColorKind.FarmPlot]: { color: "#55cc55" },
};

/** The THREE-style 0xRRGGBB number every DottedZoneVisualComponent call site actually needs, parsed from ZONE_COLOR_CONFIG's own CSS-hex string — see this file's own doc. */
export function getZoneColor(kind: ZoneColorKind): number {
    return parseInt(ZONE_COLOR_CONFIG[kind].color.replace('#', ''), 16);
}
