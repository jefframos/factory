// FloorLabelComponent.ts
//
// World-space UI painted on the floor — one or more items (each an optional
// icon + optional text, e.g. a stored count) drawn in one row (or, with
// `stack: 'column'`, one item per line — e.g. a multi-part price) on a flat plane
// lying on the ground next to whatever it describes. The in-world alternative
// to a ScreenAnchorComponent bubble on the PIXI overlay: it sits IN the scene
// (occluded by nothing, but moving/bending/hiding with its entity exactly like
// the meshes around it). An empty item list hides the label entirely.
//
// Same decal setup the "down" game uses for its face/number decals: one
// canvas (icons + text, bold font with a dark outline) -> CanvasTexture ->
// MeshBasicMaterial (transparent, no depth write, sRGB) with the world bend
// applied. The canvas is only redrawn when the content actually changes.
//
// The plane is aligned with the world grid (square with the map / the thing
// it labels), text reading from the south. Pass `rotationDeg` to turn it.
//
// Users: StorageZone/StoragePurchaseZone, and every entity whose `frame` is
// 'Floor' (buildings, shops, queues, crafting, gates — see PopupConfig.ts's
// FLOOR_FRAME).

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import Component from '../ecs/Component';
import { BendService } from '../services/BendService';
import { pixiTextureToCanvas } from '../builders/PixiIconToThree';
import { DEFAULT_FLOOR_LABEL_GAP, type FloorLabelConfig, type FloorLabelSide } from '../ui/PopupConfig';

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
/** Plate padding as a fraction of the label's height — left/right, and top/bottom (the icon fills the rest of the height). */
const PAD_X = 0.18;
const PAD_Y = 0.06;

/** One entry in the label's row — an icon, a text, or both (icon first). */
export interface FloorLabelItem {
    icon?: PIXI.Texture;
    text?: string;
}

export interface FloorLabelOptions {
    /** Icon drawn on the label (e.g. getAssetIcon(...)) — single-item shorthand for `items`. Omit for a text-only label. */
    icon?: PIXI.Texture;
    /** Initial text — single-item shorthand for `items`. Change later with setText(). */
    text?: string;
    /** Several icon/text entries in one row — wins over icon/text when set. Change later with setItems(). */
    items?: FloorLabelItem[];
    /** Label height on the floor (world units) — per LINE with `stack: 'column'`. Width follows: square for icon-only, wider with text. Default DEFAULT_FLOOR_LABEL_SIZE (2.7). */
    size?: number;
    /** 'row' (default): every item side by side. 'column': one item per line, icons lined up on the left — reads better (and stays closer to square) for several icon+count items. */
    stack?: 'row' | 'column';
    /** Where the label sits, relative to the owning entity (Y is ignored — it always sits on the floor). Its center, unless `side` is set. */
    offset?: THREE.Vector3;
    /**
     * Which way the label extends from `offset`: 'south' puts its north edge on `offset` (so it
     * sits south of that point), etc. Unset = centered on `offset`. See floorLabelEdgeOffset().
     */
    side?: FloorLabelSide;
    /** Yaw in degrees. Default 0 — aligned with the world grid, text readable from the south. */
    rotationDeg?: number;
    /** Draw a translucent rounded plate behind the icon/text. Default true. */
    background?: boolean;
    /**
     * Stand the label up (a vertical plane facing south, toward the camera) instead of lying on the
     * floor — e.g. a sign on a signpost. `height` is then its center's height above the ground.
     * `side`, `maxDepth` and `rotationDeg` still apply (rotationDeg turns it around the vertical).
     */
    upright?: boolean;
    /** Center height above the ground for an `upright` label, world units. Default = half its own height. */
    height?: number;
    /** Shrinks the whole label (keeping its aspect) so it fits inside this footprint, world units — e.g. the area it sits on. Unset = no limit. */
    maxWidth?: number;
    maxDepth?: number;
}

/**
 * The point on a footprint's `side` edge, `gap` further out — pass it as `offset` together with
 * the same `side` so the label sits just outside that edge. `center` is the footprint's own
 * center relative to the owning entity.
 */
export function floorLabelEdgeOffset(side: FloorLabelSide, center: THREE.Vector3, width: number, depth: number, gap: number): THREE.Vector3 {
    const offset = center.clone();
    switch (side) {
        case 'north': offset.z -= depth / 2 + gap; break;
        case 'south': offset.z += depth / 2 + gap; break;
        case 'east': offset.x += width / 2 + gap; break;
        case 'west': offset.x -= width / 2 + gap; break;
    }
    return offset;
}

