// TownSnapshotScene.ts
//
// Dev-only: bakes the town map's miniatures (the HUD's TownMiniature). Opened by the editor's Map shots tab as the
// game with `?mapshots=<editor url>&zone=<zone>`: it builds the level fully restored (every section open, mowed, in
// bloom, every station out; no player, no traffic, no sea, no bend), in the game's own light, and renders it from the
// zone's camera (levels/mapshots.json, by the editor: yaw round, pitch above, 0° / 40° unless set; isometric — an
// orthographic camera — or a perspective one with its field of view), on nothing (transparent), cropped tight, at
// RENDER_WIDTH. Two pictures come out of it: `<zone>` (BIG_WIDTH across: the HUD's reveal) and `<zone>-small`
// (SMALL_WIDTH: the HUD's corner), each shrunk in halving steps so it stays smooth, the small one with a black outline
// round its silhouette if the zone asks (`stroke`, like the rest of the HUD). The zone (`town`, or a section id) is
// shot one of two ways:
//   - original: the town as it is — `town` the whole island (its sides the base it stands on); a section cut out of
//     it (what fits in it; the ground clipped to it) onto a slab of earth;
//   - custom: the zone's own diorama (a level shaped like town.json, built in the editor), loaded in the town's place
//     (TOWN is swapped before anything is built: this page only ever shoots).
// Without `zone`, every zone is shot as the original. Each PNG is posted to the editor server
// (POST /api/map-snapshot?name=…), which saves it under raw-assets/non-preload/map and publishes it as
// public/mow/images/non-preload/map/<name>.webp at once.

import * as THREE from 'three';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import { MOW, TOWN, TownLevel } from '../data/MowConfig';
import { Town } from '../world/Town';
import { GrassField } from '../world/GrassField';
import { BendService } from '../services/BendService';
import { addTownLights, flowerSpots } from '../scenes/MowScene';

/** The query parameter that starts the bake (its value: the editor server's URL). */
export const SNAPSHOT_PARAM = 'mapshots';
/** The render's width (the height follows the shot), and the two pictures' (shrunk from it in halving steps). */
const RENDER_WIDTH = 2048;
const BIG_WIDTH = 512;
const SMALL_WIDTH = 192;
/** The small picture's outline (`stroke`): its width in pixels unless the zone sets one (`strokeWidth`). */
const STROKE_PX = 3;
/** A perspective camera's field of view unless the zone sets one (degrees, vertical). */
const DEFAULT_FOV = 35;
/** The camera unless the zone sets one (the game's pitch is 55°: lower reads more like a model of the town). */
const DEFAULT_CAMERA: Camera = { yaw: 0, pitch: 40 };
/** Room left round what was drawn, as a share of its size (after cropping to it). */
const MARGIN = 0.03;
/** A section's slab of earth under it (thickness, colour), and how much of the town round it the clip keeps. */
const SLAB = { depth: 1.1, color: 0x9a6a42 };
const CLIP_PAD = 0.02;
/** The shot's frame reaches this high when nothing is built yet (else the tallest thing's top: top()). */
const MAX_HEIGHT = 15;
/** A pixel this opaque (0-255) or more counts as drawn, for the crop. */
const CROP_ALPHA = 8;
/** A section's shot: things this wide (or deep) or more are ground, kept (clipped) even when they reach outside it. */
const BIG = 12;
/** A section's shot: how far past its edge a prop may reach and still count as in it. */
const FIT_SLACK = 0.3;
/** After the models load: time for the town's redraws (labels) and the grass to settle before shooting. */
const SETTLE_MS = 800;

interface Camera {
    yaw: number;
    pitch: number;
    /** Isometric (orthographic: no perspective; the default) or a perspective camera with `fov`. */
    ortho?: boolean;
    fov?: number;
}

/** A zone's settings (levels/mapshots.json, served by the editor). */
interface ZoneShot {
    mode?: 'original' | 'custom';
    camera?: Camera;
    /** A black outline round the small (HUD) picture's silhouette, `strokeWidth` pixels wide. */
    stroke?: boolean;
    strokeWidth?: number;
}

