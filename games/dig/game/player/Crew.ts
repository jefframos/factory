// Crew.ts
//
// The animals that help (ui/dig.json animals; called one by one on their pad): they run along round the miner, over the rock's
// tops where there's rock, and each every so often leaps at a block nearby, headbutts it (MiningController.bite: real
// digging, what comes out goes in the bag) and flips back. The newest `shown` are drawn; they do the others' work too. In the
// hub, and with the bag full, they only hop about.
//
// Each kind is one InstancedMesh (their models are one mesh, no skeleton: they squash and flip as a whole), all their shadows one.

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { BendService } from '../services/BendService';
import { DIG, animalKind } from '../data/DigConfig';
import { DigProgress } from '../data/DigProgress';
import { PowerSurge } from '../mining/PowerSurge';
import type { MiningController } from '../mining/MiningController';
import { AIR, VoxelTerrain } from '../world/VoxelTerrain';

const MODELS = './dig/models/animals/';
/** They keep up: this far behind at most, then they're put back beside the miner. */
const LOST = 14;
/** Following: how closely (per second), the speeds they're walking and running from, how high they bound, how fast. */
const RUN = { follow: 5, walk: 0.35, full: 2.5, hop: 0.2, pace: 12, ease: 8 };
const LEAP = { seconds: 0.2, perUnit: 0.035, arc: 0.9 };
const BACK = { seconds: 0.42, arc: 1.1 };
const DROP = { height: 6, seconds: 0.5 };
/** Round the miner: one ring, then the next this much further out. */
const RING = { of: 6, step: 0.8 };
const CLIMB = 9;
const TRIES = 10;

type Phase = 'drop' | 'with' | 'leap' | 'back';

interface Member {
    kind: number;
    slot: number;
    own: number;
    phase: Phase;
    time: number;
    wait: number;
    seconds: number;
    at: THREE.Vector3;
    from: THREE.Vector3;
    to: THREE.Vector3;
    cell: [number, number];
    /** How fast it's going (eased), and how far through its stride. */
    speed: number;
    stride: number;
    /** The height it stands at (eased up and down the rock). */
    ground: number;
    yaw: number;
    yawTo: number;
    squash: number;
    flip: number;
}

/** An animal's model as one geometry, its colours in its vertices. */
function onePiece(model: THREE.Object3D): THREE.BufferGeometry | null {
    model.updateMatrixWorld(true);
    const made = { position: [] as number[], normal: [] as number[], color: [] as number[], index: [] as number[] };
    const v = new THREE.Vector3();
    model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const { position, normal, color } = mesh.geometry.attributes;
        const base = made.position.length / 3;
        const turn = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
        for (let i = 0; i < position.count; i++) {
            v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).toArray(made.position, made.position.length);
            v.fromBufferAttribute(normal, i).applyMatrix3(turn).normalize().toArray(made.normal, made.normal.length);
            made.color.push(color ? color.getX(i) : 1, color ? color.getY(i) : 1, color ? color.getZ(i) : 1);
        }
        const { index } = mesh.geometry;
        for (let i = 0; i < (index ? index.count : position.count); i++) made.index.push(base + (index ? index.getX(i) : i));
    });
    if (!made.position.length) return null;
    const geometry = new THREE.BufferGeometry();
    for (const key of ['position', 'normal', 'color'] as const) geometry.setAttribute(key, new THREE.Float32BufferAttribute(made[key], 3));
    geometry.setIndex(made.index);
    return geometry;
}

export class Crew {
    private readonly group = new THREE.Group();
    private readonly meshes = new Map<number, THREE.InstancedMesh>();
    private readonly asked = new Set<number>();
    private readonly members: Member[] = [];
    private readonly shadows: THREE.InstancedMesh;
    private count = -1;
    private clock = 0;
    private readonly home = new THREE.Vector3();
    private readonly matrix = new THREE.Matrix4();
    private readonly position = new THREE.Vector3();
    private readonly quaternion = new THREE.Quaternion();
    private readonly euler = new THREE.Euler();
    private readonly scale = new THREE.Vector3();

    /** `onHit`: one's headbutted a block there (and whether it gave). */
    public constructor(threeScene: THREE.Scene, private readonly terrain: VoxelTerrain, private readonly mining: MiningController,
        private readonly onHit: (at: THREE.Vector3, gave: boolean) => void) {
        const shadow = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
        BendService.applyBend(shadow);
        this.shadows = new THREE.InstancedMesh(new THREE.CircleGeometry(0.5, 14).rotateX(-Math.PI / 2), shadow, DIG.animals.shown);
        this.shadows.frustumCulled = false;
        this.shadows.count = 0;
        this.group.add(this.shadows);
        threeScene.add(this.group);
    }

