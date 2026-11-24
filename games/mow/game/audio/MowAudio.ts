// MowAudio.ts
//
// Every sound in the game, by cue (bandit-controller's GameAudio pattern): digging from there-is-rope (stone / metal /
// gem hits — the stone one de-boomed and trimmed with ffmpeg into dig-hit — a short rock crackle on a break, stone / metal / gem pickups landing in the backpack, stone
// footsteps, the build sting, the UI set), wooden hub footsteps from pizza, the celebration set from down (cheers,
// applause, sparkle, whoosh, the reveal sting) and bandit-controller's purchase set (ka-ching, fanfare, shine, star). Files: raw-assets/audio (`npm run audio` packs them).
// The soundtrack (the city's: cityMusic(), set in the editor's Sounds — by default Benjamin Andrews' "Redding Rainbow")
// loops quietly under everything on SoundManager's "music" layer, loaded on the first input (startMusic(): it's the
// biggest file, kept out of the initial download) and faded in; another city's crossfades in when travelling.
// Respects mute (SoundManager) and goes quiet while the page or platform is paused.

import SoundLoadManager from 'core/audio/SoundLoaderManager';
import SoundManager, { SoundAsset } from 'core/audio/SoundManager';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { Howler } from 'howler';
import audioManifest from '../../manifests/audio.json';
import { GrassDef, MOW, MUSIC_TRACKS, TOWN, cityMusic } from '../data/MowConfig';

const five = (name: string) => [1, 2, 3, 4, 5].map((i) => `${name}-${i}`);

/**
 * The grass cut's sounds: every cut-<set>-<n> in raw-assets/audio, by set. Each grass has its own (GrassDef.cutSound); a set
 * none uses isn't downloaded (it's there to try out: the debug panel's Sounds, the editor's Mowers tab). Drop files of your
 * own in as cut-mine-1.wav, cut-mine-2.wav... and run `npm run audio` to have them listed too.
 */
export const CUT_SETS: Record<string, string[]> = {};
for (const bundle of audioManifest.bundles) {
    for (const asset of bundle.assets) {
        const id = asset.alias[0].replace(/\.[^.]+$/, '');
        const set = /^cut-(.+)-\d+$/.exec(id)?.[1];
        if (set) (CUT_SETS[set] ??= []).push(id);
    }
}
const ALL_CUTS = new Set(Object.values(CUT_SETS).flat());
const cutIds = (set: string): string[] => CUT_SETS[set] ?? Object.values(CUT_SETS)[0] ?? [];
const USED_CUTS = new Set(MOW.grass.flatMap((grass) => cutIds(grass.cutSound ?? '')));