export default class TownSnapshotScene extends ThreeScene {
    private town!: Town;
    private grass!: GrassField;
    private readonly status = document.createElement('div');
    private loaded: Promise<void> = Promise.resolve();
    private readonly params = new URLSearchParams(window.location.search);
    private readonly editor = this.params.get(SNAPSHOT_PARAM) || 'http://localhost:4710';
    /** The zone asked for (none: every zone, as the original). */
    private readonly zone = this.params.get('zone');
    private settings: ZoneShot = {};
    /** The zone's custom diorama is what's built (not the town). */
    private custom = false;

    public constructor(game: Game) {
        super(game);
    }

    /** The loading screen waits for the town and the grass. */
    public get ready(): Promise<void> {
        return this.loaded;
    }

    public build(): void {
        this.status.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:100;padding:10px 14px;border-radius:8px;'
            + 'background:rgba(20,24,32,0.9);color:#fff;font:14px sans-serif;white-space:pre';
        document.body.appendChild(this.status);
        this.say('Map snapshots: loading the town…');
        this.loaded = this.setup();
        void this.loaded.then(() => window.setTimeout(() => void this.shootAll(), SETTLE_MS),
            (error) => this.say(`Map snapshots: could not load (${String(error)}). Is the editor running at ${this.editor}?`));
    }

    /** The zone's settings and (custom) its diorama, then the level, fully restored. */
    private async setup(): Promise<void> {
        if (this.zone) {
            const shots = await this.fetchJson<{ zones: Record<string, ZoneShot> }>('/api/mapshots');
            this.settings = shots.zones?.[this.zone] ?? {};
            if (this.settings.mode === 'custom') {
                this.useLevel(await this.fetchJson<TownLevel>(`/api/mapshots/custom?zone=${encodeURIComponent(this.zone)}`));
                this.custom = true;
            }
        }
        addTownLights(this.threeScene);
        this.town = new Town(this.threeScene, () => true, () => true);
        this.grass = new GrassField(this.threeScene, (x, z) => this.town.isBlocked(x, z));
        MOW.districts.forEach((district, d) => {
            this.grass.cutAll(d);
            this.grass.setRestored(d);
            this.town.bloom(flowerSpots(district, (x, z) => this.grass.isLawn(x, z, d)));
        });
        await Promise.all([this.town.ready, this.grass.ready]);
    }

    private async fetchJson<T>(path: string): Promise<T> {
        const response = await fetch(`${this.editor}${path}`);
        if (!response.ok) throw new Error(`${path}: ${response.status}`);
        return response.json() as Promise<T>;
    }

    /**
     * The diorama in the town's place, before anything is built: TOWN's fields replaced (its sections array kept, in
     * place: MOW.districts is the same array).
     */
    private useLevel(level: TownLevel): void {
        const { sections, ...rest } = level as TownLevel & { _version?: number };
        delete (rest as { _version?: number })._version;
        const town = TOWN as unknown as Record<string, unknown>;
        for (const key of Object.keys(town)) if (key !== 'sections') delete town[key];
        // Only the view: no stations, even in a diorama from before they were left out.
        Object.assign(town, rest, { atms: [], wardrobes: [] });
        TOWN.sections.splice(0, TOWN.sections.length, ...sections);
    }

    private say(text: string): void {
        this.status.textContent = text;
    }

