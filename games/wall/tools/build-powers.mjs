// The boxing gloves' icon, drawn from their model (outlined, as the tools' are), and the orb what floats by is in (shaded white, for the game to tint; its shine on its own): node games/wall/tools/build-powers.mjs, then `npm run image`
// (GAME=wall).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const images = `${here}/../raw-assets/images/ui{tps}`;
const SIZE = 256;
const BIG = SIZE * 3;
const LINE = 24;
const INK = [23, 18, 14];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(`${here}/../raw-assets/models/player{m}/boxing.glb`);
const parts = [];
for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    mesh.listPrimitives().forEach((primitive, part) => {
        const [position, normal, index] = [primitive.getAttribute('POSITION'), primitive.getAttribute('NORMAL'), primitive.getIndices()];
        const turn = ([x, y, z], w) => [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w];
        for (let t = 0; t < index.getCount(); t += 3) {
            const corners = [0, 1, 2].map((k) => index.getScalar(t + k));
            parts.push({ part, p: corners.map((i) => turn(position.getElement(i, []), 1)), n: corners.map((i) => turn(normal.getElement(i, []), 0)) });
        }
    });
}
const unit = (v) => {
    const l = Math.hypot(...v) || 1;
    return v.map((x) => x / l);
};
const LIGHT = unit([-0.45, 0.75, 0.6]);
const HALF = unit([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);

/** A glove drawn on `out`: turned (degrees), mirrored, `size` across with its middle at (x, y) (shares of the picture), in two colours. */
export function glove(out, { turn: [pitch, yaw, roll], mirror = false, size, x: cx, y: cy, colors, only }) {
    const [a, b, c] = [pitch, yaw, roll].map((d) => (d * Math.PI) / 180);
    const rotate = ([x, y, z]) => {
        [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)];
        [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
        [x, y] = [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)];
        return mirror ? [-x, y, z] : [x, y, z];
    };
    const list = parts.map(({ part, p, n }) => ({ part, p: p.map(rotate), n: n.map(rotate) }));
    const all = list.flatMap(({ p }) => p);
    const min = [0, 1].map((k) => Math.min(...all.map((p) => p[k])));
    const max = [0, 1].map((k) => Math.max(...all.map((p) => p[k])));
    const scale = (size * BIG) / Math.max(max[0] - min[0], max[1] - min[1]);
    const at = ([x, y, z]) => [cx * BIG + (x - (min[0] + max[0]) / 2) * scale, cy * BIG - (y - (min[1] + max[1]) / 2) * scale, z];
    const depth = new Float32Array(BIG * BIG).fill(-Infinity);
    const layer = new Uint8ClampedArray(BIG * BIG * 4);
    for (const { part, p, n } of list) {
        const [P, Q, R] = p.map(at);
        const area = (Q[0] - P[0]) * (R[1] - P[1]) - (R[0] - P[0]) * (Q[1] - P[1]);
        if (Math.abs(area) < 1e-6) continue;
        for (let y = Math.max(0, Math.floor(Math.min(P[1], Q[1], R[1]))); y <= Math.min(BIG - 1, Math.ceil(Math.max(P[1], Q[1], R[1]))); y++) {
            for (let x = Math.max(0, Math.floor(Math.min(P[0], Q[0], R[0]))); x <= Math.min(BIG - 1, Math.ceil(Math.max(P[0], Q[0], R[0]))); x++) {
                const w0 = ((Q[0] - x - 0.5) * (R[1] - y - 0.5) - (R[0] - x - 0.5) * (Q[1] - y - 0.5)) / area;
                const w1 = ((R[0] - x - 0.5) * (P[1] - y - 0.5) - (P[0] - x - 0.5) * (R[1] - y - 0.5)) / area;
                const w2 = 1 - w0 - w1;
                if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                const z = w0 * P[2] + w1 * Q[2] + w2 * R[2];
                const i = x + y * BIG;
                if (z <= depth[i]) continue;
                depth[i] = z;
                let N = unit([0, 1, 2].map((k) => w0 * n[0][k] + w1 * n[1][k] + w2 * n[2][k]));
                if (N[2] < 0) N = N.map((v) => -v);
                const lit = N[0] * LIGHT[0] + N[1] * LIGHT[1] + N[2] * LIGHT[2];
                const shine = Math.max(0, N[0] * HALF[0] + N[1] * HALF[1] + N[2] * HALF[2]);
                // (In a few soft steps, as the pack's are painted.)
                const step = (from, to) => Math.min(1, Math.max(0, (lit - from) / (to - from)));
                const shade = 0.56 + 0.28 * step(-0.15, 0.2) + 0.2 * step(0.45, 0.75);
                const gloss = Math.min(1, Math.max(0, (shine ** 26 - 0.35) / 0.3)) * 0.75;
                const color = colors[part];
                for (let k = 0; k < 3; k++) layer[i * 4 + k] = Math.min(255, color[k] * shade) * (1 - gloss) + 255 * gloss;
                layer[i * 4 + 3] = only === undefined || part === only ? 255 : 0;
            }
        }
    }
    if (only === undefined) stamp(out, layer);
    else out.set(layer);
}

