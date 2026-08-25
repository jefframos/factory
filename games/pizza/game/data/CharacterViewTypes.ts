// CharacterViewTypes.ts
//
// Data-driven definition of a selectable player appearance — color, head
// shape, and a default face — set from the pizza web editor's "Character
// Views" tab. Exactly one entry should have `isStarter: true`; that's the
// look MainPlayer spawns with (see getStarterCharacterView(), the one
// reader) before the player has ever equipped anything from the shop.
//
// The `face` here is only a DEFAULT — ShopStorage's own equip system (see
// that file's own doc) can still override it live afterward: CharacterBody.
// applyCharacterView() loads this face onto the head cube first, then
// mountHeadCube()'s existing equipped-skin sync takes over exactly like it
// always has, and simply never fires (leaving this default in place) for a
// player who hasn't equipped anything yet.

export type HeadShape = 'cube';

export interface CharacterViewConfig {
    /** CSS-style hex color, e.g. "#4aba8a" — the body/head cube's base color. Deliberately a literal color, not a merge-game "value" (see CubeBuilder.buildCharacterHead(), which shares NO cache/lookup with CubeBuilder's other value-keyed builders). */
    color: string;
    /** Only 'cube' exists today (see CubeBuilder.buildCharacterHead()) — kept as its own field, not hardcoded, so a future second shape is a data change here, not a code change. */
    headShape: HeadShape;
    /** Relative path under images/non-preload — e.g. "skins/pirate.webp" (same convention as ShopStorage.ShopItem.texture) — this view's default face. */
    face: string;
    /** Exactly one entry should have this true — see getStarterCharacterView(). undefined/false on every other entry. */
    isStarter?: boolean;
}

export const CHARACTER_VIEW_CONFIG: Record<string, CharacterViewConfig> = {
    default: {
        color: "#76e31c",
        headShape: "cube",
        face: "skins/face-brave-1.webp",
        isStarter: false,
    },
    "red": {
        "color": "#ff5252",
        "headShape": "cube",
        "face": "skins/devil.webp"
    },
    "yellow": {
        "color": "#ffca28",
        "headShape": "cube",
        "face": "skins/clown.webp"
    },
    "blue": {
        "color": "#42a5f5",
        "headShape": "cube",
        "face": "skins/cool.webp",
        "isStarter": true
    },
    "coral": {
        "color": "#ff8a65",
        "headShape": "cube",
        "face": "skins/pirate.webp"
    },
    "purple": {
        "color": "#ab47bc",
        "headShape": "cube",
        "face": "skins/ninja.webp"
    },
    "cyan": {
        "color": "#26c6da",
        "headShape": "cube",
        "face": "skins/cat.webp"
    },
    "pink": {
        "color": "#ec407a",
        "headShape": "cube",
        "face": "skins/face-hearts-1.webp"
    },
    "violet": {
        "color": "#7e57c2",
        "headShape": "cube",
        "face": "skins/panda.webp"
    },
    "green": {
        "color": "#66bb6a",
        "headShape": "cube",
        "face": "skins/dog.webp"
    },
    "orange": {
        "color": "#ffa726",
        "headShape": "cube",
        "face": "skins/face-sunglasses-2.webp"
    }
};

export function getCharacterView(id: string): CharacterViewConfig | undefined {
    return CHARACTER_VIEW_CONFIG[id];
}

/** The one CharacterView flagged `isStarter`, or undefined if none is (a misconfigured registry — e.g. every entry's flag got cleared) — MainPlayer falls back to its own hardcoded default look in that case rather than crashing. */
export function getStarterCharacterView(): CharacterViewConfig | undefined {
    return Object.values(CHARACTER_VIEW_CONFIG).find(view => view.isStarter);
}
