// RestaurantAudio.ts
//
// Short effects (from the Ant game's set: raw-assets/audio, packed by `npm run audio` into public/restaurant/audio) through
// core's SoundManager, so the platforms' mute / ad handling reaches them. As Ant's AntAudio, without music.

import { Howler } from 'howler';
import SoundLoadManager from 'core/audio/SoundLoaderManager';
import SoundManager from 'core/audio/SoundManager';
import PlatformHandler from 'core/platforms/PlatformHandler';
import audioManifest from '../../manifests/audio.json';

export type Sfx = 'click' | 'pick' | 'drop' | 'sizzle' | 'whoosh' | 'happy' | 'sad' | 'coins' | 'day' | 'wrong';

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
};
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

    /** Audio can start (the first input). */
    unlock(): void {
        const context = Howler.ctx as AudioContext | undefined;
        if (context?.state === 'suspended') void context.resume();
    },
};
