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
    /** Hat model id under models/hats (e.g. "Crown"); unset = bare head. */
    hat?: string;
}

export const CHARACTER_VIEWS: Record<string, CharacterView> = {
    default: { color: '#76e31c', face: 'skins/face-brave-1.webp' },
    red: { color: '#ff5252', face: 'skins/devil.webp' },
    yellow: { color: '#ffca28', face: 'skins/clown.webp' },
    blue: { color: '#42a5f5', face: 'skins/cool.webp' },
    coral: { color: '#ff8a65', face: 'skins/face-fire-1.webp' },
    purple: { color: '#ab47bc', face: 'skins/face-smirk-1.webp' },
    cyan: { color: '#26c6da', face: 'skins/cat.webp' },
    pink: { color: '#ec407a', face: 'skins/face-hearts-1.webp' },
    violet: { color: '#7e57c2', face: 'skins/panda.webp' },
    green: { color: '#66bb6a', face: 'skins/dog.webp' },
    orange: { color: '#ffa726', face: 'skins/face-sunglasses-2.webp' },
};

/** What the player actually spawns wearing — matches bandit's "isStarter" look. */
export const DEFAULT_CHARACTER_VIEW: CharacterView = CHARACTER_VIEWS.blue;

/** Reserved uniform, separate from customizable squad looks. */
export const GUARD_CHARACTER_VIEW: Readonly<CharacterView> = {
    color: '#234b8e',
    face: 'skins/face-brave-1.webp',
};

/** Non-preload art (skins/faces) is served straight from the image pipeline's output — see public/bandit-controller/images/non-preload. */
const NON_PRELOAD_IMAGE_BASE = 'bandit-controller/images/non-preload/';

export function resolveSkinImagePath(relativePath: string): string {
    return `./${NON_PRELOAD_IMAGE_BASE}${relativePath}`;
}

/** The three squad members shown on Home and used by squad levels. */
export const SQUAD_VIEW_NAMES = ['blue', 'purple', 'orange'] as const;

/** Faces the player can pick for a squad member on the Home screen. */
export const FACE_OPTIONS: string[] = [
    'skins/cool.webp',
    'skins/face-smirk-1.webp',
    'skins/face-sunglasses-2.webp',
    'skins/face-brave-1.webp',
    'skins/face-smile-1.webp',
    'skins/face-1.webp',
    'skins/face-laughing-1.webp',
    'skins/face-money-1.webp',
    'skins/face-mustache-1.webp',
    'skins/face-glasses-1.webp',
    'skins/face-star-1.webp',
    'skins/face-hearts-1.webp',
    'skins/face-smile-3.webp',
    'skins/face-smiling-2.webp',
    'skins/face-scary-1.webp',
    'skins/face-scary-2.webp',
    'skins/face-crying-1.webp',
    'skins/face-crying-2.webp',
    'skins/face-dizzy-1.webp',
    'skins/face-dizzy-2.webp',
    'skins/face-fire-1.webp',
    'skins/face-sneaky-1.webp',
    'skins/face-grumpy-1.webp',
    'skins/face-sleepy-1.webp',
    'skins/face-cutie-1.webp',
    'skins/face-toothy-1.webp',
    'skins/face-bandit-1.webp',
    'skins/cat.webp',
    'skins/dog.webp',
    'skins/panda.webp',
    'skins/clown.webp',
    'skins/devil.webp',
];

/** Body colors a squad member can pick; no two members may share one. */
export const SQUAD_COLORS: string[] = [
    '#42a5f5', '#ab47bc', '#ffa726', '#ff5252', '#66bb6a',
    '#ffca28', '#26c6da', '#ec407a', '#7e57c2', '#8d6e63',
];

const SQUAD_LOOK_KEY = 'bandit-controller.squadLook';

function saveLook(): void {
    try {
        const look: Record<string, { face: string; hat?: string; color: string }> = {};
        for (const name of SQUAD_VIEW_NAMES) {
            look[name] = { face: CHARACTER_VIEWS[name].face, hat: CHARACTER_VIEWS[name].hat, color: CHARACTER_VIEWS[name].color };
        }
        window.localStorage.setItem(SQUAD_LOOK_KEY, JSON.stringify(look));
    } catch {
        // storage unavailable: the choice just won't persist
    }
}

export function setSquadFace(viewName: string, face: string): void {
    if (CHARACTER_VIEWS[viewName]) {
        CHARACTER_VIEWS[viewName].face = face;
        saveLook();
    }
}

/** Whether another squad member already wears `color`. */
export function isSquadColorTaken(viewName: string, color: string): boolean {
    return SQUAD_VIEW_NAMES.some((name) => name !== viewName && CHARACTER_VIEWS[name].color === color);
}

export function setSquadColor(viewName: string, color: string): boolean {
    if (!CHARACTER_VIEWS[viewName] || isSquadColorTaken(viewName, color)) {
        return false;
    }
    CHARACTER_VIEWS[viewName].color = color;
    saveLook();
    return true;
}

export function setSquadHat(viewName: string, hat: string | undefined): void {
    if (CHARACTER_VIEWS[viewName]) {
        CHARACTER_VIEWS[viewName].hat = hat;
        saveLook();
    }
}

try {
    const saved = JSON.parse(window.localStorage.getItem(SQUAD_LOOK_KEY) ?? '{}') as Record<string, { face?: string; hat?: string; color?: string }>;
    for (const [name, look] of Object.entries(saved)) {
        const view = CHARACTER_VIEWS[name];
        if (view && look.face && FACE_OPTIONS.includes(look.face)) {
            view.face = look.face;
        }
        if (view && look.color && SQUAD_COLORS.includes(look.color) && !isSquadColorTaken(name, look.color)) {
            view.color = look.color;
        }
        if (view && look.hat) {
            view.hat = look.hat;
        }
    }
} catch {
    // ignore corrupted saves
}
