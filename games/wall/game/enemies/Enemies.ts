// Enemies.ts
//
// The enemies that wait behind some walls, as they're seen: they walk in out of the dark, stand in the gate, flinch and flash
// when they're hit, fly off when they're done for, or vanish (a boss whose time's up). What they are and when they come is
// Fight's. Their models are poses (tools/build-enemies.mjs): a walk is one mesh after another, no skeleton; until they're
// loaded, a plain ball stands in.

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import type { Coat } from '../data/WallConfig';

const MODELS = './wall/models/enemies/';
const FROM_Z = -13;
const IN = { minion: 1.1, boss: 1.9 };
const DIE_SEC = 0.5;
const LEAVE_SEC = 0.45;
const FLASH_SEC = 0.16;
/** How far a hit pushes one back (the boss, less), and how fast it comes back. */
const PUSH = { minion: 0.5, boss: 0.14, most: 0.9, back: 7 };
/** Now and then one lunges (looks only): every so often, how far. */
const LUNGE = { least: 1.6, more: 2.6, seconds: 0.45, far: 0.5 };

export interface EnemySpec {
    model: string;
    height: number;
    /** It hovers this high (a share of its height). */
    float?: number;
    tint?: number;
    bright?: number;
    /** In another colour. */
    coat?: Coat;
    /** Walk cycles a second. */
    pace?: number;
    boss?: boolean;
    hp: number;
    home: THREE.Vector3;
}

interface Poses {
    poses: THREE.BufferGeometry[];
    map: THREE.Texture | null;
}

export class Enemy {
    public hp: number;
    public phase: 'in' | 'idle' | 'dying' | 'leaving' | 'gone' = 'in';
    public readonly at = new THREE.Vector3();
    public readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
    public time = 0;
    public push = 0;
    public squash = 0;
    public flash = 0;
    public lunge = 0;
    public nextLunge = LUNGE.least + Math.random() * LUNGE.more;
    public readonly own = Math.random();
    public shownAs = '';
    public readonly thrown = new THREE.Vector3();

    public constructor(public readonly spec: EnemySpec) {
        this.hp = spec.hp;
        this.mesh = new THREE.Mesh(STAND_IN, new THREE.MeshLambertMaterial({ color: spec.tint ?? 0xffffff }));
        this.mesh.material.color.multiplyScalar(spec.bright ?? 1);
        this.mesh.frustumCulled = false;
        this.at.copy(spec.home).setZ(FROM_Z);
    }

    /** It can be hit. */
    public get alive(): boolean {
        return this.phase === 'in' || this.phase === 'idle';
    }

    /** Its middle. */
    public middle(out: THREE.Vector3): THREE.Vector3 {
        return out.copy(this.at).setY(this.at.y + this.spec.height * 0.5);
    }
}

const STAND_IN = new THREE.IcosahedronGeometry(0.4, 1).translate(0, 0.45, 0);

export class Enemies {
    public readonly group = new THREE.Group();
    public readonly all: Enemy[] = [];
    private readonly models = new Map<string, Poses>();
    private readonly shadows: THREE.InstancedMesh;
    private readonly matrix = new THREE.Matrix4();
    private readonly point = new THREE.Vector3();
    private readonly edge = new THREE.Vector3();
    private clock = 0;

