// GameThemeStorage.ts

import type { SoundAsset } from 'core/audio/SoundManager';
import type { CloudBackdropLayoutMode } from '../game/vfx/CloudBackdropLayer';
import { SKY_CYCLE_COLORS } from './TowerIslandProgression';

/**
 * The three views ShapeModeToggleButton cycles through (one tap = one step,
 * wrapping — see getNextThemeId()): 'circle'/'cube' are the same catalog
 * (pieces-config.json) with PieceShapeMode's existing polygon-clear toggle
 * for the square look; 'cats' swaps to an entirely different catalog
 * (pieces-config-cats.json) AND the whole visual backdrop below.
 */
export type GameThemeId = 'circle' | 'cube' | 'cats';

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

/** Matches the old fixed SKY_CYCLE_COLORS/STAR_TINT/STAR_IMAGE_PATHS/poleColor/baseColor defaults exactly — selecting 'circle' (the default at boot) is a visual no-op. */
const DEFAULT_PARTICLES: GameThemeParticleConfig = {
    images: ['vfx/star_06.webp', 'vfx/star_07.webp'],
    tint: 0xfdf138,
};

/** Matches SKY_CYCLE_COLORS's own [top, left, bottom, right] order — see TowerSkyController's own identical default. */
const DEFAULT_SKY_COLORS: GameThemeSkyColors = {
    top: SKY_CYCLE_COLORS[0],
    left: SKY_CYCLE_COLORS[1],
    bottom: SKY_CYCLE_COLORS[2],
    right: SKY_CYCLE_COLORS[3],
};

const DEFAULT_CLOUD_IMAGES: string[] = ['vfx/cloud.webp'];
/** Matches CloudBackdropLayer's own `alpha`/`layout` defaults exactly. */
const DEFAULT_CLOUDS_ALPHA = 0.1;
const DEFAULT_CLOUDS_LAYOUT: CloudBackdropLayoutMode = 'uniform';

export const GAME_THEMES: readonly GameThemeConfig[] = [
    {
        id: 'cats',
        label: '🐱 Cats',
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
        id: 'circle',
        label: '● Circles',
        piecesBundle: 'pieces-config.json',
        forceSquare: false,
        cloudImages: DEFAULT_CLOUD_IMAGES,
        cloudsAlpha: DEFAULT_CLOUDS_ALPHA,
        cloudsLayout: DEFAULT_CLOUDS_LAYOUT,
        particles: DEFAULT_PARTICLES,
        skyColors: DEFAULT_SKY_COLORS,
        wallColor: 0x3388ff,
        trapdoorColor: 0x33cc66,
    },
    {
        id: 'cube',
        label: '■ Cubes',
        piecesBundle: 'pieces-config.json',
        forceSquare: true,
        cloudImages: DEFAULT_CLOUD_IMAGES,
        cloudsAlpha: DEFAULT_CLOUDS_ALPHA,
        cloudsLayout: DEFAULT_CLOUDS_LAYOUT,
        particles: DEFAULT_PARTICLES,
        skyColors: DEFAULT_SKY_COLORS,
        wallColor: 0x3388ff,
        trapdoorColor: 0x33cc66,
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
