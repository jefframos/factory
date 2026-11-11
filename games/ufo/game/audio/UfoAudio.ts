// UfoAudio.ts
//
// The sound effects, synthesized: a whoosh of suction while anything's going up the beam, a rising pop per bite on top of
// it, a thud on hitting something too tall, a chime when the town's done, and the saucer's hum on the move: a warbling,
// theremin-like old sci-fi sound. And the soundtrack (ui/ufo.json `music`, or the level's own, set in the editor's Sounds):
// it loops quietly under everything, loaded on the first input (it's a big file) and faded in; another level's crossfades
// in. Files: raw-assets/audio (`npm run audio` packs them).
//
// Everything plays through Howler's master gain, so the mute button and the platform's mute silence it all, and it goes
// quiet while the page or the platform is paused. The places' sounds and the cars are SpatialAudio's.

import SoundLoadManager from 'core/audio/SoundLoaderManager';
import SoundManager from 'core/audio/SoundManager';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { Howl, Howler } from 'howler';
import audioManifest from '../../manifests/audio.json';
import { DESIGN, Level, MusicDef, musicOf } from '../data/UfoConfig';

const MUSIC = { layer: 'music', fadeInMs: 4000, crossfadeMs: 1500 };

let folder = 'ufo';
/** The soundtrack playing. */
let music: string | undefined;
let applause: Howl | undefined;
/** A kill's cheer: one of these, at random (raw-assets/audio kill-yay-*). */
const CHEERS = { files: ['kill-yay-1.mp3', 'kill-yay-2.mp3', 'kill-yay-3.mp3', 'kill-yay-4.mp3'], volume: 0.7 };
let cheers: Howl[] = [];
const APPLAUSE = { file: 'applause.mp3', volume: 0.55 };
let platformPaused = false;
let volumeBeforePause: number | undefined;

/** Howler's audio context (made in initialize()). Browsers only start audio after an input. */
function ready(): AudioContext | undefined {
    const context = Howler.ctx as AudioContext | undefined;
    if (context?.state === 'suspended') void context.resume();
    return context;
}

/** Where every sound goes. */
const master = (): AudioNode => (Howler as unknown as { masterGain: AudioNode }).masterGain;

function tone(type: OscillatorType, from: number, to: number, seconds: number, volume: number, delay = 0): void {
    const audio = ready();
    if (!audio) return;
    const start = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(to, 1), start + seconds);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    oscillator.connect(gain).connect(master());
    oscillator.start(start);
    oscillator.stop(start + seconds);
}

/** The suction: looping noise through a moving filter. How loud, its pitch (Hz) and how far it rises while going, its wobble, its fades (seconds). */
const SUCTION = { volume: 0.028, moreVolume: 0.012, pitch: 380, rise: 350, riseSeconds: 0.5, wobble: 40, wobbleSpeed: 4, fadeIn: 0.15, fadeOut: 0.45, q: 0.8 };
const NOISE_SECONDS = 2;

interface Suction {
    gain: GainNode;
    filter: BiquadFilterNode;
}

let suction: Suction | undefined;

