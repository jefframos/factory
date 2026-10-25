// Trap.ts
//
// A spike plate on the floor that cycles safe -> warning flash -> armed. Same "spotter" surface as Guard and
// SecurityCamera so the scene can treat it uniformly; being on it while armed busts instantly (isTooClose).

import * as THREE from 'three';
import type { LevelTrap } from '../data/LevelData';
import { WorldBendService } from 'core/services/BendService';

const WARNING_SEC = 0.8;
const SPIKE_SPACING = 0.55;
const SPIKE_HEIGHT = 0.55;
const FOOT_MARGIN = 0.15;

export default class Trap {
    public readonly position = new THREE.Vector3();
    public alert = 0;
    public readonly stationary = true;

    private time: number;
    private readonly root = new THREE.Group();
    private readonly spikes: THREE.Mesh[] = [];
    private readonly plateMaterial: THREE.MeshStandardMaterial;
    private readonly disposables: Array<{ dispose(): void }> = [];

    public constructor(
        private readonly threeScene: THREE.Scene,
        private readonly data: LevelTrap,
        bendService: WorldBendService,
    ) {
        this.position.set(data.x, 0, data.z);
        this.time = data.offset;
        this.plateMaterial = this.track(new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.7 }));
        const spikeMaterial = this.track(new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.35, metalness: 0.4 }));
        bendService.applyBend(this.plateMaterial);
        bendService.applyBend(spikeMaterial);

        const plate = new THREE.Mesh(this.track(new THREE.BoxGeometry(data.width, 0.06, data.depth)), this.plateMaterial);
        plate.position.y = 0.03;
        this.root.add(plate);

        const geometry = this.track(new THREE.ConeGeometry(0.11, SPIKE_HEIGHT, 8));
        const columns = Math.max(1, Math.floor(data.width / SPIKE_SPACING));
        const rows = Math.max(1, Math.floor(data.depth / SPIKE_SPACING));
        for (let c = 0; c < columns; c++) {
            for (let r = 0; r < rows; r++) {
                const spike = new THREE.Mesh(geometry, spikeMaterial);
                spike.position.set((c - (columns - 1) / 2) * SPIKE_SPACING, 0.06, (r - (rows - 1) / 2) * SPIKE_SPACING);
                this.root.add(spike);
                this.spikes.push(spike);
            }
        }
        this.root.position.set(data.x, 0, data.z);
        threeScene.add(this.root);
        this.render();
    }

    private track<T extends { dispose(): void }>(resource: T): T {
        this.disposables.push(resource);
        return resource;
    }

    /** Seconds until the spikes are fully up: 0 while armed, negative-free otherwise. */
    private untilArmed(): number {
        const phase = THREE.MathUtils.euclideanModulo(this.time, this.data.period);
        const armedFrom = this.data.period - this.data.active;
        return phase >= armedFrom ? 0 : armedFrom - phase;
    }

    public get armed(): boolean {
        return this.untilArmed() === 0;
    }

    public setConeVisible(_visible: boolean): void {
        // Nothing to hide.
    }

    public hold(): void {
        // Nothing moves while the level clock is stopped.
    }

    public advance(delta: number): void {
        this.time += delta;
    }

    public render(_delta?: number): void {
        const wait = this.untilArmed();
        const warning = wait > 0 && wait < WARNING_SEC;
        const raised = wait === 0 ? 1 : warning ? 0.18 : 0;
        for (const spike of this.spikes) {
            spike.scale.y = Math.max(0.001, raised);
            spike.position.y = 0.06 + (SPIKE_HEIGHT * raised) / 2;
        }
        const flash = warning && Math.floor(performance.now() / 110) % 2 === 0;
        this.plateMaterial.color.setHex(wait === 0 ? 0x9b2222 : flash ? 0xffa024 : 0x3a3f47);
    }

    public focusOn(_point: THREE.Vector3): void {
        // Traps don't look anywhere.
    }

    /** Instant bust: armed spikes under the player's feet. */
    public isTooClose(target: THREE.Vector3): boolean {
        return this.armed
            && Math.abs(target.x - this.position.x) <= this.data.width / 2 + FOOT_MARGIN
            && Math.abs(target.z - this.position.z) <= this.data.depth / 2 + FOOT_MARGIN;
    }

    public sees(_target: THREE.Vector3): boolean {
        return false;
    }

    public chase(_target: THREE.Vector3, _delta: number): boolean {
        return true;
    }

    public faceToward(_target: THREE.Vector3): void {
        // No orientation.
    }

    public playAngry(): void {
        // No animation.
    }

    public destroy(): void {
        this.threeScene.remove(this.root);
        this.disposables.forEach((resource) => resource.dispose());
        this.disposables.length = 0;
    }
}
