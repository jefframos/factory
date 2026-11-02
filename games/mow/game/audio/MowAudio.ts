// MowAudio.ts
//
// Every sound in the game, by cue (bandit-controller's GameAudio pattern): digging from there-is-rope (stone / metal /
// gem hits — the stone one de-boomed and trimmed with ffmpeg into dig-hit — a short rock crackle on a break, stone / metal / gem pickups landing in the backpack, stone
// footsteps, the build sting, the UI set), wooden hub footsteps from pizza, the celebration set from down (cheers,
// applause, sparkle, whoosh, the reveal sting) and bandit-controller's purchase set (ka-ching, fanfare, shine, star). Files: raw-assets/audio (`npm run audio` packs them).
// The soundtrack (MUSIC: Reed Mathis' "Somnia Variation 3") loops quietly under everything on SoundManager's "music"
// layer, loaded on the first input (startMusic(): it's the biggest file, kept out of the initial download) and faded in.
// Respects mute (SoundManager) and goes quiet while the page or platform is paused.

import { Howler } from 'howler';
import SoundManager, { SoundAsset } from 'core/audio/SoundManager';
import SoundLoadManager from 'core/audio/SoundLoaderManager';
import PlatformHandler from 'core/platforms/PlatformHandler';
import audioManifest from '../../manifests/audio.json';
import { TOWN } from '../data/MowConfig';

const five = (name: string) => [1, 2, 3, 4, 5].map((i) => `${name}-${i}`);

