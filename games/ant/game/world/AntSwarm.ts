// AntSwarm.ts
//
// The ants: each follows a path of waypoints from its slot to the pixel it claimed — round the tray, never across the
// picture: up to the tray's bottom edge, then in through the cells already eaten — stops just short of its block,
// facing it, and picks it up (onPickUp: the scene hides the picture's block and hands back the way home; the block
// rises from its spot onto the ant's back — the same jelly block, the same size — tipping over to ride corner down), walks it back out and down the anthill (onHome). Each ant wanders a little either side of its
// way and keeps its own pace, so a line of them looks alive (drawn only: where it really is stays on the path). All the
// ants are one InstancedMesh (an ant in its tile's colour: abdomen, thorax, head, six legs that swing as it walks)
// and the blocks they carry another, so a big swarm costs two draw calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { TUNING } from '../data/Tuning';
import { BLOCK, BLOCK_HEIGHT, ROUNDING } from './PictureView';

const MAX_ANTS = 400;
/** How fast an ant turns to face its way (its walking speed: TUNING.antSpeed). */
const TURN = 14;
/** How long picking a block up takes. */
const PICK_SEC = 0.4;
/** An ant stops this far (of a pixel) from its block's middle: in front of it. */
const GRAB_REACH = 0.85;
/** A carried block's tilt: a corner pointing down (turned 45° round its upright, then tipped so the corner's under). */
const CORNER_DOWN = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.atan(1 / Math.SQRT2), 0, Math.PI / 4, 'ZXY'));
const NO_TILT = new THREE.Quaternion();
/** Half a cube's long diagonal: how far its corner's below its middle. */
const HALF_DIAGONAL = Math.sqrt(3) / 2;
/** The wander either side of the way: how far (of a pixel, and at most in world units), how often (per unit walked);
 *  and how much an ant's pace differs from the next's. */
const WANDER = { amount: 0.22, max: 0.2, frequency: 1.6, pace: 0.12 };

export interface Ant {
    /** Whose ant it is (the slot index) and the pixel it's after. */
    slot: number;
    pixel: number;
    color: THREE.Color;
    carried: THREE.Color;
    position: THREE.Vector3;
    heading: number;
    /** Waypoints still to walk, the next first. */
    path: THREE.Vector3[];
    phase: 'out' | 'pick' | 'home';
    wait: number;
    step: number;
    /** Where the block it's picking up was (its middle): it lifts from there. */
    grabAt: THREE.Vector3;
    /** Its wander's phase and size (-1..1 of WANDER), and its pace (x the walking speed). */
    wander: number;
    sway: number;
    pace: number;
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
    private readonly drawn = new THREE.Vector3();
    private readonly tilt = new THREE.Quaternion();
    private readonly blockTurn = new THREE.Quaternion();

