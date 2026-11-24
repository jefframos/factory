// Wardrobe clothes in the kit's icon style, as two layers each: Base (the white shape: tinted, and the pattern's mask) and
// Lines (the dark outline, the shading and the seams, over it). From the repo: `node tools/ui-kit/mow-clothes.mjs . "games/mow/raw-assets/images/ui{tps}" [preview.png]`, then `npm run image`.
import { createRequire } from 'node:module';
import path from 'node:path';
const [repo, out, preview] = process.argv.slice(2);
const sharp = createRequire(path.join(path.resolve(repo), 'package.json'))('sharp');
const S = 256;
const INK = '#15100d';

const trousers = {
    shape: 'M70 34 Q70 24 80 24 H176 Q186 24 186 34 L190 84 Q200 150 206 214 Q207 226 195 227 L152 230 Q141 230 139 219 L130 132 Q128 124 126 132 L117 219 Q115 230 104 230 L61 227 Q49 226 50 214 Q56 150 66 84 Z',
    shade: [
        // The far side of each leg, the seat under the belt, the turn-ups.
        'M186 34 L190 84 Q200 150 206 214 Q207 226 195 227 L176 228 Q182 150 168 60 Z',
        'M126 132 L117 219 Q115 230 104 230 L90 229 Q110 180 112 118 Q122 118 128 108 Z',
        'M69 58 H187 L188 70 H68 Z',
    ],
    light: ['M74 86 Q66 140 62 196 L74 197 Q78 140 88 88 Z', 'M146 130 Q149 160 152 196 L161 196 Q160 160 157 128 Z'],
    lines: [
        ['M69 57 H187', 7],
        ['M128 60 V106', 6],
        ['M128 106 Q141 102 141 86 V60', 4],
        ['M69 88 Q92 88 98 60', 5],
        ['M187 88 Q164 88 158 60', 5],
        ['M52 204 Q84 210 118 207', 6],
        ['M138 207 Q172 210 205 204', 6],
        ['M92 25 V56 M164 25 V56', 5],
    ],
    button: [128, 42, 7],
};

const shirt = {
    shape: 'M88 30 Q128 62 168 30 Q180 30 194 39 L236 72 Q244 79 240 89 L226 120 Q221 130 211 126 L190 117 V212 Q190 226 176 226 H80 Q66 226 66 212 V117 L45 126 Q35 130 30 120 L16 89 Q12 79 20 72 L62 39 Q76 30 88 30 Z',
    shade: [
        'M190 117 V212 Q190 226 176 226 H152 Q172 180 168 96 Z',
        'M66 204 H190 V212 Q190 226 176 226 H80 Q66 226 66 212 Z',
        'M190 117 L211 126 Q221 130 226 120 L230 110 L190 92 Z',
        'M66 117 L45 126 Q35 130 30 120 L26 110 L66 92 Z',
    ],
    light: ['M80 70 Q76 130 78 190 L92 190 Q90 130 96 74 Z'],
    lines: [
        ['M80 35 Q128 78 176 35', 6],
        ['M66 92 V120', 6],
        ['M190 92 V120', 6],
        ['M24 104 L52 92', 5],
        ['M232 104 L204 92', 5],
    ],
};

// A straw hat: a pinched crown with a red band, on a wide brim.
const hat = {
    shape: 'M76 158 Q78 96 92 66 Q102 46 122 54 Q128 57 134 54 Q154 46 164 66 Q178 96 180 158 Q214 152 232 144 Q246 139 247 152 Q246 176 208 194 Q172 210 128 210 Q84 210 48 194 Q10 176 9 152 Q10 139 24 144 Q42 152 76 158 Z',
    fills: [['M74 160 Q75 142 78 124 Q128 140 178 124 Q181 142 182 160 Q128 178 74 160 Z', '#d0392f']],
    shade: [
        'M164 66 Q178 96 180 158 Q168 164 152 167 Q156 110 146 56 Q157 53 164 66 Z',
        'M9 152 Q10 176 48 194 Q84 210 128 210 Q172 210 208 194 Q246 176 247 152 Q238 170 200 182 Q164 192 128 192 Q92 192 56 182 Q18 170 9 152 Z',
        'M76 158 Q128 178 180 158 L188 160 Q128 186 68 160 Z',
    ],
    light: ['M94 78 Q88 98 86 116 L99 120 Q101 96 106 72 Z', 'M34 158 Q52 170 78 176 L80 168 Q56 162 40 152 Z'],
    lines: [
        ['M78 124 Q128 140 178 124', 6],
        ['M75 158 Q128 178 181 158', 7],
        ['M116 60 Q128 82 140 60', 5],
    ],
};

