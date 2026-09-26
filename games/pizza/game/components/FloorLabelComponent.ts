// FloorLabelComponent.ts
//
// World-space UI painted on the floor — an icon, plus an optional text value
// (e.g. a stored count), drawn on a flat plane lying on the ground next to
// whatever it describes. The in-world alternative to a ScreenAnchorComponent
// bubble on the PIXI overlay: it sits IN the scene (occluded by nothing, but
// moving/bending/hiding with its entity exactly like the meshes around it).
//
// Same decal setup the "down" game uses for its face/number decals: one
// canvas (icon + text, bold font with a dark outline) -> CanvasTexture ->
// MeshBasicMaterial (transparent, no depth write, sRGB) with the world bend
// applied. The canvas is only redrawn when the text actually changes.
//
// The plane is aligned with the world grid (square with the map / the thing
// it labels), text reading from the south. Pass `rotationDeg` to turn it.
//
// First user: StorageZone (the stored count in front of each storage).

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import Component from '../ecs/Component';
import { BendService } from '../services/BendService';
import { pixiTextureToCanvas } from '../builders/PixiIconToThree';

/** Canvas pixels per world unit — high enough that the text stays crisp at gameplay camera distance. */
const PIXELS_PER_UNIT = 160;
/** Default label height on the floor, world units. */
export const DEFAULT_FLOOR_LABEL_SIZE = 2.7;
/**
 * Label height above y=0 — must clear the tallest stacked ground layer (tile height, up to 0.03
 * for sand, + GROUND_LAYER_Y_STEP per extra groundLayer, see TileMapConfig.ts) so it's never drawn
 * under the ground. Height only — depth testing stays on so buildings/props still hide it normally.
 */
const FLOOR_HEIGHT = 0.1;
const FONT_FAMILY = '"Baloo2-ExtraBold", "Arial Black", Arial, sans-serif';

export interface FloorLabelOptions {
    /** Icon drawn on the label (e.g. getAssetIcon(...)). Omit for a text-only label. */
    icon?: PIXI.Texture;
    /** Initial text — omit/empty for an icon-only label. Change later with setText(). */
    text?: string;
    /** Label height on the floor (world units). Width follows: square for icon-only, wider with text. Default DEFAULT_FLOOR_LABEL_SIZE (2.7). */
    size?: number;
    /** Center of the label, relative to the owning entity (Y is ignored — it always sits on the floor). */
    offset?: THREE.Vector3;
    /** Yaw in degrees. Default 0 — aligned with the world grid, text readable from the south. */
    rotationDeg?: number;
    /** Draw a translucent rounded plate behind the icon/text. Default true. */
    background?: boolean;
    /** Shrinks the whole label (keeping its aspect) so it fits inside this footprint, world units — e.g. the area it sits on. Unset = no limit. */
    maxWidth?: number;
    maxDepth?: number;
}

export default class FloorLabelComponent extends Component {
    private readonly options: FloorLabelOptions;
    private readonly iconCanvas: HTMLCanvasElement | null;
    private text: string;

    private readonly canvas = document.createElement('canvas');
    private texture: THREE.CanvasTexture;
    private readonly material: THREE.MeshBasicMaterial;
    private mesh?: THREE.Mesh;

    public constructor(options: FloorLabelOptions) {
        super();
        this.options = options;
        this.text = options.text ?? '';
        this.iconCanvas = options.icon ? pixiTextureToCanvas(options.icon) : null;
        this.texture = this.createTexture();
        this.material = new THREE.MeshBasicMaterial({
            map: this.texture,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
        });
        BendService.applyBend(this.material);
    }

    public awake(): void {
        this.rebuild();
    }

    /** Updates the value shown — redraws only if it changed. */
    public setText(text: string): void {
        if (text === this.text) {
            return;
        }
        this.text = text;
        this.rebuild();
    }

    public setVisible(visible: boolean): void {
        if (this.mesh) {
            this.mesh.visible = visible;
        }
    }

