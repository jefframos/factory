// EngineSound.ts
//
// The tractor's engine (there is no engine recording in the game's audio): synthesised live with the Web Audio
// context Howler already runs — a triangle and a square an octave below through a low-pass filter, its loudness
// chugging with a low LFO (the "putt-putt"), all rising in pitch, brightness and chug with the driving speed.
// It plays through Howler's master gain, so the game's mute, the platform's mute and MowAudio's pause (Howler's
// volume to 0) silence it like every other sound.

import { Howler } from 'howler';

/** Idle -> full speed. */
const PITCH = { idle: 36, full: 58 };
const CUTOFF = { idle: 200, full: 520 };
const CHUG = { idle: 6, full: 12 };
// Kept low: it loops the whole time a powered mower is out, so it should sit under the music and the cuts.
const VOLUME = { idle: 0.022, full: 0.045 };
/** Seconds the levels take to follow the speed (and to fade in / out). */
const GLIDE = 0.3;
const FADE = 0.25;

export class EngineSound {
    private nodes?: { ctx: AudioContext; out: GainNode; saw: OscillatorNode; sub: OscillatorNode; filter: BiquadFilterNode; lfo: OscillatorNode };

    /** Starts the engine (idling); no-op if it's running or the audio context isn't there yet. */
    public start(): void {
        if (this.nodes) return;
        const ctx = Howler.ctx as AudioContext | undefined;
        const master = (Howler as unknown as { masterGain?: GainNode }).masterGain;
        if (!ctx || !master) return;
        const out = ctx.createGain();
        out.gain.value = 0;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 0.9;
        filter.frequency.value = CUTOFF.idle;
        // The chug: an LFO swinging a gain stage between ~60% and 100% (gentle, not a stutter).
        const chug = ctx.createGain();
        chug.gain.value = 0.8;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = CHUG.idle;
        const depth = ctx.createGain();
        depth.gain.value = 0.2;
        lfo.connect(depth).connect(chug.gain);
        const saw = ctx.createOscillator();
        saw.type = 'triangle';
        saw.frequency.value = PITCH.idle;
        const sub = ctx.createOscillator();
        sub.type = 'square';
        sub.frequency.value = PITCH.idle / 2;
        const subLevel = ctx.createGain();
        subLevel.gain.value = 0.35;
        saw.connect(filter);
        sub.connect(subLevel).connect(filter);
        filter.connect(chug).connect(out).connect(master);
        saw.start();
        sub.start();
        lfo.start();
        out.gain.setTargetAtTime(VOLUME.idle, ctx.currentTime, FADE / 3);
        this.nodes = { ctx, out, saw, sub, filter, lfo };
    }

    /** Follows the driving speed: 0 = idling, 1 = flat out. */
    public update(speed: number): void {
        const n = this.nodes;
        if (!n) return;
        const k = Math.min(1, Math.max(0, speed));
        const t = n.ctx.currentTime;
        const pitch = PITCH.idle + (PITCH.full - PITCH.idle) * k;
        n.saw.frequency.setTargetAtTime(pitch, t, GLIDE);
        n.sub.frequency.setTargetAtTime(pitch / 2, t, GLIDE);
        n.filter.frequency.setTargetAtTime(CUTOFF.idle + (CUTOFF.full - CUTOFF.idle) * k, t, GLIDE);
        n.lfo.frequency.setTargetAtTime(CHUG.idle + (CHUG.full - CHUG.idle) * k, t, GLIDE);
        n.out.gain.setTargetAtTime(VOLUME.idle + (VOLUME.full - VOLUME.idle) * k, t, GLIDE);
    }

    /** Fades the engine out and lets it go. */
    public stop(): void {
        const n = this.nodes;
        if (!n) return;
        this.nodes = undefined;
        const end = n.ctx.currentTime + FADE;
        n.out.gain.setTargetAtTime(0, n.ctx.currentTime, FADE / 3);
        for (const osc of [n.saw, n.sub, n.lfo]) osc.stop(end + 0.1);
        window.setTimeout(() => n.out.disconnect(), (FADE + 0.2) * 1000);
    }
}