const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 256 256">${body}</svg>`);
const base = (g) => svg(`<path d="${g.shape}" fill="#fff"/>`);
const lines = (g) => svg(`
  <defs><clipPath id="c"><path d="${g.shape}"/></clipPath></defs>
  <g clip-path="url(#c)">
    ${(g.fills ?? []).map(([d, color]) => `<path d="${d}" fill="${color}"/>`).join('')}
    ${g.shade.map((d) => `<path d="${d}" fill="#000" fill-opacity="0.2"/>`).join('')}
    ${g.light.map((d) => `<path d="${d}" fill="#fff" fill-opacity="0.22"/>`).join('')}
    ${g.lines.map(([d, w]) => `<path d="${d}" fill="none" stroke="${INK}" stroke-opacity="0.55" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
    ${g.button ? `<circle cx="${g.button[0]}" cy="${g.button[1]}" r="${g.button[2]}" fill="#ffd34d" stroke="${INK}" stroke-width="4"/>` : ''}
  </g>
  <path d="${g.shape}" fill="none" stroke="${INK}" stroke-width="13" stroke-linejoin="round"/>
  <path d="${g.shape}" transform="translate(0 5)" fill="none" stroke="${INK}" stroke-width="11" stroke-linejoin="round" clip-path="url(#below)"/>`);

// The crossed-out sign (the NO HAT card).
const none = svg(['#15100d 34', '#ff3b3b 20'].map((look) => {
    const [color, width] = look.split(' ');
    return `<g fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"><circle cx="128" cy="128" r="92"/><path d="M66 66 L190 190"/></g>`;
}).join(''));
if (out !== '-') await sharp(none).png().toFile(path.join(out, 'Wardrobe_None.png'));

const layers = {};
for (const [name, g] of Object.entries({ Trousers: trousers, Shirt: shirt, Hat: hat })) {
    layers[name] = { base: await sharp(base(g)).png().toBuffer(), lines: await sharp(lines(g)).png().toBuffer() };
    if (out !== '-') {
        await sharp(layers[name].base).toFile(path.join(out, `Wardrobe_${name}_Base.png`));
        await sharp(layers[name].lines).toFile(path.join(out, `Wardrobe_${name}_Lines.png`));
    }
}
if (preview) {
    const items = [['Trousers', '#2f4a7a'], ['Trousers', '#3b3b44'], ['Trousers', '#6b4a2e'], ['Trousers', '#4f8a3a'], ['Trousers', '#c0392b'], ['Hat', '#f2c14e'], ['Shirt', '#42a5f5'], ['Shirt', '#e0a03c'], ['Shirt', '#ab47bc'], ['Shirt', '#e53935'], ['Shirt', '#f5f5f5'], ['Shirt', '#2a2a30']];
    const tiles = [];
    for (let i = 0; i < items.length; i++) {
        const [name, color] = items[i];
        const tinted = await sharp({ create: { width: S, height: S, channels: 4, background: color } }).composite([{ input: layers[name].base, blend: 'dest-in' }, { input: layers[name].lines }]).png().toBuffer();
        tiles.push({ input: await sharp(tinted).resize(170).png().toBuffer(), left: 15 + (i % 6) * 200, top: 15 + Math.floor(i / 6) * 200 });
    }
    await sharp({ create: { width: 1210, height: 410, channels: 4, background: '#00a2ff' } }).composite(tiles).png().toFile(preview);
}
