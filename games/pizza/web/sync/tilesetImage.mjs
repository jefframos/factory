// tilesetImage.mjs
//
// Regenerates games/pizza/tiled/grounds.png and resources.png straight from
// map/tiles.json's own `color` fields — a flat single-row spritesheet, one
// tileSize×tileSize solid-color square per tile, index order matching
// tiles.json's array order exactly (same convention TileMapConfig.ts and
// the web editor's Map tab already assume — see that tab's own doc). This
// is what makes editing a tile's color in the Map tab and hitting Save
// actually change what's visible when painting the map in Tiled, instead of
// only updating the color used by the flat-quad in-game renderer.
//
// Optionally bakes the tile's own array index onto the square as a small
// bitmap number (toggled by the caller) — the whole point of a designer
// painting in Tiled being able to tell tiles apart at a glance instead of
// counting squares in the spritesheet strip. No image library dependency
// (this repo has none) — encodePNG() below hand-writes a valid PNG file
// (RGBA, filter-none scanlines, zlib-deflated via node's built-in zlib).

import zlib from 'node:zlib';

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/** `rgba` is a flat Buffer of width*height*4 bytes (RGBA, row-major, no padding). */
function encodePng(width, height, rgba) {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8; // bit depth
    ihdrData[9] = 6; // color type: RGBA
    ihdrData[10] = 0; // compression
    ihdrData[11] = 0; // filter
    ihdrData[12] = 0; // interlace
    const ihdr = pngChunk('IHDR', ihdrData);

    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0; // per-scanline filter type: none
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
    }
    const idat = pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 }));
    const iend = pngChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([signature, ihdr, idat, iend]);
}

function hexToRgb(hex) {
    const clean = (hex ?? '#ff00ff').replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean.padEnd(6, '0');
    const num = parseInt(full, 16) || 0xff00ff;
    return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

/** A 3×5 bitmap digit font — each row is a 3-char '0'/'1' string; drawTileIndex() below scales each cell up by CELL_SCALE and adds a stroke, so this stays the same regardless of on-tile size. */
const DIGIT_FONT = {
    '0': ['111', '101', '101', '101', '111'],
    '1': ['010', '110', '010', '010', '111'],
    '2': ['111', '001', '111', '100', '111'],
    '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'],
    '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'],
    '7': ['111', '001', '010', '010', '010'],
    '8': ['111', '101', '111', '101', '111'],
    '9': ['111', '101', '111', '001', '111'],
};

function setPixel(rgba, width, height, x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = (y * width + x) * 4;
    const alpha = a / 255;
    rgba[idx] = Math.round(rgba[idx] * (1 - alpha) + r * alpha);
    rgba[idx + 1] = Math.round(rgba[idx + 1] * (1 - alpha) + g * alpha);
    rgba[idx + 2] = Math.round(rgba[idx + 2] * (1 - alpha) + b * alpha);
    rgba[idx + 3] = 255;
}

/** Each DIGIT_FONT bitmap cell is drawn as a CELL_SCALE×CELL_SCALE block of actual pixels — this is the "a bit bigger" knob (was effectively 1, i.e. illegibly tiny on a 32px tile). */
const CELL_SCALE = 2;

/**
 * Draws `index` as digits on one tile, either centered (grounds) or in the top-left corner
 * (resources) — see generateTilesetImage()'s callers for which list gets which. Every glyph
 * cell is drawn TWICE: first a 1px-larger black square (the "stroke"), then the actual `fg`
 * fill square on top — cheap substitute for a real outline algorithm, but with a bitmap font
 * this coarse the two look the same and it never needs an image library.
 */
function drawTileIndex(rgba, width, height, tileX, tileSize, index, fg, position) {
    const text = String(index);
    const cell = CELL_SCALE;
    const glyphW = 3 * cell;
    const glyphH = 5 * cell;
    const spacing = cell;
    const totalW = text.length * glyphW + (text.length - 1) * spacing;

    let startX;
    let startY;
    if (position === 'center') {
        startX = tileX + Math.round((tileSize - totalW) / 2);
        startY = Math.round((tileSize - glyphH) / 2);
    } else {
        const pad = Math.max(1, Math.floor(tileSize * 0.06));
        startX = tileX + pad;
        startY = pad;
    }

    let cx = startX;
    for (const ch of text) {
        const glyph = DIGIT_FONT[ch];
        if (glyph) {
            for (let row = 0; row < glyph.length; row++) {
                for (let col = 0; col < glyph[row].length; col++) {
                    if (glyph[row][col] !== '1') continue;
                    const px = cx + col * cell;
                    const py = startY + row * cell;
                    // Stroke pass — 1px black border all around this cell.
                    for (let yy = -1; yy <= cell; yy++) {
                        for (let xx = -1; xx <= cell; xx++) {
                            setPixel(rgba, width, height, px + xx, py + yy, 0, 0, 0, 255);
                        }
                    }
                }
            }
            // Fill pass — drawn after every stroke cell for this glyph so a fill cell never
            // gets overwritten by a neighboring cell's stroke.
            for (let row = 0; row < glyph.length; row++) {
                for (let col = 0; col < glyph[row].length; col++) {
                    if (glyph[row][col] !== '1') continue;
                    const px = cx + col * cell;
                    const py = startY + row * cell;
                    for (let yy = 0; yy < cell; yy++) {
                        for (let xx = 0; xx < cell; xx++) {
                            setPixel(rgba, width, height, px + xx, py + yy, fg.r, fg.g, fg.b, 255);
                        }
                    }
                }
            }
        }
        cx += glyphW + spacing;
    }
}

/** Fixed per-list number style (not luminance-picked anymore — a stroke makes either color legible on any tile color) — grounds gets a grey number centered on the tile, resources gets a white number in the top-left corner, per this feature's own request. */
export const GROUND_NUMBER_STYLE = { color: { r: 190, g: 190, b: 190 }, position: 'center' };
export const RESOURCE_NUMBER_STYLE = { color: { r: 255, g: 255, b: 255 }, position: 'topLeft' };

/**
 * Builds a single-row spritesheet PNG buffer from a tiles.json list (`grounds` or `resources`)
 * — one `tileSize`×`tileSize` solid-color square per entry, in array order, matching
 * TileMapConfig.ts's `gid - firstgid` indexing exactly. `showNumbers` bakes each tile's index
 * onto its own square (see drawTileIndex()) so a designer painting in Tiled can read tile ids
 * straight off the palette instead of counting squares. `numberStyle` (GROUND_NUMBER_STYLE or
 * RESOURCE_NUMBER_STYLE above) picks the fill color and on-tile position.
 */
export function generateTilesetImage(tiles, tileSize, { showNumbers = false, numberStyle = RESOURCE_NUMBER_STYLE } = {}) {
    const count = Math.max(1, tiles.length);
    const width = count * tileSize;
    const height = tileSize;
    const rgba = Buffer.alloc(width * height * 4, 0);

    tiles.forEach((tile, index) => {
        const { r, g, b } = hexToRgb(tile.color);
        const tileX = index * tileSize;
        for (let y = 0; y < tileSize; y++) {
            for (let x = 0; x < tileSize; x++) {
                setPixel(rgba, width, height, tileX + x, y, r, g, b, 255);
            }
        }
        if (showNumbers) {
            drawTileIndex(rgba, width, height, tileX, tileSize, index, numberStyle.color, numberStyle.position);
        }
    });

    return encodePng(width, height, rgba);
}
