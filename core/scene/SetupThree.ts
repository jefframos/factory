import * as THREE from 'three';
import { AdaptiveResolution } from './AdaptiveResolution';
export default class SetupThree {
    static renderer: THREE.WebGLRenderer;
    static container: HTMLElement;

    static initialize(container?: HTMLElement) {
        if (!container) {
            container = document.createElement('div');
            container.id = "three-container"; // Helpful for debugging
            container.style.position = 'absolute';
            container.style.top = '0';
            container.style.left = '0';
            container.style.width = '100%';
            container.style.height = '100%';
            container.style.pointerEvents = 'none';
            container.style.zIndex = '0'; // Lower than Pixi
            document.body.appendChild(container);
        }
        this.container = container;

        // Create a Three.js Renderer
        this.renderer = new THREE.WebGLRenderer({ alpha: !this.OPAQUE, antialias: false, powerPreference: 'high-performance' });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.sortObjects = true;
        this.renderer.setPixelRatio(this.getCurrentPixelRatio());
        // Append canvas to container
        this.container.appendChild(this.renderer.domElement);

    }

    /** The most pixels the 3D is drawn at (1080p's): a bigger screen stretches it, a 4K one costing no more. (The UI isn't capped.) */
    static MAX_PIXELS = 1920 * 1080;
    /** The highest pixel ratio, whatever the device's. */
    static MAX_PIXEL_RATIO = 2;
    /** Never drawn under this, however big the screen or slow the device. */
    static MIN_PIXEL_RATIO = 0.5;
    /** The resolution lowered while the device can't keep up (AdaptiveResolution): set by the games that want it. */
    static adaptive: AdaptiveResolution | null = null;
    /** Set before anything's built by a game whose 3D covers the page: its canvas needs no blending over it. */
    static OPAQUE = false;
    /** The 3D drawn this many times a frame (a debug panel's slow graphics card). */
    static testDraws = 1;
    /** A pixel ratio forced instead (the debug panel's test switch); 0: none. */
    static forcedPixelRatio = 0;

    /** The pixel ratio to draw at now: the device's, capped (MAX_PIXEL_RATIO, MAX_PIXELS), less what `adaptive` takes off. */
    static getCurrentPixelRatio(): number {
        if (this.forcedPixelRatio > 0) return this.forcedPixelRatio;
        const area = Math.max(1, window.innerWidth * window.innerHeight);
        const full = Math.min(window.devicePixelRatio || 1, this.MAX_PIXEL_RATIO, Math.sqrt(this.MAX_PIXELS / area));
        return Math.max(this.MIN_PIXEL_RATIO, full * (this.adaptive?.scale ?? 1));
    }

    static ForceResize(camera: THREE.PerspectiveCamera) {
        const width = window.innerWidth + 1;
        const height = window.innerHeight + 1;
        this.renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();

        setTimeout(() => {
            const width = window.innerWidth;
            const height = window.innerHeight;
            this.renderer.setSize(width, height);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        }, 10);
    }

    /** The cameras already listening for the window's resize (each listens once, however often resize() is called). */
    private static readonly watched = new WeakSet<THREE.PerspectiveCamera>();
    private static readonly size = new THREE.Vector2();

    /** The canvas and `camera` fitted to the window now, and again on each resize event. */
    static resize(camera: THREE.PerspectiveCamera) {
        this.syncSize(camera, true);
        if (this.watched.has(camera)) return;
        this.watched.add(camera);
        window.addEventListener('resize', () => this.syncSize(camera, true));
    }

    /**
     * The canvas fitted to the window if it isn't (and `camera`'s aspect with it); whether it changed. Called every frame
     * (ThreeScene.update), since a resize event can be missed: an iframe (YouTube Playables) can boot tiny or 0 high and be
     * grown without one, leaving the 3D at its boot size while the UI (Game's own size check) is right. A 0-sized window
     * is skipped (its aspect would be broken).
     */
    static syncSize(camera: THREE.PerspectiveCamera, updateCamera = false): boolean {
        const width = window.innerWidth;
        const height = window.innerHeight;
        if (!this.renderer || width <= 0 || height <= 0) return false;
        // (Once a frame, just before it's drawn: a canvas resized after is cleared.)
        if (!updateCamera) this.adaptive?.frame(performance.now());
        const ratio = this.getCurrentPixelRatio();
        if (Math.abs(this.renderer.getPixelRatio() - ratio) > 1e-3) this.renderer.setPixelRatio(ratio);
        const now = this.renderer.getSize(this.size);
        const changed = now.x !== width || now.y !== height;
        if (changed) this.renderer.setSize(width, height);
        if (changed || updateCamera || Math.abs(camera.aspect - width / height) > 1e-6) {
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        }
        return changed;
    }
}