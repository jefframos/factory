// ModelSnapshotTool.ts
//
// Dev-only tool (see PizzaScene's 'Model Snapshots' dat.GUI folder) —
// renders any MODELS registry entry (see modelsRegistry.ts) straight from
// directly overhead against a transparent background and downloads the
// result as a PNG, named so it can be DECONSTRUCTED back to the exact
// model it came from (see encodeFilename()/decodeModelRef(), the pair this
// whole tool exists around).
//
// The whole point is a Tiled workflow: drop these PNGs onto an object
// layer as a level designer's visual placeholder (rotate/position it by
// eye, right there in Tiled), then at runtime a lazy loader reads that
// object layer, decodes each image's filename back to a model ref, and
// spawns the REAL 3D model in its place — the PNG never actually renders
// in-game, it's only ever a stand-in for placing objects in the 2D editor.
// For that substitution to look right sight-unseen, the PNG has to be
// scaled EXACTLY like the map's own tile grid: `pixelsPerWorldUnit` is
// tileSizePx / WORLD_UNITS_PER_TILE (32 / 2 = 16 by default — see
// TileMapConfig.ts's own constants) — NOT an auto-fit-to-frame zoom like
// PieceSnapshotTool/FaceSnapshotTool use, since those deliberately
// normalize every subject to look the same size regardless of its real
// scale, which is exactly wrong here: a tree PNG needs to come out
// visibly bigger than a pebble PNG, at the same real-world ratio the tile
// grid itself uses, so placing either one in Tiled at face value already
// shows accurate relative footprints.
//
// Uses its own offscreen WebGLRenderer/Scene/OrthographicCamera rather
// than touching the live gameplay renderer, so it can run mid-game without
// disturbing what's on screen. Orthographic (not the perspective rig
// PieceSnapshotTool/FaceSnapshotTool use) is deliberate too — perspective
// would make a model's near edge read bigger than its far edge, which is
// both an inaccurate footprint AND inconsistent between models of
// different heights.

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import MODELS, { ModelDefinition } from '../../registry/assetsRegistry/modelsRegistry';

/** Same `./` + repo-relative convention every other model load in pizza uses (see GlbVisualComponent.ts/PizzaScene.ts/MainPlayer.ts's own modelUrl()). */
const modelUrl = (fullPath: string): string => `./${fullPath}`;

/** Separates a model ref's Group from its Key in a filename — "--" rather than "." since a filename with a dot before the extension is easy to mis-split, and neither a MODELS group nor key name ever contains "--" (both are plain camelCase identifiers). */
const REF_SEPARATOR = '--';

export class ModelSnapshotTool {
    // Chrome (and most Chromium browsers) will create a real subfolder under
    // Downloads if the `download` attribute contains a "/" — no File System
    // Access API needed.
    private static readonly DOWNLOAD_FOLDER = 'pizza-model-snapshots';
    // Back-to-back <a download> clicks with no gap get silently dropped by
    // the browser's multi-download throttling — space batch exports out.
    private static readonly BATCH_DELAY_MS = 150;

    /** Bound live by DevGuiManager controls (see PizzaScene.setupModelSnapshotDevGui()). `pixelsPerWorldUnit` should stay in lockstep with the real map's tile scale (tileSizePx / WORLD_UNITS_PER_TILE) — see this file's own top-of-file doc for why that's not just a cosmetic default. */
    public static readonly settings = {
        pixelsPerWorldUnit: 32,
        selectedModelRef: '',
    };

    private static renderer: THREE.WebGLRenderer | null = null;
    private static scene: THREE.Scene | null = null;
    private static camera: THREE.OrthographicCamera | null = null;

    private static ensureSetup(): { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera } {
        if (!this.renderer) {
            // preserveDrawingBuffer so toDataURL() doesn't have to race the
            // next render — this renderer only ever renders on demand anyway.
            this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });

            this.scene = new THREE.Scene();
            // Flat, shadeless-ish overhead lighting — a strict top-down shot has no
            // "camera angle" to catch a directional light attractively from, so this
            // just aims for "every face is clearly lit," not a dramatic look.
            this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
            const overhead = new THREE.DirectionalLight(0xffffff, 0.8);
            overhead.position.set(0.001, 10, 0.001);
            this.scene.add(overhead);

            this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
            // Degenerate default up=(0,1,0) when looking straight down -Y — three.js
            // would pick an arbitrary perpendicular basis in that case, which reads as
            // a RANDOM yaw per model. Fixing `up` first makes "north" (-Z) consistently
            // the top of every rendered image.
            this.camera.up.set(0, 0, -1);
        }
        return { renderer: this.renderer, scene: this.scene!, camera: this.camera! };
    }

    /** Flattens MODELS' nested `{ Group: { Key: ModelDefinition } }` shape into every "Group.Key" ref this tool can snapshot — see resolveModelDef()/encodeFilename() for the same convention read back. */
    public static listModelRefs(): string[] {
        const refs: string[] = [];
        for (const [group, entries] of Object.entries(MODELS as Record<string, Record<string, ModelDefinition>>)) {
            for (const key of Object.keys(entries)) {
                refs.push(`${group}.${key}`);
            }
        }
        return refs;
    }

    /** "Group.Key" -> the actual ModelDefinition, or undefined if either half doesn't exist on MODELS. */
    public static resolveModelDef(modelRef: string): ModelDefinition | undefined {
        const [group, key] = modelRef.split('.');
        const groupEntries = (MODELS as Record<string, Record<string, ModelDefinition> | undefined>)[group];
        return groupEntries?.[key];
    }

    /** The exact filename (no folder) snapshotOne()/snapshotAll() download to — see decodeModelRef() for the inverse. `widthPx`/`heightPx` are purely informational (handy for eyeballing a batch export), never read back by decodeModelRef(). */
    public static encodeFilename(modelRef: string, widthPx: number, heightPx: number): string {
        const [group, key] = modelRef.split('.');
        return `${group}${REF_SEPARATOR}${key}__${widthPx}x${heightPx}.png`;
    }

    /**
     * The inverse of encodeFilename() — reads a bare filename OR a full path (only the last
     * "/"-segment is used) back to its "Group.Key" model ref, or undefined if it doesn't match
     * this tool's own naming convention at all (e.g. some other image entirely) — that's the
     * ONE thing a lazy loader reading a Tiled object layer needs to turn "whatever image this
     * placed object references" into "which real 3D model to spawn there instead."
     *
     * Also strips a leading "pizza-model-snapshots_"/"pizza-model-snapshots-" — some browsers/
     * OS drag-and-drop flows flatten download()'s "<folder>/<file>" into a single
     * "<folder>_<file>" name instead of actually creating a subfolder (confirmed in practice:
     * a snapshot dragged into Tiled showed up there as "pizza-model-snapshots_Group--Key__WxH.png",
     * not inside an actual subfolder), so this has to tolerate that prefix surviving all the way
     * into the map file.
     */
    public static decodeModelRef(filenameOrPath: string): string | undefined {
        const base = filenameOrPath.split('/').pop() ?? filenameOrPath;
        const withoutExt = base.replace(/\.[a-z0-9]+$/i, '');
        const withoutSize = withoutExt.replace(/__\d+x\d+$/, '');
        const withoutFolderPrefix = withoutSize.replace(new RegExp(`^${this.DOWNLOAD_FOLDER}[_-]`), '');
        const sepIndex = withoutFolderPrefix.indexOf(REF_SEPARATOR);
        if (sepIndex === -1) {
            return undefined;
        }
        const group = withoutFolderPrefix.slice(0, sepIndex);
        const key = withoutFolderPrefix.slice(sepIndex + REF_SEPARATOR.length);
        return group && key ? `${group}.${key}` : undefined;
    }

    /**
     * Sizes/aims the orthographic camera to frame `object`'s own XZ footprint EXACTLY (no
     * padding, no auto-zoom) at `settings.pixelsPerWorldUnit` — see this file's own top-of-file
     * doc for why real relative scale matters here. Y (height) only affects near/far and
     * camera distance, never the image's width/height, since this is a straight-down shot.
     */
    private static frameTopDown(object: THREE.Object3D, camera: THREE.OrthographicCamera): { widthPx: number; heightPx: number } {
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        const halfWidth = Math.max(size.x, 0.001) / 2;
        const halfDepth = Math.max(size.z, 0.001) / 2;

        camera.left = -halfWidth;
        camera.right = halfWidth;
        camera.top = halfDepth;
        camera.bottom = -halfDepth;
        camera.near = 0.1;
        camera.far = Math.max(size.y, 0.001) + 20;
        camera.position.set(center.x, box.max.y + 10, center.z);
        camera.lookAt(center.x, box.min.y, center.z);
        camera.updateProjectionMatrix();

        return {
            widthPx: Math.max(1, Math.round(size.x * this.settings.pixelsPerWorldUnit)),
            heightPx: Math.max(1, Math.round(size.z * this.settings.pixelsPerWorldUnit)),
        };
    }

    private static async renderModel(modelRef: string): Promise<{ dataUrl: string; widthPx: number; heightPx: number }> {
        const def = this.resolveModelDef(modelRef);
        if (!def) {
            throw new Error(`ModelSnapshotTool: no model registered for ref "${modelRef}"`);
        }

        const { renderer, scene, camera } = this.ensureSetup();
        const object = await ModelLoaderManager.instance.loadModel(modelUrl(def.fullPath), def.id);
        scene.add(object);

        const { widthPx, heightPx } = this.frameTopDown(object, camera);
        renderer.setSize(widthPx, heightPx, false);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL('image/png');

        // Not disposing geometry/material here — ModelLoaderManager.loadModel() clones off a
        // SHARED cached original (see that file's own doc), so disposing this clone's own
        // geometry/material would risk breaking whatever else in the running game already
        // cloned the same cached model. Just detach it from THIS tool's own scene.
        scene.remove(object);

        return { dataUrl, widthPx, heightPx };
    }

    private static download(dataUrl: string, filename: string): void {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${this.DOWNLOAD_FOLDER}/${filename}`;
        a.click();
    }

    /** "Snapshot Selected Model" — a single download, so pixelsPerWorldUnit/framing can be checked before running a full batch. */
    public static async snapshotOne(modelRef: string): Promise<void> {
        if (!modelRef) {
            console.warn('ModelSnapshotTool: no model ref given');
            return;
        }
        try {
            const { dataUrl, widthPx, heightPx } = await this.renderModel(modelRef);
            this.download(dataUrl, this.encodeFilename(modelRef, widthPx, heightPx));
        } catch (e) {
            console.error('ModelSnapshotTool: failed to snapshot', modelRef, e);
        }
    }

    /**
     * "Snapshot Random Model" — picks one ref out of every model MODELS actually has and
     * downloads just that one, so a designer can pull a handful of real snapshots to test the
     * Tiled placement workflow with (see this file's own doc) without generating the entire
     * registry up front.
     */
    public static async snapshotRandom(): Promise<void> {
        const refs = this.listModelRefs();
        if (refs.length === 0) {
            console.warn('ModelSnapshotTool: MODELS registry is empty');
            return;
        }
        const modelRef = refs[Math.floor(Math.random() * refs.length)];
        this.settings.selectedModelRef = modelRef;
        await this.snapshotOne(modelRef);
    }

    /** "Snapshot All Models" — every entry in MODELS, one PNG each. */
    public static async snapshotAll(): Promise<void> {
        for (const modelRef of this.listModelRefs()) {
            await this.snapshotOne(modelRef);
            await new Promise(resolve => setTimeout(resolve, this.BATCH_DELAY_MS));
        }
    }
}