    public constructor() {
        this.shadows = new THREE.InstancedMesh(new THREE.CircleGeometry(0.5, 18).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }), 12);
        this.shadows.count = 0;
        this.shadows.frustumCulled = false;
        this.group.add(this.shadows);
    }

    /** A model, loaded (a ball stands in till it is). */
    public async load(id: string): Promise<void> {
        if (!this.models.has(id)) this.models.set(id, posesOf(await ModelLoaderManager.instance.loadModel(`${MODELS}${id}.glb`)));
    }

    public spawn(spec: EnemySpec): Enemy {
        const enemy = new Enemy(spec);
        this.all.push(enemy);
        this.group.add(enemy.mesh);
        this.draw(enemy);
        return enemy;
    }

    public get alive(): Enemy[] {
        return this.all.filter((enemy) => enemy.alive);
    }

    /** The one at a spot on the screen (-1..1), or the nearest; and where on it, on the screen. */
    public pick(x: number, y: number, camera: THREE.PerspectiveCamera): { enemy: Enemy; x: number; y: number } | null {
        let best: { enemy: Enemy; x: number; y: number } | null = null;
        let nearest = Infinity;
        for (const enemy of this.alive) {
            const middle = enemy.middle(this.point).project(camera);
            const { x: mx, y: my } = middle;
            enemy.middle(this.edge).setY(this.edge.y + enemy.spec.height * 0.5).project(camera);
            const radius = Math.max(0.03, Math.abs(this.edge.y - my));
            const off = Math.hypot((x - mx) * camera.aspect, y - my) / radius;
            if (off >= nearest) continue;
            nearest = off;
            // (Off it: on its side nearest to the tap.)
            const k = off <= 0.85 ? 1 : 0.6 / off;
            best = { enemy, x: mx + (x - mx) * k, y: my + (y - my) * k };
        }
        return best;
    }

    /** One near x to be hit by the crew: where. */
    public target(x: number, out: THREE.Vector3): THREE.Vector3 | null {
        let best: Enemy | undefined;
        let nearest = Infinity;
        for (const enemy of this.alive) {
            const far = Math.abs(enemy.at.x - x) + Math.random();
            if (far < nearest) {
                nearest = far;
                best = enemy;
            }
        }
        if (!best) return null;
        best.middle(out);
        out.x += (Math.random() - 0.5) * best.spec.height * 0.3;
        out.y += (Math.random() - 0.6) * best.spec.height * 0.5;
        return out;
    }

    /** The one nearest to a point in the world. */
    public nearest(at: THREE.Vector3): Enemy | undefined {
        let best: Enemy | undefined;
        let nearest = Infinity;
        for (const enemy of this.alive) {
            const far = enemy.middle(this.point).distanceToSquared(at) - enemy.spec.height;
            if (far < nearest) {
                nearest = far;
                best = enemy;
            }
        }
        return best;
    }

    /** Hit: it flinches; true if that did for it. */
    public hit(enemy: Enemy, damage: number, strong: boolean): boolean {
        enemy.hp = Math.max(0, enemy.hp - damage);
        enemy.flash = FLASH_SEC;
        if (strong || enemy.squash <= 0) enemy.squash = 1;
        const push = enemy.spec.boss ? PUSH.boss : PUSH.minion;
        enemy.push = Math.min(PUSH.most, enemy.push + (strong ? push : push * 0.4));
        if (enemy.hp > 0) return false;
        enemy.phase = 'dying';
        enemy.time = 0;
        enemy.thrown.set((Math.random() - 0.5) * 5, 5 + Math.random() * 2, -7);
        return true;
    }

    /** All of them gone in a puff. */
    public leave(): void {
        for (const enemy of this.alive) {
            enemy.phase = 'leaving';
            enemy.time = 0;
        }
    }

    public clear(): void {
        for (const { mesh } of this.all) {
            mesh.removeFromParent();
            mesh.material.dispose();
        }
        this.all.length = 0;
        this.shadows.count = 0;
    }

    public update(delta: number): void {
        this.clock += delta;
        for (const enemy of this.all) this.step(enemy, delta);
        for (let i = this.all.length - 1; i >= 0; i--) {
            if (this.all[i].phase !== 'gone') continue;
            this.all[i].mesh.removeFromParent();
            this.all[i].mesh.material.dispose();
            this.all.splice(i, 1);
        }
        let count = 0;
        for (const enemy of this.all) {
            if (!enemy.alive || count >= 12) continue;
            const size = enemy.spec.height * 0.85;
            this.matrix.makeScale(size, 1, size).setPosition(enemy.at.x, 0.02, enemy.at.z);
            this.shadows.setMatrixAt(count++, this.matrix);
        }
        this.shadows.count = count;
        this.shadows.instanceMatrix.needsUpdate = true;
    }

    private step(enemy: Enemy, delta: number): void {
        const { spec, mesh } = enemy;
        enemy.time += delta;
        enemy.flash = Math.max(0, enemy.flash - delta);
        enemy.squash = Math.max(0, enemy.squash - delta * 5);
        enemy.push *= Math.exp(-delta * PUSH.back);
        const floats = spec.float ? spec.height * (spec.float + 0.08 * Math.sin(this.clock * 2.6 + enemy.own * 6)) : 0;
        let scale = 1;
        let spin = 0;
        switch (enemy.phase) {
            case 'in': {
                const t = Math.min(1, enemy.time / (spec.boss ? IN.boss : IN.minion));
                enemy.at.copy(spec.home);
                enemy.at.z = FROM_Z + (spec.home.z - FROM_Z) * t * (2 - t);
                enemy.at.y = floats + Math.abs(Math.sin(enemy.time * 9)) * 0.06 * spec.height * (spec.float ? 0 : 1);
                if (t >= 1) {
                    enemy.phase = 'idle';
                    enemy.squash = 1;
                }
                break;
            }
            case 'idle': {
                enemy.nextLunge -= delta;
                if (enemy.nextLunge <= 0) {
                    enemy.nextLunge = LUNGE.least + Math.random() * LUNGE.more;
                    enemy.lunge = 1;
                }
                enemy.lunge = Math.max(0, enemy.lunge - delta / LUNGE.seconds);
                const hop = Math.sin(enemy.lunge * Math.PI);
                enemy.at.copy(spec.home);
                enemy.at.z += hop * LUNGE.far * (spec.boss ? 0.6 : 1) - enemy.push;
                enemy.at.x += Math.sin(this.clock * 1.3 + enemy.own * 9) * 0.08;
                enemy.at.y = floats + hop * 0.16 * spec.height * (spec.boss ? 0.4 : 1);
                break;
            }
            case 'dying': {
                const t = enemy.time / DIE_SEC;
                enemy.at.addScaledVector(enemy.thrown, delta);
                enemy.thrown.y -= 16 * delta;
                spin = t * 7;
                scale = Math.max(0.01, 1 - t * t);
                if (t >= 1) enemy.phase = 'gone';
                break;
            }
            case 'leaving': {
                const t = enemy.time / LEAVE_SEC;
                scale = Math.max(0.01, 1 - t);
                spin = t * 4;
                if (t >= 1) enemy.phase = 'gone';
                break;
            }
            default:
                break;
        }
        this.draw(enemy);
        const squash = Math.sin(enemy.squash * Math.PI) * (spec.boss ? 0.1 : 0.22);
        const size = spec.height * scale;
        mesh.position.copy(enemy.at);
        mesh.rotation.set(enemy.phase === 'dying' ? -spin : -enemy.push * 0.35, enemy.phase === 'leaving' ? spin : Math.sin(this.clock * 1.1 + enemy.own * 7) * 0.12, 0);
        mesh.scale.set(size * (1 + squash * 0.7), size * (1 - squash), size * (1 + squash * 0.7));
        const glow = (enemy.flash / FLASH_SEC) * 0.85;
        mesh.material.emissive.setRGB(glow, glow * 0.9, glow * 0.85);
    }

    /** A model, in a coat if it has one (made once). */
    private painted(id: string, coat?: Coat): Poses | undefined {
        const plain = this.models.get(id);
        if (!plain || !coat) return plain;
        const key = `${id} ${coat.how} ${coat.hue} ${coat.dark}`;
        let made = this.models.get(key);
        if (!made) {
            made = repaint(plain, coat);
            this.models.set(key, made);
        }
        return made;
    }

    /** The pose of its walk it's at. */
    private draw(enemy: Enemy): void {
        const model = this.painted(enemy.spec.model, enemy.spec.coat);
        if (!model) return;
        const { mesh } = enemy;
        if (enemy.shownAs !== enemy.spec.model) {
            enemy.shownAs = enemy.spec.model;
            mesh.material.map = model.map;
            mesh.material.vertexColors = !model.map;
            mesh.material.needsUpdate = true;
        }
        const pace = (enemy.spec.pace ?? 1) * (enemy.phase === 'in' ? 1.5 : 0.55);
        mesh.geometry = model.poses[Math.floor((this.clock * pace + enemy.own) * model.poses.length) % model.poses.length];
    }
}

