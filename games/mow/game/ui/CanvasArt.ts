// CanvasArt.ts
//
// Drawing for the labels that live in the 3D world (station icons, price tags, zone signs, floating "+$"),
// so they match the 2D UI: the kit's font (UiKit.fontFamily) with a dark outline, plaques with a soft rim,
// and UI-atlas icons (cash, trophy, heart, coin) pulled out of the loaded atlas through the Pixi renderer.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { Game } from 'core/Game';
import { UiKit } from './UiKit';

const atlasCache = new Map<string, CanvasImageSource | null>();

export const CanvasArt = {
    /** CSS font for canvas text in the kit's main font. */
    font(size: number): string {
        return `${size}px ${UiKit.fontFamily('primary')}`;
    },

    /** A UI-atlas frame as a drawable image (null if the atlas doesn't have it). */
    atlasImage(name: string): CanvasImageSource | null {
        if (!atlasCache.has(name)) {
            let image: CanvasImageSource | null = null;
            try {
                const sprite = PIXI.Sprite.from(name);
                image = Game.renderer.extract.canvas(sprite) as unknown as CanvasImageSource;
                sprite.destroy();
            } catch (error) {
                console.warn(`[CanvasArt] no atlas frame ${name}`, error);
            }
            // A miss isn't remembered: the atlas may just not be ready yet (forgetIcon() redraws later).
            if (image) atlasCache.set(name, image);
            return image;
        }
        return atlasCache.get(name) ?? null;
    },

    /** Drops a frame's cached image (drawn too early it can come out blank), so the next draw extracts it again. */
    forgetIcon(name: string): void {
        atlasCache.delete(name);
    },

    /** Draws an atlas frame fitted into a `size` box centred on (x, y). */
    drawIcon(g: CanvasRenderingContext2D, name: string, x: number, y: number, size: number): void {
        const image = CanvasArt.atlasImage(name) as (CanvasImageSource & { width: number; height: number }) | null;
        if (!image) return;
        const scale = size / Math.max(image.width, image.height, 1);
        g.drawImage(image, x - (image.width * scale) / 2, y - (image.height * scale) / 2, image.width * scale, image.height * scale);
    },

    /** Kit-style text: fill over a thick dark outline, shrunk to `maxWidth`. */
    text(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, maxWidth?: number, stroke = '#1d140e'): void {
        g.font = CanvasArt.font(size);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        g.lineWidth = Math.max(4, size * 0.22);
        g.strokeStyle = stroke;
        g.strokeText(text, x, y, maxWidth);
        g.fillStyle = fill;
        g.fillText(text, x, y, maxWidth);
    },

    /** A dark rounded plaque with a light rim and a darker bottom band, like the kit's dark frames. */
    plaque(g: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, rim = 'rgba(255,255,255,0.35)'): void {
        const gradient = g.createLinearGradient(0, y, 0, y + height);
        gradient.addColorStop(0, 'rgba(46, 52, 66, 0.95)');
        gradient.addColorStop(1, 'rgba(22, 25, 33, 0.95)');
        g.fillStyle = gradient;
        g.beginPath();
        g.roundRect(x, y, width, height, radius);
        g.fill();
        g.lineWidth = 4;
        g.strokeStyle = rim;
        g.stroke();
    },

    texture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    },
};