const SOUNDS = {
    // digging
    // dig-hit = there-is-rope's stone hit with the low boom cut and the tail trimmed (a crisp tick, not a pound);
    // the pickaxe and up play it higher (sharper), the shovel lower (duller).
    hitPick: { soundId: five('dig-hit'), volumeMinMax: [0.2, 0.26], pitchMinMax: [1.08, 1.22] },
    // Mowing: a short, bright swish per cut (a placeholder from the collect sounds, pitched up).
    cut: { soundId: five('collect-stone'), volumeMinMax: [0.07, 0.1], pitchMinMax: [1.35, 1.7] },
    hitStone: { soundId: five('dig-hit'), volumeMinMax: [0.22, 0.28], pitchMinMax: [0.88, 1.0] },
    // Soft ground (dirt, gravel): a low, gritty crunch instead of the stone tick. Placeholder: the stone footsteps
    // pitched down. To use real dirt-dig sounds, add dig-dirt-1..5 to raw-assets/audio (`npm run audio`) and switch
    // soundId to five('dig-dirt').
    hitDirt: { soundId: five('step-stone'), volumeMinMax: [0.3, 0.36], pitchMinMax: [0.68, 0.8] },
    hitMetal: { soundId: five('hit-metal'), volumeMinMax: [0.22, 0.28], pitchMinMax: [0.94, 1.08] },
    hitGem: { soundId: five('hit-gem'), volumeMinMax: [0.22, 0.28], pitchMinMax: [0.95, 1.1] },
    // Obsidian: volcanic glass — the gem hit and the break pitched well down, a deep glassy crack instead of the
    // rock tick (which, sped up by the drills and the tractor, turned into a harsh rattle).
    hitObsidian: { soundId: five('hit-gem'), volumeMinMax: [0.18, 0.22], pitchMinMax: [0.5, 0.62] },
    breakObsidian: { soundId: ['break-1', 'break-2', 'break-3'], volumeMinMax: [0.32, 0.38], pitchMinMax: [0.62, 0.72] },
    break: { soundId: ['break-1', 'break-2', 'break-3'], volumeMinMax: [0.3, 0.36], pitchMinMax: [0.92, 1.08] },
    collectStone: { soundId: five('collect-stone'), volumeMinMax: [0.14, 0.18], pitchMinMax: [0.95, 1.12] },
    collectMetal: { soundId: five('collect-metal'), volumeMinMax: [0.18, 0.22], pitchMinMax: [0.95, 1.1] },
    collectGem: { soundId: five('collect-gem'), volumeMinMax: [0.2, 0.24], pitchMinMax: [0.95, 1.1] },
    // walking
    stepStone: { soundId: five('step-stone'), volumeMinMax: [0.12, 0.16], pitchMinMax: [0.92, 1.08] },
    stepWood: { soundId: [0, 1, 2, 3, 4].map((i) => `step-wood-${i}`), volumeMinMax: [0.16, 0.2], pitchMinMax: [0.92, 1.08] },
    // On the lawn: the stone steps pitched down and quieter (a soft, dull pad rather than a click).
    stepGrass: { soundId: five('step-stone'), volumeMinMax: [0.07, 0.09], pitchMinMax: [0.7, 0.8] },
    // money
    coins: { soundId: ['coins-1', 'coins-2'], volumeMinMax: [0.18, 0.22], pitchMinMax: [0.95, 1.12] },
    // ui
    click: { soundId: ['ui-click-1', 'ui-click-2', 'ui-click-3'], volumeMinMax: 0.3 },
    open: { soundId: 'ui-open', volumeMinMax: 0.28 },
    close: { soundId: 'ui-close', volumeMinMax: 0.28 },
    tab: { soundId: 'ui-tab', volumeMinMax: 0.28 },
    error: { soundId: 'ui-error', volumeMinMax: 0.3 },
    confirm: { soundId: 'ui-confirm', volumeMinMax: 0.3 },
    toggle: { soundId: 'ui-toggle', volumeMinMax: 0.28 },
    quest: { soundId: 'ui-quest', volumeMinMax: 0.26 },
    item: { soundId: 'ui-item', volumeMinMax: 0.3 },
    complete: { soundId: 'ui-complete', volumeMinMax: 0.32 },
    // progress & celebration
    // purchases (bandit-controller's set): a cash-register ka-ching under every buy, a victory fanfare on upgrades
    // (plus a sparkle for tools), a star chime for wardrobe looks
    buyCash: { soundId: 'buy-cash', volumeMinMax: 0.4 },
    buyFanfare: { soundId: 'buy-fanfare', volumeMinMax: 0.34 },
    buyShine: { soundId: 'buy-shine', volumeMinMax: 0.26 },
    buyStar: { soundId: 'buy-star', volumeMinMax: 0.3 },
    build: { soundId: five('build'), volumeMinMax: 0.34, pitchMinMax: [0.95, 1.05] },
    sparkle: { soundId: 'sparkle', volumeMinMax: 0.3 },
    cheer: { soundId: ['yay-1', 'yay-2', 'yay-3', 'yay-4'], volumeMinMax: 0.3 },
    applause: { soundId: 'applause', volumeMinMax: 0.22 },
    reveal: { soundId: 'reveal', volumeMinMax: 0.3 },
    whoosh: { soundId: 'whoosh', volumeMinMax: 0.24, pitchMinMax: [0.92, 1.05] },
    // The bag filling up: a soft stuffed-sack "fwump" (made with ffmpeg: a cloth rustle over a low thump).
    bagFull: { soundId: 'bag-full', volumeMinMax: 0.5, pitchMinMax: [0.95, 1.05] },
} satisfies Record<string, SoundAsset>;

export type Cue = keyof typeof SOUNDS;

/** The soundtrack: its file (raw-assets/audio), volume (low: a bed under the game's sounds) and fade-in (ms). */
const MUSIC = { id: 'Somnia-Variation-3-relax-and-sleep-Reed-Mathis', volume: 0.18, fadeInMs: 4000, layer: 'music' };

/** Sound effects downloaded at once in the background (loadInBackground()). */
const BACKGROUND_LOADS = 3;

/** Long loops SpatialAudio plays itself (Web Audio, placed in 3D): not loaded as Howler cues. */
const AMBIENT_LOOPS = new Set(['ocean-ambient', ...(TOWN.sounds ?? []).map((zone) => zone.sound)]);

/** Repeats closer than this are dropped (a burst of pickups or coins doesn't stack into noise). */
const COOLDOWN_MS: Partial<Record<Cue, number>> = { cut: 90, stepStone: 120, stepWood: 120, stepGrass: 120, coins: 55, collectStone: 45, collectMetal: 45, collectGem: 45 };
const DEFAULT_COOLDOWN_MS = 60;

