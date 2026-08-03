import * as THREE from 'three';
import { ISLAND_TEXTURE_CONFIG } from '../world/MeshConfig';

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
