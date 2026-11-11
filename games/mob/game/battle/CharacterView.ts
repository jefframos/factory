// CharacterView.ts
//
// Draws the card units that have a character of their own (Battle LOOK: the skeleton minions and warriors, models from
// library3d's character packs, built by tools/build-characters.mjs into public/mob/models/characters/), the way the
// crowd draws its mobs (CrowdView): the run cycle baked once into FRAMES poses, each pose one InstancedMesh, a unit
// drawn by the pose its own point in the cycle is at. Under each, a ring in its team's colour (the models keep their
// own colours: the ring says whose they are).
//
// Loaded only when needed: a battle asks for the looks its cards (the player's, an arena opponent's) can make (need()),
// before it's shown (the transition waits for it); nothing's fetched for a battle with none. Each look's poses are
// baked once and kept (the next battle with it starts at once).
//
// The models come in parts (arms, legs, head, cloak... skinned to one skeleton; a helmet on the head bone). Each pose
// merges them into one mesh, every vertex coloured from the texture where its UV falls (the packs' textures are
// palettes of flat swatches), so a pose is one plain vertex-coloured mesh, like the mob's.

import * as THREE from 'three';
import { createGLTFLoader } from 'core/three/GLTFLoaders';
import { COLORS, TUNING } from '../data/MobConfig';
import { applyBend } from '../services/Bend';
import { BLUE, Battle, LOOK, turtleWalking } from './Battle';

const BASE = './mob/models/characters/';
/** Poses of the run baked, and how many cycles a unit of speed makes. */
const FRAMES = 10;
const CYCLES_PER_UNIT = 0.5;
/** A new one pops in over this long, from this share of its size (as the crowd's). */
const POP_SECONDS = 0.18;
const POP_FROM = 0.3;
/**
 * Each look: its model, its rig's clips (the run first found) — or `baked` (its poses made by the build: the FBX ones,
 * pose_0..pose_N) — its height (x TUNING.mobHeight), how many at once, and how fast its cycle goes (cycles a unit of
 * speed, x CYCLES_PER_UNIT).
 */
const LOOKS: Record<number, { model: string; rig?: string; clips?: string[]; baked?: boolean; float?: { height: number; bob: number; speed: number; tilt: number }; height: number; capacity: number; pace: number }> = {
    1: { model: 'skeleton-minion', rig: 'rig-medium', clips: ['Running_A', 'Walking_A'], height: 0.95, capacity: 160, pace: 1.8 },
    2: { model: 'skeleton-warrior', rig: 'rig-medium', clips: ['Running_A', 'Walking_A'], height: 1.4, capacity: 40, pace: 1.5 },
    3: { model: 'golem', baked: true, height: 2.2, capacity: 16, pace: 1.1 },
    // The bomb floats (no run): this high off the ground (x its height), bobbing up and down, rocking a little.
    4: { model: 'stone-monster', baked: true, float: { height: 0.35, bob: 0.12, speed: 5, tilt: 0.12 }, height: 0.95, capacity: 24, pace: 1 },
    // The bats fly high over the field; the turtle walks (its own clip), holding still while it stops.
    5: { model: 'bat', baked: true, float: { height: 4.5, bob: 0.5, speed: 7, tilt: 0.25 }, height: 0.3, capacity: 120, pace: 1 },
    6: { model: 'turtle', baked: true, height: 0.7, capacity: 20, pace: 1.4 },
};
/** The team ring under each: its inner and outer radius (x its height), how high over the ground, how opaque. */
const RING = { inner: 0.24, outer: 0.34, y: 0.04, opacity: 0.9, capacity: 220 };

/** A look's poses, and its texture (the textured ones': else their colours are in the vertices). */
interface Poses { poses: THREE.BufferGeometry[]; map: THREE.Texture | null }
/** A look's baked poses (shared by every battle once made). */
const baked = new Map<number, Promise<Poses | null>>();

