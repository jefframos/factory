import * as THREE from 'three';
import { ISLAND_TEXTURE_CONFIG } from '../world/MeshConfig';

/**
 * Generates a 2:1 canvas texture atlas for island-style tiles.
 *
 * Atlas layout (edit ISLAND_TEXTURE_CONFIG in MeshConfig.ts to tweak colours/detail):
 *   Left  half [U 0.0 → 0.5] — sand, used on vertical side faces
 *   Right half [U 0.5 → 1.0] — grass, used on top faces
 *
 * UV v=1 maps to the top of a face (at yTop), v=0 to the bottom (at yBot).
 * Because THREE.CanvasTexture has flipY=true by default, canvas y=0 (top of image)
 * maps to UV v=1 — so the soil-transition strip drawn at canvas y=0 appears at
 * the top edge of side faces, right where they meet the grass cap.
 */
export function makeIslandTexture(): THREE.CanvasTexture {
    const cfg = ISLAND_TEXTURE_CONFIG;
    const half = cfg.resolution;
    const canvas = document.createElement('canvas');
    canvas.width = half * 2;
    canvas.height = half;
    const ctx = canvas.getContext('2d')!;

    // Deterministic PRNG — same texture every load, no Date.now() / Math.random()
    let seed = 0x4f7a2b;
    const rand = (): number => {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        return (seed >>> 0) / 0xffffffff;
    };

    // ── Sand region (left half) ───────────────────────────────────────────────

    ctx.fillStyle = cfg.sand.base;
    ctx.fillRect(0, 0, half, half);

    // Soil/root strip at canvas-top (= top edge of side face, grass junction)
    ctx.fillStyle = cfg.sand.soilStrip;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, 0, half, Math.round(half * 0.1));
    ctx.globalAlpha = 1;

    // Colour variation patches
    for (let i = 0; i < cfg.sand.patchCount; i++) {
        const px = rand() * half;
        const py = rand() * half;
        const pw = 5 + rand() * 22;
        const ph = 4 + rand() * 14;
        ctx.fillStyle = rand() > 0.5 ? cfg.sand.light : cfg.sand.dark;
        ctx.globalAlpha = 0.18 + rand() * 0.28;
        ctx.fillRect(px, py, pw, ph);
    }

    // Subtle horizontal grain (layered sand look)
    ctx.strokeStyle = cfg.sand.dark;
    ctx.lineWidth = 1;
    for (let y = 8; y < half; y += 9 + Math.floor(rand() * 7)) {
        ctx.globalAlpha = 0.05 + rand() * 0.05;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(half, y);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // ── Grass region (right half) ─────────────────────────────────────────────

    ctx.fillStyle = cfg.grass.base;
    ctx.fillRect(half, 0, half, half);

    // Rounded variation patches (like tuft shadows / sunlit spots)
    for (let i = 0; i < cfg.grass.patchCount; i++) {
        const px = half + rand() * half;
        const py = rand() * half;
        const pr = 4 + rand() * 16;
        ctx.fillStyle = rand() > 0.5 ? cfg.grass.light : cfg.grass.dark;
        ctx.globalAlpha = 0.28 + rand() * 0.32;
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
    }

    // Tiny grass-blade details (1–2 px wide vertical strokes)
    ctx.globalAlpha = 0.42;
    for (let i = 0; i < 55; i++) {
        const px = half + rand() * half;
        const py = rand() * half;
        const bh = 3 + rand() * 6;
        ctx.fillStyle = rand() > 0.5 ? cfg.grass.light : cfg.grass.dark;
        ctx.fillRect(px, py, 1 + Math.round(rand()), bh);
    }
    ctx.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    return tex;
}
