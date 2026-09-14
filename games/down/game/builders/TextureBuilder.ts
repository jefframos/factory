import * as THREE from 'three';
import { ISLAND_TEXTURE_CONFIG } from '../world/MeshConfig';

/**
 * How many wood-grain tiles fit per world unit — see woodGrain()'s own doc
 * for why this is a fixed constant rather than something scaled per-mesh.
 * Same idea as a Pixi TilingSprite's tileScale, just inverted: LOWER values
 * spread the same 256x256 canvas over MORE world-space, so each tile reads
 * as a bigger, coarser chunk of grain; higher values tile it more densely.
 */
const WOOD_GRAIN_REPEAT = 0.5;

/**
 * Central place to obtain any texture the game uses, whichever of three
 * sources it comes from:
 *   - island() / face()  — real art once loaded (island() via loadRealIsland(),
 *     face() always procedural for now), else a procedural placeholder on a
 *     canvas (see export() below for pulling one out to hand-edit into real art)
 *   - load(path)          — a real image file, loaded once and cached by path
 */
export class TextureBuilder {
    private static islandTex: THREE.CanvasTexture | null = null;
    private static realIslandTex: THREE.Texture | null = null;
    private static faceTex: THREE.CanvasTexture | null = null;
    private static woodGrainTex: THREE.CanvasTexture | null = null;
    private static pathCache = new Map<string, THREE.Texture | Promise<THREE.Texture>>();
    private static loader = new THREE.TextureLoader();

    /**
     * Loads the real island art (see IslandStorage.ts) and makes island()
     * return it from then on instead of the procedural placeholder. Call
     * once, before any LinearArea is built, so mesh construction can stay
     * synchronous — see LinearWorld3dScene.build().
     */
    static async loadRealIsland(path: string): Promise<THREE.Texture> {
        const tex = await TextureBuilder.load(path);
        TextureBuilder.realIslandTex = tex;
        return tex;
    }

    /**
     * Real island art once loadRealIsland() has resolved; otherwise falls
     * back to the procedural placeholder — see islandPlaceholder().
     */
    static island(): THREE.Texture {
        if (TextureBuilder.realIslandTex) return TextureBuilder.realIslandTex;
        return TextureBuilder.islandPlaceholder();
    }

