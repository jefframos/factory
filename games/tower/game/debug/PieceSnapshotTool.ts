import * as THREE from 'three';
import { PieceBoxBuilder } from '../builders/PieceBoxBuilder';
import { TextureBuilder } from '../builders/TextureBuilder';
import { PIECES, resolvePieceImagePath, type PieceDefinition } from '../../tw/PieceStorage';
import { POWERUPS } from '../../tw/PowerupStorage';
import { DEFAULT_TOWER_3D_CONFIG } from '../../tw/Tower3DConfig';

/** Everything renderPiece()/frameMesh() actually need — a full PieceDefinition satisfies this, but so does a PowerupDefinition's embedded `piece` (which omits id/level, since a powerup's shape isn't a catalog entry — see PowerupStorage). */
type RenderablePiece = Omit<PieceDefinition, 'id' | 'level'>;

/** "powerup-" prefix on a powerup's snapshot id — matches FaceTowerGameController.spawnPowerup()'s own synthesized piece.id, so NextPiecePreview's snapshot lookup (keyed off piece.id) resolves to the same file for a powerup piece as this tool generates for it. */
const POWERUP_ID_PREFIX = 'powerup-';

function hexStringToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

/** Extra breathing room past the tight fit-to-frame distance, so a piece's edges don't touch the crop exactly — see frameMesh(). */
const FIT_PADDING = 1.15;

/**
 * Dev-only tool (see IslandViewScene's 'Piece Snapshots' dat.GUI folder) —
 * renders each tower piece (its own real shape/scale/color/face texture,
 * built through the exact same PieceBoxBuilder gameplay uses, not a generic
 * cube) in isolation against a transparent background and downloads the
 * result as a PNG. Same overall shape as clog's FaceSnapshotTool, adapted
 * for pieces instead of shop faces on a fixed cube.
 *
 * Uses its own offscreen WebGLRenderer/Scene/Camera rather than touching the
 * live gameplay renderer, so it can run mid-game without disturbing what's
 * on screen.
 */
export class PieceSnapshotTool {
    // Chrome (and most Chromium browsers) will create a real subfolder under
    // Downloads if the `download` attribute contains a "/" — no File System
    // Access API needed.
    private static readonly DOWNLOAD_FOLDER = 'tower-piece-snapshots';
    // Back-to-back <a download> clicks with no gap get silently dropped by
    // the browser's multi-download throttling — space batch exports out.
    private static readonly BATCH_DELAY_MS = 150;