    public destroy(): void {
        this.mesh?.geometry.dispose();
        this.mesh?.removeFromParent();
        this.material.dispose();
        this.texture.dispose();
    }

    /** Redraws the canvas and (re)builds the plane when its aspect changes (text appearing/disappearing/growing). */
    private rebuild(): void {
        const size = this.options.size ?? DEFAULT_FLOOR_LABEL_SIZE;
        const heightPx = Math.round(size * PIXELS_PER_UNIT);
        const pad = Math.round(heightPx * 0.1);
        const iconSize = this.iconCanvas ? heightPx - pad * 2 : 0;
        const hasText = this.text.length > 0;

        const ctx = this.canvas.getContext('2d')!;
        const fontSize = Math.round(heightPx * 0.6);
        ctx.font = `${fontSize}px ${FONT_FAMILY}`;
        const textWidth = hasText ? Math.ceil(ctx.measureText(this.text).width) : 0;
        const gap = this.iconCanvas && hasText ? Math.round(pad * 0.6) : 0;
        const widthPx = Math.max(heightPx, pad * 2 + iconSize + gap + textWidth);

        const resized = this.canvas.width !== widthPx || this.canvas.height !== heightPx;
        this.canvas.width = widthPx;
        this.canvas.height = heightPx;
        ctx.clearRect(0, 0, widthPx, heightPx);

        if (this.options.background ?? true) {
            const radius = heightPx * 0.25;
            const inset = Math.max(2, heightPx * 0.03);
            ctx.beginPath();
            ctx.roundRect(inset, inset, widthPx - inset * 2, heightPx - inset * 2, radius);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.fill();
            ctx.lineWidth = inset * 2;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.stroke();
        }

        // Icon + text centered as one group.
        const contentWidth = iconSize + gap + textWidth;
        let x = (widthPx - contentWidth) / 2;
        if (this.iconCanvas) {
            ctx.drawImage(this.iconCanvas, x, pad, iconSize, iconSize);
            x += iconSize + gap;
        }
        if (hasText) {
            // Font must be set again — resizing the canvas resets the context state.
            ctx.font = `${fontSize}px ${FONT_FAMILY}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.lineJoin = 'round';
            ctx.lineWidth = Math.max(4, fontSize * 0.16);
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.strokeText(this.text, x, heightPx / 2 + fontSize * 0.05);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(this.text, x, heightPx / 2 + fontSize * 0.05);
        }
        if (resized) {
            // A GPU texture can't change size in place — swap in a fresh one.
            this.texture.dispose();
            this.texture = this.createTexture();
            this.material.map = this.texture;
            this.material.needsUpdate = true;
        } else {
            this.texture.needsUpdate = true;
        }

        if (!this.mesh || resized) {
            this.buildMesh(widthPx / PIXELS_PER_UNIT, heightPx / PIXELS_PER_UNIT);
        }
    }

    private createTexture(): THREE.CanvasTexture {
        const texture = new THREE.CanvasTexture(this.canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    private buildMesh(width: number, depth: number): void {
        const fit = Math.min(
            1,
            this.options.maxWidth !== undefined ? this.options.maxWidth / width : 1,
            this.options.maxDepth !== undefined ? this.options.maxDepth / depth : 1,
        );
        width *= fit;
        depth *= fit;
        const visible = this.mesh?.visible ?? true;
        this.mesh?.geometry.dispose();
        this.mesh?.removeFromParent();

        const geometry = new THREE.PlaneGeometry(width, depth);
        // Lie flat with the texture's "up" pointing north (-Z), then turn to the label's yaw.
        geometry.rotateX(-Math.PI / 2);
        geometry.rotateY(THREE.MathUtils.degToRad(this.options.rotationDeg ?? 0));

        const mesh = new THREE.Mesh(geometry, this.material);
        const offset = this.options.offset;
        mesh.position.set(offset?.x ?? 0, FLOOR_HEIGHT, offset?.z ?? 0);
        mesh.renderOrder = 1;
        mesh.visible = visible;
        this.mesh = mesh;
        this.entity.transform.add(mesh);
    }
}
