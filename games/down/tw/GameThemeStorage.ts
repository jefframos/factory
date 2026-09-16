// GameThemeStorage.ts

import type { SoundAsset } from 'core/audio/SoundManager';
import type { CloudBackdropLayoutMode } from '../game/vfx/CloudBackdropLayer';

/**
 * The real, player-selectable levels (see HomePopup's "Choose your level"
 * list) — each its own piece catalog (pieces-config-cats.json/
 * pieces-config-dogs.json) plus its own visual backdrop below. 'circle'/
 * 'cube' (the original single catalog, toggled square via PieceShapeMode)
 * are retired as real levels — ShapeModeToggleButton (dev-only) still cycles
 * between these two for quick testing.
 */
export type GameThemeId = 'cats' | 'dogs' | 'penguin';

export interface GameThemeParticleConfig {
    /** Non-preload image paths (see resolveIslandImagePath) — one texture per "kind", picked per-particle at random for visual variety, same convention as StarSparkleLayer's own default star_06/star_07 pair. */
    images: string[];
    /** Tint multiplied over each particle texture's own color — 0xffffff leaves it untouched. */
    tint: number;
}

/** Fed to TowerSkyController's four-way rotating gradient — one color per corner, same convention as the old fixed SKY_CYCLE_COLORS. */
export interface GameThemeSkyColors {
    top: string;
    left: string;
    bottom: string;
    right: string;
}

/**
 * Extra one-shot SFX layered ON TOP of a theme, never replacing whatever
 * already plays for that moment (see IslandViewScene's onMerge/onBlockFirstHit
 * handlers — merge currently plays nothing at all, hit already plays
 * Assets.Sounds.Game.Impact; both keep doing exactly that regardless of this
 * config). Both fields are optional and independent — a theme with neither
 * set (the default for every theme today) changes nothing. e.g. a 'meow'
 * clip for `merge` on the 'cats' theme, once that clip actually exists in
 * games/down/raw-assets/audio and is registered in Assets.ts/manifests/audio.json.
 */
export interface GameThemeSounds {
    /** Plays alongside whatever normally happens when two pieces merge. */
    merge?: SoundAsset;
    /** Plays alongside Assets.Sounds.Game.Impact when a block first touches something. */
    hit?: SoundAsset;
}

export interface GameThemeConfig {
    id: GameThemeId;
    /** Button label ShapeModeToggleButton shows while this theme is active. */
    label: string;
    /** Bare atlas frame name (same PIXI.Sprite.from() convention as PieceDefinition.icon) for HomePopup's "Choose your level" row — a representative low-tier piece from this theme's own catalog, since there's no dedicated select-level icon art. */
    icon: string;
    /** PIXI.Assets bundle alias PieceStorage.loadPieces() (re)populates PIECES from when this theme is selected. */
    piecesBundle: string;
    /** Clears every piece's `polygon` after loading (plain square look, via PieceShapeMode's existing 'cube' mode) — only the 'cube' theme sets this; 'cats' keeps its own authored circle polygons same as 'circle'. */
    forceSquare: boolean;
    /** Non-preload cloud image paths (see resolveIslandImagePath) — cycled across CloudBackdropLayer's vertical stack, same convention as `particles.images`. */
    cloudImages: string[];
    /** Opacity applied to every cloud sprite (0-1) — see CloudBackdropLayer's own `alpha` default. */
    cloudsAlpha: number;
    /** 'uniform' (default): clouds evenly spaced/scaled across the whole vertical stack. 'bottom-heavy': bigger and more densely packed toward the bottom of the SAME range — see CloudBackdropLayer's own doc. */
    cloudsLayout: CloudBackdropLayoutMode;
    particles: GameThemeParticleConfig;
    skyColors: GameThemeSkyColors;
    /** Side containment pole color — see Tower3DConfig.poleColor / TowerWallSync3D's 'column' static-piece fallback. */
    wallColor: number;
    /** Base/trapdoor panel color — see Tower3DConfig.baseColor / TowerBaseSync3D's 'base' (starting floor) and 'milestone' (every trapdoor-replaced floor after) static-piece fallback. */
    trapdoorColor: number;
    /** Extra merge/hit SFX layered on top for this theme — see GameThemeSounds' own doc. Omit entirely (every theme today does) for no extra sound. */
    sounds?: GameThemeSounds;
}


