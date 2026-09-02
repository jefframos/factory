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

    /**
     * Bound live by DevGuiManager controls (see PizzaScene.setupModelSnapshotDevGui()).
     * `pixelsPerWorldUnit` should stay in lockstep with the real map's tile scale
     * (tileSizePx / WORLD_UNITS_PER_TILE) — see this file's own top-of-file doc for why that's
     * not just a cosmetic default.
     *
     * `portraitMode` on switches every snapshot from the default straight-down orthographic
     * shot (see frameTopDown()) to an angled one framed by `portraitDistance`/`portraitPitchDeg`/
     * `portraitYawDeg` instead (see framePortrait()) — same distance/pitch/yaw convention
     * PizzaScene's own CAMERA_SETTINGS uses for the live gameplay camera, just orbiting a
     * model's own center instead of the player. Off (the default) leaves every existing
     * snapshot call — snapshotOne()/snapshotAll()/snapshotGroup() — rendering exactly as it did
     * before this setting existed.
     *
     * `portraitFillTexture` is an ADDITIONAL opt-in on top of `portraitMode` (only consulted at
     * all while that's also on — see framePortrait()'s own doc), for producing actual GAME ICON
     * assets rather than Tiled-placeholder previews: framePortrait()'s default behavior tightly
     * fits the orthographic frustum (and therefore the output PNG's own pixel dimensions) to
     * each model's real screen-space footprint, which is exactly right for the Tiled-placeholder
     * workflow (see this file's own top-of-file doc) but means a small model comes out as a tiny
     * image — no good for an icon that needs to fill a fixed texture size. With this on, every
     * portrait shot instead renders at a FIXED `portraitTextureSizePx` square, with the model's
     * longest screen-space dimension filling `(100 - portraitPaddingPercent * 2)`% of that
     * square (so `portraitPaddingPercent` is the margin on EACH side, not the total) — same
     * "consistent icon canvas regardless of the model's real size" framing a UI icon sheet
     * needs. Off (the default) leaves framePortrait() exactly as it was before this setting
     * existed.
     */
    public static readonly settings = {
        pixelsPerWorldUnit: 32,
        selectedModelRef: '',
        selectedGroup: '',
        portraitMode: false,
        portraitDistance: 8,
        portraitPitchDeg: 30,
        portraitYawDeg: 0,
        portraitFillTexture: false,
        portraitTextureSizePx: 512,
        portraitPaddingPercent: 10,
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

    /** Every top-level MODELS group name (e.g. "Trees", "Rocks") — the unit `snapshotGroup()` exports as a folder. */
    public static listGroups(): string[] {
        return Object.keys(MODELS as Record<string, Record<string, ModelDefinition>>);
    }

    /** Every "Group.Key" ref belonging to a single MODELS group, in the same order listModelRefs() would produce them. */
    public static listModelRefsInGroup(group: string): string[] {
        const groupEntries = (MODELS as Record<string, Record<string, ModelDefinition> | undefined>)[group];
        return groupEntries ? Object.keys(groupEntries).map(key => `${group}.${key}`) : [];
    }

    /** "Group.Key" -> the actual ModelDefinition, or undefined if either half doesn't exist on MODELS. */
    public static resolveModelDef(modelRef: string): ModelDefinition | undefined {
        const [group, key] = modelRef.split('.');
        const groupEntries = (MODELS as Record<string, Record<string, ModelDefinition> | undefined>)[group];
        return groupEntries?.[key];
    }

    /**
     * The exact filename (no folder) snapshotOne()/snapshotAll() download to — see
     * decodeModelRef() for the inverse. `widthPx`/`heightPx` are purely informational (handy for
     * eyeballing a batch export), never read back by decodeModelRef() — omit them entirely (no
     * `__WxH` suffix at all) for a portrait-mode shot: those are one-off icon previews, not the
     * Tiled-placeholder workflow this tool's own top-of-file doc describes, where the exact
     * pixel size matters for eyeballing relative footprints.
     */
    public static encodeFilename(modelRef: string, widthPx?: number, heightPx?: number): string {
        const [group, key] = modelRef.split('.');
        const sizeSuffix = widthPx !== undefined && heightPx !== undefined ? `__${widthPx}x${heightPx}` : '';
        return `${group}${REF_SEPARATOR}${key}${sizeSuffix}.png`;
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

        // Explicit every call (not just once in ensureSetup()) — framePortrait() below points
        // this same shared camera's `up` a different way, so a top-down snapshot right after a
        // portrait one needs this reset, not just relying on whatever `up` happened to be left at.
        camera.up.set(0, 0, -1);
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

    /**
     * Sizes/aims the SAME orthographic camera at an angled view instead of straight down — same
     * distance/pitch/yaw spherical-offset convention PizzaScene's own cameraOffset() uses for the
     * live gameplay camera (see that function's own doc), orbiting this model's own bounding-box
     * center rather than the player. Unlike frameTopDown()'s XZ-footprint shortcut (only valid
     * looking straight down the Y axis), an arbitrary pitch/yaw needs the object's REAL
     * projected screen-space extents to frame it without clipping — this projects every one of
     * the box's 8 corners into the camera's own view space (after positioning/aiming it) and
     * takes the min/max there, exactly like a proper "fit orthographic frustum to bounds" pass.
     */
    private static framePortrait(object: THREE.Object3D, camera: THREE.OrthographicCamera): { widthPx: number; heightPx: number } {
        const { portraitDistance, portraitPitchDeg, portraitYawDeg, pixelsPerWorldUnit } = this.settings;
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());

        const yaw = portraitYawDeg * (Math.PI / 180);
        const pitch = portraitPitchDeg * (Math.PI / 180);
        const horizontal = portraitDistance * Math.cos(pitch);
        const offset = new THREE.Vector3(
            horizontal * Math.sin(yaw),
            portraitDistance * Math.sin(pitch),
            horizontal * Math.cos(yaw),
        );

        camera.up.set(0, 1, 0);
        camera.position.copy(center).add(offset);
        camera.lookAt(center);
        // Camera overrides updateMatrixWorld() to also refresh matrixWorldInverse — needed
        // below to project each corner into this camera's own view space.
        camera.updateMatrixWorld(true);

        const corners = [
            new THREE.Vector3(box.min.x, box.min.y, box.min.z),
            new THREE.Vector3(box.min.x, box.min.y, box.max.z),
            new THREE.Vector3(box.min.x, box.max.y, box.min.z),
            new THREE.Vector3(box.min.x, box.max.y, box.max.z),
            new THREE.Vector3(box.max.x, box.min.y, box.min.z),
            new THREE.Vector3(box.max.x, box.min.y, box.max.z),
            new THREE.Vector3(box.max.x, box.max.y, box.min.z),
            new THREE.Vector3(box.max.x, box.max.y, box.max.z),
        ];

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxDist = -Infinity;
        for (const corner of corners) {
            const view = corner.clone().applyMatrix4(camera.matrixWorldInverse);
            minX = Math.min(minX, view.x);
            maxX = Math.max(maxX, view.x);
            minY = Math.min(minY, view.y);
            maxY = Math.max(maxY, view.y);
            // View space looks down -Z, so a corner's distance FROM the camera is -view.z.
            maxDist = Math.max(maxDist, -view.z);
        }

        camera.near = 0.1;
        camera.far = Math.max(maxDist, 0.001) + 1;

        // See settings.portraitFillTexture's own doc — a fixed-size, padded frustum instead of
        // the tight footprint-fit frustum right below, so every icon comes out the same texture
        // size regardless of how big the source model's real footprint is.
        if (this.settings.portraitFillTexture) {
            return this.applyFillTextureFraming(camera, minX, maxX, minY, maxY);
        }

        camera.left = minX;
        camera.right = maxX;
        camera.top = maxY;
        camera.bottom = minY;
        camera.updateProjectionMatrix();

        return {
            widthPx: Math.max(1, Math.round((maxX - minX) * pixelsPerWorldUnit)),
            heightPx: Math.max(1, Math.round((maxY - minY) * pixelsPerWorldUnit)),
        };
    }

    /**
     * The settings.portraitFillTexture framing — replaces framePortrait()'s usual tight
     * footprint-fit frustum with a SQUARE one, sized so the model's longest screen-space
     * dimension (whichever of width/height is bigger — the shorter one just ends up with extra
     * margin instead of being stretched) fills `portraitTextureSizePx` minus
     * `portraitPaddingPercent` on each side, centered on the model's own screen-space center.
     * Output pixel dimensions are always exactly `portraitTextureSizePx` square — unlike every
     * other framing method here, `pixelsPerWorldUnit` plays no part in this one at all, since
     * the whole point is a texture size that's independent of the model's real-world scale.
     */
    private static applyFillTextureFraming(
        camera: THREE.OrthographicCamera,
        minX: number, maxX: number, minY: number, maxY: number,
    ): { widthPx: number; heightPx: number } {
        const { portraitTextureSizePx, portraitPaddingPercent } = this.settings;

        const width = maxX - minX;
        const height = maxY - minY;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        // Margin on EACH side (see settings.portraitFillTexture's own doc), clamped so a
        // careless 50+% value can never invert/zero out the fill fraction.
        const fillFraction = Math.max(0.05, 1 - (portraitPaddingPercent / 100) * 2);
        const frustumSize = Math.max(width, height, 0.001) / fillFraction;
        const halfSize = frustumSize / 2;

        camera.left = centerX - halfSize;
        camera.right = centerX + halfSize;
        camera.top = centerY + halfSize;
        camera.bottom = centerY - halfSize;
        camera.updateProjectionMatrix();

        return { widthPx: portraitTextureSizePx, heightPx: portraitTextureSizePx };
    }

    private static async renderModel(modelRef: string): Promise<{ dataUrl: string; widthPx: number; heightPx: number }> {
        const def = this.resolveModelDef(modelRef);
        if (!def) {
            throw new Error(`ModelSnapshotTool: no model registered for ref "${modelRef}"`);
        }

        const { renderer, scene, camera } = this.ensureSetup();
        const object = await ModelLoaderManager.instance.loadModel(modelUrl(def.fullPath), def.id);
        scene.add(object);

        // portraitMode off -> exactly the same straight-down shot this tool always took (see
        // this.settings' own doc); on -> the angled distance/pitch/yaw framing instead.
        const { widthPx, heightPx } = this.settings.portraitMode
            ? this.framePortrait(object, camera)
            : this.frameTopDown(object, camera);
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
            // Portrait shots are one-off icon previews, not Tiled-placement placeholders — see
            // encodeFilename()'s own doc for why the size suffix only matters for the latter.
            const filename = this.settings.portraitMode
                ? this.encodeFilename(modelRef)
                : this.encodeFilename(modelRef, widthPx, heightPx);
            this.download(dataUrl, filename);
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

    /** "Snapshot Group" — every entry under a single MODELS group (e.g. all of "Trees"), one PNG each. */
    public static async snapshotGroup(group: string): Promise<void> {
        const modelRefs = this.listModelRefsInGroup(group);
        if (modelRefs.length === 0) {
            console.warn('ModelSnapshotTool: no models found for group', group);
            return;
        }
        for (const modelRef of modelRefs) {
            await this.snapshotOne(modelRef);
            await new Promise(resolve => setTimeout(resolve, this.BATCH_DELAY_MS));
        }
    }
}
