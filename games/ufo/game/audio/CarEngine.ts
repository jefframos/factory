// CarEngine.ts
//
// A car going by, synthesized live (the same voice as the mow game's traffic): a smooth engine (sawtooth and a fifth
// above through a low-pass, a slight wobble) and its tyres on the road (low noise), following its speed. SpatialAudio
// places it and sets how loud it is.

/** Seconds the levels take to follow the speed, and to fade in and out. */
const GLIDE = 0.25;
const FADE = 0.25;
const PITCH = { idle: 55, full: 95 };
const CUTOFF = { idle: 380, full: 1000 };
const VOLUME = { idle: 0.035, full: 0.06 };
const TYRES = { idle: 0, full: 0.09 };

const lerp = (range: { idle: number; full: number }, k: number) => range.idle + (range.full - range.idle) * k;

/** Two seconds of white noise per context, looped by every car. */
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

function lowpass(ctx: BaseAudioContext, frequency: number, q: number): BiquadFilterNode {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    filter.Q.value = q;
    return filter;
}

function gain(ctx: BaseAudioContext, value: number): GainNode {
    const node = ctx.createGain();
    node.gain.value = value;
    return node;
}

export class CarEngine {
    private readonly out: GainNode;
    private readonly level: GainNode;
    private readonly tyres: GainNode;
    private readonly filter: BiquadFilterNode;
    private readonly saw: OscillatorNode;
    private readonly fifth: OscillatorNode;
    private readonly sources: AudioScheduledSourceNode[];

    public constructor(private readonly ctx: BaseAudioContext, destination: AudioNode) {
        this.out = gain(ctx, 0);
        this.out.gain.setTargetAtTime(1, ctx.currentTime, FADE / 3);
        this.out.connect(destination);
        this.level = gain(ctx, VOLUME.idle);
        this.level.connect(this.out);
        this.filter = lowpass(ctx, CUTOFF.idle, 0.9);
        this.filter.connect(this.level);
        this.saw = ctx.createOscillator();
        this.saw.type = 'sawtooth';
        this.saw.frequency.value = PITCH.idle;
        this.fifth = ctx.createOscillator();
        this.fifth.type = 'triangle';
        this.fifth.frequency.value = PITCH.idle * 1.5;
        this.saw.connect(this.filter);
        this.fifth.connect(gain(ctx, 0.3)).connect(this.filter);
        const wobble = ctx.createOscillator();
        wobble.frequency.value = 3 + Math.random() * 2;
        wobble.connect(gain(ctx, 2)).connect(this.saw.frequency);
        const tyreNoise = ctx.createBufferSource();
        tyreNoise.buffer = noise(ctx);
        tyreNoise.loop = true;
        tyreNoise.loopStart = Math.random();
        this.tyres = gain(ctx, 0);
        tyreNoise.connect(lowpass(ctx, 520, 0.7)).connect(this.tyres).connect(this.out);
        this.sources = [this.saw, this.fifth, wobble, tyreNoise];
        this.sources.forEach((source) => source.start());
    }

    /** Follows its speed: 0 is idling, 1 flat out. */
    public update(speed: number): void {
        const k = Math.min(1, Math.max(0, speed));
        const t = this.ctx.currentTime;
        const pitch = lerp(PITCH, k);
        this.saw.frequency.setTargetAtTime(pitch, t, GLIDE);
        this.fifth.frequency.setTargetAtTime(pitch * 1.5, t, GLIDE);
        this.filter.frequency.setTargetAtTime(lerp(CUTOFF, k), t, GLIDE);
        this.level.gain.setTargetAtTime(lerp(VOLUME, k), t, GLIDE);
        this.tyres.gain.setTargetAtTime(lerp(TYRES, k), t, GLIDE);
    }

    /** Fades out and lets go. */
    public stop(): void {
        const now = this.ctx.currentTime;
        this.out.gain.cancelScheduledValues(now);
        this.out.gain.setTargetAtTime(0, now, FADE / 3);
        this.sources.forEach((source) => source.stop(now + FADE + 0.1));
        window.setTimeout(() => this.out.disconnect(), (FADE + 0.2) * 1000);
    }
}