    /**
     * An ant's size is TUNING.antSize (the same in every level); `carried`: the size of the block on its back; `pixel`: a picture block's size (a lifted
     * block starts at it and shrinks to `carried` as it rises onto the ant's back); `groundAt(x, z)`: the height it
     * walks at there;
     * `onPickUp(ant)` as it lifts its pixel, returning its way home (ending in the anthill); `onHome(ant)` as it drops in.
     */
    public constructor(scene: THREE.Scene, private readonly carried: number, private readonly pixel: number,
        private readonly groundAt: (x: number, z: number) => number,
        private readonly onPickUp: (ant: Ant) => THREE.Vector3[], private readonly onHome: (ant: Ant) => void) {
        this.bodies = new THREE.InstancedMesh(antGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.4 }), MAX_ANTS);
        // The picture's own jelly block (PictureView), at its full size.
        this.blocks = new THREE.InstancedMesh(new RoundedBoxGeometry(BLOCK, BLOCK_HEIGHT, BLOCK, 2, ROUNDING),
            new THREE.MeshPhysicalMaterial({ roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.12 }), MAX_ANTS);
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

    /** Sends an ant from `from` along `path` (its last point: the pixel it's after). */
    public send(slot: number, pixel: number, color: THREE.Color, carried: THREE.Color, from: THREE.Vector3, path: THREE.Vector3[]): void {
        if (this.ants.length >= MAX_ANTS || !path.length) return;
        const heading = Math.atan2(path[0].x - from.x, path[0].z - from.z);
        this.ants.push({
            slot, pixel, color, carried, position: from.clone(), heading, path, phase: 'out', wait: 0, step: Math.random() * 6,
            grabAt: new THREE.Vector3(), wander: Math.random() * Math.PI * 2, sway: 0.5 + Math.random() * 0.5, pace: 1 + (Math.random() * 2 - 1) * WANDER.pace,
        });
    }

    public update(delta: number): void {
        for (let n = this.ants.length - 1; n >= 0; n--) {
            const ant = this.ants[n];
            if (ant.phase === 'pick') {
                // Facing its block while it lifts it.
                const want = Math.atan2(ant.grabAt.x - ant.position.x, ant.grabAt.z - ant.position.z);
                ant.heading += Math.atan2(Math.sin(want - ant.heading), Math.cos(want - ant.heading)) * Math.min(1, TURN * delta);
                ant.wait -= delta;
                if (ant.wait <= 0) ant.phase = 'home';
                continue;
            }
            const target = ant.path[0];
            if (!target) {
                // Nowhere left to walk (never expected): home at once.
                this.ants.splice(n, 1);
                if (ant.phase === 'home') this.onHome(ant);
                continue;
            }
            const dx = target.x - ant.position.x;
            const dz = target.z - ant.position.z;
            const distance = Math.hypot(dx, dz);
            const stride = TUNING.antSpeed * ant.pace * delta;
            // The block itself: it stops in front of it rather than on it.
            if (ant.phase === 'out' && ant.path.length === 1 && distance <= this.pixel * GRAB_REACH) {
                this.grab(ant, target);
                continue;
            }
            if (distance <= stride) {
                ant.position.set(target.x, ant.position.y, target.z);
                ant.path.shift();
                if (ant.path.length) continue;
                if (ant.phase === 'out') {
                    this.grab(ant, target);
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
            ant.wander += stride * WANDER.frequency;
            // Turn smoothly towards the way it's going (the shortest way round).
            const want = Math.atan2(dx, dz);
            const turn = Math.atan2(Math.sin(want - ant.heading), Math.cos(want - ant.heading));
            ant.heading += turn * Math.min(1, TURN * delta);
        }
        this.draw();
    }

    /** Stops in front of its block (at `block`, its middle on top of the picture) and starts lifting it. */
    private grab(ant: Ant, block: THREE.Vector3): void {
        // The block's middle: half a block under the picture's top there (taken before the scene takes it).
        ant.grabAt.set(block.x, this.groundAt(block.x, block.z) - (this.pixel * BLOCK_HEIGHT) / 2, block.z);
        ant.phase = 'pick';
        ant.wait = PICK_SEC;
        ant.path = this.onPickUp(ant);
    }

    private draw(): void {
        let carrying = 0;
        const reach = Math.min(WANDER.max, this.pixel * WANDER.amount);
        this.ants.forEach((ant, i) => {
            // A little waddle: the body rocks side to side with its steps; and a wander either side of its way (none
            // while it picks a block up).
            const side = ant.phase === 'pick' ? 0 : Math.sin(ant.wander) * reach * ant.sway;
            this.drawn.set(ant.position.x + Math.cos(ant.heading) * side, ant.position.y, ant.position.z - Math.sin(ant.heading) * side);
            this.quaternion.setFromAxisAngle(this.up, ant.heading + Math.sin(ant.step) * 0.08 + Math.cos(ant.wander) * 0.25 * ant.sway);
            this.scale.setScalar(TUNING.antSize);
            this.matrix.compose(this.drawn, this.quaternion, this.scale);
            this.bodies.setMatrixAt(i, this.matrix);
            this.bodies.setColorAt(i, ant.color);
            // The block it took: while picking up it rises from its spot in front of the ant onto its back, tipping over
            // to a corner down (`carried`: a full block's size); then it rides there home.
            if (ant.phase !== 'out') {
                const t = ant.phase === 'pick' ? 1 - Math.max(0, ant.wait) / PICK_SEC : 1;
                const ease = t * t * (3 - 2 * t);
                const back = this.drawn.y + TUNING.antSize * 0.45 + this.carried * HALF_DIAGONAL;
                // Up first, then over onto the back: an arc rather than a slide.
                const up = Math.sin(ease * Math.PI) * this.pixel * 0.5;
                this.lift.set(
                    ant.grabAt.x + (this.drawn.x - ant.grabAt.x) * ease,
                    ant.grabAt.y + (back - ant.grabAt.y) * ease + up,
                    ant.grabAt.z + (this.drawn.z - ant.grabAt.z) * ease,
                );
                if (ant.phase !== 'pick') this.lift.copy(this.drawn).setY(back);
                this.tilt.slerpQuaternions(NO_TILT, CORNER_DOWN, ease);
                this.blockTurn.copy(this.quaternion).multiply(this.tilt);
                this.matrix.compose(this.lift, this.blockTurn, this.scale.setScalar(this.pixel + (this.carried - this.pixel) * ease));
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
