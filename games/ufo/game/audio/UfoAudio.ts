// UfoAudio.ts
//
// The sound effects, synthesized (no audio files yet): a rising pop per bite, its pitch falling as the saucer grows, a
// thud on hitting something too tall, a chime when the town's done.

let context: AudioContext | undefined;

/** Browsers only start audio after an input. */
function ready(): AudioContext | undefined {
    if (!context) {
        const Context = window.AudioContext;
        if (!Context) return undefined;
        context = new Context();
    }
    if (context.state === 'suspended') void context.resume();
    return context;
}

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
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + seconds);
}

export const UfoAudio = {
    /** `size`: how big the thing eaten was next to the saucer (0..1): bigger is lower and longer. */
    eat(size: number): void {
        const pitch = 900 - 600 * Math.min(1, size);
        tone('sine', pitch, pitch * 1.9, 0.12 + 0.2 * size, 0.14 + 0.08 * size);
    },
    bump(): void {
        tone('triangle', 130, 55, 0.18, 0.28);
    },
    win(): void {
        [523, 659, 784, 1047].forEach((note, i) => tone('triangle', note, note, 0.35, 0.16, i * 0.12));
    },
};