    /**
     * Deterministic 2×2 quadrant atlas (see ISLAND_TEXTURE_CONFIG in
     * MeshConfig.ts to tweak colours/detail, and its atlas-layout comment for
     * the quadrant convention). Built once and cached — callers must NOT
     * dispose the returned texture, it's shared across every mesh that uses it
     * for the lifetime of the app.
     */
    static islandPlaceholder(): THREE.CanvasTexture {
        if (TextureBuilder.islandTex) return TextureBuilder.islandTex;

        const cfg = ISLAND_TEXTURE_CONFIG;
        const q = cfg.resolution; // one quadrant's edge length, in px
        const canvas = document.createElement('canvas');
        canvas.width = q * 2;
        canvas.height = q * 2;
        const ctx = canvas.getContext('2d')!;

        // Deterministic PRNG — same texture every load, no Date.now() / Math.random()
        let seed = 0x4f7a2b;
        const rand = (): number => {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            return (seed >>> 0) / 0xffffffff;
        };

        // ── Sand quadrant painter — used for both the collar (top-left) and the
        // tiled side quadrant (bottom-left). `soilStrip` only makes sense on the
        // collar, where it sits right at the grass/sand seam.
        const paintSand = (offX: number, offY: number, soilStrip: boolean) => {
            ctx.fillStyle = cfg.sand.base;
            ctx.fillRect(offX, offY, q, q);

            if (soilStrip) {
                ctx.fillStyle = cfg.sand.soilStrip;
                ctx.globalAlpha = 0.55;
                ctx.fillRect(offX, offY, q, Math.round(q * 0.1));
                ctx.globalAlpha = 1;
            }

            for (let i = 0; i < cfg.sand.patchCount; i++) {
                const px = offX + rand() * q;
                const py = offY + rand() * q;
                const pw = 5 + rand() * 22;
                const ph = 4 + rand() * 14;
                ctx.fillStyle = rand() > 0.5 ? cfg.sand.light : cfg.sand.dark;
                ctx.globalAlpha = 0.18 + rand() * 0.28;
                ctx.fillRect(px, py, pw, ph);
            }

            ctx.strokeStyle = cfg.sand.dark;
            ctx.lineWidth = 1;
            for (let y = offY + 8; y < offY + q; y += 9 + Math.floor(rand() * 7)) {
                ctx.globalAlpha = 0.05 + rand() * 0.05;
                ctx.beginPath();
                ctx.moveTo(offX, y);
                ctx.lineTo(offX + q, y);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        };

        // Top-left — collar (canvas y 0..q → V 1..0.5, right at the grass seam)
        paintSand(0, 0, true);
        // Bottom-left — repeating side tile (canvas y q..2q → V 0.5..0)
        paintSand(0, q, false);

        // ── Grass quadrant (top-right) ──────────────────────────────────────
        ctx.fillStyle = cfg.grass.base;
        ctx.fillRect(q, 0, q, q);

        for (let i = 0; i < cfg.grass.patchCount; i++) {
            const px = q + rand() * q;
            const py = rand() * q;
            const pr = 4 + rand() * 16;
            ctx.fillStyle = rand() > 0.5 ? cfg.grass.light : cfg.grass.dark;
            ctx.globalAlpha = 0.28 + rand() * 0.32;
            ctx.beginPath();
            ctx.arc(px, py, pr, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.globalAlpha = 0.42;
        for (let i = 0; i < 55; i++) {
            const px = q + rand() * q;
            const py = rand() * q;
            const bh = 3 + rand() * 6;
            ctx.fillStyle = rand() > 0.5 ? cfg.grass.light : cfg.grass.dark;
            ctx.fillRect(px, py, 1 + Math.round(rand()), bh);
        }
        ctx.globalAlpha = 1;

        // Bottom-right — unused, left blank.

        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        TextureBuilder.islandTex = tex;
        return tex;
    }

    /**
     * Placeholder player face (eyes + smile on a transparent background) —
     * meant to sit on its own decal plane in front of the cube's front face
     * rather than be baked into a per-value material, so it's a single shared
     * texture regardless of the cube's colour. Temporary — meant to be
     * export()ed, touched up in an image editor, and swapped for
     * hand-authored art loaded via load().
     */
    static face(): THREE.CanvasTexture {
        if (TextureBuilder.faceTex) return TextureBuilder.faceTex;

        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d')!;

        // Transparent background — this is drawn as an overlay, not a full face material.
        // Eyes — white
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(40, 45, 14, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(88, 45, 14, 0, Math.PI * 2); ctx.fill();
        // Pupils
        ctx.fillStyle = '#222222';
        ctx.beginPath(); ctx.arc(44, 48, 7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(92, 48, 7, 0, Math.PI * 2); ctx.fill();
        // Smile
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(64, 60, 28, 0.2 * Math.PI, 0.8 * Math.PI);
        ctx.stroke();

        const tex = new THREE.CanvasTexture(canvas);
        TextureBuilder.faceTex = tex;
        return tex;
    }

    /**
     * Faint, tileable grayscale grain texture (near-white with soft, wavy
     * streaks) — meant as a `map` on a piece that's otherwise a flat solid
     * color, since three.js multiplies map × material.color. That's what
     * lets the SAME texture read as a subtle wood-like grain on any tint
     * (wall poles, base/trapdoor panels — see TowerWallSync3D/
     * TowerBaseSync3D) instead of baking in a specific wood color.
     *
     * `repeat` is set here (not left for callers) to a FIXED value rather
     * than one scaled by each mesh's own width/height: ExtrudeGeometry's
     * default UV generator (WorldUVGenerator) already emits UVs as raw
     * LOCAL-SPACE coordinates, not normalized 0..1 — so a mesh's own UV
     * range already grows with its size, and multiplying `repeat` by that
     * same width/height on top double-applies the scaling, over-tiling the
     * grain by orders of magnitude (it collapses to a flat averaged tint
     * under mipmapping — no visible texture at all). Leaving repeat at a
     * small fixed constant here means bigger meshes naturally show more
     * tile repeats (consistent grain size in world units) without a second,
     * redundant per-caller multiply. Shared/cached like face()/island() —
     * do not clone or mutate `.repeat` per instance.
     */
    static woodGrain(): THREE.CanvasTexture {
        if (TextureBuilder.woodGrainTex) return TextureBuilder.woodGrainTex;

        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d')!;

        ctx.fillStyle = '#ececec';
        ctx.fillRect(0, 0, size, size);

        // Deterministic PRNG — same texture every load, no Date.now()/Math.random().
        let seed = 0x9e3779b9;
        const rand = (): number => {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            return (seed >>> 0) / 0xffffffff;
        };

        // Short, gently wavy streaks at low alpha — deliberately faint so
        // this reads as subtle surface variation (a hint of grain), not a
        // printed wood pattern. Kept well under the canvas size (unlike the
        // old 0.5-1.1x-size streaks, which were often WIDER than the whole
        // canvas and drew as near-full-width, nearly-flat lines — stack 130
        // of those and it reads as uniform horizontal ridges/banding rather
        // than grain, especially once WOOD_GRAIN_REPEAT scales tiles up).
        for (let i = 0; i < 190; i++) {
            const y = rand() * size;
            const streakLen = size * (0.12 + rand() * 0.22);
            const x = rand() * size - streakLen / 2;
            const lighter = rand() > 0.5;

            ctx.strokeStyle = lighter ? '#fafafa' : '#c2c2c2';
            ctx.globalAlpha = 0.1 + rand() * 0.16;
            ctx.lineWidth = 1 + rand() * 1.5;

            // Wave shape rolled ONCE, then the same streak is stamped at
            // three horizontal offsets (-size, 0, +size) with THAT identical
            // shape. Without this, a streak that runs past x=0 or x=size
            // just gets clipped by the canvas edge, and RepeatWrapping's
            // tiling has nothing on the opposite side to line up with —
            // that mismatch is the visible "seam". Stamping the same curve
            // one tile-width to either side guarantees whatever spills off
            // one edge is exactly what appears on the other.
            //
            // `drift` tilts the streak diagonally end-to-end (on top of the
            // usual mid-curve wobble) — without it, short streaks with only
            // a few px of wobble still all read as basically horizontal,
            // which is the same banding problem at a smaller scale.
            const drift = (rand() - 0.5) * streakLen * 0.5;
            const waveStart = (rand() - 0.5) * 3;
            const wave1 = drift * 0.33 + (rand() - 0.5) * 6;
            const wave2 = drift * 0.66 + (rand() - 0.5) * 6;
            const waveEnd = drift + (rand() - 0.5) * 3;

            // Wrapped in both axes now that `drift` can carry a streak's y
            // far enough to spill past the top/bottom edge too, not just
            // left/right.
            for (const dx of [-size, 0, size]) {
                for (const dy of [-size, 0, size]) {
                    ctx.beginPath();
                    ctx.moveTo(x + dx, y + dy + waveStart);
                    ctx.bezierCurveTo(
                        x + dx + streakLen * 0.33, y + dy + wave1,
                        x + dx + streakLen * 0.66, y + dy + wave2,
                        x + dx + streakLen, y + dy + waveEnd,
                    );
                    ctx.stroke();
                }
            }
        }
        ctx.globalAlpha = 1;

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        // See WOOD_GRAIN_REPEAT's own doc for why this is a small fixed
        // constant instead of something callers scale by their mesh's own
        // width/height.
        tex.repeat.set(WOOD_GRAIN_REPEAT, WOOD_GRAIN_REPEAT);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        TextureBuilder.woodGrainTex = tex;
        return tex;
    }

    /**
     * Loads a texture from a path once and caches it — a second call with the
     * same path returns the same texture (or joins the same in-flight load)
     * instead of loading it again.
     */
    static load(path: string): Promise<THREE.Texture> {
        const cached = TextureBuilder.pathCache.get(path);
        if (cached) return Promise.resolve(cached);

        const promise = TextureBuilder.loader.loadAsync(path).then((tex) => {
            TextureBuilder.pathCache.set(path, tex);
            return tex;
        });
        TextureBuilder.pathCache.set(path, promise);
        return promise;
    }

    /**
     * Dumps a generated CanvasTexture out as a PNG download so it can be
     * hand-edited and later swapped in for real via load(path).
     */
    static export(texture: THREE.CanvasTexture, filename: string): void {
        const canvas = texture.image as HTMLCanvasElement;
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
        a.click();
    }
}