export class MowAudio {
    private static ready = false;
    private static platformPaused = false;
    private static volumeBeforePause: number | undefined;
    private static readonly lastPlayed = new Map<Cue, number>();
    private static folderPath = 'mow';
    private static musicStarted = false;
    /** The sound effects to download (loadInBackground()), and whether that's started. */
    private static ids: string[] = [];
    private static loading = false;

    /** Where an audio file is served from (for the ambient loops SpatialAudio loads itself). */
    public static url(file: string): string {
        return `./${this.folderPath}/audio/${file}`;
    }

    /**
     * Sets every sound of the packed manifest up (call once at boot; nothing downloads yet: loadInBackground(), once
     * the game is up, so the sounds stay out of the initial download).
     */
    public static async initialize(folderPath: string): Promise<void> {
        this.folderPath = folderPath;
        const manifest = structuredClone(audioManifest);
        for (const bundle of manifest.bundles) {
            for (const asset of bundle.assets) {
                asset.src = asset.src.map((src) => `./${folderPath}/audio/${src}`);
            }
        }
        SoundLoadManager.instance.setUpManifests([manifest], ['default']);
        this.ids = manifest.bundles.flatMap((bundle) => bundle.assets.map((asset) => asset.alias[0].replace(/\.[^.]+$/, '')))
            .filter((id) => !AMBIENT_LOOPS.has(id) && id !== MUSIC.id);
        this.ready = true;
        document.addEventListener('visibilitychange', this.syncPause);
        PlatformHandler.instance.onPause.add(this.onPause);
        PlatformHandler.instance.onResume.add(this.onResume);
        this.syncPause();
    }

    /**
     * The soundtrack, looping on its own layer (the scene calls it on the first input: kept out of the initial
     * download; it loads in the background). Once.
     */
    public static startMusic(): void {
        if (this.musicStarted) return;
        this.musicStarted = true;
        SoundManager.instance.setLayerVolume(MUSIC.layer, MUSIC.volume);
        void SoundManager.instance.playBackgroundSound(MUSIC.id, MUSIC.fadeInMs, MUSIC.layer).catch(() => {
            // No soundtrack (missing file): the game plays on without it.
        });
    }

    /**
     * Downloads the sound effects in the background, a few at a time (call once the game is up). A cue played before
     * its file is in is skipped, not played late.
     */
    public static loadInBackground(): void {
        if (this.loading) return;
        this.loading = true;
        const queue = [...this.ids];
        const next = async (): Promise<void> => {
            for (let id = queue.shift(); id; id = queue.shift()) await SoundLoadManager.instance.loadSoundByName(id).catch(() => undefined);
        };
        for (let i = 0; i < BACKGROUND_LOADS; i++) void next();
    }

    /** Every file of `cue` is in (its variants load together). */
    private static loaded(cue: Cue): boolean {
        const ids = SOUNDS[cue].soundId;
        return (Array.isArray(ids) ? ids : [ids]).every((id) => SoundLoadManager.instance.getSound(id)?.isLoaded);
    }

    public static play(cue: Cue): void {
        if (!this.ready || this.isPaused() || SoundManager.instance.isMuted || !this.loaded(cue)) return;
        const now = performance.now();
        if (now - (this.lastPlayed.get(cue) ?? -Infinity) < (COOLDOWN_MS[cue] ?? DEFAULT_COOLDOWN_MS)) return;
        this.lastPlayed.set(cue, now);
        SoundManager.instance.tryToPlaySound(SOUNDS[cue]);
    }

    private static readonly onPause = (): void => {
        this.platformPaused = true;
        this.syncPause();
    };

    private static readonly onResume = (): void => {
        this.platformPaused = false;
        this.syncPause();
    };

    private static readonly syncPause = (): void => {
        if (this.isPaused()) {
            if (this.volumeBeforePause === undefined) this.volumeBeforePause = Howler.volume();
            Howler.volume(0);
        } else if (this.volumeBeforePause !== undefined) {
            Howler.volume(this.volumeBeforePause);
            this.volumeBeforePause = undefined;
        }
    };

    private static isPaused(): boolean {
        return this.platformPaused || (PlatformHandler.instance.platform.usesPageVisibilityApi !== false && document.hidden);
    }
}
