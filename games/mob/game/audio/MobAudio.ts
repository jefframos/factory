// MobAudio.ts
//
// Mob's sounds: short effects for the cannon, gates, clashes, the base, giants, a won or lost battle and the buttons,
// and a soundtrack ("High Class" by Benjamin Andrews, from library3d/sounds) looping quietly under it all. Files:
// raw-assets/audio (`npm run audio` packs them into public/mob/audio, listed in manifests/audio.json); the effects come
// from the ant, dig and down games.
//
// Everything plays through core's SoundManager (as Ant's sounds do), so the platforms' own handling reaches it: the
// ads mute it, a platform mute silences it, and it goes quiet while the platform pauses the game. Each effect has its
// volume and the least time between two plays — hundreds of mobs clash, and only a few of those should sound.

import { Howler } from 'howler';
import SoundLoadManager from 'core/audio/SoundLoaderManager';
import SoundManager from 'core/audio/SoundManager';
import PlatformHandler from 'core/platforms/PlatformHandler';
import audioManifest from '../../manifests/audio.json';

export type Sfx = 'shot' | 'gate' | 'clash' | 'baseHit' | 'bigHit' | 'giant' | 'explosion' | 'win' | 'applause' | 'lose' | 'click' | 'whoosh' | 'coins';

/** Each effect's sound(s) (one is picked at random), its volume, and the least time between two plays (seconds). */
const SFX: Record<Sfx, { files: string[]; volume: number; gap?: number }> = {
    shot: { files: ['tap'], volume: 0.1, gap: 0.09 },
    gate: { files: ['bubbles'], volume: 0.18, gap: 0.1 },
    clash: { files: ['drop-1', 'drop-2', 'drop-3', 'drop-4', 'drop-5'], volume: 0.3, gap: 0.05 },
    baseHit: { files: ['dig-hit-1', 'dig-hit-2', 'dig-hit-3'], volume: 0.3, gap: 0.07 },
    bigHit: { files: ['explosion'], volume: 0.35, gap: 0.2 },
    giant: { files: ['reveal'], volume: 0.45 },
    explosion: { files: ['explosion'], volume: 0.6 },
    win: { files: ['ui-complete'], volume: 0.45 },
    applause: { files: ['applause'], volume: 0.4 },
    lose: { files: ['lose'], volume: 0.5 },
    click: { files: ['tap'], volume: 0.4 },
    whoosh: { files: ['whoosh'], volume: 0.4 },
    coins: { files: ['coins-1'], volume: 0.4, gap: 0.08 },
};
/** One knob for every effect. */
const SFX_LEVEL = 0.8;
const MUSIC = { sound: 'music', layer: 'music', volume: 0.2, fadeMs: 2500 };

const lastPlayed = new Map<Sfx, number>();
let musicStarted = false;
/** The platform's paused the game: everything silent until it resumes. */
let platformPaused = false;

export const MobAudio = {
    /** Call once at boot (`gameFolder`: where public/<game>/audio is): the sounds are listed, then loaded in the background. */
    initialize(gameFolder: string): void {
        const manifest = structuredClone(audioManifest);
        for (const bundle of manifest.bundles) {
            for (const asset of bundle.assets) asset.src = asset.src.map((src) => `./${gameFolder}/audio/${src}`);
        }
        SoundLoadManager.instance.setUpManifests([manifest], ['default']);
        for (const { files } of Object.values(SFX)) for (const file of files) SoundLoadManager.instance.loadInBackground(file);
        SoundManager.instance.setLayerVolume(MUSIC.layer, MUSIC.volume);
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

    /** Audio can start (the first input): wakes the audio context and fades the soundtrack in. */
    unlock(): void {
        const context = Howler.ctx as AudioContext | undefined;
        if (context?.state === 'suspended') void context.resume();
        if (musicStarted) return;
        musicStarted = true;
        void SoundManager.instance.playBackgroundSound(MUSIC.sound, MUSIC.fadeMs, MUSIC.layer).catch(() => undefined);
    },
};
