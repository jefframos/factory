// Themes.ts
//
// A zone's looks, as the editor saves them (games/mob/ui/themes.json; npm run editor → Themes tab; ui/zones.json picks one
// per zone): the colours of the field, the ground round it, the sea, the sky; what's round the field (the sea, or cliffs:
// a valley); hedges or a kit's wall pieces down its sides, towers at its corners; the style of a level's polygons
// (raised blocks, breakables) and water holes; and props dotted round the outside, each a model with a height and a count.
// Pure cosmetics: the gameplay pieces (cannon, gates, forts, houses...) and every level work the same in any theme.
//
// Colours are "#rrggbb" in the file (numbers here). Model paths are under public/mob/models/ (e.g. "castle/wall.glb";
// the editor's library imports land in "town/library/...").

import themesFile from '../../ui/themes.json';

export interface ThemeProp {
    model: string;
    /** Its height on the field (world units): the model is scaled to it. */
    height: number;
    count: number;
}

export interface ThemeKit {
    /** A side wall piece (1 unit long along X, as the Kenney kits) and, every `pillarEvery` pieces, a pillar (none: no walls). */
    wall?: string;
    pillar?: string;
    pillarEvery?: number;
    /** Tower pieces stacked at the field's corners (bottom first). */
    tower?: string[];
    /** Scale of the kit's 1-unit pieces (walls, towers). */
    scale: number;
    /** Props dotted outside the field (on the cliffs, in a valley; a seeded scatter: the same every time). */
    props?: ThemeProp[];
}

export interface Theme {
    id: string;
    name: string;
    sky: number;
    /** The sea round the island (and water holes), as a CSS colour for the water shader. */
    sea: string;
    /** The ground round the field, the field and its stripes. */
    ground: number;
    field: number;
    stripe: number;
    /** Hedge colours (alternating), when there's no kit wall and no valley. */
    hedge: [number, number];
    /** A level's raised polygons: top and sides; its breakables: top and sides; a water hole's rim. */
    block: { top: number; side: number };
    breakable: { top: number; side: number };
    rim: number;
    /** What's round the field: the sea (an island), or grassy cliffs either side and behind the base (a valley). */
    surround: 'sea' | 'valley';
    /** A valley's cliffs: their height, top, and face. */
    cliff?: { height: number; top: number; side: number };
    kit?: ThemeKit;
}

/** A theme as the file has it: colours as strings. */
type Colour = string | number;
export interface ThemeFile {
    id: string;
    name: string;
    sky: Colour;
    sea: string;
    ground: Colour;
    field: Colour;
    stripe: Colour;
    hedge: [Colour, Colour];
    block: { top: Colour; side: Colour };
    breakable: { top: Colour; side: Colour };
    rim: Colour;
    surround: 'sea' | 'valley';
    cliff?: { height: number; top: Colour; side: Colour };
    kit?: ThemeKit;
}

const colour = (value: Colour): number => (typeof value === 'number' ? value : parseInt(value.replace('#', ''), 16) || 0);

/** A theme from its file form (the editor's live preview sends these too). */
export function parseTheme(data: ThemeFile): Theme {
    return {
        ...data,
        sky: colour(data.sky),
        ground: colour(data.ground),
        field: colour(data.field),
        stripe: colour(data.stripe),
        hedge: [colour(data.hedge[0]), colour(data.hedge[1])],
        block: { top: colour(data.block.top), side: colour(data.block.side) },
        breakable: { top: colour(data.breakable.top), side: colour(data.breakable.side) },
        rim: colour(data.rim),
        cliff: data.cliff ? { height: data.cliff.height, top: colour(data.cliff.top), side: colour(data.cliff.side) } : undefined,
    };
}

export const THEMES: Record<string, Theme> = Object.fromEntries(
    (themesFile as unknown as { themes: ThemeFile[] }).themes.map((theme) => [theme.id, parseTheme(theme)]),
);

export const DEFAULT_THEME = 'beach';

export function themeById(id: string | undefined): Theme {
    return THEMES[id ?? DEFAULT_THEME] ?? THEMES[DEFAULT_THEME] ?? Object.values(THEMES)[0];
}
