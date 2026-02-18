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
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
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

    static resize(camera: THREE.PerspectiveCamera) {
        window.addEventListener('resize', () => {
            const width = window.innerWidth;
            const height = window.innerHeight;
            this.renderer.setSize(width, height);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        });
    }
}