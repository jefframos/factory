// WallAudio.ts
//
// The sound effects (raw-assets/audio, `npm run audio`): hits by what the wall's made of, the swing, pieces breaking off, a
// wall coming down, the money; and the music, a loop under it all (tools/build-music.py), got once it's being played. Each has a few takes, and a pitch and a loudness of its own every time, so a hundred hits
// don't turn into a machine gun.

import { Howl, Howler } from 'howler';
import { SaveStorage } from 'core/platforms/SaveStorage';
import PlatformHandler from 'core/platforms/PlatformHandler';
import SoundManager from 'core/audio/SoundManager';

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
    combo: { files: ['combo'], volume: 0.5 },
    beat: { files: ['beat'], volume: 0.5, spread: 0.12 },
    clear: { files: ['clear'], volume: 0.6 },
    win: { files: ['win'], volume: 0.75 },
    applause: { files: ['applause'], volume: 0.7 },
} satisfies Record<string, Sound>;

export type SoundName = keyof typeof SOUNDS;

/** The music: how loud, how long it takes to come in (ms), and the part of the file that goes round (ms: build-music.py says). */
const MUSIC = { file: 'music', volume: 0.34, comesIn: 3500, from: 250, long: 75789.478 };

const loaded = new Map<string, Howl>();
/** The combo's notes, over the first (half tones). */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

/** Heard in the first seconds; and how many are got at once. */
const FIRST: SoundName[] = ['swing', 'hit-soft', 'break', 'collapse', 'boom', 'coins', 'hit-wood', 'claim', 'tool', 'combo'];
const AT_ONCE = 3;

let music: Howl | undefined;
let musicWanted = false;
let soundsIn = false;
let path = '';
let muted = false;
/** Hidden (the tab, the app), and an ad on. */
let paused = false;
let hushed = false;

/** Howler's mute from all that wants it off: the player's toggle, the platform's mute (always wins: YouTube, CrazyGames), a pause, an ad. */
function applyMute(): void {
    Howler.mute(muted || paused || hushed || SoundManager.instance.platformMuted);
}

export const WallAudio = {
    saveKeys: [MUTED_KEY],

    initialize(folder: string): void {
        path = `./${folder}/audio/`;
        muted = SaveStorage.getItem(MUTED_KEY) === 'true';
        applyMute();
        PlatformHandler.instance.onPause.add(() => {
            paused = true;
            applyMute();
        });
        PlatformHandler.instance.onResume.add(() => {
            paused = false;
            applyMute();
        });
        // (SoundManager sets Howler's mute itself when the platform's changes: the rest of what wants it off is put back over it.)
        SoundManager.instance.onMuteChange.add(applyMute);
    },

    /** The sounds, once the first screen's up (nothing in its way): a few at a time, the soonest heard first; then the music, if it's wanted. */
    loadInBackground(): void {
        const order = [...new Set([...FIRST, ...(Object.keys(SOUNDS) as SoundName[])])];
        const left = order.flatMap((name) => (SOUNDS[name] as Sound).files.map((file) => ({ file, volume: SOUNDS[name].volume })));
        let busy = AT_ONCE;
        const next = (): void => {
            const one = left.shift();
            if (one) {
                loaded.set(one.file, new Howl({ src: [`${path}${one.file}.mp3`], volume: one.volume, onload: next, onloaderror: next }));
                return;
            }
            busy--;
            if (busy > 0) return;
            soundsIn = true;
            if (musicWanted) this.startMusic();
        };
        for (let i = 0; i < AT_ONCE; i++) next();
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

    /** The combo's bell, a step higher each time (in the music's key). */
    combo(step: number): void {
        const at = Math.max(0, Math.min(SCALE.length - 1, step));
        this.play('combo', 1, 2 ** (SCALE[at] / 12));
    },

    /** The music comes in (the player's begun: no browser plays any before that). Once. */
    startMusic(): void {
        // (Not before the sounds: it's the biggest of them all.)
        musicWanted = true;
        if (music || !soundsIn) return;
        music = new Howl({ src: [`${path}${MUSIC.file}.mp3`], volume: 0, sprite: { loop: [MUSIC.from, MUSIC.long, true] } });
        music.once('load', () => {
            const id = music!.play('loop');
            music!.fade(0, MUSIC.volume, MUSIC.comesIn, id);
        });
    },

    /** Silent for an ad, and back. */
    hush(on: boolean): void {
        hushed = on;
        applyMute();
    },

    get muted(): boolean {
        return muted;
    },

    toggleMuted(): boolean {
        muted = !muted;
        applyMute();
        SaveStorage.setItem(MUTED_KEY, String(muted));
        return muted;
    },
};
