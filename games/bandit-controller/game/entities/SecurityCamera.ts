// SecurityCamera.ts
//
// A wall/corner-mounted camera: a small body up high plus a view cone on the floor that sweeps back and forth
// (sweep 0 = fixed). Same sensing API as Guard so the scene treats both as "spotters", but it never moves
// and never chases — being spotted by one simply busts the player on the spot.

import * as THREE from 'three';
import type { LevelSecurityCamera } from '../data/LevelData';
import type { LevelSight } from '../utils/LevelSight';
import { WorldBendService } from 'core/services/BendService';

const CONE_RAYS = 28;
const CONE_Y = 0.045;
const CALM_COLOR = new THREE.Color(0x7fd8ff);
const ALERT_COLOR = new THREE.Color(0xff2d2d);
const MOUNT_HEIGHT = 2.6;
const TURN_RATE = THREE.MathUtils.degToRad(200);

export default class SecurityCamera {
    public readonly position = new THREE.Vector3();
    /** 0..1 — how close the player is to being busted by this camera. */
    public alert = 0;
    /** The scene checks this to skip the guard chase. */
    public readonly stationary = true;

    private readonly coneHalfAngle: number;
    private readonly baseHeading: number;
    private heading: number;
    private time = 0;
    private focusPoint?: THREE.Vector3;
    private focusTime = 0;
    private readonly coneGeometry: THREE.BufferGeometry;
    private readonly coneMaterial: THREE.MeshBasicMaterial;
    private readonly cone: THREE.Mesh;
    private readonly body = new THREE.Group();
    private readonly head = new THREE.Group();
    private readonly lens: THREE.Mesh;
    private readonly disposables: Array<{ dispose(): void }> = [];

