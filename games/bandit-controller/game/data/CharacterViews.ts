// CharacterViews.ts
//
// Same color + face data bandit's shop/Character-Views system uses (see
// that project's CharacterViewTypes.ts) — a named look is just a body color
// plus a default face decal, no shop/equip persistence needed here.

export interface CharacterView {
    /** CSS-style hex color — the body/head's base color. */
    color: string;
    /** Relative path under images/non-preload — e.g. "skins/cool.webp". Resolve with resolveSkinImagePath(). */
    face: string;
}

export const CHARACTER_VIEWS: Record<string, CharacterView> = {
    default: { color: '#76e31c', face: 'skins/face-brave-1.webp' },
    red: { color: '#ff5252', face: 'skins/devil.webp' },
    yellow: { color: '#ffca28', face: 'skins/clown.webp' },
    blue: { color: '#42a5f5', face: 'skins/cool.webp' },
    coral: { color: '#ff8a65', face: 'skins/pirate.webp' },
    purple: { color: '#ab47bc', face: 'skins/ninja.webp' },
    cyan: { color: '#26c6da', face: 'skins/cat.webp' },
    pink: { color: '#ec407a', face: 'skins/face-hearts-1.webp' },
    violet: { color: '#7e57c2', face: 'skins/panda.webp' },
    green: { color: '#66bb6a', face: 'skins/dog.webp' },
    orange: { color: '#ffa726', face: 'skins/face-sunglasses-2.webp' },
};

/** What the player actually spawns wearing — matches bandit's "isStarter" look. */
export const DEFAULT_CHARACTER_VIEW: CharacterView = CHARACTER_VIEWS.blue;

/** Non-preload art (skins/faces) is served straight from the image pipeline's output — see public/bandit-controller/images/non-preload. */
const NON_PRELOAD_IMAGE_BASE = 'bandit-controller/images/non-preload/';

export function resolveSkinImagePath(relativePath: string): string {
    return `./${NON_PRELOAD_IMAGE_BASE}${relativePath}`;
}