    private async shootAll(): Promise<void> {
        const editor = this.editor;
        this.town.prepareSnapshot();
        this.grass.update();
        BendService.setEnabled(false);
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(1);
        renderer.setClearColor(0x000000, 0);
        this.threeScene.background = null;

        const shots: { name: string; box: THREE.Box3; section?: (typeof TOWN.sections)[number]; slab?: boolean }[] = [];
        const camera = this.settings.camera ?? DEFAULT_CAMERA;
        if (this.custom) {
            // The diorama whole: on its island's sides, or (none) on a slab of earth under its ground.
            shots.push({ name: this.zone!, box: this.islandBox(), slab: !TOWN.island });
        } else {
            if (!this.zone || this.zone === 'town') shots.push({ name: 'town', box: this.islandBox() });
            TOWN.sections.forEach((section) => {
                if (!this.zone || this.zone === section.id) shots.push({ name: section.id, box: this.sectionBox(section), section });
            });
        }

        const failed: string[] = [];
        for (const [i, shot] of shots.entries()) {
            this.say(`Map snapshots: ${shot.name} (${i + 1}/${shots.length})…`);
            const slab = shot.section ? this.addSlab(shot.section) : shot.slab ? this.addSlab(TOWN.ground) : null;
            const hidden = shot.section ? this.hideOutside(rectOf(shot.section)) : [];
            renderer.clippingPlanes = shot.section ? this.clipPlanes(shot.section) : [];
            const render = this.shoot(renderer, shot.box, camera);
            slab?.removeFromParent();
            hidden.forEach((mesh) => (mesh.visible = true));
            const small = shrunk(render, SMALL_WIDTH);
            const pictures: [string, HTMLCanvasElement][] = [
                [shot.name, shrunk(render, BIG_WIDTH)],
                [`${shot.name}-small`, this.settings.stroke ? outlined(small, Math.max(1, this.settings.strokeWidth ?? STROKE_PX)) : small],
            ];
            try {
                for (const [name, canvas] of pictures) {
                    const response = await fetch(`${editor}/api/map-snapshot?name=${encodeURIComponent(name)}`, { method: 'POST', body: await png(canvas) });
                    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
                }
            } catch (error) {
                console.error('[TownSnapshotScene]', shot.name, error);
                failed.push(shot.name);
            }
        }
        renderer.dispose();
        this.say(failed.length
            ? `Map snapshots: ${failed.length} failed (${failed.join(', ')}). Is the editor running at ${editor}?`
            : `Map snapshots: ${shots.length} saved. You can close this tab.`);
    }

    /** The island, from the bottom of its sides up. */
    private islandBox(): THREE.Box3 {
        const outline = TOWN.island?.outline;
        const xs = outline?.length ? outline.map((p) => p.x) : [TOWN.ground.x - TOWN.ground.width / 2, TOWN.ground.x + TOWN.ground.width / 2];
        const zs = outline?.length ? outline.map((p) => p.z) : [TOWN.ground.z - TOWN.ground.depth / 2, TOWN.ground.z + TOWN.ground.depth / 2];
        const rect = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
        return new THREE.Box3(
            new THREE.Vector3(rect.minX, TOWN.island ? -TOWN.island.sideDepth : -SLAB.depth, rect.minZ),
            new THREE.Vector3(rect.maxX, this.top(), rect.maxZ),
        );
    }

    /** A section: its rect, from the bottom of its slab up. */
    private sectionBox(section: (typeof TOWN.sections)[number]): THREE.Box3 {
        const rect = rectOf(section);
        return new THREE.Box3(
            new THREE.Vector3(rect.minX, -SLAB.depth, rect.minZ),
            new THREE.Vector3(rect.maxX, this.top(), rect.maxZ),
        );
    }

    /**
     * The top of the tallest thing built (the frame reaches it: a fixed height cut tall buildings off; the crop takes
     * away what's left over).
     */
    private top(): number {
        const box = new THREE.Box3();
        this.threeScene.traverseVisible((child) => {
            if (child instanceof THREE.Mesh) box.expandByObject(child);
        });
        return box.isEmpty() ? MAX_HEIGHT : Math.max(1, box.max.y) + 0.5;
    }

    /** Four planes keeping only what's over the section (a hair past its edges, so the slab's sides survive). */
    private clipPlanes(section: (typeof TOWN.sections)[number]): THREE.Plane[] {
        const rect = rectOf(section);
        return [
            new THREE.Plane(new THREE.Vector3(1, 0, 0), -(rect.minX - CLIP_PAD)),
            new THREE.Plane(new THREE.Vector3(-1, 0, 0), rect.maxX + CLIP_PAD),
            new THREE.Plane(new THREE.Vector3(0, 0, 1), -(rect.minZ - CLIP_PAD)),
            new THREE.Plane(new THREE.Vector3(0, 0, -1), rect.maxZ + CLIP_PAD),
        ];
    }

