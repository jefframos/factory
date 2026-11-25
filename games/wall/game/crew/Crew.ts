// Crew.ts
//
// The helpers at the wall's foot (ui/wall.json `crew`): each runs at the wall and headbutts it, flips back and waits; the
// ones who throw stay where they are. Their hits are real: each does its share of what its kind does a second. As many are
// drawn as `shows`; more of them hit harder instead. Between walls they jump about.
//
// Each kind is one InstancedMesh (their models are one mesh, no skeleton: they squash and flip as a whole), with the shadows
// and the thrown things one each.

import * as THREE from 'three';
import { CREW, CREW_ROWS, CrewDef, hash } from '../data/WallConfig';
import { WallProgress } from '../data/WallProgress';
import { fx } from '../config/Effects';
import { WALL_WIDTH } from '../wall/Tunnel';

const MAX_SHOWN = CREW.reduce((sum, def) => sum + def.shows, 0);
/** Each kind has its own row (`z`), spread evenly along the wall (its share each side; less the nearer the eyes it is: a narrow screen sees less there), the rows out of step; a little off each. */
const ROW = { along: 0.96, nearer: 0.048, step: 0.05, x: 0.06, z: 0.3 };
/** The row by the wall. */
const NEAREST = Math.min(...CREW.map(({ z }) => z));
const LEAP = { seconds: 0.24, perUnit: 0.03, arc: 0.5 };
const BACK = { seconds: 0.42, arc: 1.1 };
const DROP = { height: 5, seconds: 0.45 };
const THROW = { seconds: 0.42, arc: 1.3, size: 0.16, pool: 12, color: 0x7a4a26 };
/** How far off the wall they stop: this much of their size. */
const NOSE = 0.75;

type Phase = 'drop' | 'wait' | 'leap' | 'back';

interface Member {
    kind: number;
    /** The how many-eth of its kind. */
    n: number;
    home: THREE.Vector3;
    at: THREE.Vector3;
    target: THREE.Vector3;
    phase: Phase;
    time: number;
    wait: number;
    seconds: number;
    yaw: number;
    yawTo: number;
    squash: number;
    flip: number;
    own: number;
}

interface Thrown {
    time: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    kind: number;
}

export interface CrewActions {
    /** Where one standing at x could hit the wall (undefined: nowhere now). */
    target(x: number, out: THREE.Vector3): THREE.Vector3 | null;
    hit(def: CrewDef, at: THREE.Vector3, damage: number): void;
}

export class Crew {
    public readonly group = new THREE.Group();
    private readonly meshes: (THREE.InstancedMesh | undefined)[] = [];
    private readonly members: Member[] = [];
    private readonly shown: number[] = CREW.map(() => 0);
    private readonly shadows: THREE.InstancedMesh;
    private readonly balls: THREE.InstancedMesh;
    private readonly thrown: Thrown[] = Array.from({ length: THROW.pool }, () => ({ time: -1, from: new THREE.Vector3(), to: new THREE.Vector3(), kind: 0 }));
    private nextThrown = 0;
    private clock = 0;
    private readonly matrix = new THREE.Matrix4();
    private readonly position = new THREE.Vector3();
    private readonly quaternion = new THREE.Quaternion();
    private readonly euler = new THREE.Euler();
    private readonly scale = new THREE.Vector3();

