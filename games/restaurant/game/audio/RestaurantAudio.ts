// RestaurantAudio.ts
//
// Short effects (from the Ant game's set: raw-assets/audio, packed by `npm run audio` into public/restaurant/audio) through
// core's SoundManager, so the platforms' mute / ad handling reaches them. Plus loops that run while something's going on
// (the patty sizzling, the oven, the delivery car: their own background layers, faded in and out) and the music
// (Redding Rainbow, Benjamin Andrews: library3d/sounds), quiet under it all.

import { Howler } from 'howler';
import SoundLoadManager from 'core/audio/SoundLoaderManager';
import SoundManager from 'core/audio/SoundManager';
import PlatformHandler from 'core/platforms/PlatformHandler';
import audioManifest from '../../manifests/audio.json';

export type Sfx = 'click' | 'pick' | 'drop' | 'sizzle' | 'whoosh' | 'happy' | 'sad' | 'coins' | 'day' | 'wrong' | 'ding' | 'machine' | 'scoop' | 'munch' | 'burp';
export type Loop = 'sizzle' | 'oven' | 'car';

const SFX: Record<Sfx, { files: string[]; volume: number; gap?: number }> = {
    click: { files: ['tap'], volume: 0.45 },
    pick: { files: ['bubbles'], volume: 0.4, gap: 0.05 },
    drop: { files: ['drop-1', 'drop-2', 'drop-3'], volume: 0.45, gap: 0.05 },
    sizzle: { files: ['whoosh'], volume: 0.2 },
    whoosh: { files: ['whoosh'], volume: 0.4 },
    happy: { files: ['ui-complete'], volume: 0.5 },
    sad: { files: ['lose'], volume: 0.45 },
    coins: { files: ['collect-gem-1', 'collect-gem-2', 'collect-gem-3'], volume: 0.3, gap: 0.06 },
    day: { files: ['applause'], volume: 0.45 },
    wrong: { files: ['ui-error'], volume: 0.3, gap: 0.2 },
    // A pizza out of the oven; the ice cream machine's handle; a sundae's scoop; a customer's bites and the end of the meal.
    ding: { files: ['oven-ding'], volume: 0.4 },
    machine: { files: ['icecream-machine'], volume: 0.35, gap: 0.3 },
    scoop: { files: ['scoop'], volume: 0.3, gap: 0.08 },
    munch: { files: ['munch-01', 'munch-02', 'munch-13', 'munch-18'], volume: 0.22, gap: 0.12 },
    burp: { files: ['burp'], volume: 0.18 },
};

/** The loops: each one's file, its level (x SFX_LEVEL and the effects' volume), how long it fades in and out (ms). */
const LOOPS: Record<Loop, { file: string; volume: number; fade: number }> = {
    sizzle: { file: 'sizzle-loop', volume: 0.28, fade: 150 },
    oven: { file: 'oven-hum', volume: 0.22, fade: 250 },
    car: { file: 'car-engine', volume: 0.3, fade: 300 },
};
/** The music: its file, its layer's level (under the effects). */
const MUSIC = { file: 'redding-rainbow', volume: 0.16, fade: 1500 };
const looping = new Set<Loop>();
let musicOn = false;
const SFX_LEVEL = 0.7;

const lastPlayed = new Map<Sfx, number>();
let platformPaused = false;

export const RestaurantAudio = {
    initialize(gameFolder: string): void {
        const manifest = structuredClone(audioManifest);
        for (const bundle of manifest.bundles) {
            for (const asset of bundle.assets) asset.src = asset.src.map((src) => `./${gameFolder}/audio/${src}`);
        }
        SoundLoadManager.instance.setUpManifests([manifest], ['default']);
        for (const { files } of Object.values(SFX)) for (const file of files) SoundLoadManager.instance.loadInBackground(file);
        for (const { file } of Object.values(LOOPS)) SoundLoadManager.instance.loadInBackground(file);
        PlatformHandler.instance.onPause.add(() => {
            platformPaused = true;
            Howler.volume(0);
        });
        PlatformHandler.instance.onResume.add(() => {
            platformPaused = false;
            Howler.volume(1);
        });
    },

    play(name: Sfx, rate = 1): void {
        if (platformPaused) return;
        const { files, volume, gap } = SFX[name];
        const now = performance.now() / 1000;
        if (gap && now - (lastPlayed.get(name) ?? -Infinity) < gap) return;
        lastPlayed.set(name, now);
        const file = files[Math.floor(Math.random() * files.length)];
        void SoundManager.instance.playSoundById(file, { volume: volume * SFX_LEVEL * SoundManager.instance.sfxVolume, pitch: rate }).catch(() => undefined);
    },

    /** A loop on or off (faded): idempotent, so a scene can set it every frame from what's going on. `level`: 0..1 of its volume. */
    loop(name: Loop, on: boolean, level = 1): void {
        const { file, volume, fade } = LOOPS[name];
        const layer = `loop-${name}`;
        if (on) {
            SoundManager.instance.setLayerVolume(layer, volume * level * SFX_LEVEL);
            if (looping.has(name)) return;
            looping.add(name);
            void SoundManager.instance.playBackgroundSound(file, fade, layer).catch(() => undefined);
        } else if (looping.has(name)) {
            looping.delete(name);
            SoundManager.instance.stopLayer(layer, fade);
        }
    },

    /** Every loop off (a scene going away). */
    stopLoops(): void {
        for (const name of [...looping]) RestaurantAudio.loop(name, false);
    },

    /** The music, from the first time it's asked for on (it plays on through every scene). */
    music(): void {
        if (musicOn) return;
        musicOn = true;
        SoundManager.instance.setLayerVolume('music', MUSIC.volume);
        void SoundManager.instance.playBackgroundSound(MUSIC.file, MUSIC.fade, 'music').catch(() => undefined);
    },

    /** Audio can start (the first input). */
    unlock(): void {
        const context = Howler.ctx as AudioContext | undefined;
        if (context?.state === 'suspended') void context.resume();
    },
};