const SOUNDS = {
    // digging
    // dig-hit = there-is-rope's stone hit with the low boom cut and the tail trimmed (a crisp tick, not a pound);
    // the pickaxe and up play it higher (sharper), the shovel lower (duller).
    hitPick: { soundId: five('dig-hit'), volumeMinMax: [0.2, 0.26], pitchMinMax: [1.08, 1.22] },
    // Mowing (CUT_SETS): several variants, so ten a second don't sound like a machine.
    // This is the first grass's; tougher grass has its own (MowAudio.cut()).
    cut: { soundId: cutIds(MOW.grass[0].cutSound ?? ''), volumeMinMax: MOW.cutSound.volume, pitchMinMax: MOW.cutSound.pitch },
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
/** The soundtrack's layer, its fade in (the first), and the crossfade to another city's. */
const MUSIC = { layer: 'music', fadeInMs: 4000, crossfadeMs: 1500 };

/** The first minute's cues, downloaded before the rest (which comes in the manifest's order): the cut above all. */
const FIRST_CUES: Cue[] = ['cut', 'whoosh', 'coins', 'buyFanfare', 'buyShine', 'quest', 'item', 'click', 'sparkle', 'cheer', 'complete'];
/** The scene's other downloads wait this long at most for the cut's sounds (essentials()). */
const ESSENTIALS_MS = 4000;
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
    /** The soundtrack playing (startMusic()). */
    private static music: string | undefined;
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
            .filter((id) => !AMBIENT_LOOPS.has(id) && !MUSIC_TRACKS.has(id) && (!ALL_CUTS.has(id) || USED_CUTS.has(id)));
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
    /** The city's soundtrack: started (faded in), or another city's crossfaded to; the same one just takes its volume. */
    public static startMusic(): void {
        const music = cityMusic();
        if (this.music === music.sound) {
            SoundManager.instance.setLayerVolume(MUSIC.layer, music.volume, MUSIC.crossfadeMs);
            return;
        }
        const first = !this.music;
        this.music = music.sound;
        SoundManager.instance.setLayerVolume(MUSIC.layer, music.volume);
        void SoundManager.instance.playBackgroundSound(music.sound, first ? MUSIC.fadeInMs : MUSIC.crossfadeMs, MUSIC.layer).catch(() => {
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
        const first = FIRST_CUES.flatMap((cue) => SOUNDS[cue].soundId as string | string[]).filter((id) => this.ids.includes(id));
        const queue = [...new Set([...first, ...this.ids])];
        const next = async (): Promise<void> => {
            for (let id = queue.shift(); id; id = queue.shift()) await SoundLoadManager.instance.loadSoundByName(id).catch(() => undefined);
        };
        for (let i = 0; i < BACKGROUND_LOADS; i++) void next();
    }

    /** Resolves once the cut's sounds are in (or after ESSENTIALS_MS): what else is waiting to download starts then. */
    public static async essentials(): Promise<void> {
        const started = performance.now();
        while (!this.loaded('cut') && performance.now() - started < ESSENTIALS_MS) await new Promise((resolve) => window.setTimeout(resolve, 60));
    }

    /** Debug: one set of cut sounds (CUT_SETS) for every grass, from its download on; undefined: each grass's own. */
    public static async tryCutSet(set: string | undefined): Promise<void> {
        if (set) await Promise.all(cutIds(set).map((id) => SoundLoadManager.instance.loadSoundByName(id).catch(() => undefined)));
        this.triedCutSet = set;
    }

    private static triedCutSet: string | undefined;

    /** `grass` cut (or chewed): its own sounds; the first grass's until they're in. Sharing the cut's cooldown. */
    public static cut(grass: GrassDef): void {
        const ids = cutIds(this.triedCutSet ?? grass.cutSound ?? MOW.grass[0].cutSound ?? '');
        if (!ids.every((id) => SoundLoadManager.instance.getSound(id)?.isLoaded)) {
            this.play('cut');
            return;
        }
        if (!this.ready || this.isPaused() || SoundManager.instance.isMuted || !this.rested('cut')) return;
        const { volume, pitch } = MOW.cutSound;
        const scale = this.triedCutSet ? 1 : grass.cutPitch ?? 1;
        SoundManager.instance.tryToPlaySound({ soundId: ids, volumeMinMax: volume, pitchMinMax: [pitch[0] * scale, pitch[1] * scale] });
    }

    /** Whether `cue` may play again (its cooldown's over): if so, it starts anew. */
    private static rested(cue: Cue): boolean {
        const now = performance.now();
        if (now - (this.lastPlayed.get(cue) ?? -Infinity) < (COOLDOWN_MS[cue] ?? DEFAULT_COOLDOWN_MS)) return false;
        this.lastPlayed.set(cue, now);
        return true;
    }

    /** Every file of `cue` is in (its variants load together). */
    private static loaded(cue: Cue): boolean {
        const ids = SOUNDS[cue].soundId;
        return (Array.isArray(ids) ? ids : [ids]).every((id) => SoundLoadManager.instance.getSound(id)?.isLoaded);
    }

    public static play(cue: Cue): void {
        if (!this.ready || this.isPaused() || SoundManager.instance.isMuted || !this.loaded(cue)) return;
        if (!this.rested(cue)) return;
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