    /**
     * Hides every piece that doesn't fit inside the section (FIT_SLACK of give): a half-cut prop, or a streetlight just
     * outside whose head leans over the cut, would look broken on the diorama. A prop goes or stays whole (the town's
     * pieces: the children of the scene's groups); ground-sized ones stay, clipped, losing only their small parts
     * that stick out. The instanced grass and flowers stay, clipped. Returns what it hid.
     */
    private hideOutside(rect: Rect): THREE.Object3D[] {
        const hidden: THREE.Object3D[] = [];
        const box = new THREE.Box3();
        const size = new THREE.Vector3();
        const fits = () => box.min.x >= rect.minX - FIT_SLACK && box.max.x <= rect.maxX + FIT_SLACK
            && box.min.z >= rect.minZ - FIT_SLACK && box.max.z <= rect.maxZ + FIT_SLACK;
        const big = () => Math.max(box.getSize(size).x, size.z) >= BIG;
        for (const group of this.threeScene.children) {
            if (!(group instanceof THREE.Group)) continue;
            for (const piece of group.children) {
                if (!piece.visible || piece instanceof THREE.InstancedMesh) continue;
                box.setFromObject(piece);
                if (box.isEmpty() || fits()) continue;
                if (!big()) {
                    hidden.push(piece);
                    continue;
                }
                piece.traverseVisible((child) => {
                    if (!(child instanceof THREE.Mesh) || child instanceof THREE.InstancedMesh) return;
                    box.setFromObject(child);
                    if (!box.isEmpty() && !fits() && !big()) hidden.push(child);
                });
            }
        }
        hidden.forEach((object) => (object.visible = false));
        return hidden;
    }

    /** The earth under a section's (or an island-less diorama's ground's) rect, its top just under the ground. */
    private addSlab(section: { x: number; z: number; width: number; depth: number }): THREE.Mesh {
        const slab = new THREE.Mesh(
            new THREE.BoxGeometry(section.width, SLAB.depth, section.depth),
            new THREE.MeshStandardMaterial({ color: SLAB.color, roughness: 1 }),
        );
        slab.position.set(section.x, -0.06 - SLAB.depth / 2, section.z);
        this.threeScene.add(slab);
        return slab;
    }

    /**
     * Renders `box` from `angle` (yaw 0 = from the south; isometric unless `ortho` is false), framed on it, RENDER_WIDTH
     * across, then cropped to what was drawn (plus MARGIN).
     */
    private shoot(renderer: THREE.WebGLRenderer, box: THREE.Box3, angle: Camera): HTMLCanvasElement {
        const yaw = THREE.MathUtils.degToRad(angle.yaw);
        const pitch = THREE.MathUtils.degToRad(Math.min(89.5, Math.max(1, angle.pitch)));
        const ortho = angle.ortho ?? true;
        const centre = box.getCenter(new THREE.Vector3());
        const radius = box.getSize(new THREE.Vector3()).length() / 2;
        const fov = Math.min(100, Math.max(5, angle.fov ?? DEFAULT_FOV));
        // Far enough back that the whole box is in view (perspective: its bounding sphere in the field of view).
        const reach = ortho ? radius * 2 + 10 : radius / Math.sin(THREE.MathUtils.degToRad(fov) / 2) + 1;
        const direction = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        const camera: THREE.OrthographicCamera | THREE.PerspectiveCamera = ortho
            ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, reach + radius * 2)
            : new THREE.PerspectiveCamera(fov, 1, Math.max(0.1, reach - radius * 1.5), reach + radius * 2);
        camera.position.copy(centre).addScaledVector(direction, reach);
        camera.lookAt(centre);
        camera.updateMatrixWorld();
        camera.updateProjectionMatrix();
        // The occlusion fade (props between the camera and the player turn see-through) off: the "player" is the camera.
        BendService.updateCameraPosition(camera.position);
        BendService.updateOcclusionTarget(camera.position);

