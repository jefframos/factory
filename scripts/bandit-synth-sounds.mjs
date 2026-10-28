// bandit-synth-sounds.mjs
//
// Synthesises the Bandit Controller sound effects nothing in the repo covers (cash register, siren,
// checkpoint/star chimes, "spotted" sting) as 16-bit mono WAVs in raw-assets/audio. Pure math, no
// samples, so they are reproducible and license-free. Run `npm run audio` afterwards to publish.
//
//   node scripts/bandit-synth-sounds.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'games', 'bandit-controller', 'raw-assets', 'audio');
const RATE = 44100;

function wav(samples) {
    const data = Buffer.alloc(samples.length * 2);
    const peak = Math.max(1e-6, ...samples.map(Math.abs));
    const gain = 0.89 / peak;
    samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * gain)) * 32767), i * 2));
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(RATE, 24);
    header.writeUInt32LE(RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
}

const buffer = (seconds) => new Float64Array(Math.ceil(seconds * RATE));
/** Seeded noise so every run writes identical files. */
let seed = 1234567;
const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
};

/** Inharmonic struck-bell partials (ratios from a small handbell), exponential decay. */
function bell(out, start, freq, gain, decay, partials = [[1, 1], [2.76, 0.45], [5.4, 0.22], [8.93, 0.08]]) {
    const from = Math.floor(start * RATE);
    for (let i = from; i < out.length; i++) {
        const t = (i - from) / RATE;
        const attack = Math.min(1, t / 0.002);
        let v = 0;
        for (const [ratio, amp] of partials) {
            v += amp * Math.sin(2 * Math.PI * freq * ratio * t) * Math.exp(-t / (decay / Math.sqrt(ratio)));
        }
        out[i] += gain * attack * v;
    }
}

/** Short filtered noise burst: the mechanical "ka" of a cash drawer / a click. */
function clack(out, start, length, gain, brightness = 0.35) {
    const from = Math.floor(start * RATE);
    let low = 0;
    let previous = 0;
    for (let i = from; i < Math.min(out.length, from + length * RATE); i++) {
        const t = (i - from) / RATE;
        const n = noise();
        low += brightness * (n - low);
        const band = low - previous;
        previous = low;
        out[i] += gain * band * 6 * Math.exp(-t / (length / 4));
        out[i] += gain * 0.6 * Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t / 0.012);
    }
}

function tone(out, start, length, freqAt, gain, shape = (p) => Math.sin(p), envelope = (t, l) => Math.min(1, t / 0.01) * Math.min(1, (l - t) / 0.04)) {
    const from = Math.floor(start * RATE);
    let phase = 0;
    for (let i = from; i < Math.min(out.length, from + length * RATE); i++) {
        const t = (i - from) / RATE;
        phase += (2 * Math.PI * freqAt(t)) / RATE;
        out[i] += gain * envelope(t, length) * shape(phase);
    }
}

const softSquare = (p) => Math.tanh(3 * Math.sin(p)) * 0.8;
const triangle = (p) => (2 / Math.PI) * Math.asin(Math.sin(p));

const SOUNDS = {
    // Cash register "ka-ching": drawer clack, then two bells a hair apart.
    'cash': () => {
        const out = buffer(0.85);
        clack(out, 0, 0.05, 0.9, 0.55);
        clack(out, 0.035, 0.03, 0.5, 0.7);
        bell(out, 0.07, 2093, 0.5, 0.35);
        bell(out, 0.1, 2637, 0.42, 0.3);
        return out;
    },
    // A single bill landing in the HUD counter: tiny, bright, quick.
    'cash-tick': () => {
        const out = buffer(0.3);
        clack(out, 0, 0.015, 0.3, 0.8);
        bell(out, 0.008, 3136, 0.5, 0.09);
        return out;
    },
    // Checkpoint reached: two rising bell notes.
    'checkpoint': () => {
        const out = buffer(0.8);
        bell(out, 0, 1046.5, 0.6, 0.28, [[1, 1], [2, 0.25], [3.01, 0.1]]);
        bell(out, 0.11, 1568, 0.65, 0.35, [[1, 1], [2, 0.25], [3.01, 0.1]]);
        return out;
    },
    // Star landing on the results panel: sparkly up-arpeggio (pitched per star in GameAudio).
    'star': () => {
        const out = buffer(0.9);
        [1318.5, 1568, 2093, 2637].forEach((f, i) => bell(out, i * 0.045, f, 0.45 - i * 0.05, 0.25, [[1, 1], [2.01, 0.3], [4.1, 0.1]]));
        return out;
    },
    // Busted: police "wee-woo" siren, three cycles, fading out.
    'siren': () => {
        const length = 1.75;
        const out = buffer(length);
        tone(out, 0, length, (t) => {
            const cycle = (t % 0.58) / 0.58;
            const high = cycle < 0.5;
            const glide = high ? Math.min(1, cycle / 0.06) : Math.min(1, (cycle - 0.5) / 0.06);
            const target = high ? 960 : 720;
            const from = high ? 720 : 960;
            return (from + (target - from) * glide) * (1 + 0.006 * Math.sin(2 * Math.PI * 7 * t));
        }, 0.7, softSquare, (t, l) => Math.min(1, t / 0.02) * Math.min(1, (l - t) / 0.45));
        return out;
    },
    // Busted panel: sad-trombone "wah wah wah waaah", each note bending down, the last one wobbling.
    'lose': () => {
        const out = buffer(2.1);
        const brass = (p) => Math.tanh(2.2 * (Math.sin(p) + 0.45 * Math.sin(2 * p) + 0.2 * Math.sin(3 * p))) * 0.7;
        const notes = [[0, 0.32, 311], [0.36, 0.32, 294], [0.72, 0.32, 277], [1.08, 0.95, 262]];
        notes.forEach(([start, length, freq], index) => {
            const last = index === notes.length - 1;
            tone(out, start, length, (t) => freq * (1 - 0.04 * Math.min(1, t / length)) * (last ? 1 + 0.025 * Math.sin(2 * Math.PI * 6 * t) : 1),
                0.65, brass, (t, l) => Math.min(1, t / 0.03) * Math.min(1, (l - t) / (last ? 0.35 : 0.06)));
        });
        return out;
    },
    // A guard starts noticing you: quick rising "!" sting.
    'spotted': () => {
        const out = buffer(0.32);
        tone(out, 0, 0.12, (t) => 520 + (t / 0.12) * 700, 0.7, triangle);
        tone(out, 0.12, 0.18, () => 1250, 0.6, triangle, (t, l) => Math.min(1, t / 0.005) * Math.exp(-t / 0.06) * Math.min(1, (l - t) / 0.02));
        return out;
    },
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, make] of Object.entries(SOUNDS)) {
    const file = path.join(OUT, `${name}.wav`);
    fs.writeFileSync(file, wav(Array.from(make())));
    console.log(`${name}.wav`);
}
