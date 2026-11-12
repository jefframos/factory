// AntSwarm.ts
//
// The ants: each follows a path of waypoints from its slot to the pixel it claimed — round the tray, never across the
// picture: up to the tray's bottom edge, then in through the cells already eaten — stops just short of its block,
// facing it, and picks it up (onPickUp: the scene hides the picture's block and hands back the way home; the block
// rises from its spot onto the ant's back — the same jelly block, the same size — tipping over to ride corner down), walks it back out and down the anthill (onHome). Each ant wanders a little either side of its
// way and keeps its own pace, so a line of them looks alive (drawn only: where it really is stays on the path). All the
// ants are drawn as a walk cycle baked into WALK.frames poses, one InstancedMesh each (an ant in its tile's colour, its
// edges darker as the UFO's saucers' are: abdomen, thorax, a big head, six jointed legs spread along the body, walking
// a tripod gait: front and back legs of one side with the other side's middle one) — each ant in the pose of its own
// stride,
// their eyes another (white with black pupils, in vertex colours: not tinted), and the blocks they carry a third, so a
// big swarm costs three draw calls.

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

/** The ant's head: big, for personality (the eyes go on its front). */
const HEAD = { radius: 0.27, y: 0.36, z: 0.36 };
/** The ants' dark edge (as the UFO's saucers have, PopMaterial.ts): how much darker their outline goes (0..1), and how
 *  far in it reaches (of how much the surface faces the camera). */
const RIM = { amount: 0.55, width: 0.6 };

/**
 * The walk: how many baked poses, how far a leg swings forward and back (radians round its hip), how high a foot lifts
 * as it swings forward. The legs: each pair's hip (z along the body), which way it points at rest (radians: + forward),
 * the hip's height and how far out from the middle; the thigh's and the shin's lengths, how thick they are.
 */
const WALK = { frames: 8, swing: 0.42, lift: 0.1 };
/** The flat shadow under each ant (so it stands out on the picture and the floor): its half width and half length (x
 *  the ant's size), how far back its middle is, how dark, how far over the ground (no flicker with it). */
const SHADOW = { width: 0.6, length: 0.9, back: -0.06, opacity: 0.5, lift: 0.015 };

/** The shadow's picture: a soft dark blot, darkest in the middle and fading out to nothing at its edge. Drawn once. */
let shadowTexture: THREE.Texture | null = null;
function softShadow(): THREE.Texture {
    if (shadowTexture) return shadowTexture;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const c = canvas.getContext('2d')!;
    const blot = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    blot.addColorStop(0, 'rgba(255,255,255,1)');
    blot.addColorStop(0.45, 'rgba(255,255,255,0.7)');
    blot.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = blot;
    c.fillRect(0, 0, 64, 64);
    shadowTexture = new THREE.CanvasTexture(canvas);
    return shadowTexture;
}
const LEGS = {
    pairs: [{ z: 0.15, angle: 0.65 }, { z: 0.02, angle: 0 }, { z: -0.11, angle: -0.6 }],
    hipY: 0.27, hipX: 0.1, thigh: 0.24, shin: 0.3, thick: 0.065, kneeUp: 0.13,
};

/** A stick between `a` and `b`, `thick` across (a box along the line). */
function segment(a: THREE.Vector3, b: THREE.Vector3, thick: number): THREE.BufferGeometry {
    const length = a.distanceTo(b);
    const g = new THREE.BoxGeometry(thick, thick, length + thick * 0.6);
    const holder = new THREE.Object3D();
    holder.position.copy(a).add(b).multiplyScalar(0.5);
    holder.lookAt(b);
    holder.updateMatrix();
    g.applyMatrix4(holder.matrix);
    return g;
}

/**
 * An ant, nose along +Z, in walk pose `frame` (of WALK.frames; -1: standing): abdomen, thorax, a big head, and six legs —
 * each a thigh up and out to its knee, then a shin down to the ground — swinging in a tripod gait.
 */