    public constructor(
        private readonly threeScene: THREE.Scene,
        private readonly data: LevelSecurityCamera,
        private readonly sight: LevelSight,
        private readonly bendService: WorldBendService,
    ) {
        this.position.set(data.x, 0, data.z);
        this.coneHalfAngle = THREE.MathUtils.degToRad(data.fov) / 2;
        this.baseHeading = THREE.MathUtils.degToRad(data.facing);
        this.heading = this.baseHeading;

        this.coneGeometry = new THREE.BufferGeometry();
        this.coneGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((CONE_RAYS + 2) * 3), 3));
        const indices: number[] = [];
        for (let i = 0; i < CONE_RAYS; i++) {
            indices.push(0, i + 1, i + 2);
        }
        this.coneGeometry.setIndex(indices);
        this.coneMaterial = new THREE.MeshBasicMaterial({
            color: CALM_COLOR.clone(),
            transparent: true,
            opacity: 0.38,
            depthWrite: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
        });
        this.bendService.applyBend(this.coneMaterial);
        this.cone = new THREE.Mesh(this.coneGeometry, this.coneMaterial);
        this.cone.frustumCulled = false;
        this.cone.renderOrder = 2;
        this.threeScene.add(this.cone);

        const shell = this.track(new THREE.MeshStandardMaterial({ color: 0x2c333b, roughness: 0.5 }));
        const lensMaterial = this.track(new THREE.MeshBasicMaterial({ color: 0xff3b3b }));
        const bracket = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10)), shell);
        bracket.position.y = MOUNT_HEIGHT + 0.25;
        const camera = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.42, 0.34, 0.7)), shell);
        this.lens = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12)), lensMaterial);
        this.lens.rotation.x = Math.PI / 2;
        this.lens.position.z = 0.37;
        this.head.add(camera, this.lens);
        this.head.position.y = MOUNT_HEIGHT;
        this.body.add(bracket, this.head);
        this.body.position.set(data.x, 0, data.z);
        this.bendService.applyBend(shell);
        this.threeScene.add(this.body);
        this.rebuildCone();
    }

    private track<T extends { dispose(): void }>(resource: T): T {
        this.disposables.push(resource);
        return resource;
    }

    public setConeVisible(visible: boolean): void {
        this.cone.visible = visible;
    }

    public hold(): void {
        // Nothing moves while the level clock is stopped.
    }

    /** Sweeps the cone; only call while the level clock is running. */
    public advance(delta: number): void {
        this.time += delta;
        if (this.focusPoint && this.focusTime > 0) {
            this.focusTime -= delta;
            this.turnToward(Math.atan2(this.focusPoint.x - this.position.x, this.focusPoint.z - this.position.z), delta);
            return;
        }
        const period = Math.max(0.5, this.data.period);
        const sweep = THREE.MathUtils.degToRad(this.data.sweep) * Math.sin((this.time * Math.PI * 2) / period);
        this.turnToward(this.baseHeading + sweep, delta);
    }

    public render(_delta?: number): void {
        this.head.rotation.y = this.heading;
        const blink = this.alert > 0.01 ? 0.5 + 0.5 * Math.sin(performance.now() / 60) : 1;
        (this.lens.material as THREE.MeshBasicMaterial).color.setHex(this.alert > 0.01 ? 0xff3b3b : 0xff8a3b).multiplyScalar(blink);
        this.coneMaterial.color.copy(CALM_COLOR).lerp(ALERT_COLOR, this.alert);
        this.coneMaterial.opacity = 0.34 + this.alert * 0.3;
        this.rebuildCone();
    }

    public focusOn(point: THREE.Vector3): void {
        (this.focusPoint ??= new THREE.Vector3()).copy(point);
        this.focusTime = 1.2;
    }

    /** Cameras have no personal space; only the cone counts. */
    public isTooClose(_target: THREE.Vector3): boolean {
        return false;
    }

    public sees(target: THREE.Vector3): boolean {
        const dx = target.x - this.position.x;
        const dz = target.z - this.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance > this.data.range) {
            return false;
        }
        if (distance > 0.05) {
            const offset = Math.abs(THREE.MathUtils.euclideanModulo(Math.atan2(dx, dz) - this.heading + Math.PI, Math.PI * 2) - Math.PI);
            if (offset > this.coneHalfAngle) {
                return false;
            }
        }
        return this.sight.hasLineOfSight(this.position.x, this.position.z, target.x, target.z);
    }

    // The camera has no body to run, so the busted sequence skips straight to the reaction.
    public chase(_target: THREE.Vector3, _delta: number): boolean {
        return true;
    }

    public faceToward(target: THREE.Vector3): void {
        this.heading = Math.atan2(target.x - this.position.x, target.z - this.position.z);
    }

    public playAngry(): void {
        // No animation on a camera.
    }

    public destroy(): void {
        this.threeScene.remove(this.cone);
        this.threeScene.remove(this.body);
        this.coneGeometry.dispose();
        this.coneMaterial.dispose();
        this.disposables.forEach((resource) => resource.dispose());
        this.disposables.length = 0;
    }

    private turnToward(target: number, delta: number): void {
        const difference = THREE.MathUtils.euclideanModulo(target - this.heading + Math.PI, Math.PI * 2) - Math.PI;
        const maxStep = TURN_RATE * delta;
        this.heading += THREE.MathUtils.clamp(difference, -maxStep, maxStep);
    }

    private rebuildCone(): void {
        const positions = this.coneGeometry.getAttribute('position') as THREE.BufferAttribute;
        positions.setXYZ(0, this.position.x, CONE_Y, this.position.z);
        for (let i = 0; i <= CONE_RAYS; i++) {
            const angle = this.heading - this.coneHalfAngle + (this.coneHalfAngle * 2 * i) / CONE_RAYS;
            const dx = Math.sin(angle);
            const dz = Math.cos(angle);
            const length = this.sight.castRay(this.position.x, this.position.z, dx, dz, this.data.range);
            positions.setXYZ(i + 1, this.position.x + dx * length, CONE_Y, this.position.z + dz * length);
        }
        positions.needsUpdate = true;
    }
}