/** A layer over the picture, a dark outline round it. */
function stamp(out, layer) {
    const round = [];
    for (let y = -LINE; y <= LINE; y++) for (let x = -LINE; x <= LINE; x++) if (x * x + y * y <= LINE * LINE) round.push([x, y]);
    const solid = (i) => layer[i * 4 + 3] > 0;
    for (let y = 1; y < BIG - 1; y++) for (let x = 1; x < BIG - 1; x++) {
        const i = x + y * BIG;
        if (!solid(i) || (solid(i - 1) && solid(i + 1) && solid(i - BIG) && solid(i + BIG))) continue;
        for (const [dx, dy] of round) {
            const X = x + dx;
            const Y = y + dy;
            if (X >= 0 && Y >= 0 && X < BIG && Y < BIG && !solid(X + Y * BIG)) out.set([...INK, 255], (X + Y * BIG) * 4);
        }
    }
    for (let i = 0; i < BIG * BIG; i++) if (solid(i)) out.set(layer.subarray(i * 4, i * 4 + 4), i * 4);
}

const blank = () => new Uint8ClampedArray(BIG * BIG * 4);
const save = (out, name, size = SIZE) => sharp(Buffer.from(out.buffer), { raw: { width: BIG, height: BIG, channels: 4 } }).resize(size, size, { kernel: 'lanczos3' }).png().toFile(name);
const RED = [[255, 62, 52], [255, 240, 225]];

if (process.argv[2] === 'turns') {
    let n = 0;
    for (const pitch of [-30, 0, 30]) for (const yaw of [0, 45, 90, 135, 180, 225, 270, 315]) {
        const out = blank();
        glove(out, { turn: [pitch, yaw, 0], size: 0.8, x: 0.5, y: 0.5, colors: RED });
        await save(out, `${process.argv[3]}/turn-${String(n++).padStart(2, '0')}.png`, 120);
    }
    process.exit();
}

// The gloves as a tool: in red, and their leather alone, for the game to tint.
const boxing = blank();
const leather = blank();
const gloves = { turn: [4, 90, 14], size: 0.84, x: 0.5, y: 0.5 };
glove(boxing, { ...gloves, colors: RED });
glove(leather, { ...gloves, colors: [[255, 255, 255], [255, 255, 255]], only: 0 });
await save(boxing, `${images}/Wall_boxing.png`, 120);
await save(leather, `${images}/Wall_boxing_metal.png`, 120);

// The orb: a ball of glass, lit from over it, darker towards its rim, light bouncing back under it.
const orb = (body) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${SIZE}" height="${SIZE}"><defs>
<radialGradient id="ball" cx="0.5" cy="0.42" r="0.6"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#e2e2e2"/><stop offset="0.85" stop-color="#a0a0a0"/><stop offset="1" stop-color="#7a7a7a"/></radialGradient>
<radialGradient id="under" cx="0.5" cy="1.02" r="0.55"><stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="0.7" stop-color="#ffffff" stop-opacity="0.18"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
<linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.02"/></linearGradient>
<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.75"/><stop offset="0.45" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.7" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.55"/></linearGradient>
</defs>${body}</svg>`)).png();
await orb('<circle cx="128" cy="128" r="119" fill="#2a2a2a"/><circle cx="128" cy="128" r="110" fill="url(#ball)"/><circle cx="128" cy="128" r="110" fill="url(#under)"/>').toFile(`${images}/Wall_orb.png`);
await orb('<circle cx="128" cy="128" r="105" fill="none" stroke="url(#rim)" stroke-width="7"/><path d="M42 106 C46 52 88 26 128 26 C168 26 210 52 214 106 C186 78 158 74 128 74 C98 74 70 78 42 106 Z" fill="url(#top)"/><ellipse cx="72" cy="66" rx="15" ry="9" transform="rotate(-40 72 66)" fill="#ffffff" fill-opacity="0.95"/>').toFile(`${images}/Wall_orb_shine.png`);
