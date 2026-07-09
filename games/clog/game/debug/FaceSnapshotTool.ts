import * as THREE from 'three';
import { CubeBuilder } from '../builders/CubeBuilder';
import { TextureBuilder } from '../builders/TextureBuilder';
import { SHOP_ITEMS, resolveShopImagePath, type ShopItem } from '../data/ShopStorage';

/**
 * Dev-only tool (see BaseDemoScene's 'Face Snapshots' dat.GUI folder) —
 * renders an isolated player cube (fixed colour, transparent background)
 * with a shop face texture applied, and downloads the result as a PNG.
 * Meant for lining up the camera framing against hand-authored face art
 * before/after it lands in raw-assets/non-preload/skins.
 *
 * Uses its own offscreen WebGLRenderer/Scene/Camera rather than touching the
 * live gameplay renderer, so it can run mid-game without disturbing what's
 * on screen.
 */
export class FaceSnapshotTool {
    private static readonly CUBE_COLOR = 0xFFC335;
    // Chrome (and most Chromium browsers) will create a real subfolder under
    // Downloads if the `download` attribute contains a "/" — no File System
    // Access API needed.
    private static readonly DOWNLOAD_FOLDER = 'clog-face-snapshots';
    // Back-to-back <a download> clicks with no gap get silently dropped by
    // the browser's multi-download throttling — space batch exports out.
    private static readonly BATCH_DELAY_MS = 150;

    /** Bound live by DevGuiManager controls in BaseDemoScene — tune size/camera here, use "Snapshot Selected Face" to preview, then "Snapshot All Faces" once it looks right. */
    public static readonly settings = {
        size: 128,
        yaw: 15,
        pitch: 25,
        distance: 2.8,
        selectedFaceId: '',
    };

    private static renderer: THREE.WebGLRenderer | null = null;
    private static scene: THREE.Scene | null = null;
    private static camera: THREE.PerspectiveCamera | null = null;

    private static ensureSetup(): { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
        if (!this.renderer) {
            // preserveDrawingBuffer so toDataURL() doesn't have to race the
            // next render — this renderer only ever renders on demand anyway.
            this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });

            this.scene = new THREE.Scene();
            // Same three-light rig as LinearWorld3dScene.build(), so the cube
            // reads the same here as it does in-game.
            this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
            const key = new THREE.DirectionalLight(0xfff4dd, 1.6);
            key.position.set(5, 10, 7.5);
            this.scene.add(key);
            const fill = new THREE.DirectionalLight(0x99ccff, 0.5);
            fill.position.set(-8, 3, -5);
            this.scene.add(fill);

            this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
        }
        return { renderer: this.renderer, scene: this.scene!, camera: this.camera! };
    }

    /** Orbits the camera around the cube's centre — yaw/pitch in degrees, distance in world units. Default (0, 0) points it straight at the face decal on the cube's +Z face. */
    private static positionCamera(camera: THREE.PerspectiveCamera): void {
        const yaw = this.settings.yaw * Math.PI / 180;
        const pitch = this.settings.pitch * Math.PI / 180;
        const d = this.settings.distance;
        camera.position.set(
            Math.sin(yaw) * Math.cos(pitch) * d,
            Math.sin(pitch) * d,
            Math.cos(yaw) * Math.cos(pitch) * d,
        );
        camera.lookAt(0, 0, 0);
    }

    private static async renderFace(item: ShopItem): Promise<string> {
        const { renderer, scene, camera } = this.ensureSetup();
        const texture = await TextureBuilder.load(resolveShopImagePath(item.texture));

        const mesh = CubeBuilder.buildDebugCube(this.CUBE_COLOR, 1, texture);
        scene.add(mesh);

        const size = Math.max(1, Math.round(this.settings.size));
        renderer.setSize(size, size, false);
        camera.aspect = 1;
        camera.updateProjectionMatrix();
        this.positionCamera(camera);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL('image/png');

        scene.remove(mesh);
        CubeBuilder.disposeMesh(mesh);
        (mesh.material as THREE.Material).dispose();

        return dataUrl;
    }

    private static download(dataUrl: string, filename: string): void {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${this.DOWNLOAD_FOLDER}/${filename}`;
        a.click();
    }

    private static filenameFor(item: ShopItem): string {
        const size = Math.max(1, Math.round(this.settings.size));
        return `${item.id || 'unnamed'}_${size}x${size}.png`;
    }

    /** "Snapshot Selected Face" — a single download, so camera/size settings can be checked before running the full batch. */
    public static async snapshotOne(itemId: string): Promise<void> {
        const item = SHOP_ITEMS.find((i) => i.id === itemId);
        if (!item) {
            console.warn('FaceSnapshotTool: no shop item with id', itemId);
            return;
        }
        const dataUrl = await this.renderFace(item);
        this.download(dataUrl, this.filenameFor(item));
    }

    /** "Snapshot All Faces" — every entry in shopItems.json, one PNG each. */
    public static async snapshotAll(): Promise<void> {
        for (const item of SHOP_ITEMS) {
            const dataUrl = await this.renderFace(item);
            this.download(dataUrl, this.filenameFor(item));
            await new Promise((resolve) => setTimeout(resolve, this.BATCH_DELAY_MS));
        }
    }
}
