// AntAudio.ts
//
// Ant's sounds: short effects for the buttons, the tiles, the ants picking up their blocks, a won or lost level, and a
// soundtrack ("Redding Rainbow" by Benjamin Andrews, from library3d/sounds) looping quietly under it all. Files:
// raw-assets/audio (`npm run audio` packs them as mp3 into public/ant/audio); the effects come from the dig, down,
// bandit and UFO games. Played through Howler (the music streamed), so the sound toggle
// (SoundManager's saved mute) silences everything; the music has its own saved setting (the pause popup's MUSIC).

import { Howl, Howler } from 'howler';
import SoundManager from 'core/audio/SoundManager';

export type Sfx =
    | 'click' | 'open' | 'close' | 'toggle' | 'tab' | 'tile' | 'slot' | 'full' | 'win' | 'applause' | 'lose' | 'whoosh' | 'pick';

/** Each effect's file(s) (one is picked at random), its volume, and the least time between two plays (seconds). */
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
};
const MUSIC = { file: 'music', volume: 0.3, fadeMs: 2500 };
const MUSIC_KEY = 'ant.music';

let folder = 'ant';
const howls = new Map<string, Howl>();
const lastPlayed = new Map<Sfx, number>();
let music: Howl | undefined;

function howl(file: string): Howl {
    let sound = howls.get(file);
    if (!sound) {
        sound = new Howl({ src: [`${folder}/audio/${file}.mp3`], preload: true });
        howls.set(file, sound);
    }
    return sound;
}

function savedMusic(): boolean {
    try {
        return window.localStorage.getItem(MUSIC_KEY) !== 'off';
    } catch {
        return true;
    }
}

export const AntAudio = {
    /** Where the files are (the game's folder), and the effects loaded ahead. */
    initialize(gameFolder: string): void {
        folder = gameFolder;
        for (const { files } of Object.values(SFX)) for (const file of files) howl(file);
    },

    /** An effect, a little higher or lower with `rate`. */
    play(name: Sfx, rate = 1): void {
        const { files, volume, gap } = SFX[name];
        const now = performance.now() / 1000;
        if (gap && now - (lastPlayed.get(name) ?? -Infinity) < gap) return;
        lastPlayed.set(name, now);
        const sound = howl(files[Math.floor(Math.random() * files.length)]);
        const id = sound.play();
        sound.volume(volume, id);
        sound.rate(rate, id);
    },

    /** The soundtrack, faded in (browsers only start audio after an input: call it from one, or it waits for one). */
    startMusic(): void {
        if (music) return;
        music = new Howl({ src: [`${folder}/audio/${MUSIC.file}.mp3`], loop: true, html5: true, volume: 0 });
        music.play();
        if (savedMusic()) music.fade(0, MUSIC.volume, MUSIC.fadeMs);
    },

    get musicOn(): boolean {
        return savedMusic();
    },

    /** The music on or off (saved). */
    set musicOn(on: boolean) {
        try {
            window.localStorage.setItem(MUSIC_KEY, on ? 'on' : 'off');
        } catch {
            // Private mode: it lasts this session.
        }
        if (music) music.fade(music.volume(), on ? MUSIC.volume : 0, 400);
    },

    /** Everything silent (an ad playing), or back as the player's mute says. */
    silence(on: boolean): void {
        Howler.mute(on || SoundManager.instance.isMuted);
    },

    /** Audio can start (the first input). */
    unlock(): void {
        const context = Howler.ctx as AudioContext | undefined;
        if (context?.state === 'suspended') void context.resume();
        AntAudio.startMusic();
    },
};
