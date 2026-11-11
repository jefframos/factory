import * as THREE from 'three';
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
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.sortObjects = true;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        // Append canvas to container
        this.container.appendChild(this.renderer.domElement);

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