    /** Bound live by DevGuiManager controls (see IslandViewScene.setupPieceSnapshotDevGui()) — tune size/camera here, use "Snapshot Selected Piece" to preview, then "Snapshot All Pieces" once it looks right. */
    public static readonly settings = {
        size: 256,
        yaw: 15,
        pitch: 25,
        /**
         * Multiplier applied ON TOP of the auto-computed "whole piece fits
         * the frame" distance (see frameMesh()) — 1 is a tight fit with a
         * little padding, higher zooms out further. Unlike the old raw
         * world-unit distance this used to be, the camera is now ALWAYS
         * fit to each piece's own bounding sphere first, so an
         * oversized/stretched piece (e.g. a 2.4x scale) never gets cropped
         * regardless of this value — it only controls extra zoom-out on
         * top of that.
         */
        distance: 1,
        selectedPieceId: '',
        selectedPowerupId: '',
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
            // Same three-light rig as IslandViewScene.build(), so a piece
            // reads the same here as it does in-game.
            this.scene.add(new THREE.AmbientLight(0xffffff, 1));
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

    /**
     * Orbits the camera around `mesh`'s ACTUAL bounding sphere (not a fixed
     * origin-centered assumption) at whatever distance guarantees the whole
     * sphere fits the vertical FOV — yaw/pitch (degrees) only change the
     * viewing angle, never whether it fits. This is what fixes oversized/
     * stretched pieces (e.g. a 2.4x scale) getting cropped: previously
     * `distance` was a flat world-unit value shared by every piece
     * regardless of its actual size.
     */
    private static frameMesh(mesh: THREE.Object3D, camera: THREE.PerspectiveCamera): void {
        const sphere = new THREE.Box3().setFromObject(mesh).getBoundingSphere(new THREE.Sphere());

        const fovRad = (camera.fov * Math.PI) / 180;
        const fitDistance = (sphere.radius / Math.sin(fovRad / 2)) * FIT_PADDING;
        const distance = fitDistance * Math.max(0.01, this.settings.distance);

        const yaw = this.settings.yaw * Math.PI / 180;
        const pitch = this.settings.pitch * Math.PI / 180;

        camera.position.set(
            sphere.center.x + Math.sin(yaw) * Math.cos(pitch) * distance,
            sphere.center.y + Math.sin(pitch) * distance,
            sphere.center.z + Math.cos(yaw) * Math.cos(pitch) * distance,
        );
        camera.lookAt(sphere.center);
    }

    private static async renderPiece(piece: RenderablePiece): Promise<string> {
        const { renderer, scene, camera } = this.ensureSetup();

        const texture = piece.texture
            ? await TextureBuilder.load(resolvePieceImagePath(piece.texture)).catch(() => undefined)
            : undefined;

        const pixelsPerUnit = DEFAULT_TOWER_3D_CONFIG.pixelsPerUnit;
        const faceOffsetPx = piece.faceOffset ?? { x: 0, y: 0 };

        const mesh = PieceBoxBuilder.build(hexStringToNumber(piece.color), piece.scale.x, piece.scale.y, {
            polygon: piece.polygon,
            faceTexture: texture,
            faceOffset: { x: faceOffsetPx.x / pixelsPerUnit, y: faceOffsetPx.y / pixelsPerUnit },
            faceScale: piece.faceScale,
        });
        scene.add(mesh);

        const size = Math.max(1, Math.round(this.settings.size));
        renderer.setSize(size, size, false);
        camera.aspect = 1;
        camera.updateProjectionMatrix();
        this.frameMesh(mesh, camera);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL('image/png');

        scene.remove(mesh);
        PieceBoxBuilder.disposeMesh(mesh);
        (mesh.material as THREE.Material).dispose();

        return dataUrl;
    }

    private static download(dataUrl: string, filename: string): void {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${this.DOWNLOAD_FOLDER}/${filename}`;
        a.click();
    }

    private static filenameFor(id: string): string {
        const size = Math.max(1, Math.round(this.settings.size));
        return `${id || 'unnamed'}_${size}x${size}.png`;
    }

    /** "Snapshot Selected Piece" — a single download, so camera/size settings can be checked before running the full batch. */
    public static async snapshotOne(pieceId: string): Promise<void> {
        const piece = PIECES.find((p) => p.id === pieceId);
        if (!piece) {
            console.warn('PieceSnapshotTool: no piece with id', pieceId);
            return;
        }
        const dataUrl = await this.renderPiece(piece);
        this.download(dataUrl, this.filenameFor(piece.id));
    }

    /** "Snapshot All Pieces" — every entry in pieces-config.json, one PNG each. */
    public static async snapshotAll(): Promise<void> {
        for (const piece of PIECES) {
            const dataUrl = await this.renderPiece(piece);
            this.download(dataUrl, this.filenameFor(piece.id));
            await new Promise((resolve) => setTimeout(resolve, this.BATCH_DELAY_MS));
        }
    }

    /**
     * "Snapshot Selected Powerup" — a separate button from the piece ones
     * above (see IslandViewScene.setupPieceSnapshotDevGui()), since a
     * powerup's shape lives on PowerupDefinition.piece, not in PIECES.
     * Filename uses the same "powerup-<id>" convention
     * FaceTowerGameController.spawnPowerup() synthesizes for its held-block
     * piece.id, so NextPiecePreview's snapshot lookup for a powerup piece
     * resolves to whatever this generates.
     */
    public static async snapshotOnePowerup(powerupId: string): Promise<void> {
        const powerup = POWERUPS.find((p) => p.id === powerupId);
        if (!powerup) {
            console.warn('PieceSnapshotTool: no powerup with id', powerupId);
            return;
        }
        const dataUrl = await this.renderPiece(powerup.piece);
        this.download(dataUrl, this.filenameFor(POWERUP_ID_PREFIX + powerup.id));
    }

    /** "Snapshot All Powerups" — every entry in powerups-config.json, one PNG each. */
    public static async snapshotAllPowerups(): Promise<void> {
        for (const powerup of POWERUPS) {
            const dataUrl = await this.renderPiece(powerup.piece);
            this.download(dataUrl, this.filenameFor(POWERUP_ID_PREFIX + powerup.id));
            await new Promise((resolve) => setTimeout(resolve, this.BATCH_DELAY_MS));
        }
    }
}