/** A texture's pixels, to sample colours from. */
function pixelsOf(texture: THREE.Texture | null): { data: Uint8ClampedArray; width: number; height: number } | null {
    const image = texture?.image as CanvasImageSource & { width: number; height: number } | undefined;
    if (!image || !image.width) return null;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0);
    return { data: context.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height };
}

/** A look baked by the build (tools/bake-characters.mjs): its poses pose_0.., each a vertex-coloured mesh, fitted. */
async function loadBaked(model: string): Promise<Poses> {
    const gltf = await createGLTFLoader().loadAsync(`${BASE}${model}.glb`);
    gltf.scene.updateMatrixWorld(true);
    const poses: THREE.BufferGeometry[] = [];
    let map: THREE.Texture | null = null;
    for (let f = 0; f < FRAMES; f++) {
        const mesh = gltf.scene.getObjectByName(`pose_${f}`) as THREE.Mesh | undefined;
        const found = mesh?.isMesh ? mesh : (mesh?.children.find((child) => (child as THREE.Mesh).isMesh) as THREE.Mesh | undefined);
        if (!found) break;
        map ??= (found.material as THREE.MeshStandardMaterial).map ?? null;
        // (Its node's transform holds the compression's scale: put into the vertices.)
        const geometry = found.geometry.clone().applyMatrix4(found.matrixWorld);
        geometry.computeVertexNormals();
        poses.push(geometry);
    }
    if (!poses.length) throw new Error(`${model}.glb has no poses`);
    return { poses, map };
}

/** Loads a look's model and its rig's clips, and bakes its run into FRAMES merged, vertex-coloured poses. */
async function bake(look: number): Promise<Poses | null> {
    const spec = LOOKS[look];
    if (!spec) return null;
    const loader = createGLTFLoader();
    if (spec.baked) return loadBaked(spec.model);
    const [model, rig] = await Promise.all([loader.loadAsync(`${BASE}${spec.model}.glb`), loader.loadAsync(`${BASE}${spec.rig}.glb`)]);
    const clip = (spec.clips ?? []).map((name) => rig.animations.find((a) => a.name === name)).find(Boolean);
    if (!clip) throw new Error(`${spec.rig}.glb has no run clip`);
    const root = model.scene;
    const parts: { mesh: THREE.Mesh; colors: Float32Array }[] = [];
    const sampled = new Map<THREE.Texture, ReturnType<typeof pixelsOf>>();
    root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
        const position = mesh.geometry.getAttribute('position');
        const uv = mesh.geometry.getAttribute('uv');
        const map = material.map ?? null;
        if (map && !sampled.has(map)) sampled.set(map, pixelsOf(map));
        const pixels = map ? sampled.get(map) : null;
        // Each vertex's colour: the texture where its UV falls (glTF's UVs: v down), else the material's own (the eyes'
        // glow: its emissive, if brighter).
        const colors = new Float32Array(position.count * 3);
        const own = material.color?.clone() ?? new THREE.Color(1, 1, 1);
        if (material.emissive && material.emissive.getHex() > own.getHex()) own.copy(material.emissive);
        const color = new THREE.Color();
        for (let i = 0; i < position.count; i++) {
            if (pixels && uv) {
                const u = THREE.MathUtils.euclideanModulo(uv.getX(i), 1);
                const v = THREE.MathUtils.euclideanModulo(uv.getY(i), 1);
                const px = Math.min(pixels.width - 1, Math.floor(u * pixels.width));
                const py = Math.min(pixels.height - 1, Math.floor(v * pixels.height));
                const k = (py * pixels.width + px) * 4;
                color.setRGB(pixels.data[k] / 255, pixels.data[k + 1] / 255, pixels.data[k + 2] / 255, THREE.SRGBColorSpace);
                color.multiply(own);
            } else color.copy(own);
            colors.set([color.r, color.g, color.b], i * 3);
        }
        parts.push({ mesh, colors });
    });
    if (!parts.length) throw new Error(`${spec.model}.glb has no mesh`);
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clip).play();
    const vertex = new THREE.Vector3();
    const poses: THREE.BufferGeometry[] = [];
    let fit: { scale: number; x: number; y: number; z: number } | null = null;
    for (let f = 0; f < FRAMES; f++) {
        mixer.setTime((f / FRAMES) * clip.duration);
        root.updateMatrixWorld(true);
        const positions: number[] = [];
        const colors: number[] = [];
        const indices: number[] = [];
        for (const { mesh, colors: own } of parts) {
            const skinned = mesh as THREE.SkinnedMesh;
            if (skinned.isSkinnedMesh) skinned.skeleton.update();
            const position = mesh.geometry.getAttribute('position');
            const offset = positions.length / 3;
            for (let i = 0; i < position.count; i++) {
                if (skinned.isSkinnedMesh) skinned.getVertexPosition(i, vertex);
                else vertex.fromBufferAttribute(position, i);
                vertex.applyMatrix4(mesh.matrixWorld);
                positions.push(vertex.x, vertex.y, vertex.z);
            }
            for (let i = 0; i < own.length; i++) colors.push(own[i]);
            const index = mesh.geometry.getIndex();
            if (index) for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + offset);
            else for (let i = 0; i < position.count; i++) indices.push(i + offset);
        }
        const array = new Float32Array(positions);
        // Fitted from the first pose: unit height, feet on the ground, centred.
        if (!fit) {
            const box = new THREE.Box3().setFromArray(array);
            fit = { scale: 1 / Math.max(0.01, box.max.y - box.min.y), x: (box.min.x + box.max.x) / 2, y: box.min.y, z: (box.min.z + box.max.z) / 2 };
        }
        for (let i = 0; i < array.length; i += 3) {
            array[i] = (array[i] - fit.x) * fit.scale;
            array[i + 1] = (array[i + 1] - fit.y) * fit.scale;
            array[i + 2] = (array[i + 2] - fit.z) * fit.scale;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(array, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        poses.push(geometry);
    }
    mixer.stopAllAction();
    return { poses, map: null };
}

