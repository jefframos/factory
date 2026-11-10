// AntAudio.ts
//
// Ant's sounds: short effects for the buttons, the tiles, the ants picking up their blocks and dropping them down the
// anthill, a won or lost level, and a
// soundtrack ("Redding Rainbow" by Benjamin Andrews, from library3d/sounds) looping quietly under it all. Files:
// raw-assets/audio (`npm run audio` packs them as mp3 into public/ant/audio, listed in manifests/audio.json); the
// effects come from the dig, down, bandit and UFO games.
//
// Everything plays through core's SoundManager (as the other games' sounds do), so the platforms' own handling reaches
// it: the ads mute it (PokiPlatform / YouTubePlayablePlatform call muteAllSounds / restoreSound round every ad), a
// platform mute (YouTube's button) and the in-game toggle silence it, and it goes quiet while the platform pauses the
// game. Effects get their own volume x SoundManager's effects volume; the music's on its "music" layer (the pause
// popup's MUSIC sets that layer, saved).

import { Howler } from 'howler';
import SoundLoadManager from 'core/audio/SoundLoaderManager';
import SoundManager from 'core/audio/SoundManager';
import PlatformHandler from 'core/platforms/PlatformHandler';
import audioManifest from '../../manifests/audio.json';

export type Sfx =
    | 'click' | 'open' | 'close' | 'toggle' | 'tab' | 'tile' | 'slot' | 'full' | 'win' | 'applause' | 'lose' | 'whoosh' | 'pick' | 'drop';

/** Each effect's sound(s) (one is picked at random), its volume, and the least time between two plays (seconds). */
const SFX: Record<Sfx, { files: string[]; volume: number; gap?: number }> = {
    // Soft taps and bubbles for the buttons and tiles (not beeps).
    click: { files: ['tap'], volume: 0.45 },
    open: { files: ['bubbles'], volume: 0.35 },
    close: { files: ['tap'], volume: 0.4 },
    toggle: { files: ['tap'], volume: 0.45 },
    tab: { files: ['tap'], volume: 0.4 },
    tile: { files: ['bubbles'], volume: 0.35, gap: 0.08 },
    slot: { files: ['bubbles'], volume: 0.45 },
    full: { files: ['ui-error'], volume: 0.25, gap: 0.25 },
    win: { files: ['ui-complete'], volume: 0.45 },
    applause: { files: ['applause'], volume: 0.45 },
    lose: { files: ['lose'], volume: 0.55 },
    whoosh: { files: ['whoosh'], volume: 0.5 },
    // Many ants at once: soft, quick pops, never too many together.
    pick: { files: ['collect-gem-1', 'collect-gem-2', 'collect-gem-3', 'collect-gem-4', 'collect-gem-5'], volume: 0.18, gap: 0.07 },
    // An ant dropping its block down the anthill: a soft little thud (from the down game).
    drop: { files: ['drop-1', 'drop-2', 'drop-3', 'drop-4', 'drop-5'], volume: 0.3, gap: 0.06 },
};
/** Every effect's volume is scaled by this — one knob for the whole mix. */
const SFX_LEVEL = 0.65;
/** The soundtrack: "With You" (Everet Almond). */
const MUSIC = { sound: 'with-you', layer: 'music', volume: 0.22, fadeMs: 2500 };
const MUSIC_KEY = 'ant.music';

const lastPlayed = new Map<Sfx, number>();
let musicStarted = false;
/** The platform's paused the game (its own pause, e.g. YouTube's): everything silent until it resumes. */
let platformPaused = false;

function savedMusic(): boolean {
    try {
        return window.localStorage.getItem(MUSIC_KEY) !== 'off';
    } catch {
        return true;
    }
}

export const AntAudio = {
    /** Call once at boot (`gameFolder`: where public/<game>/audio is): the sounds are listed, then loaded in the background. */
    initialize(gameFolder: string): void {
        const manifest = structuredClone(audioManifest);
        for (const bundle of manifest.bundles) {
            for (const asset of bundle.assets) asset.src = asset.src.map((src) => `./${gameFolder}/audio/${src}`);
        }
        SoundLoadManager.instance.setUpManifests([manifest], ['default']);
        for (const { files } of Object.values(SFX)) for (const file of files) SoundLoadManager.instance.loadInBackground(file);
        // The music layer as the saved setting says (ads mute it and put it back).
        SoundManager.instance.setLayerVolume(MUSIC.layer, savedMusic() ? MUSIC.volume : 0);
        PlatformHandler.instance.onPause.add(() => {
            platformPaused = true;
            Howler.volume(0);
        });
        PlatformHandler.instance.onResume.add(() => {
            platformPaused = false;
            Howler.volume(1);
        });
    },

    /** An effect, a little higher or lower with `rate`. */
    play(name: Sfx, rate = 1): void {
        if (platformPaused) return;
        const { files, volume, gap } = SFX[name];
        const now = performance.now() / 1000;
        if (gap && now - (lastPlayed.get(name) ?? -Infinity) < gap) return;
        lastPlayed.set(name, now);
        const file = files[Math.floor(Math.random() * files.length)];
        void SoundManager.instance.playSoundById(file, { volume: volume * SFX_LEVEL * SoundManager.instance.sfxVolume, pitch: rate }).catch(() => undefined);
    },

    /** The soundtrack, faded in on its layer (browsers only start audio after an input: call it from one). */
    startMusic(): void {
        if (musicStarted) return;
        musicStarted = true;
        void SoundManager.instance.playBackgroundSound(MUSIC.sound, MUSIC.fadeMs, MUSIC.layer).catch(() => undefined);
    },

    get musicOn(): boolean {
        return savedMusic();
    },

    /** The music on or off (saved): its layer's volume. */
    set musicOn(on: boolean) {
        try {
            window.localStorage.setItem(MUSIC_KEY, on ? 'on' : 'off');
        } catch {
            // Private mode: it lasts this session.
        }
        SoundManager.instance.setLayerVolume(MUSIC.layer, on ? MUSIC.volume : 0, 400);
    },

    /** Audio can start (the first input). */
    unlock(): void {
        const context = Howler.ctx as AudioContext | undefined;
        if (context?.state === 'suspended') void context.resume();
        AntAudio.startMusic();
    },
};