function antGeometry(frame: number): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const sphere = (r: number, z: number, sx = 1, sy = 0.85, sz = 1.2) => {
        const g = new THREE.SphereGeometry(r, 10, 8);
        g.scale(sx, sy, sz);
        g.translate(0, 0.32, z);
        return g;
    };
    parts.push(sphere(0.26, -0.32), sphere(0.17, 0.02, 1, 0.9, 1.1));
    const head = new THREE.SphereGeometry(HEAD.radius, 12, 10);
    head.translate(0, HEAD.y, HEAD.z);
    parts.push(head);
    const t = frame < 0 ? 0 : (frame / WALK.frames) * Math.PI * 2;
    LEGS.pairs.forEach(({ z, angle }, pair) => {
        for (const side of [-1, 1]) {
            // The tripod: front and back of one side with the middle of the other (half a cycle apart from the rest).
            const group = (pair === 1 ? side > 0 : side < 0) ? 0 : Math.PI;
            const phase = t + group;
            const swing = frame < 0 ? 0 : Math.sin(phase) * WALK.swing;
            // Lifted while it swings forward (the first half of its cycle), on the ground while it pushes back.
            const lift = frame < 0 ? 0 : Math.max(0, Math.cos(phase)) * WALK.lift;
            const yaw = angle + swing;
            // Out sideways, turned forward or back by its yaw.
            const out = new THREE.Vector3(side * Math.cos(yaw), 0, Math.sin(yaw));
            const hip = new THREE.Vector3(side * LEGS.hipX, LEGS.hipY, z);
            const knee = hip.clone().addScaledVector(out, LEGS.thigh).add(new THREE.Vector3(0, LEGS.kneeUp + lift * 0.5, 0));
            const foot = knee.clone().addScaledVector(out, LEGS.shin * 0.55).setY(0.02 + lift);
            parts.push(segment(hip, knee, LEGS.thick), segment(knee, foot, LEGS.thick * 0.85));
        }
    });
    const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
    parts.forEach((p) => p.dispose());
    return merged;
}

/** Two big eyes on the front of the ant's head (HEAD), white with black pupils, as vertex colours — the eyes' mesh
 *  isn't tinted per ant. */
function eyesGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const ball = (r: number, x: number, y: number, z: number, shade: number) => {
        const g = new THREE.SphereGeometry(r, 8, 6).toNonIndexed();
        g.translate(x, y, z);
        const colors = new Float32Array(g.getAttribute('position').count * 3).fill(shade);
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        parts.push(g);
    };
    const front = HEAD.z + HEAD.radius * 0.8;
    for (const side of [-1, 1]) {
        ball(0.1, side * 0.12, HEAD.y + 0.07, front, 1);
        ball(0.055, side * 0.13, HEAD.y + 0.08, front + 0.07, 0.05);
    }
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return merged;
}

/** A standard material whose edges go darker, where the surface turns away from the camera (RIM). */
function rimmed(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uRim = { value: RIM.amount };
        shader.uniforms.uRimWidth = { value: RIM.width };
        shader.fragmentShader = `uniform float uRim;\nuniform float uRimWidth;\n${shader.fragmentShader}`.replace(
            '#include <opaque_fragment>',
            `float facing = max(dot(normalize(normal), normalize(vViewPosition)), 0.0);
            outgoingLight *= pow(1.0 - uRim * (1.0 - smoothstep(0.0, uRimWidth, facing)), 2.2);
            #include <opaque_fragment>`,
        );
    };
    return material;
}

