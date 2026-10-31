// StarMusic.ts
//
// The power surge's "invincible" tune: a fast, bright, looping arpeggio over a bouncing bass, synthesised live (like
// EngineSound) with Howler's Web Audio context and through its master gain, so the game's mute, the platform's mute
// and DigAudio's pause silence it too. Notes are scheduled a little ahead on the audio clock (update() each frame), so
// the beat stays even whatever the frame rate. It fades in on start() and out on stop().

import { Howler } from 'howler';

/** Seconds per step (a sixteenth at ~165 bpm). */
const STEP = 0.091;
/** How far ahead notes are scheduled. */
const LOOKAHEAD = 0.25;
const VOLUME = 0.07;
const FADE = 0.15;
/** The lead, one note a step (MIDI; 0 = rest): up-and-down arpeggios climbing through four chords. */
const LEAD = [
    72, 76, 79, 84, 79, 76, 72, 79,
    74, 77, 81, 86, 81, 77, 74, 81,
    76, 79, 83, 88, 83, 79, 76, 83,
    77, 81, 84, 89, 88, 86, 84, 0,
];
/** The bass, on every other step (MIDI; 0 = rest). */
const BASS = [48, 0, 55, 0, 50, 0, 57, 0, 52, 0, 59, 0, 53, 0, 60, 55];

const frequency = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class StarMusic {
    private nodes?: { ctx: AudioContext; out: GainNode };
    private next = 0;
    private step = 0;

    public get playing(): boolean {
        return !!this.nodes;
    }

    /** Starts the tune from the top; no-op if it's playing or the audio context isn't there yet. */
    public start(): void {
        if (this.nodes) return;
        const ctx = Howler.ctx as AudioContext | undefined;
        const master = (Howler as unknown as { masterGain?: GainNode }).masterGain;
        if (!ctx || !master) return;
        const out = ctx.createGain();
        out.gain.value = 0;
        out.gain.setTargetAtTime(VOLUME, ctx.currentTime, FADE / 3);
        out.connect(master);
        this.nodes = { ctx, out };
        this.next = ctx.currentTime + 0.05;
        this.step = 0;
    }

    /** Schedules the notes coming up (call every frame while playing). */
    public update(): void {
        if (!this.nodes) return;
        const { ctx, out } = this.nodes;
        // Back from a pause (the audio clock ran on): pick up from now, not with a burst of missed notes.
        if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.02;
        while (this.next < ctx.currentTime + LOOKAHEAD) {
            const lead = LEAD[this.step % LEAD.length];
            if (lead) this.note(ctx, out, 'square', frequency(lead), this.next, STEP * 0.9, 0.5);
            if (this.step % 2 === 0) {
                const bass = BASS[(this.step / 2) % BASS.length];
                if (bass) this.note(ctx, out, 'triangle', frequency(bass), this.next, STEP * 1.8, 0.9);
            }
            this.next += STEP;
            this.step++;
        }
    }

    /** Fades out and lets go of the audio nodes. */
    public stop(): void {
        if (!this.nodes) return;
        const { ctx, out } = this.nodes;
        out.gain.setTargetAtTime(0, ctx.currentTime, FADE / 3);
        window.setTimeout(() => out.disconnect(), FADE * 1000 * 3);
        this.nodes = undefined;
    }

    /** One plucked note: a quick attack, then down to nothing over `length`. */
    private note(ctx: AudioContext, out: GainNode, type: OscillatorType, hz: number, at: number, length: number, level: number): void {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = hz;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, at);
        env.gain.linearRampToValueAtTime(level, at + 0.006);
        env.gain.exponentialRampToValueAtTime(0.001, at + length);
        osc.connect(env).connect(out);
        osc.start(at);
        osc.stop(at + length + 0.02);
    }
}