function suctionNodes(audio: AudioContext): Suction {
    if (suction) return suction;
    const samples = audio.sampleRate * NOISE_SECONDS;
    const buffer = audio.createBuffer(1, samples, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;
    const noise = audio.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const filter = audio.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = SUCTION.q;
    filter.frequency.value = SUCTION.pitch;
    const wobble = audio.createOscillator();
    wobble.frequency.value = SUCTION.wobbleSpeed;
    const wobbleDepth = audio.createGain();
    wobbleDepth.gain.value = SUCTION.wobble;
    wobble.connect(wobbleDepth).connect(filter.frequency);
    const gain = audio.createGain();
    gain.gain.value = 0;
    noise.connect(filter).connect(gain).connect(master());
    noise.start();
    wobble.start();
    suction = { gain, filter };
    return suction;
}

let sucking = false;

/**
 * The hum: two slightly detuned tones with a slow warble. How loud at full speed, its pitch at rest and how much higher at
 * full speed (Hz), the warble's speed (Hz) and depth (Hz), the detune (cents), how quickly it follows (seconds).
 */
const HUM = { volume: 0.035, pitch: 300, rise: 260, warbleSpeed: 5.5, warbleDepth: 32, detune: 9, follow: 0.18, sizeDrop: 0.5 };

interface Hum {
    gain: GainNode;
    tones: OscillatorNode[];
}

let hum: Hum | undefined;

function humNodes(audio: AudioContext): Hum {
    if (hum) return hum;
    const gain = audio.createGain();
    gain.gain.value = 0;
    gain.connect(master());
    const warble = audio.createOscillator();
    warble.frequency.value = HUM.warbleSpeed;
    const warbleDepth = audio.createGain();
    warbleDepth.gain.value = HUM.warbleDepth;
    warble.connect(warbleDepth);
    const tones = [-HUM.detune, HUM.detune].map((detune) => {
        const tone = audio.createOscillator();
        tone.type = 'sine';
        tone.frequency.value = HUM.pitch;
        tone.detune.value = detune;
        warbleDepth.connect(tone.frequency);
        tone.connect(gain);
        tone.start();
        return tone;
    });
    warble.start();
    hum = { gain, tones };
    return hum;
}

const isPaused = (): boolean => platformPaused || (PlatformHandler.instance.platform.usesPageVisibilityApi !== false && document.hidden);

/** A hidden tab stops the game's updates, so the suction would be left running: everything's silent with the tab. */
function syncPause(): void {
    if (isPaused()) {
        volumeBeforePause ??= Howler.volume();
        Howler.volume(0);
    } else if (volumeBeforePause !== undefined) {
        Howler.volume(volumeBeforePause);
        volumeBeforePause = undefined;
    }
}

export const UfoAudio = {
    /** Call once at boot: nothing downloads yet. */
    initialize(folderPath: string): void {
        folder = folderPath;
        const manifest = structuredClone(audioManifest);
        for (const bundle of manifest.bundles) {
            for (const asset of bundle.assets) asset.src = asset.src.map((src) => `./${folderPath}/audio/${src}`);
        }
        SoundLoadManager.instance.setUpManifests([manifest], ['default']);
        // Everything here plays through Howler's audio context. The first Howl ever made replaces that context (closing the
        // old one) on any device not at 44.1 kHz, so one is made now, loading nothing, before anything can hold on to it.
        new Howl({ src: [UfoAudio.url('none.mp3')], preload: false }).unload();
        document.addEventListener('visibilitychange', syncPause);
        PlatformHandler.instance.onPause.add(() => {
            platformPaused = true;
            syncPause();
        });
        PlatformHandler.instance.onResume.add(() => {
            platformPaused = false;
            syncPause();
        });
        syncPause();
    },

    /** Where an audio file is served from. */
    url(file: string): string {
        return `./${folder}/audio/${file}`;
    },

    /** Whether the player has done anything yet, so sound can start (the soundtrack starts on the first input). */
    started(): boolean {
        return music !== undefined;
    },

    /** The level's soundtrack: started (faded in), or another level's crossfaded to; the same one just takes its volume. */
    startMusic(level: Level): void {
        UfoAudio.playTrack(musicOf(level));
    },

    /** The home screen's: the sea. */
    startHomeMusic(): void {
        UfoAudio.playTrack(DESIGN.homeMusic);
    },

    /** Applause, for a level won. Fetched ahead (startMusic's the first chance, after an input), so it's on time. */
    loadApplause(): void {
        applause ??= new Howl({ src: [UfoAudio.url(APPLAUSE.file)], volume: APPLAUSE.volume });
        if (!cheers.length) cheers = CHEERS.files.map((file) => new Howl({ src: [UfoAudio.url(file)], volume: CHEERS.volume }));
    },

    /** The player ate a saucer: a cheer (a different one each time, at random), over a quick rising chime. */
    kill(): void {
        UfoAudio.loadApplause();
        cheers[Math.floor(Math.random() * cheers.length)]?.play();
        [784, 1175].forEach((note, i) => tone('triangle', note, note, 0.16, 0.08, i * 0.05));
    },

    applause(): void {
        UfoAudio.loadApplause();
        applause?.play();
    },

    playTrack(track: MusicDef): void {
        UfoAudio.loadApplause();
        if (music === track.sound) {
            SoundManager.instance.setLayerVolume(MUSIC.layer, track.volume, MUSIC.crossfadeMs);
            return;
        }
        const first = music === undefined;
        music = track.sound;
        SoundManager.instance.setLayerVolume(MUSIC.layer, track.volume);
        void SoundManager.instance.playBackgroundSound(track.sound, first ? MUSIC.fadeInMs : MUSIC.crossfadeMs, MUSIC.layer).catch(() => {
            // No soundtrack (missing file): the game plays on without it.
        });
    },

    /**
     * The saucer's hum. `speed`: how fast it's going (0..1): silent at rest, louder and higher going fast. `size`: how big
     * it is (bigger is lower). Call it every frame.
     */
    setHum(speed: number, size = 1): void {
        // Nothing to start until it first moves (an input: browsers allow sound from then on).
        if (!hum && speed <= 0) return;
        const audio = ready();
        if (!audio) return;
        const { gain, tones } = humNodes(audio);
        const now = audio.currentTime;
        gain.gain.setTargetAtTime(HUM.volume * speed, now, HUM.follow);
        const low = Math.pow(Math.max(size, 1), -HUM.sizeDrop);
        for (const tone of tones) tone.frequency.setTargetAtTime((HUM.pitch + HUM.rise * speed) * low, now, HUM.follow);
    },

    /**
     * The suction, while anything's going up the beam. `amount`: how many things (more is a bit louder). `size`: how big
     * the saucer is (bigger is lower). Call it every frame: it only acts on a change.
     */
    setSucking(on: boolean, amount = 1, size = 1): void {
        if (on === sucking) return;
        sucking = on;
        const audio = ready();
        if (!audio) return;
        const { gain, filter } = suctionNodes(audio);
        const now = audio.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        filter.frequency.cancelScheduledValues(now);
        if (!on) {
            gain.gain.linearRampToValueAtTime(0, now + SUCTION.fadeOut);
            return;
        }
        gain.gain.linearRampToValueAtTime(SUCTION.volume + SUCTION.moreVolume * Math.min(1, (amount - 1) / 3), now + SUCTION.fadeIn);
        const low = 1 / Math.sqrt(Math.max(size, 1));
        filter.frequency.setValueAtTime(SUCTION.pitch * low, now);
        filter.frequency.linearRampToValueAtTime((SUCTION.pitch + SUCTION.rise) * low, now + SUCTION.riseSeconds);
    },
    /** `size`: how big the thing eaten was next to the saucer (0..1): bigger is lower and longer. */
    eat(size: number): void {
        const pitch = 900 - 600 * Math.min(1, size);
        // A quick slurp: from low, shooting up.
        tone('sine', pitch * 0.45, pitch * 2.2, 0.09 + 0.12 * size, 0.12 + 0.06 * size);
    },
    /** A new size: a quick rising chime. */
    milestone(): void {
        [660, 880, 1320].forEach((note, i) => tone('triangle', note, note, 0.22, 0.1, i * 0.06));
    },
    bump(): void {
        tone('triangle', 130, 55, 0.18, 0.28);
    },
    win(): void {
        [523, 659, 784, 1047].forEach((note, i) => tone('triangle', note, note, 0.35, 0.16, i * 0.12));
    },
    toggle(): void {
        tone('sine', 620, 880, 0.08, 0.14);
    },
    /** A button pressed: a short soft pop. */
    click(): void {
        tone('sine', 520, 340, 0.06, 0.12);
        tone('triangle', 1040, 900, 0.03, 0.05);
    },
    /** The transition to another level. */
    whoosh(): void {
        tone('sine', 180, 720, 0.45, 0.12);
    },
};
