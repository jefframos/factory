// EngineSound.ts
//
// The mower's running sound (there are no mower recordings in the game's audio): synthesised live with the Web Audio
// context Howler already runs, one voice per kind of mower, each following the walking / driving speed (0..1):
//  - `reel`     (the push reel mowers): no motor; the blades clicking past the bed knife (short bright noise ticks
//               at a rate set by the speed) over a soft whirr. Silent standing still.
//  - `electric` (the walked engine mowers): a smooth motor hum and whine with a breath of blade air, no chug.
//  - `tractor`  (the ride-on mowers): a petrol putt-putt (sawtooth + sub through a low-pass, its loudness chugging).
//  - `car`      (the town's traffic, placed in 3D by SpatialAudio): a smoother engine with tyre roar.
// Levels are kept low: it loops the whole time a mower runs, so it sits under the music and the cuts.
// It plays through Howler's master gain, so the game's mute, the platform's mute and MowAudio's pause (Howler's
// volume to 0) silence it like every other sound.

import { Howler } from 'howler';

export type MowerVoice = 'reel' | 'electric' | 'tractor' | 'car';

/** Seconds the levels take to follow the speed, and to fade in / out. */
const GLIDE = 0.25;
const FADE = 0.25;
/**
 * A mower left standing (below `speed` for `after` seconds) fades slowly to silence (`fade`: the time constant, so
 * about three times that to nothing) and comes back quickly (`back`) once it moves. Cars keep idling.
 */
const STILL = { speed: 0.05, after: 0.2, fade: 0.6, back: 0.08 };
/** Every mower voice's overall level (the per-voice volumes below are relative to it); cars are set by SpatialAudio. */
const MOWER_VOLUME = 0.6;
const levelOf = (voice: MowerVoice) => (voice === 'car' ? 1 : MOWER_VOLUME);

const REEL = {
    /** Blade ticks a second at full speed (a 5-blade reel turning a few times a second). */
    clicks: 15,
    clickPeak: 0.24,
    clickFreq: 3400,
    whirr: 0.07,
    whirrFreq: 1100,
};
const ELECTRIC = {
    pitch: { idle: 150, full: 225 },
    volume: { idle: 0.016, full: 0.032 },
    air: { idle: 0.02, full: 0.06 },
};
const TRACTOR = {
    pitch: { idle: 42, full: 70 },
    cutoff: { idle: 320, full: 820 },
    chug: { idle: 8, full: 15 },
    volume: { idle: 0.03, full: 0.05 },
};
/** A town car going by: a smoother, higher engine than the tractor's, with tyre roar on the road. */
const CAR = {
    pitch: { idle: 55, full: 95 },
    cutoff: { idle: 380, full: 1000 },
    volume: { idle: 0.035, full: 0.06 },
    tyres: { idle: 0, full: 0.09 },
};

const lerp = (range: { idle: number; full: number }, k: number) => range.idle + (range.full - range.idle) * k;

/** Two seconds of white noise per context, looped by the voices that need it. */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(ctx: BaseAudioContext): AudioBuffer {
    let buffer = noiseBuffers.get(ctx);
    if (!buffer) {
        buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        noiseBuffers.set(ctx, buffer);
    }
    return buffer;
}

interface Running {
    kind: MowerVoice;
    ctx: BaseAudioContext;
    out: GainNode;
    sources: AudioScheduledSourceNode[];
    /** Follows the speed (0..1); `delta`: seconds since the last call. */
    follow: (k: number, delta: number) => void;
    /** Seconds the mower has stood still, and whether it's counted as moving (heard). */
    still: number;
    moving: boolean;
}

export class EngineSound {
    private running?: Running;

    /** Starts `voice` (switching from another one); no-op if it's already running or the audio context isn't there yet. */
    public start(voice: MowerVoice, ctx = Howler.ctx as BaseAudioContext | undefined,
        destination = (Howler as unknown as { masterGain?: AudioNode }).masterGain): void {
        if (this.running?.kind === voice) return;
        this.stop();
        if (!ctx || !destination) return;
        const out = ctx.createGain();
        out.gain.value = 0;
        out.gain.setTargetAtTime(levelOf(voice), ctx.currentTime, FADE / 3);
        out.connect(destination);
        const build = { reel, electric, tractor, car }[voice];
        const { sources, follow } = build(ctx, out);
        for (const source of sources) source.start();
        this.running = { kind: voice, ctx, out, sources, follow, still: 0, moving: true };
        follow(0, 0);
    }