/**
 * A floor label placed from an entity config's own FloorLabelConfig fields — on its
 * `floorLabelSide` (default south) of the footprint (`center`/`width`/`depth`, relative to the
 * owning entity), `floorLabelGap` out, `floorLabelSize` tall. Add it with addComponent().
 */
export function createConfiguredFloorLabel(config: FloorLabelConfig, center: THREE.Vector3, width: number, depth: number, items: FloorLabelItem[] = []): FloorLabelComponent {
    const side = config.floorLabelSide ?? 'south';
    return new FloorLabelComponent({
        items,
        size: config.floorLabelSize ?? DEFAULT_FLOOR_LABEL_SIZE,
        side,
        offset: floorLabelEdgeOffset(side, center, width, depth, config.floorLabelGap ?? DEFAULT_FLOOR_LABEL_GAP),
    });
}

interface DrawnItem {
    iconCanvas: HTMLCanvasElement | null;
    text: string;
}

/** Resolves each item's icon to its (cached) canvas and drops items with neither icon nor text. */
function toDrawnItems(items: FloorLabelItem[]): DrawnItem[] {
    return items
        .map(item => ({ iconCanvas: item.icon ? pixiTextureToCanvas(item.icon) : null, text: item.text ?? '' }))
        .filter(item => item.iconCanvas !== null || item.text.length > 0);
}

export default class FloorLabelComponent extends Component {
    private readonly options: FloorLabelOptions;
    private items: DrawnItem[];
    /** Last value passed to setVisible() — the mesh also hides on its own while `items` is empty. */
    private shown = true;

    private readonly canvas = document.createElement('canvas');
    private texture: THREE.CanvasTexture;
    private readonly material: THREE.MeshBasicMaterial;
    private mesh?: THREE.Mesh;

