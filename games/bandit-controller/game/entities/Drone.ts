// Drone.ts
//
// A hovering patrol drone. It has no facing cone: it lights a round disc on the floor under it and spots
// anything inside, as long as no wall is in between. It flies its route back and forth at a steady speed.

import * as THREE from 'three';
import type { LevelDrone } from '../data/LevelData';
import type { LevelSight } from '../utils/LevelSight';
import { WorldBendService } from 'core/services/BendService';

const HOVER_HEIGHT = 1.7;
const CALM_COLOR = new THREE.Color(0xffe066);
const ALERT_COLOR = new THREE.Color(0xff2d2d);

export default class Drone {
    public readonly position = new THREE.Vector3();
    public alert = 0;
    public readonly stationary = true;

    private readonly route: THREE.Vector3[];
    private readonly lengths: number[] = [];
    private readonly total: number;
    private travelled = 0;
    private readonly root = new THREE.Group();
    private readonly body = new THREE.Group();
    private readonly disc: THREE.Mesh;
    private readonly discMaterial: THREE.MeshBasicMaterial;
    private readonly eye: THREE.Mesh;
    private readonly disposables: Array<{ dispose(): void }> = [];

    public constructor(
        private readonly threeScene: THREE.Scene,
        private readonly data: LevelDrone,
        private readonly sight: LevelSight,
        bendService: WorldBendService,
    ) {
        this.route = data.path.map((point) => new THREE.Vector3(point.x, 0, point.z));
        let total = 0;
        for (let i = 1; i < this.route.length; i++) {
            const length = this.route[i].distanceTo(this.route[i - 1]);
            this.lengths.push(length);
            total += length;
        }
        this.total = total;
        this.position.copy(this.route[0]);

        const shell = this.track(new THREE.MeshStandardMaterial({ color: 0x39424e, roughness: 0.45 }));
        const eyeMaterial = this.track(new THREE.MeshBasicMaterial({ color: 0xffe066 }));
        bendService.applyBend(shell);
        const hull = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.4, 16, 12)), shell);
        hull.scale.y = 0.6;
        const ring = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.5, 0.06, 8, 20)), shell);
        ring.rotation.x = Math.PI / 2;
        this.eye = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.13, 10, 8)), eyeMaterial);
        this.eye.position.y = -0.16;
        this.body.add(hull, ring, this.eye);
        this.root.add(this.body);

        this.discMaterial = this.track(new THREE.MeshBasicMaterial({
            color: CALM_COLOR.clone(),
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
        }));
        bendService.applyBend(this.discMaterial);
        this.disc = new THREE.Mesh(this.track(new THREE.CircleGeometry(data.radius, 36)), this.discMaterial);
        this.disc.rotation.x = -Math.PI / 2;
        this.disc.renderOrder = 2;
        threeScene.add(this.root, this.disc);
        this.place();
    }

    private track<T extends { dispose(): void }>(resource: T): T {
        this.disposables.push(resource);
        return resource;
    }

    public setConeVisible(visible: boolean): void {
        this.disc.visible = visible;
    }

    public hold(): void {
        // Nothing moves while the level clock is stopped.
    }

    public advance(delta: number): void {
        this.travelled += delta * this.data.speed;
        this.place();
    }

    /** Position along the route, ping-ponging between its two ends. */
    private place(): void {
        if (this.total <= 0) {
            return;
        }
        const cycle = this.total * 2;
        const along = THREE.MathUtils.euclideanModulo(this.travelled, cycle);
        let distance = along <= this.total ? along : cycle - along;
        for (let i = 0; i < this.lengths.length; i++) {
            if (distance <= this.lengths[i] || i === this.lengths.length - 1) {
                const f = this.lengths[i] > 0 ? Math.min(1, distance / this.lengths[i]) : 0;
                this.position.lerpVectors(this.route[i], this.route[i + 1], f);
                break;
            }
            distance -= this.lengths[i];
        }
    }

    public render(_delta?: number): void {
        this.root.position.set(this.position.x, HOVER_HEIGHT + Math.sin(performance.now() / 300) * 0.06, this.position.z);
        this.body.rotation.y += 0.04;
        this.disc.position.set(this.position.x, 0.05, this.position.z);
        this.discMaterial.color.copy(CALM_COLOR).lerp(ALERT_COLOR, this.alert);
        this.discMaterial.opacity = 0.3 + this.alert * 0.3;
        (this.eye.material as THREE.MeshBasicMaterial).color.copy(CALM_COLOR).lerp(ALERT_COLOR, this.alert);
    }

    public focusOn(_point: THREE.Vector3): void {
        // Drones don't turn.
    }

    public isTooClose(_target: THREE.Vector3): boolean {
        return false;
    }

    public sees(target: THREE.Vector3): boolean {
        if (Math.hypot(target.x - this.position.x, target.z - this.position.z) > this.data.radius) {
            return false;
        }
        return this.sight.hasLineOfSight(this.position.x, this.position.z, target.x, target.z);
    }

    public chase(_target: THREE.Vector3, _delta: number): boolean {
        return true;
    }

    public faceToward(_target: THREE.Vector3): void {
        // Always hovering in place.
    }

    public playAngry(): void {
        // No animation.
    }

    public destroy(): void {
        this.threeScene.remove(this.root);
        this.threeScene.remove(this.disc);
        this.disposables.forEach((resource) => resource.dispose());
        this.disposables.length = 0;
    }
}