const hsl = { h: 0, s: 0, l: 0 };

/** Bone: a light, warm, not very vivid colour (armour's grey, leather's dark). */
const isBone = ({ h, s, l }: typeof hsl): boolean => h > 0.045 && h < 0.13 && s > 0.3 && s < 0.8 && l > 0.54;

/** Poses in a coat: only the bones in its hue, or every colour turned round by as much (what was grey stays grey). */
function repaint({ poses, map }: Poses, coat: Coat): Poses {
    const own = new THREE.Color();
    const turn = (coat.hue - coat.base) / 360;
    return {
        map,
        poses: poses.map((pose) => {
            const color = pose.attributes.color as THREE.BufferAttribute | undefined;
            if (!color) return pose;
            const painted = new Float32Array(color.count * 3);
            for (let i = 0; i < color.count; i++) {
                own.fromBufferAttribute(color, i).getHSL(hsl, THREE.SRGBColorSpace);
                if (coat.how === 'bone') {
                    // (Less white than bone, so it's seen.)
                    if (isBone(hsl)) own.setHSL(coat.hue / 360, 0.78, hsl.l * 0.8 * coat.dark, THREE.SRGBColorSpace);
                } else {
                    const vivid = coat.sat > 0 ? Math.max(hsl.s, coat.sat) : hsl.s;
                    own.setHSL((((hsl.h + turn) % 1) + 1) % 1, vivid * (coat.dark < 1 ? 0.6 : 1), hsl.l * coat.dark, THREE.SRGBColorSpace);
                }
                own.toArray(painted, i * 3);
            }
            const made = pose.clone();
            made.setAttribute('color', new THREE.BufferAttribute(painted, 3));
            return made;
        }),
    };
}

/** A mesh as it stands, its positions floats (they're packed small in the file, and unpacked by where its node is), lit. */
function plain(mesh: THREE.Mesh): THREE.BufferGeometry {
    const geometry = mesh.geometry.clone();
    const { position } = geometry.attributes;
    mesh.updateWorldMatrix(true, false);
    const at = new Float32Array(position.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).toArray(at, i * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(at, 3));
    geometry.computeVertexNormals();
    return geometry;
}

/** A model's poses in order, lit, and its texture if its colours are there. */
function posesOf(model: THREE.Object3D): Poses {
    const found: { n: number; geometry: THREE.BufferGeometry; map: THREE.Texture | null }[] = [];
    model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const geometry = plain(mesh);
        found.push({ n: Number(/(\d+)/.exec(mesh.name || mesh.parent?.name || '')?.[1] ?? found.length), geometry, map: (mesh.material as THREE.MeshStandardMaterial).map ?? null });
    });
    found.sort((a, b) => a.n - b.n);
    if (!found.length) throw new Error('no poses');
    return { poses: found.map(({ geometry }) => geometry), map: found[0].map };
}