    /** A kind's model, when it's first needed. */
    private async load(kind: number): Promise<void> {
        if (this.asked.has(kind)) return;
        this.asked.add(kind);
        try {
            const geometry = onePiece(await ModelLoaderManager.instance.loadModel(`${MODELS}${DIG.animals.kinds[kind].id}.glb`));
            if (!geometry) return;
            const material = new THREE.MeshLambertMaterial({ vertexColors: true });
            BendService.applyBend(material);
            const mesh = new THREE.InstancedMesh(geometry, material, DIG.animals.shown);
            mesh.frustumCulled = false;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.count = 0;
            this.meshes.set(kind, mesh);
            this.group.add(mesh);
        } catch (error) {
            console.warn(`[Crew] ${DIG.animals.kinds[kind].id} could not load`, error);
        }
    }

    /** As many as there are now: the newest ones shown; new ones drop in beside the miner. */
    private refresh(player: THREE.Vector3): void {
        const total = DigProgress.animals;
        if (total === this.count) return;
        const drop = this.count >= 0;
        this.count = total;
        const shown = Math.min(DIG.animals.shown, total);
        const kinds = Array.from({ length: shown }, (_, i) => DIG.animals.kinds.indexOf(animalKind(total - shown + i)));
        kinds.forEach((kind) => void this.load(kind));
        // The ones there stay where they are (the oldest go as better ones come).
        this.members.splice(0, Math.max(0, this.members.length - shown + (drop ? 1 : 0)));
        while (this.members.length < shown) {
            this.members.push({
                kind: 0, slot: 0, own: Math.random(), phase: drop ? 'drop' : 'with', time: 0, wait: Math.random() * DIG.animals.every, seconds: 1,
                at: player.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3)), from: new THREE.Vector3(), to: new THREE.Vector3(), cell: [0, 0],
                ground: 0, speed: 0, stride: Math.random() * 6, yaw: 0, yawTo: 0, squash: 0, flip: 0,
            });
        }
        this.members.forEach((member, i) => {
            member.kind = kinds[i];
            member.slot = i;
        });
    }

    /** On the fixed clock, as the miner and the camera are (on another they'd judder against them). `active`: they dig (out in the mine); `spread`: how far round the miner they keep (a tractor's bigger). */
    public update(delta: number, player: THREE.Vector3, active: boolean, spread: number): void {
        this.clock += delta;
        this.refresh(player);
        const digs = active && (PowerSurge.active || DigProgress.backpackCount < DigProgress.capacity);
        const bite = this.members.length ? DigProgress.animalBite : 0;
        const counts = new Map<number, number>();
        let shadow = 0;
        for (const member of this.members) {
            this.step(member, delta, player, digs, spread, bite);
            const def = DIG.animals.kinds[member.kind];
            member.squash = Math.max(0, member.squash - delta * 4);
            const turn = Math.atan2(Math.sin(member.yawTo - member.yaw), Math.cos(member.yawTo - member.yaw));
            member.yaw += turn * (1 - Math.exp(-delta * 10));
            const squash = Math.sin(member.squash * Math.PI) * 0.28;
            const { size } = def;
            this.quaternion.setFromEuler(this.euler.set(member.flip, member.yaw, 0, 'YXZ'));
            // (Flips round its middle.)
            const middle = 0.75 * size;
            this.position.set(0, -middle, 0).applyQuaternion(this.quaternion).add(member.at);
            this.position.y += middle;
            this.scale.set(size * (1 + squash * 0.7), size * (1 - squash), size * (1 + squash * 0.7));
            const mesh = this.meshes.get(member.kind);
            if (mesh) {
                const n = counts.get(member.kind) ?? 0;
                counts.set(member.kind, n + 1);
                mesh.setMatrixAt(n, this.matrix.compose(this.position, this.quaternion, this.scale));
            }
            const floor = this.floorAt(member.at.x, member.at.z);
            const near = 1 / (1 + Math.max(0, member.at.y - floor) * 0.5);
            this.matrix.makeScale(size * 1.2 * near, 1, size * 1.2 * near).setPosition(member.at.x, floor + 0.02, member.at.z);
            this.shadows.setMatrixAt(shadow++, this.matrix);
        }
        for (const [kind, mesh] of this.meshes) {
            mesh.count = counts.get(kind) ?? 0;
            mesh.visible = mesh.count > 0;
            mesh.instanceMatrix.needsUpdate = true;
        }
        this.shadows.count = shadow;
        this.shadows.visible = shadow > 0;
        this.shadows.instanceMatrix.needsUpdate = true;
    }

    /** What they'd stand on: the rock's top, or the ground. */
    private floorAt(x: number, z: number): number {
        return this.terrain.isSolid(x, z) ? this.terrain.blockHeight : 0;
    }

    /** One's place by the miner: rings round them. */
    private place(member: Member, player: THREE.Vector3, spread: number): THREE.Vector3 {
        const ring = Math.floor(member.slot / RING.of);
        const angle = ((member.slot % RING.of) / RING.of + ring * 0.5 / RING.of) * Math.PI * 2;
        const radius = spread + ring * RING.step;
        return this.home.set(player.x + Math.sin(angle) * radius, 0, player.z + Math.cos(angle) * radius);
    }

    private step(member: Member, delta: number, player: THREE.Vector3, digs: boolean, spread: number, bite: number): void {
        member.time += delta;
        const home = this.place(member, player, spread);
        switch (member.phase) {
            case 'drop': {
                const t = Math.min(1, member.time / DROP.seconds);
                member.at.set(home.x, this.floorAt(home.x, home.z) + DROP.height * (1 - t * t), home.z);
                if (t >= 1) this.land(member);
                break;
            }
            case 'with': {
                const dx = home.x - member.at.x;
                const dz = home.z - member.at.z;
                const away = Math.hypot(dx, dz);
                if (away > LOST) {
                    member.at.copy(home);
                    break;
                }
                // (Never stopping and starting: always a share of the way, so it glides along behind.)
                const share = 1 - Math.exp(-delta * RUN.follow);
                member.at.x += dx * share;
                member.at.z += dz * share;
                const now = delta > 0 ? (away * share) / delta : 0;
                member.speed += (now - member.speed) * (1 - Math.exp(-delta * RUN.ease));
                const run = THREE.MathUtils.smoothstep(member.speed, RUN.walk, RUN.full);
                if (member.speed > RUN.walk) member.yawTo = Math.atan2(dx, dz);
                member.stride += delta * RUN.pace * (0.4 + 0.6 * run);
                const floor = this.floorAt(member.at.x, member.at.z);
                const hop = Math.abs(Math.sin(member.stride)) * RUN.hop * run + Math.max(0, Math.sin(this.clock * 5 + member.own * 20)) * 0.05 * (1 - run);
                member.ground += (floor - member.ground) * (1 - Math.exp(-delta * CLIMB));
                member.at.y = member.ground + hop;
                member.wait -= delta;
                if (digs && member.wait <= 0) this.attack(member, player);
                break;
            }
            case 'leap': {
                const t = Math.min(1, member.time / member.seconds);
                member.at.lerpVectors(member.from, member.to, t * t * (0.4 + 0.6 * t));
                member.at.y += Math.sin(t * Math.PI) * LEAP.arc * (1 - t * 0.5);
                member.flip = -0.5 * t;
                if (t < 1) break;
                this.onHit(member.to, this.mining.bite(member.cell[0], member.cell[1], bite));
                member.phase = 'back';
                member.time = 0;
                member.squash = 0.6;
                member.from.copy(member.at);
                break;
            }
            case 'back': {
                const t = Math.min(1, member.time / BACK.seconds);
                member.at.lerpVectors(member.from, home, t * (2 - t));
                member.at.y = THREE.MathUtils.lerp(member.from.y, this.floorAt(home.x, home.z), t * t) + Math.sin(t * Math.PI) * BACK.arc;
                member.flip = -0.5 * (1 - t) - Math.PI * 2 * t;
                if (t >= 1) this.land(member);
                break;
            }
            default:
                break;
        }
    }

    private land(member: Member): void {
        member.ground = member.at.y;
        member.phase = 'with';
        member.time = 0;
        member.flip = 0;
        member.squash = 1;
        member.wait = Math.max(0.1, DIG.animals.every - LEAP.seconds - BACK.seconds) * (0.8 + Math.random() * 0.4);
    }

    /** Off at a block near it that can be dug, one on a tunnel's edge if there is. */
    private attack(member: Member, player: THREE.Vector3): void {
        const { terrain } = this;
        let found: [number, number] | undefined;
        for (let k = 0; k < TRIES && !found; k++) {
            const angle = Math.atan2(member.at.x - player.x, member.at.z - player.z) + (Math.random() - 0.5) * 2.4;
            const far = 1.2 + Math.random() * DIG.animals.reach;
            const [ix, iz] = terrain.cellOf(player.x + Math.sin(angle) * far, player.z + Math.cos(angle) * far);
            if (!this.mining.bitable(ix, iz)) continue;
            const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => terrain.cellValue(ix + dx, iz + dz) === AIR);
            if (edge || k > TRIES / 2) found = [ix, iz];
        }
        if (!found) {
            member.wait = 0.25;
            return;
        }
        member.cell = found;
        const size = DIG.animals.kinds[member.kind].size;
        terrain.cellCenter(found[0], found[1], member.to).setY(Math.max(0.2, terrain.blockHeight - size));
        member.from.copy(member.at);
        member.yawTo = Math.atan2(member.to.x - member.at.x, member.to.z - member.at.z);
        member.phase = 'leap';
        member.time = 0;
        member.seconds = LEAP.seconds + member.from.distanceTo(member.to) * LEAP.perUnit;
    }

    public destroy(): void {
        for (const mesh of this.meshes.values()) {
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
        }
        this.group.removeFromParent();
    }
}