    /** Follows the walking / driving speed: 0 = standing (idling), 1 = flat out. A mower standing still fades away (STILL). */
    public update(speed: number, delta: number): void {
        const n = this.running;
        if (!n) return;
        const k = Math.min(1, Math.max(0, speed));
        n.follow(k, delta);
        if (n.kind === 'car') return;
        n.still = k < STILL.speed ? n.still + delta : 0;
        const moving = n.still < STILL.after;
        if (moving === n.moving) return;
        n.moving = moving;
        n.out.gain.setTargetAtTime(moving ? levelOf(n.kind) : 0, n.ctx.currentTime, moving ? STILL.back : STILL.fade);
    }

    /** Fades the mower out and lets it go. */
    public stop(): void {
        const n = this.running;
        if (!n) return;
        this.running = undefined;
        const now = n.ctx.currentTime;
        n.out.gain.cancelScheduledValues(now);
        n.out.gain.setTargetAtTime(0, now, FADE / 3);
        for (const source of n.sources) source.stop(now + FADE + 0.1);
        window.setTimeout(() => n.out.disconnect(), (FADE + 0.2) * 1000);
    }
}

function noiseSource(ctx: BaseAudioContext): AudioBufferSourceNode {
    const source = ctx.createBufferSource();
    source.buffer = noise(ctx);
    source.loop = true;
    source.loopStart = Math.random();
    return source;
}

function band(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, q: number): BiquadFilterNode {
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    return filter;
}

function gain(ctx: BaseAudioContext, value: number): GainNode {
    const node = ctx.createGain();
    node.gain.value = value;
    return node;
}

/** Blade ticks (noise bursts through a bright band-pass, one per blade pass) over a soft noise whirr. */
function reel(ctx: BaseAudioContext, out: GainNode): Pick<Running, 'sources' | 'follow'> {
    const tickNoise = noiseSource(ctx);
    const tick = gain(ctx, 0);
    tickNoise.connect(band(ctx, 'bandpass', REEL.clickFreq, 2.2)).connect(tick).connect(out);
    const whirrNoise = noiseSource(ctx);
    const whirr = gain(ctx, 0);
    whirrNoise.connect(band(ctx, 'bandpass', REEL.whirrFreq, 0.8)).connect(whirr).connect(out);
    let phase = 0;
    return {
        sources: [tickNoise, whirrNoise],
        follow: (k, delta) => {
            const t = ctx.currentTime;
            whirr.gain.setTargetAtTime(REEL.whirr * k, t, 0.12);
            phase += REEL.clicks * k * delta;
            if (phase < 1) return;
            phase %= 1;
            const when = t + 0.01;
            tick.gain.setValueAtTime(REEL.clickPeak * (0.75 + Math.random() * 0.5), when);
            tick.gain.setTargetAtTime(0, when, 0.012);
        },
    };
}

/** A motor's hum (triangle) and whine (a sine three times up), a slight wobble, and blade air (band-passed noise). */
function electric(ctx: BaseAudioContext, out: GainNode): Pick<Running, 'sources' | 'follow'> {
    const body = gain(ctx, ELECTRIC.volume.idle);
    body.connect(out);
    const lowpass = band(ctx, 'lowpass', 1800, 0.7);
    lowpass.connect(body);
    const hum = ctx.createOscillator();
    hum.type = 'triangle';
    const whine = ctx.createOscillator();
    whine.type = 'sine';
    hum.connect(lowpass);
    hum.frequency.value = ELECTRIC.pitch.idle;
    whine.frequency.value = ELECTRIC.pitch.idle * 3;
    whine.connect(gain(ctx, 0.22)).connect(lowpass);
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 5.5;
    wobble.connect(gain(ctx, 1.5)).connect(hum.frequency);
    wobble.connect(gain(ctx, 4.5)).connect(whine.frequency);
    const airNoise = noiseSource(ctx);
    const air = gain(ctx, ELECTRIC.air.idle);
    airNoise.connect(band(ctx, 'bandpass', 750, 0.7)).connect(air).connect(out);
    return {
        sources: [hum, whine, wobble, airNoise],
        follow: (k) => {
            const t = ctx.currentTime;
            const pitch = lerp(ELECTRIC.pitch, k);
            hum.frequency.setTargetAtTime(pitch, t, GLIDE);
            whine.frequency.setTargetAtTime(pitch * 3, t, GLIDE);
            body.gain.setTargetAtTime(lerp(ELECTRIC.volume, k), t, GLIDE);
            air.gain.setTargetAtTime(lerp(ELECTRIC.air, k), t, GLIDE);
        },
    };
}