        // Frame the box's eight corners as the camera sees them: orthographic, its view's edges; perspective, the
        // part of a square frame they project into (a view offset).
        const view = new THREE.Box3();
        const corner = new THREE.Vector3();
        for (let i = 0; i < 8; i++) {
            corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
            view.expandByPoint(ortho ? corner.applyMatrix4(camera.matrixWorldInverse) : corner.project(camera));
        }
        let renderHeight: number;
        if (camera instanceof THREE.OrthographicCamera) {
            camera.left = view.min.x;
            camera.right = view.max.x;
            camera.bottom = view.min.y;
            camera.top = view.max.y;
            camera.updateProjectionMatrix();
            renderHeight = Math.round((RENDER_WIDTH * (camera.top - camera.bottom)) / (camera.right - camera.left));
        } else {
            const minX = Math.max(-1, view.min.x);
            const maxX = Math.min(1, view.max.x);
            const minY = Math.max(-1, view.min.y);
            const maxY = Math.min(1, view.max.y);
            const frame = RENDER_WIDTH / ((maxX - minX) / 2);
            renderHeight = Math.round((frame * (maxY - minY)) / 2);
            camera.setViewOffset(frame, frame, ((minX + 1) / 2) * frame, ((1 - maxY) / 2) * frame, RENDER_WIDTH, renderHeight);
        }
        renderer.setSize(RENDER_WIDTH, renderHeight, false);
        renderer.render(this.threeScene, camera);
        const full = document.createElement('canvas');
        full.width = RENDER_WIDTH;
        full.height = renderHeight;
        const fullContext = full.getContext('2d', { willReadFrequently: true })!;
        fullContext.drawImage(renderer.domElement, 0, 0);
        const crop = drawnBounds(fullContext.getImageData(0, 0, RENDER_WIDTH, renderHeight));
        const padX = Math.round(crop.width * MARGIN);
        const padY = Math.round(crop.height * MARGIN);
        const out = document.createElement('canvas');
        out.width = crop.width + padX * 2;
        out.height = crop.height + padY * 2;
        out.getContext('2d')!.drawImage(full, crop.x - padX, crop.y - padY, out.width, out.height, 0, 0, out.width, out.height);
        return out;
    }

    public update(): void {
        // Nothing moves and nothing needs drawing on screen: the shots render themselves (shoot()).
    }

    public destroy(): void {
        this.status.remove();
        this.town?.destroy();
        this.grass?.destroy();
        super.destroy();
    }
}

interface Rect {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

/** `source` scaled to `width` across, halving at most each step (a straight big shrink drops pixels: jaggies). */
function shrunk(source: HTMLCanvasElement, width: number): HTMLCanvasElement {
    let current = source;
    while (current.width > width) {
        const next = document.createElement('canvas');
        next.width = Math.max(width, Math.round(current.width / 2));
        next.height = Math.max(1, Math.round((current.height * next.width) / current.width));
        const context = next.getContext('2d')!;
        context.imageSmoothingQuality = 'high';
        context.drawImage(current, 0, 0, next.width, next.height);
        current = next;
    }
    return current;
}

/** `source` with a black outline `px` wide round its silhouette (its shape stamped black all round, it on top). */
function outlined(source: HTMLCanvasElement, px: number): HTMLCanvasElement {
    const silhouette = document.createElement('canvas');
    silhouette.width = source.width;
    silhouette.height = source.height;
    const ink = silhouette.getContext('2d')!;
    ink.drawImage(source, 0, 0);
    ink.globalCompositeOperation = 'source-in';
    ink.fillStyle = '#000';
    ink.fillRect(0, 0, silhouette.width, silhouette.height);
    const out = document.createElement('canvas');
    out.width = source.width + px * 2;
    out.height = source.height + px * 2;
    const context = out.getContext('2d')!;
    for (let k = 0; k < 16; k++) {
        const angle = (k / 16) * Math.PI * 2;
        context.drawImage(silhouette, px + Math.cos(angle) * px, px + Math.sin(angle) * px);
    }
    context.drawImage(source, px, px);
    return out;
}

function png(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png'));
}

/** The smallest rectangle holding every pixel drawn (opaque enough), or the whole image when nothing was. */
function drawnBounds(image: ImageData): { x: number; y: number; width: number; height: number } {
    const { width, height, data } = image;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] < CROP_ALPHA) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    return maxX < 0 ? { x: 0, y: 0, width, height } : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

const rectOf = (box: { x: number; z: number; width: number; depth: number }): Rect => ({
    minX: box.x - box.width / 2, maxX: box.x + box.width / 2, minZ: box.z - box.depth / 2, maxZ: box.z + box.depth / 2,
});