    public constructor(private readonly actions: CrewActions) {
        const shadow = new THREE.CircleGeometry(0.5, 16).rotateX(-Math.PI / 2);
        this.shadows = new THREE.InstancedMesh(shadow, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }), MAX_SHOWN);
        this.balls = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(THROW.size, 1), new THREE.MeshLambertMaterial({ color: THROW.color }), THROW.pool);
        for (const mesh of [this.shadows, this.balls]) {
            mesh.frustumCulled = false;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.count = 0;
            this.group.add(mesh);
        }
    }

    /** One kind's model, loaded. */
    public setModel(id: string, model: THREE.Object3D): void {
        const kind = CREW.findIndex((def) => def.id === id);
        const geometry = onePiece(model);
        if (kind < 0 || !geometry) return;
        const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }), CREW[kind].shows);
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        this.meshes[kind] = mesh;
        this.group.add(mesh);
    }

    /** As many as are owned; the new ones drop in (`at once`: they were there already). */
    public refresh(atOnce = false): void {
        CREW.forEach((def, kind) => {
            const wanted = Math.min(def.shows, WallProgress.owned(def.id));
            while (this.shown[kind] < wanted) this.add(kind, this.shown[kind]++, atOnce);
            if (this.shown[kind] > wanted) {
                // (A rewind: they've gone.)
                for (let i = this.members.length - 1; i >= 0; i--) if (this.members[i].kind === kind) this.members.splice(i, 1);
                this.shown[kind] = 0;
                while (this.shown[kind] < wanted) this.add(kind, this.shown[kind]++, atOnce);
            }
        });
    }

    /** Where one stands. */
    private homeOf(kind: number, n: number): THREE.Vector3 {
        const def = CREW[kind];
        const { away, spread, width } = CREW_ROWS;
        const z = NEAREST + away + (def.z - NEAREST) * spread;
        // (The first by the middle, the next ones to and fro from it.)
        const middle = (def.shows - 1) / 2;
        const out = Math.ceil(n / 2) * (n % 2 ? 1 : -1) * (kind % 2 ? 1 : -1);
        const place = (((Math.round(middle) + out) % def.shows) + def.shows) % def.shows;
        const along = ((place - middle) / Math.max(1, middle)) * (ROW.along - ROW.nearer * z) * width + (kind % 2 ? ROW.step : -ROW.step) + (hash(kind, n, 2, 77) - 0.5) * ROW.x;
        return new THREE.Vector3(along * (WALL_WIDTH / 2), 0, z + (hash(kind, n, 3, 77) - 0.5) * ROW.z);
    }

    /** Debug: all of them to where they stand now (the rows were moved). */
    public replace(): void {
        for (const member of this.members) member.home.copy(this.homeOf(member.kind, member.n));
    }

    private add(kind: number, n: number, atOnce: boolean): void {
        const def = CREW[kind];
        const own = hash(kind, n, 1, 77);
        const home = this.homeOf(kind, n);
        this.members.push({
            kind, n, home, at: home.clone(), target: new THREE.Vector3(), phase: atOnce ? 'wait' : 'drop', time: 0, wait: own * def.every,
            seconds: LEAP.seconds, yaw: Math.PI, yawTo: Math.PI, squash: 0, flip: 0, own,
        });
    }

    /** A jump for a kind just bought (one more of them, when they're all drawn). */
    public cheer(id: string): void {
        for (const member of this.members) if (CREW[member.kind].id === id) member.squash = 1;
    }

    /** `active`: there's a wall to hit; `running`: on the way to the next one. */
    public update(delta: number, active: boolean, running = false): void {
        this.clock += delta;
        const counts = CREW.map(() => 0);
        let shadow = 0;
        for (const member of this.members) {
            const def = CREW[member.kind];
            this.step(member, def, delta, active, running);
            member.squash = Math.max(0, member.squash - delta * 4);
            member.yaw += (member.yawTo - member.yaw) * (1 - Math.exp(-delta * 9));
            const mesh = this.meshes[member.kind];
            const squash = Math.sin(member.squash * Math.PI) * 0.28;
            const size = def.size;
            this.euler.set(member.flip, member.yaw, 0, 'YXZ');
            this.quaternion.setFromEuler(this.euler);
            // (Flips round its middle.)
            const middle = 0.75 * size;
            this.position.set(0, -middle, 0).applyQuaternion(this.quaternion).add(member.at);
            this.position.y += middle;
            this.scale.set(size * (1 + squash * 0.7), size * (1 - squash), size * (1 + squash * 0.7));
            if (mesh) mesh.setMatrixAt(counts[member.kind]++, this.matrix.compose(this.position, this.quaternion, this.scale));
            const near = 1 / (1 + member.at.y * 0.5);
            this.matrix.makeScale(size * 1.25 * near, 1, size * 1.25 * near).setPosition(member.at.x, 0.015, member.at.z);
            this.shadows.setMatrixAt(shadow++, this.matrix);
        }
        this.meshes.forEach((mesh, kind) => {
            if (!mesh) return;
            mesh.count = counts[kind];
            mesh.visible = counts[kind] > 0;
            mesh.instanceMatrix.needsUpdate = true;
        });
        this.shadows.count = shadow;
        this.shadows.visible = shadow > 0;
        this.shadows.instanceMatrix.needsUpdate = true;
        this.updateThrown(delta);
    }

    private step(member: Member, def: CrewDef, delta: number, active: boolean, running: boolean): void {
        member.time += delta;
        switch (member.phase) {
            case 'drop': {
                const t = Math.min(1, member.time / DROP.seconds);
                member.at.copy(member.home);
                member.at.y = DROP.height * (1 - t * t);
                if (t >= 1) this.land(member, def, 0.25);
                break;
            }
            case 'wait': {
                member.at.copy(member.home);
                // A little hop now and then; big ones while there's no wall.
                const hop = active ? Math.max(0, Math.sin(this.clock * 5 + member.own * 20)) * 0.04 : Math.abs(Math.sin(this.clock * 8 + member.own * 6)) * 0.45;
                member.at.y = hop;
                if (!active) {
                    member.yawTo = running ? Math.PI : (member.own - 0.5) * 1.2;
                    break;
                }
                member.wait -= delta;
                if (member.wait <= 0) this.attack(member, def);
                break;
            }
            case 'leap': {
                const t = Math.min(1, member.time / member.seconds);
                const e = t * t * (0.4 + 0.6 * t);
                member.at.lerpVectors(member.home, member.target, e);
                member.at.y += Math.sin(t * Math.PI) * LEAP.arc * (1 - t);
                member.flip = -0.5 * t;
                if (t < 1) break;
                this.actions.hit(def, member.target, this.damageOf(member, def));
                member.phase = 'back';
                member.time = 0;
                member.squash = 0.6;
                break;
            }
            case 'back': {
                const t = Math.min(1, member.time / BACK.seconds);
                member.at.lerpVectors(member.target, member.home, t * (2 - t));
                member.at.y = THREE.MathUtils.lerp(member.target.y, 0, t * t) + Math.sin(t * Math.PI) * BACK.arc * 0.5;
                member.flip = -0.5 * (1 - t) + fx('crewFlips') * Math.PI * 2 * t;
                if (t >= 1) this.land(member, def, 0);
                break;
            }
        }
    }

    private land(member: Member, def: CrewDef, extra: number): void {
        member.phase = 'wait';
        member.time = 0;
        member.flip = 0;
        member.squash = 1;
        member.at.copy(member.home);
        // (Less what its way there took: the farther ones hit as often.)
        member.wait = Math.max(0.05, def.every - member.seconds - BACK.seconds) * (0.85 + Math.random() * 0.3) + extra;
        // Back to the wall, side on, or a look at the player.
        member.yawTo = Math.random() < 0.35 ? (Math.random() - 0.5) * 0.9 : Math.PI + (Math.random() - 0.5) * 1.6;
    }

    private attack(member: Member, def: CrewDef): void {
        const target = this.actions.target(member.home.x, member.target);
        if (!target) {
            member.wait = 0.2;
            return;
        }
        member.time = 0;
        member.yawTo = Math.PI - Math.atan2(target.x - member.home.x, Math.max(0.5, member.home.z - target.z)) * 0.7;
        if (def.style === 'throw') {
            const ball = this.thrown[this.nextThrown];
            this.nextThrown = (this.nextThrown + 1) % THROW.pool;
            ball.time = 0;
            ball.kind = member.kind;
            ball.from.copy(member.home).setY(def.size * 1.3);
            ball.to.copy(target);
            member.squash = 1;
            member.wait = def.every * (0.85 + Math.random() * 0.3);
            return;
        }
        target.z += def.size * NOSE;
        target.y = Math.max(0, target.y - def.size * 0.6);
        member.phase = 'leap';
        member.seconds = LEAP.seconds + member.home.distanceTo(target) * LEAP.perUnit;
    }

    /** What one's hit does: its share of its kind's damage a second. */
    private damageOf({ kind }: { kind: number }, def: CrewDef): number {
        return (WallProgress.dpsEach(def) * WallProgress.owned(def.id) * def.every) / Math.max(1, this.shown[kind]);
    }

    private updateThrown(delta: number): void {
        let count = 0;
        for (const ball of this.thrown) {
            if (ball.time < 0) continue;
            ball.time += delta;
            const t = Math.min(1, ball.time / THROW.seconds);
            this.position.lerpVectors(ball.from, ball.to, t);
            this.position.y += Math.sin(t * Math.PI) * THROW.arc;
            this.quaternion.setFromEuler(this.euler.set(ball.time * 14, ball.time * 9, 0));
            this.balls.setMatrixAt(count++, this.matrix.compose(this.position, this.quaternion, this.scale.setScalar(1)));
            if (t < 1) continue;
            ball.time = -1;
            this.actions.hit(CREW[ball.kind], ball.to, this.damageOf(ball, CREW[ball.kind]));
        }
        this.balls.count = count;
        this.balls.visible = count > 0;
        this.balls.instanceMatrix.needsUpdate = true;
    }
}

/** A model's meshes as one geometry: positions, normals, colours, where they stand. */
function onePiece(model: THREE.Object3D): THREE.BufferGeometry | null {
    model.updateMatrixWorld(true);
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const v = new THREE.Vector3();
    model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const { position, normal, color } = mesh.geometry.attributes;
        const base = positions.length / 3;
        const turn = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
        for (let i = 0; i < position.count; i++) {
            v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
            positions.push(v.x, v.y, v.z);
            v.fromBufferAttribute(normal, i).applyMatrix3(turn).normalize();
            normals.push(v.x, v.y, v.z);
            colors.push(color ? color.getX(i) : 1, color ? color.getY(i) : 1, color ? color.getZ(i) : 1);
        }
        const index = mesh.geometry.index;
        if (index) for (let i = 0; i < index.count; i++) indices.push(base + index.getX(i));
        else for (let i = 0; i < position.count; i++) indices.push(base + i);
    });
    if (!positions.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    return geometry;
}