export class AntSwarm {
    private readonly ants: Ant[] = [];
    /** The flat shadows under the ants (one quad each: cheap). */
    private readonly shadows: THREE.InstancedMesh;
    private readonly shadowAt = new THREE.Vector3();
    /** The bodies: one mesh per walk pose (WALK.frames), and a standing one (an ant lifting its block). */
    private readonly poses: THREE.InstancedMesh[] = [];
    private readonly eyes: THREE.InstancedMesh;
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
        // A soft dark blot on the ground under each ant (a square with a fading round picture: no hard edge), drawn
        // before them, never hiding anything.
        const oval = new THREE.PlaneGeometry(2, 2);
        oval.rotateX(-Math.PI / 2);
        oval.scale(SHADOW.width, 1, SHADOW.length);
        oval.translate(0, 0, SHADOW.back);
        this.shadows = new THREE.InstancedMesh(oval, new THREE.MeshBasicMaterial({ color: 0x2a1408, map: softShadow(), transparent: true, opacity: SHADOW.opacity, depthWrite: false }), MAX_ANTS);
        this.shadows.renderOrder = -1;
        const material = rimmed(new THREE.MeshStandardMaterial({ roughness: 0.4 }));
        for (let frame = 0; frame < WALK.frames; frame++) this.poses.push(new THREE.InstancedMesh(antGeometry(frame), material, MAX_ANTS));
        this.poses.push(new THREE.InstancedMesh(antGeometry(-1), material, MAX_ANTS));
        this.eyes = new THREE.InstancedMesh(eyesGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25 }), MAX_ANTS);
        // The picture's own jelly block (PictureView), at its full size.
        this.blocks = new THREE.InstancedMesh(new RoundedBoxGeometry(BLOCK, BLOCK_HEIGHT, BLOCK, 2, ROUNDING),
            new THREE.MeshPhysicalMaterial({ roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.12 }), MAX_ANTS);
        for (const mesh of [this.shadows, ...this.poses, this.eyes, this.blocks]) {
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
        // How many ants each pose has drawn so far.
        const counts = this.poses.map(() => 0);
        const reach = Math.min(WANDER.max, this.pixel * WANDER.amount);
        this.ants.forEach((ant, i) => {
            // A little waddle: the body rocks side to side with its steps; and a wander either side of its way (none
            // while it picks a block up).
            const side = ant.phase === 'pick' ? 0 : Math.sin(ant.wander) * reach * ant.sway;
            this.drawn.set(ant.position.x + Math.cos(ant.heading) * side, ant.position.y, ant.position.z - Math.sin(ant.heading) * side);
            this.quaternion.setFromAxisAngle(this.up, ant.heading + Math.sin(ant.step) * 0.08 + Math.cos(ant.wander) * 0.25 * ant.sway);
            this.scale.setScalar(TUNING.antSize);
            // Its shadow, flat on the ground just under it, turned with it.
            this.shadowAt.copy(this.drawn).setY(this.drawn.y + SHADOW.lift * TUNING.antSize);
            this.matrix.compose(this.shadowAt, this.quaternion, this.scale);
            this.shadows.setMatrixAt(i, this.matrix);
            this.matrix.compose(this.drawn, this.quaternion, this.scale);
            // Its pose: its own stride through the walk (ant.step: radians, a cycle a step pair); lifting a block, standing.
            const cycle = ((ant.step % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            const pose = ant.phase === 'pick' ? WALK.frames : Math.floor((cycle / (Math.PI * 2)) * WALK.frames) % WALK.frames;
            const mesh = this.poses[pose];
            mesh.setMatrixAt(counts[pose], this.matrix);
            mesh.setColorAt(counts[pose], ant.color);
            counts[pose]++;
            this.eyes.setMatrixAt(i, this.matrix);
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
        this.poses.forEach((mesh, k) => {
            mesh.count = counts[k];
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        });
        this.eyes.count = this.ants.length;
        this.shadows.count = this.ants.length;
        this.shadows.instanceMatrix.needsUpdate = true;
        this.eyes.instanceMatrix.needsUpdate = true;
        this.blocks.count = carrying;
        this.blocks.instanceMatrix.needsUpdate = true;
        if (this.blocks.instanceColor) this.blocks.instanceColor.needsUpdate = true;
    }

    /** All ants gone at once (a restart). */
    public clear(): void {
        this.ants.length = 0;
        this.draw();
    }

    public destroy(): void {
        for (const mesh of [this.shadows, ...this.poses, this.eyes, this.blocks]) {
            mesh.removeFromParent();
            mesh.geometry.dispose();
        }
        (this.shadows.material as THREE.Material).dispose();
        // (The poses share one material.)
        (this.poses[0]?.material as THREE.Material | undefined)?.dispose();
        (this.eyes.material as THREE.Material).dispose();
        (this.blocks.material as THREE.Material).dispose();
    }
}
