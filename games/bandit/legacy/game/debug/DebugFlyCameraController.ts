// DebugFlyCameraController.ts
//
// Debug-only free-fly camera for PC, for eyeballing the whole map without walking the player
// character everywhere. OFF by default — toggled on/off via PizzaScene's "Toggle Fly Camera"
// debug button (see InGameButtonList), which also disables/enables PlayerMovementController so
// WASD doesn't ALSO walk the player underneath the free camera while flying.
//
// Controls: WASD to move relative to the camera's own facing (Q/E for down/up, hold Shift to
// move faster), hold the RIGHT mouse button and drag to look around (yaw/pitch), and the mouse
// wheel to dolly forward/backward along the current view direction ("zoom in/out").
//
// Listeners are only ever attached while enabled — toggling off tears them down completely, so
// this has zero footprint (no global key/mouse handlers at all) during normal play.

import * as THREE from 'three';

const MOVE_SPEED_UNITS_PER_SEC = 12;
/** Held Shift multiplies MOVE_SPEED_UNITS_PER_SEC by this — a quick way to cross the whole map without waiting on the base speed. */
const FAST_MOVE_MULTIPLIER = 4;
/** Radians of yaw/pitch per pixel of right-drag — tuned by feel, not derived from anything. */
const LOOK_SENSITIVITY = 0.0025;
/** World units the wheel dollies per notch (one `deltaY` step) — scroll up moves forward (zoom in), scroll down moves backward (zoom out). */
const DOLLY_UNITS_PER_NOTCH = 1.2;
/** Clamped just short of straight up/down so the look direction never flips through the pole (setFromEuler('YXZ') would otherwise gimbal-lock there). */
const MAX_PITCH = Math.PI / 2 - 0.05;

export default class DebugFlyCameraController {
    private readonly camera: THREE.PerspectiveCamera;
    private readonly domElement: HTMLElement;

    private enabled = false;
    private yaw = 0;
    private pitch = 0;

    private readonly heldKeys = new Set<string>();
    private dragging = false;
    private lastPointerX = 0;
    private lastPointerY = 0;

    /** Scratch vectors — avoids allocating one set of three.js Vector3s every frame this flies. */
    private readonly scratchForward = new THREE.Vector3();
    private readonly scratchRight = new THREE.Vector3();
    private readonly scratchMove = new THREE.Vector3();
    private readonly worldUp = new THREE.Vector3(0, 1, 0);

    public constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
        this.camera = camera;
        this.domElement = domElement;
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    /** Toggling ON snapshots the camera's CURRENT look direction as the starting yaw/pitch, so flying picks up exactly where the normal follow-camera left off instead of snapping to some default orientation. Toggling OFF tears down every listener and clears held state, so a stuck key/drag from the instant it was switched off can never leak into normal play. */
    public setEnabled(enabled: boolean): void {
        if (enabled === this.enabled) {
            return;
        }
        this.enabled = enabled;

        if (enabled) {
            const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
            this.yaw = euler.y;
            this.pitch = euler.x;
            this.attachListeners();
        } else {
            this.detachListeners();
            this.heldKeys.clear();
            this.dragging = false;
        }
    }

    private attachListeners(): void {
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
        this.domElement.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('mouseup', this.onMouseUp);
        window.addEventListener('mousemove', this.onMouseMove);
        this.domElement.addEventListener('wheel', this.onWheel, { passive: false });
        this.domElement.addEventListener('contextmenu', this.onContextMenu);
    }

    private detachListeners(): void {
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        this.domElement.removeEventListener('mousedown', this.onMouseDown);
        window.removeEventListener('mouseup', this.onMouseUp);
        window.removeEventListener('mousemove', this.onMouseMove);
        this.domElement.removeEventListener('wheel', this.onWheel);
        this.domElement.removeEventListener('contextmenu', this.onContextMenu);
    }

    private readonly onKeyDown = (e: KeyboardEvent): void => {
        this.heldKeys.add(e.key.toLowerCase());
    };

    private readonly onKeyUp = (e: KeyboardEvent): void => {
        this.heldKeys.delete(e.key.toLowerCase());
    };

    /** Right mouse button only (button 2) — left/middle stay free for whatever else the page does. */
    private readonly onMouseDown = (e: MouseEvent): void => {
        if (e.button === 2) {
            this.dragging = true;
            this.lastPointerX = e.clientX;
            this.lastPointerY = e.clientY;
        }
    };

    private readonly onMouseUp = (e: MouseEvent): void => {
        if (e.button === 2) {
            this.dragging = false;
        }
    };

    private readonly onMouseMove = (e: MouseEvent): void => {
        if (!this.dragging) {
            return;
        }
        const dx = e.clientX - this.lastPointerX;
        const dy = e.clientY - this.lastPointerY;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        this.yaw -= dx * LOOK_SENSITIVITY;
        this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy * LOOK_SENSITIVITY));
    };

    private readonly onWheel = (e: WheelEvent): void => {
        // Otherwise the page itself scrolls underneath the canvas while flying.
        e.preventDefault();
        this.camera.getWorldDirection(this.scratchForward);
        const amount = -Math.sign(e.deltaY) * DOLLY_UNITS_PER_NOTCH;
        this.camera.position.addScaledVector(this.scratchForward, amount);
    };

    /** Right-drag drives look — suppress the browser's own context menu while flying, same as any other fly-cam/editor convention. */
    private readonly onContextMenu = (e: Event): void => {
        e.preventDefault();
    };

    /** Call once per frame while enabled (no-ops instantly when not — safe to call unconditionally from the scene's own update loop). */
    public update(delta: number): void {
        if (!this.enabled) {
            return;
        }

        this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

        let moveRight = 0;
        let moveForward = 0;
        let moveUp = 0;
        if (this.heldKeys.has('w')) moveForward += 1;
        if (this.heldKeys.has('s')) moveForward -= 1;
        if (this.heldKeys.has('d')) moveRight += 1;
        if (this.heldKeys.has('a')) moveRight -= 1;
        if (this.heldKeys.has('e')) moveUp += 1;
        if (this.heldKeys.has('q')) moveUp -= 1;

        if (moveRight === 0 && moveForward === 0 && moveUp === 0) {
            return;
        }

        // WASD walks the ground plane (X/Z) — deliberately derived from yaw alone, NOT the
        // camera's actual (pitched) look direction, so looking down and pressing W pans across
        // the map instead of diving toward the ground; pressing W while looking up doesn't lift
        // off it either. Moving INTO the view direction (including pitch) is the wheel's job
        // now (see onWheel()) — that's the "walk toward what you're looking at" motion, kept
        // separate from WASD's "strafe around the map" motion.
        this.scratchForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        this.scratchRight.set(-this.scratchForward.z, 0, this.scratchForward.x);

        const speed = MOVE_SPEED_UNITS_PER_SEC * (this.heldKeys.has('shift') ? FAST_MOVE_MULTIPLIER : 1) * delta;
        this.scratchMove.set(0, 0, 0)
            .addScaledVector(this.scratchForward, moveForward)
            .addScaledVector(this.scratchRight, moveRight)
            .addScaledVector(this.worldUp, moveUp);

        if (this.scratchMove.lengthSq() > 0) {
            this.scratchMove.normalize().multiplyScalar(speed);
            this.camera.position.add(this.scratchMove);
        }
    }

    /** Tears down listeners if still enabled — call from the scene's own teardown. */
    public destroy(): void {
        this.setEnabled(false);
    }
}
