// AntSwarm.ts
//
// The ants: each walks from its slot to the pixel it claimed, picks the block up (onPickUp: the scene hides the
// picture's block, the ant now carries a copy over its head), walks it to the anthill and drops in (onHome). All the
// ants are one InstancedMesh (an ant in its tile's colour: abdomen, thorax, head, six legs that swing as it walks)
// and the blocks they carry another, so a big swarm costs two draw calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const MAX_ANTS = 400;
/** Walking speed (world units a second) and how fast an ant turns to face its way. */
const SPEED = 9;
const TURN = 14;
/** How long picking a block up takes. */
const PICK_SEC = 0.12;

export interface Ant {
    /** Whose ant it is (the slot index) and the pixel it's after. */
    slot: number;
    pixel: number;
    color: THREE.Color;
    carried: THREE.Color;
    position: THREE.Vector3;
    heading: number;
    target: THREE.Vector3;
    phase: 'out' | 'pick' | 'home';
    wait: number;
    step: number;
}

/** An ant, nose along +Z: abdomen, thorax, head, and three pairs of legs (thin boxes). */
function antGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const sphere = (r: number, z: number, sx = 1, sy = 0.85, sz = 1.2) => {
        const g = new THREE.SphereGeometry(r, 10, 8);
        g.scale(sx, sy, sz);
        g.translate(0, 0.32, z);
        return g;
    };
    parts.push(sphere(0.26, -0.32), sphere(0.17, 0.02, 1, 0.9, 1.1), sphere(0.19, 0.3, 1, 0.95, 0.95));
    for (const z of [-0.08, 0.04, 0.16]) {
        for (const side of [-1, 1]) {
            const leg = new THREE.BoxGeometry(0.42, 0.05, 0.05);
            leg.rotateZ(side * 0.5);
            leg.translate(side * 0.2, 0.22, z);
            parts.push(leg);
        }
    }
    const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()));
    parts.forEach((p) => p.dispose());
    return merged;
}

export class AntSwarm {
    private readonly ants: Ant[] = [];
    private readonly bodies: THREE.InstancedMesh;
    private readonly blocks: THREE.InstancedMesh;
    private readonly matrix = new THREE.Matrix4();
    private readonly quaternion = new THREE.Quaternion();
    private readonly scale = new THREE.Vector3();
    private readonly up = new THREE.Vector3(0, 1, 0);
    private readonly lift = new THREE.Vector3();

    /**
     * `size`: an ant's length in world units (about a pixel); `groundAt(x, z)`: the height it walks at there (on top of
     * the picture's blocks, on the floor elsewhere); `onPickUp(ant)` as it lifts its pixel, `onHome(ant)` as it drops into
     * the anthill at `home`.
     */
    public constructor(scene: THREE.Scene, private readonly size: number, private readonly home: THREE.Vector3,
        private readonly groundAt: (x: number, z: number) => number,
        private readonly onPickUp: (ant: Ant) => void, private readonly onHome: (ant: Ant) => void) {
        this.bodies = new THREE.InstancedMesh(antGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.4 }), MAX_ANTS);
        this.blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.6, 1), new THREE.MeshStandardMaterial({ roughness: 0.55 }), MAX_ANTS);
        for (const mesh of [this.bodies, this.blocks]) {
            mesh.count = 0;
            mesh.frustumCulled = false;
            scene.add(mesh);
        }
    }

    public get count(): number {
        return this.ants.length;
    }

    /** Ants still out for a slot. */
    public countFor(slot: number): number {
        return this.ants.filter((a) => a.slot === slot).length;
    }

    /** Sends an ant from `from` to the pixel at `to`. */
    public send(slot: number, pixel: number, color: THREE.Color, carried: THREE.Color, from: THREE.Vector3, to: THREE.Vector3): void {
        if (this.ants.length >= MAX_ANTS) return;
        const heading = Math.atan2(to.x - from.x, to.z - from.z);
        this.ants.push({ slot, pixel, color, carried, position: from.clone(), heading, target: to.clone(), phase: 'out', wait: 0, step: Math.random() * 6 });
    }

    public update(delta: number): void {
        for (let n = this.ants.length - 1; n >= 0; n--) {
            const ant = this.ants[n];
            if (ant.phase === 'pick') {
                ant.wait -= delta;
                if (ant.wait > 0) continue;
                ant.phase = 'home';
                ant.target.copy(this.home);
                continue;
            }
            const dx = ant.target.x - ant.position.x;
            const dz = ant.target.z - ant.position.z;
            const distance = Math.hypot(dx, dz);
            const stride = SPEED * delta;
            if (distance <= stride) {
                ant.position.set(ant.target.x, ant.position.y, ant.target.z);
                if (ant.phase === 'out') {
                    ant.phase = 'pick';
                    ant.wait = PICK_SEC;
                    this.onPickUp(ant);
                } else {
                    this.ants.splice(n, 1);
                    this.onHome(ant);
                }
                continue;
            }
            ant.position.x += (dx / distance) * stride;
            ant.position.z += (dz / distance) * stride;
            // Climbs onto the picture (and back down) over a few frames rather than in one jump.
            ant.position.y += (this.groundAt(ant.position.x, ant.position.z) - ant.position.y) * Math.min(1, 18 * delta);
            ant.step += stride * 3;
            // Turn smoothly towards the way it's going (the shortest way round).
            const want = Math.atan2(dx, dz);
            const turn = Math.atan2(Math.sin(want - ant.heading), Math.cos(want - ant.heading));
            ant.heading += turn * Math.min(1, TURN * delta);
        }
        this.draw();
    }

    private draw(): void {
        let carrying = 0;
        this.ants.forEach((ant, i) => {
            // A little waddle: the body rocks side to side with its steps.
            this.quaternion.setFromAxisAngle(this.up, ant.heading + Math.sin(ant.step) * 0.08);
            this.scale.setScalar(this.size);
            this.matrix.compose(ant.position, this.quaternion, this.scale);
            this.bodies.setMatrixAt(i, this.matrix);
            this.bodies.setColorAt(i, ant.color);
            if (ant.phase !== 'out') {
                this.lift.copy(ant.position).setY(ant.position.y + this.size * 0.85);
                this.matrix.compose(this.lift, this.quaternion, this.scale.setScalar(this.size * 0.7));
                this.blocks.setMatrixAt(carrying, this.matrix);
                this.blocks.setColorAt(carrying, ant.carried);
                carrying++;
            }
        });
        this.bodies.count = this.ants.length;
        this.blocks.count = carrying;
        this.bodies.instanceMatrix.needsUpdate = true;
        this.blocks.instanceMatrix.needsUpdate = true;
        if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
        if (this.blocks.instanceColor) this.blocks.instanceColor.needsUpdate = true;
    }

    /** All ants gone at once (a restart). */
    public clear(): void {
        this.ants.length = 0;
        this.draw();
    }

    public destroy(): void {
        for (const mesh of [this.bodies, this.blocks]) {
            mesh.removeFromParent();
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
        }
    }
}