    public constructor(options: FloorLabelOptions) {
        super();
        this.options = options;
        this.items = toDrawnItems(options.items ?? [{ icon: options.icon, text: options.text }]);
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

    /** Updates the (first item's) text — redraws only if it changed. Single-item shorthand for setItems(). */
    public setText(text: string): void {
        const first = this.items[0];
        if (!first) {
            this.setItems([{ text }]);
            return;
        }
        if (text === first.text) {
            return;
        }
        first.text = text;
        this.rebuild();
    }

    /** Replaces every item — redraws only if anything changed. An empty list hides the label. */
    public setItems(items: FloorLabelItem[]): void {
        const next = toDrawnItems(items);
        const same = next.length === this.items.length
            && next.every((item, i) => item.iconCanvas === this.items[i].iconCanvas && item.text === this.items[i].text);
        if (same) {
            return;
        }
        this.items = next;
        this.rebuild();
    }

    public setVisible(visible: boolean): void {
        this.shown = visible;
        this.applyVisibility();
    }

    public destroy(): void {
        this.mesh?.geometry.dispose();
        this.mesh?.removeFromParent();
        this.material.dispose();
        this.texture.dispose();
    }

    private applyVisibility(): void {
        if (this.mesh) {
            this.mesh.visible = this.shown && this.items.length > 0;
        }
    }

    /** Redraws the canvas and (re)builds the plane when its aspect changes (items appearing/disappearing/growing). */
    private rebuild(): void {
        const size = this.options.size ?? DEFAULT_FLOOR_LABEL_SIZE;
        const heightPx = Math.round(size * PIXELS_PER_UNIT);
        // Plate padding — wider on the sides than top/bottom (PAD_X/PAD_Y). Gaps between an icon
        // and its text / between items stay on the old uniform 10% base.
        const padX = Math.round(heightPx * PAD_X);
        const padY = Math.round(heightPx * PAD_Y);
        const pad = Math.round(heightPx * 0.1);
        const iconSize = heightPx - padY * 2;
        const iconTextGap = Math.round(pad * 0.6);
        const itemGap = pad * 2;

        const ctx = this.canvas.getContext('2d')!;
        const fontSize = Math.round(heightPx * 0.6);
        ctx.font = `${fontSize}px ${FONT_FAMILY}`;
        // Per item: [icon][gap][text] — widths measured once, reused for drawing below.
        const layout = this.items.map(item => {
            const textWidth = item.text.length > 0 ? Math.ceil(ctx.measureText(item.text).width) : 0;
            const iconWidth = item.iconCanvas ? iconSize : 0;
            const gap = item.iconCanvas && textWidth > 0 ? iconTextGap : 0;
            return { item, iconWidth, gap, textWidth, width: iconWidth + gap + textWidth };
        });
        // 'column': one item per line (each line iconSize tall, `pad` apart), the widest line sets
        // the width. 'row': everything on one line, as before.
        const column = this.options.stack === 'column' && layout.length > 1;
        const lineGap = pad;
        const contentWidth = column
            ? Math.max(0, ...layout.map(l => l.width))
            : layout.reduce((sum, l) => sum + l.width, 0) + Math.max(0, layout.length - 1) * itemGap;
        const canvasHeightPx = column ? padY * 2 + layout.length * iconSize + (layout.length - 1) * lineGap : heightPx;
        const widthPx = Math.max(heightPx, padX * 2 + contentWidth);

        const resized = this.canvas.width !== widthPx || this.canvas.height !== canvasHeightPx;
        this.canvas.width = widthPx;
        this.canvas.height = canvasHeightPx;
        ctx.clearRect(0, 0, widthPx, canvasHeightPx);

        if (this.options.background ?? true) {
            const radius = heightPx * 0.25;
            const inset = Math.max(2, heightPx * 0.03);
            ctx.beginPath();
            ctx.roundRect(inset, inset, widthPx - inset * 2, canvasHeightPx - inset * 2, radius);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.fill();
            ctx.lineWidth = inset * 2;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.stroke();
        }

        // Every item centered as one group. Font must be set again — resizing the canvas resets
        // the context state.
        ctx.font = `${fontSize}px ${FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(4, fontSize * 0.16);
        const startX = (widthPx - contentWidth) / 2;
        let x = startX;
        layout.forEach((l, index) => {
            // Column: every line starts at the same x (icons lined up); row: items follow each other.
            const lineTop = column ? padY + index * (iconSize + lineGap) : padY;
            if (l.item.iconCanvas) {
                ctx.drawImage(l.item.iconCanvas, x, lineTop, iconSize, iconSize);
            }
            if (l.textWidth > 0) {
                const textX = x + l.iconWidth + l.gap;
                const textY = lineTop + iconSize / 2 + fontSize * 0.05;
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.strokeText(l.item.text, textX, textY);
                ctx.fillStyle = '#ffffff';
                ctx.fillText(l.item.text, textX, textY);
            }
            x = column ? startX : x + l.width + itemGap;
        });

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
            this.buildMesh(widthPx / PIXELS_PER_UNIT, canvasHeightPx / PIXELS_PER_UNIT);
        }
        this.applyVisibility();
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
        this.mesh?.geometry.dispose();
        this.mesh?.removeFromParent();

        // Subdivided so a wide label follows the world bend — see BendService.segmentsForSpan().
        const geometry = new THREE.PlaneGeometry(width, depth, BendService.segmentsForSpan(width), BendService.segmentsForSpan(depth));
        // Flat: lie down with the texture's "up" pointing north (-Z). Upright: PlaneGeometry already
        // stands in XY facing +Z (south, toward the camera). Either way, then turn to the label's yaw.
        if (!this.options.upright) {
            geometry.rotateX(-Math.PI / 2);
        }
        geometry.rotateY(THREE.MathUtils.degToRad(this.options.rotationDeg ?? 0));

        const mesh = new THREE.Mesh(geometry, this.material);
        const offset = this.options.offset;
        const y = this.options.upright ? (this.options.height ?? depth / 2) : FLOOR_HEIGHT;
        mesh.position.set(offset?.x ?? 0, y, offset?.z ?? 0);
        // Shift so the label's near edge (not its center) lands on `offset` — see
        // FloorLabelOptions.side. Uses the un-yawed width/depth, exact for the grid-aligned default.
        switch (this.options.side) {
            case 'north': mesh.position.z -= depth / 2; break;
            case 'south': mesh.position.z += depth / 2; break;
            case 'east': mesh.position.x += width / 2; break;
            case 'west': mesh.position.x -= width / 2; break;
        }
        mesh.renderOrder = 1;
        this.mesh = mesh;
        this.entity.transform.add(mesh);
    }
}