/** A petrol engine: sawtooth + square sub through a low-pass, its loudness chugging with a low LFO. */
function tractor(ctx: BaseAudioContext, out: GainNode): Pick<Running, 'sources' | 'follow'> {
    const level = gain(ctx, TRACTOR.volume.idle);
    level.connect(out);
    const chug = gain(ctx, 0.65);
    chug.connect(level);
    const lfo = ctx.createOscillator();
    lfo.connect(gain(ctx, 0.35)).connect(chug.gain);
    const filter = band(ctx, 'lowpass', TRACTOR.cutoff.idle, 1.1);
    filter.connect(chug);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    const sub = ctx.createOscillator();
    sub.type = 'square';
    saw.connect(filter);
    saw.frequency.value = TRACTOR.pitch.idle;
    sub.frequency.value = TRACTOR.pitch.idle / 2;
    lfo.frequency.value = TRACTOR.chug.idle;
    sub.connect(gain(ctx, 0.4)).connect(filter);
    return {
        sources: [saw, sub, lfo],
        follow: (k) => {
            const t = ctx.currentTime;
            const pitch = lerp(TRACTOR.pitch, k);
            saw.frequency.setTargetAtTime(pitch, t, GLIDE);
            sub.frequency.setTargetAtTime(pitch / 2, t, GLIDE);
            filter.frequency.setTargetAtTime(lerp(TRACTOR.cutoff, k), t, GLIDE);
            lfo.frequency.setTargetAtTime(lerp(TRACTOR.chug, k), t, GLIDE);
            level.gain.setTargetAtTime(lerp(TRACTOR.volume, k), t, GLIDE);
        },
    };
}

/** A car's engine (sawtooth + a fifth above through a low-pass, a slight wobble) and its tyres on the road (low noise). */
function car(ctx: BaseAudioContext, out: GainNode): Pick<Running, 'sources' | 'follow'> {
    const level = gain(ctx, CAR.volume.idle);
    level.connect(out);
    const filter = band(ctx, 'lowpass', CAR.cutoff.idle, 0.9);
    filter.connect(level);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = CAR.pitch.idle;
    const fifth = ctx.createOscillator();
    fifth.type = 'triangle';
    fifth.frequency.value = CAR.pitch.idle * 1.5;
    saw.connect(filter);
    fifth.connect(gain(ctx, 0.3)).connect(filter);
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 3 + Math.random() * 2;
    wobble.connect(gain(ctx, 2)).connect(saw.frequency);
    const tyreNoise = noiseSource(ctx);
    const tyres = gain(ctx, 0);
    tyreNoise.connect(band(ctx, 'lowpass', 520, 0.7)).connect(tyres).connect(out);
    return {
        sources: [saw, fifth, wobble, tyreNoise],
        follow: (k) => {
            const t = ctx.currentTime;
            const pitch = lerp(CAR.pitch, k);
            saw.frequency.setTargetAtTime(pitch, t, GLIDE);
            fifth.frequency.setTargetAtTime(pitch * 1.5, t, GLIDE);
            filter.frequency.setTargetAtTime(lerp(CAR.cutoff, k), t, GLIDE);
            level.gain.setTargetAtTime(lerp(CAR.volume, k), t, GLIDE);
            tyres.gain.setTargetAtTime(lerp(CAR.tyres, k), t, GLIDE);
        },
    };
}
