// WallAudio.ts
//
// The sound effects (raw-assets/audio, `npm run audio`): hits by what the wall's made of, the swing, pieces breaking off, a
// wall coming down, the money. Each has a few takes, and a pitch and a loudness of its own every time, so a hundred hits
// don't turn into a machine gun.

import { Howl, Howler } from 'howler';
import { SaveStorage } from 'core/platforms/SaveStorage';
import PlatformHandler from 'core/platforms/PlatformHandler';

const MUTED_KEY = 'wall.muted';

interface Sound {
    files: string[];
    volume: number;
    /** The pitch, and how much it varies either way. */
    rate?: number;
    spread?: number;
}

const takes = (name: string, count: number) => Array.from({ length: count }, (_, i) => `${name}-${i + 1}`);

const SOUNDS = {
    'hit-soft': { files: takes('hit-soft', 5), volume: 0.8, spread: 0.1 },
    'hit-wood': { files: takes('hit-wood', 3), volume: 0.6, spread: 0.1 },
    'hit-stone': { files: takes('hit-stone', 5), volume: 0.75, spread: 0.08 },
    'hit-metal': { files: takes('hit-metal', 5), volume: 0.6, rate: 0.85, spread: 0.08 },
    'hit-glass': { files: takes('hit-glass', 5), volume: 0.6, rate: 0.9, spread: 0.1 },
    'hit-pick': { files: takes('hit-pick', 5), volume: 0.55, spread: 0.08 },
    swing: { files: takes('swing', 4), volume: 0.22, rate: 1.15, spread: 0.12 },
    break: { files: takes('break', 3), volume: 0.45, spread: 0.12 },
    collapse: { files: takes('collapse', 2), volume: 0.8, spread: 0.06 },
    boom: { files: ['boom'], volume: 0.6, rate: 0.9, spread: 0.05 },
    coins: { files: takes('coins', 2), volume: 0.5, spread: 0.06 },
    claim: { files: ['claim'], volume: 0.6 },
    tool: { files: ['tool'], volume: 0.6 },
    error: { files: ['error'], volume: 0.4 },
} satisfies Record<string, Sound>;

export type SoundName = keyof typeof SOUNDS;

const loaded = new Map<string, Howl>();
let muted = false;

export const WallAudio = {
    saveKeys: [MUTED_KEY],

    initialize(folder: string): void {
        muted = SaveStorage.getItem(MUTED_KEY) === 'true';
        Howler.mute(muted);
        for (const sound of Object.values(SOUNDS) as Sound[]) {
            for (const file of sound.files) loaded.set(file, new Howl({ src: [`./${folder}/audio/${file}.mp3`], volume: sound.volume }));
        }
        PlatformHandler.instance.onPause.add(() => Howler.mute(true));
        PlatformHandler.instance.onResume.add(() => Howler.mute(muted));
    },

    /** Plays one of its takes; `loud`: times its volume, `pitch`: times its pitch. */
    play(name: SoundName, loud = 1, pitch = 1): void {
        const sound: Sound = SOUNDS[name];
        const howl = loaded.get(sound.files[Math.floor(Math.random() * sound.files.length)]);
        if (!howl) return;
        const spread = sound.spread ?? 0;
        const id = howl.play();
        howl.rate((sound.rate ?? 1) * pitch * (1 + (Math.random() - 0.5) * 2 * spread), id);
        howl.volume(Math.min(1, sound.volume * loud * (0.88 + Math.random() * 0.12)), id);
    },

    /** Silent for an ad, and back. */
    hush(on: boolean): void {
        Howler.mute(on || muted);
    },

    get muted(): boolean {
        return muted;
    },

    toggleMuted(): boolean {
        muted = !muted;
        Howler.mute(muted);
        SaveStorage.setItem(MUTED_KEY, String(muted));
        return muted;
    },
};