export class CharacterView {
    public readonly group = new THREE.Group();
    private readonly sets = new Map<number, THREE.InstancedMesh[]>();
    private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
    private readonly ring: THREE.InstancedMesh;
    private readonly blue = new THREE.Color(COLORS.blue);
    private readonly red = new THREE.Color(COLORS.red);
    private readonly matrix = new THREE.Matrix4();
    private readonly position = new THREE.Vector3();
    private readonly rotation = new THREE.Quaternion();
    private readonly scale = new THREE.Vector3();
    private readonly up = new THREE.Vector3(0, 1, 0);
    private readonly flat = new THREE.Quaternion();
    private readonly tilt = new THREE.Quaternion();
    private readonly forwardAxis = new THREE.Vector3(0, 0, 1);

    public constructor() {
        applyBend(this.material);
        const ringMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: RING.opacity, depthWrite: false });
        applyBend(ringMaterial);
        const ringGeometry = new THREE.RingGeometry(RING.inner, RING.outer, 28).rotateX(-Math.PI / 2);
        this.ring = new THREE.InstancedMesh(ringGeometry, ringMaterial, RING.capacity);
        this.ring.count = 0;
        this.ring.frustumCulled = false;
        this.ring.renderOrder = 1;
        this.group.add(this.ring);
    }

    /**
     * The looks a battle can make (its cards'): loaded and baked (each once ever), their meshes made. Resolves when
     * they're ready (a look that fails to load is left out: its units just aren't drawn).
     */
    public async need(looks: readonly number[]): Promise<void> {
        await Promise.all([...new Set(looks)].filter((look) => LOOKS[look] && !this.sets.has(look)).map(async (look) => {
            let poses = baked.get(look);
            if (!poses) {
                poses = bake(look).catch((error) => {
                    console.warn('[mob] character', look, error);
                    baked.delete(look);
                    return null;
                });
                baked.set(look, poses);
            }
            const loaded = await poses;
            if (!loaded || this.sets.has(look)) return;
            // A textured one: its own material (its texture); else the shared vertex-coloured one.
            let material = this.material;
            if (loaded.map) {
                material = new THREE.MeshLambertMaterial({ map: loaded.map });
                applyBend(material);
            }
            const meshes = loaded.poses.map((geometry) => {
                const mesh = new THREE.InstancedMesh(geometry, material, LOOKS[look].capacity);
                mesh.count = 0;
                mesh.frustumCulled = false;
                this.group.add(mesh);
                return mesh;
            });
            this.sets.set(look, meshes);
        }));
    }

    /** Every live character into its pose, its ring under it. */
    public update(battle: Battle, time: number): void {
        for (const meshes of this.sets.values()) for (const mesh of meshes) mesh.count = 0;
        this.ring.count = 0;
        if (!this.sets.size) return;
        for (let i = 0; i < battle.count; i++) {
            const look = battle.look[i];
            if (!look) continue;
            const meshes = this.sets.get(look);
            if (!meshes) continue;
            const spec = LOOKS[look];
            const speed = battle.team[i] === BLUE ? TUNING.blueSpeed : TUNING.redSpeed;
            const cycle = (time * speed * CYCLES_PER_UNIT * spec.pace + battle.phase[i]) % 1;
            // A stopped turtle holds its first pose.
            const still = look === LOOK.turtle && !turtleWalking(battle.time, battle.phase[i]);
            const pose = still ? 0 : Math.min(meshes.length - 1, Math.floor(cycle * meshes.length));
            const mesh = meshes[pose];
            if (mesh.count >= spec.capacity) continue;
            const grow = battle.age[i] < POP_SECONDS ? POP_FROM + (1 - POP_FROM) * (battle.age[i] / POP_SECONDS) : 1;
            const leave = battle.leaving[i];
            const shrink = leave > 0 ? (leave < 0.3 ? 1 + leave : 1.3 * (1 - (leave - 0.3) / 0.7)) : 1;
            const height = grow * shrink * TUNING.mobHeight * spec.height;
            this.position.set(battle.x[i], 0, battle.z[i]);
            this.rotation.setFromAxisAngle(this.up, battle.heading[i] + Math.PI);
            if (spec.float) {
                // Floating: up off the ground, bobbing (each its own beat), rocking side to side.
                const beat = time * spec.float.speed + battle.phase[i] * Math.PI * 2;
                this.position.y = height * (spec.float.height + spec.float.bob * Math.sin(beat));
                this.tilt.setFromAxisAngle(this.forwardAxis, spec.float.tilt * Math.sin(beat * 0.5));
                this.rotation.multiply(this.tilt);
            }
            this.scale.setScalar(height);
            this.matrix.compose(this.position, this.rotation, this.scale);
            mesh.setMatrixAt(mesh.count++, this.matrix);
            // The ring: flat under it (on the ground, under a floating one too), in its team's colour.
            if (this.ring.count < RING.capacity) {
                this.position.y = RING.y;
                this.matrix.compose(this.position, this.flat, this.scale);
                this.ring.setMatrixAt(this.ring.count, this.matrix);
                this.ring.setColorAt(this.ring.count, battle.team[i] === BLUE ? this.blue : this.red);
                this.ring.count++;
            }
        }
        for (const meshes of this.sets.values()) for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
        this.ring.instanceMatrix.needsUpdate = true;
        if (this.ring.instanceColor) this.ring.instanceColor.needsUpdate = true;
    }
}

/** The looks the cards `kinds` make (the character cards': Battle CHARACTER_CARDS). */
export { LOOKS as CHARACTER_LOOKS };