export const GAME_THEMES: readonly GameThemeConfig[] = [
    {
        id: 'cats',
        label: '🐱 Cats',
        icon: 'cat-0',
        piecesBundle: 'pieces-config-cats.json',
        forceSquare: false,
        cloudImages: ['vfx/cloud-cats.webp'],
        cloudsAlpha: 0.5,
        sounds: {
            merge: { soundId: ['Cat-Meow-01', 'Cat-Meow-02'], volumeMinMax: 0.2, pitchMinMax: [0.95, 1.05] },
            hit: { soundId: ['Cat-Meow-Angry-01', 'Cat-Meow-Angry-02'], volumeMinMax: 0.2, pitchMinMax: [0.95, 1.05] },
        },

        cloudsLayout: 'bottom-heavy',
        particles: { images: ['vfx/fish.webp', 'vfx/star_06.webp', 'vfx/star_07.webp'], tint: 0xFFF3B0 },
        skyColors: { top: '#FFB6D9', left: '#FFD8A8', bottom: '#FFF3B0', right: '#C8F4C8' },
        wallColor: 0xff8fb3,
        trapdoorColor: 0x15DAB1,
    },
    {
        id: 'dogs',
        label: '🐶 Dogs',
        icon: 'dog1',
        piecesBundle: 'pieces-config-dogs.json',
        forceSquare: false,
        cloudImages: ['vfx/cloud-cats.webp'],
        cloudsAlpha: 0.5,
        sounds: {
            //merge: { soundId: ['Cat-Meow-01', 'Cat-Meow-02'], volumeMinMax: 0.2, pitchMinMax: [0.95, 1.05] },
            merge: { soundId: ['bark1'], volumeMinMax: 0.07, pitchMinMax: [1.5, 1.7] },
            hit: { soundId: ['bark2'], volumeMinMax: 0.07, pitchMinMax: [1.7, 1.9] },
        },

        cloudsLayout: 'bottom-heavy',
        particles: { images: ['vfx/star_06.webp', 'vfx/star_07.webp'], tint: 0xFFF3B0 },
        skyColors: { top: '#34B6FD', left: '#61D4FE', bottom: '#A0F0FD', right: '#72DCFD' },
        wallColor: 0xFEA685,
        trapdoorColor: 0x0CDE81,
    },
    {
        id: 'penguin',
        label: '🐶 Penguin',
        icon: 'pen1',
        piecesBundle: 'pieces-config-penguin.json',
        forceSquare: false,
        cloudImages: ['vfx/cloud-cats.webp'],
        cloudsAlpha: 0.5,
        sounds: {
            //merge: { soundId: ['Cat-Meow-01', 'Cat-Meow-02'], volumeMinMax: 0.2, pitchMinMax: [0.95, 1.05] },
            merge: { soundId: ['bark1'], volumeMinMax: 0.07, pitchMinMax: [1.5, 1.7] },
            hit: { soundId: ['bark2'], volumeMinMax: 0.07, pitchMinMax: [1.7, 1.9] },
        },

        cloudsLayout: 'bottom-heavy',
        particles: { images: ['vfx/star_06.webp', 'vfx/star_07.webp'], tint: 0xFFF3B0 },
        skyColors: { top: '#34B6FD', left: '#61D4FE', bottom: '#3180f8', right: '#72DCFD' },
        wallColor: 0x0CDE81,
        trapdoorColor: 0xFEA685,
    },
];

export function getGameTheme(id: GameThemeId): GameThemeConfig {
    return GAME_THEMES.find(theme => theme.id === id) ?? GAME_THEMES[0];
}

/** Type guard for a value loaded from storage (see TowerDevMeta's saved `themeId`) — untyped JSON, so it needs validating before use as a GameThemeId. */
export function isGameThemeId(id: unknown): id is GameThemeId {
    return typeof id === 'string' && GAME_THEMES.some(theme => theme.id === id);
}

/** Steps through GAME_THEMES in array order, wrapping — see ShapeModeToggleButton.handleTap(). */
export function getNextThemeId(current: GameThemeId): GameThemeId {
    const index = GAME_THEMES.findIndex(theme => theme.id === current);
    return GAME_THEMES[(index + 1) % GAME_THEMES.length].id;
}
