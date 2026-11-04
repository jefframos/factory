// Saucer.ts
//
// The player: the UFO model (tools/build-saucer.mjs: its disc's radius is 1, its lowest point at 0, its front +Z) and its
// beam (TractorBeam.ts). It turns to face where it's going. Its radius is how much fits under it, and sets how high it
// flies. It slides round whatever is too tall to fly over, and only goes so far out over the water.
//
// What it looks like comes from ui/saucers.json (the editor's Hangar tab): a UFO style (a skin over the maps they all
// share, a dome colour, attachments) and an alien in the dome. The alien stays turned to the camera, which is mostly
// behind the saucer, leaning into its way; pupils (`look`) swing about with its movement. A plate and a cylinder stand in
// until the model's loaded, or if it can't be.

import * as THREE from 'three';
import { Piece, buildPiece, freePiece, placePiece } from 'core/pieces/Pieces';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { createGLTFLoader } from 'core/three/GLTFLoaders';
import { MODEL_BASE, SAUCER, SAUCER_TEXTURE_BASE, UFO, altitudeFor, currentAlien, currentUfo } from '../data/UfoConfig';
import { bendObject } from '../services/Bend';
import type { Blocker, UfoTown } from '../world/UfoTown';
import { TractorBeam } from './TractorBeam';

const PLATE_THICKNESS = 0.16;
const CYLINDER = { radius: 0.36, height: 0.42 };
const TILT = 0.28;
const TILT_SPEED = 6;
const BOB = { height: 0.05, speed: 2.6 };
/** In radii, from its lowest point: where the hull's underside starts (the beam reaches up to it), and its dome's top. */
const BELLY = 0.26;
/** How fast it turns to face its way, and the slowest it bothers. */
const FACE_SPEED = 5;
const FACE_MIN_SPEED = 1.5;
const GLASS_ROUGHNESS = 0.15;
/** How far the alien turns towards its way at full speed (radians). */
const ALIEN_LEAN = 0.6;
/** Googly pupils: a spring (stiffness, damping), and how hard the saucer's acceleration swings them. */
const GOOGLY = { stiffness: 70, damping: 7, swing: 0.5 };
/** The dome lighting up while it's eating: its light's colour, how bright at rest and at most, how fast it comes on and dies. */
const DOME_LIGHT = { color: 0xffd23f, rest: 0.08, full: 1.5, on: 12, off: 2.5 };
/** A bite's swell: how much bigger at most, how fast it swells towards that, how fast that dies away. */
const SWELL = { amount: 0.035, rise: 14, fall: 5 };
/**
 * Hitting something too tall: how much speed it comes back with, the slowest hit that bounces, how long it won't steer
 * after one (so the bounce shows, even holding the stick into the wall), and how long until it can bounce again.
 */
const BOUNCE = { restitution: 0.7, minSpeed: 2, stunSeconds: 0.22, cooldownSeconds: 0.6 };

const textureLoader = new THREE.TextureLoader();
const textures = new Map<string, Promise<THREE.Texture>>();

/** One of its textures, loaded once. Laid out as glTF expects (V down the image), so not flipped. */
function saucerTexture(name: string, color: boolean): Promise<THREE.Texture> {
    let texture = textures.get(name);
    if (!texture) {
        texture = textureLoader.loadAsync(`${SAUCER_TEXTURE_BASE}${name}.webp`).then((loaded) => {
            loaded.flipY = false;
            loaded.anisotropy = 4;
            if (color) loaded.colorSpace = THREE.SRGBColorSpace;
            return loaded;
        });
        textures.set(name, texture);
    }
    return texture;
}

/** The model with its shared maps on. Loaded once: PLAY AGAIN reuses it. */
let model: Promise<{ scene: THREE.Object3D; body: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial | null }> | null = null;

function loadModel(): NonNullable<typeof model> {
    model ??= (async () => {
        const [gltf, normal, orm, emissive] = await Promise.all([
            createGLTFLoader().loadAsync(`${MODEL_BASE}${SAUCER.model}`),
            saucerTexture('saucer-normal', false),
            saucerTexture('saucer-orm', false),
            saucerTexture('saucer-emissive', true),
        ]);
        let body: THREE.MeshStandardMaterial | null = null;
        let glass: THREE.MeshStandardMaterial | null = null;
        gltf.scene.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            const material = child.material as THREE.MeshStandardMaterial;
            if (material.name === 'Glass') {
                material.transparent = true;
                material.roughness = GLASS_ROUGHNESS;
                material.metalness = 0;
                material.emissive.setHex(DOME_LIGHT.color);
                material.emissiveIntensity = DOME_LIGHT.rest;
                glass = material;
                return;
            }
            body = material;
            material.normalMap = normal;
            material.aoMap = orm;
            material.roughnessMap = orm;
            material.metalnessMap = orm;
            material.roughness = 1;
            material.metalness = 1;
            material.emissiveMap = emissive;
            material.emissive.setHex(0xffffff);
            material.needsUpdate = true;
        });
        if (!body) throw new Error('The saucer has no body material');
        return { scene: gltf.scene, body, glass };
    })();
    return model;
}

export class Saucer {
    private readonly body = new THREE.Group();
    /** Inside the body (which leans): the model, turned to face its way. */
    private readonly heading = new THREE.Group();
    private readonly standIn = new THREE.Group();
    private hull: THREE.MeshStandardMaterial | null = null;
    private dome: THREE.MeshStandardMaterial | null = null;
    private domeLight = 0;
    /** The attachments, on the heading; the alien on a seat that keeps it turned to the camera. */
    private readonly attachments = new THREE.Group();
    private readonly alienTurn = new THREE.Group();
    private readonly seat = new THREE.Group();
    private readonly alienRoot = new THREE.Group();
    private guns: THREE.Object3D | null = null;
    private built: { object: THREE.Object3D; piece: Piece }[] = [];
    private lookToken = 0;
    /** Googly pupils, how far they've swung (-1..1 each way), and the speed of that. */
    private pupils: { object: THREE.Object3D; piece: Piece }[] = [];
    private readonly swing = new THREE.Vector2();
    private readonly swingSpeed = new THREE.Vector2();
    private readonly lastVelocity = new THREE.Vector2();
    private destroyed = false;
    private readonly beam: TractorBeam;
    private readonly velocity = new THREE.Vector2();
    private readonly materials: THREE.Material[];
    private readonly geometries: THREE.BufferGeometry[];
    private time = 0;
    private sucking = false;
    private warning = false;
    /** A bite's swell: where it's heading (dropping back to 0), and where it is (following that smoothly). */
    private swellGoal = 0;
    private swell = 0;
    private stun = 0;
    private bounceCooldown = 0;
    /** Where it is on the ground. */
    public readonly position = new THREE.Vector2();
    /** What it has grown to, and what it's easing there on. */
    public targetRadius = UFO.startRadius;
    public radius = UFO.startRadius;
    public altitude = altitudeFor(UFO.startRadius);
    /** The tall thing it pushed into this frame, if any. */
    public bumped: Blocker | null = null;

    public constructor(threeScene: THREE.Scene, x: number, z: number) {
        this.position.set(x, z);
        const hull = new THREE.MeshStandardMaterial({ color: 0xc9d3dc, metalness: 0.55, roughness: 0.35 });
        const glass = new THREE.MeshStandardMaterial({ color: 0x59e6c8, emissive: 0x1a8f7a, roughness: 0.3 });
        const plateGeometry = new THREE.CylinderGeometry(1, 0.82, PLATE_THICKNESS, 48);
        const cylinderGeometry = new THREE.CylinderGeometry(CYLINDER.radius, CYLINDER.radius, CYLINDER.height, 32);
        const plate = new THREE.Mesh(plateGeometry, hull);
        plate.position.y = PLATE_THICKNESS / 2;
        const cylinder = new THREE.Mesh(cylinderGeometry, glass);
        cylinder.position.y = PLATE_THICKNESS + CYLINDER.height / 2;
        this.standIn.add(plate, cylinder);
        this.body.add(this.standIn, this.heading);
        this.seat.add(this.alienRoot);
        this.alienTurn.add(this.seat);
        this.heading.add(this.attachments, this.alienTurn);

        bendObject(this.body, false);
        threeScene.add(this.body);
        void this.loadHull();
        this.beam = new TractorBeam(threeScene);
        this.materials = [hull, glass];
        this.geometries = [plateGeometry, cylinderGeometry];
    }

    private async loadHull(): Promise<void> {
        try {
            const { scene, body, glass } = await loadModel();
            if (this.destroyed) return;
            this.hull = body;
            this.dome = glass;
            await this.applyLook();
            if (this.destroyed) return;
            const hull = scene.clone(true);
            bendObject(hull, false);
            this.guns = hull.getObjectByName('guns') ?? null;
            if (this.guns) this.guns.visible = currentUfo().guns === true;
            this.heading.add(hull);
            this.standIn.visible = false;
        } catch (error) {
            console.warn('[Saucer] could not load the model: keeping the stand-in', error);
        }
    }

    /** Puts on the style and the alien chosen (LOOKS: currentUfo(), currentAlien()). */
    public async applyLook(): Promise<void> {
        const token = ++this.lookToken;
        const ufo = currentUfo();
        const alien = currentAlien();
        const load = async (path: string) => ModelLoaderManager.instance.loadModel(`${MODEL_BASE}${path}`);
        const make = async (pieces: Piece[], parent: THREE.Object3D) => Promise.all(pieces.map(async (piece) => {
            const object = await buildPiece(piece, load);
            return object ? { object, piece, parent } : null;
        }));
        const [texture, onUfo, onAlien] = await Promise.all([saucerTexture(ufo.skin, true), make(ufo.pieces, this.attachments), make(alien.pieces, this.alienRoot)]);
        const next = [...onUfo, ...onAlien].filter((entry): entry is NonNullable<typeof entry> => !!entry);
        if (this.destroyed || token !== this.lookToken) {
            next.forEach(({ object, piece }) => freePiece(object, piece));
            return;
        }
        if (this.hull) {
            this.hull.map = texture;
            this.hull.needsUpdate = true;
        }
        if (this.dome) {
            this.dome.color.set(ufo.domeColor);
            this.dome.opacity = ufo.domeOpacity;
        }
        if (this.guns) this.guns.visible = ufo.guns === true;
        placePiece(this.seat, ufo.seat);
        if (alien.root) placePiece(this.alienRoot, alien.root);
        else this.alienRoot.scale.setScalar(1);
        this.clearLook();
        for (const { object, parent } of next) {
            bendObject(object, false);
            parent.add(object);
        }
        this.built = next;
        this.pupils = next.filter(({ piece }) => piece.look);
    }

    private clearLook(): void {
        this.built.forEach(({ object, piece }) => {
            object.removeFromParent();
            freePiece(object, piece);
        });
        this.built = [];
        this.pupils = [];
    }

    /** Pupils lag behind the saucer's movement, and swing back. */
    private updatePupils(delta: number): void {
        const ax = (this.velocity.x - this.lastVelocity.x) / Math.max(delta, 1e-3);
        const az = (this.velocity.y - this.lastVelocity.y) / Math.max(delta, 1e-3);
        this.lastVelocity.copy(this.velocity);
        const { swing, swingSpeed } = this;
        swingSpeed.x += (-GOOGLY.stiffness * swing.x - GOOGLY.damping * swingSpeed.x - ax * GOOGLY.swing) * delta;
        swingSpeed.y += (-GOOGLY.stiffness * swing.y - GOOGLY.damping * swingSpeed.y + az * GOOGLY.swing) * delta;
        swing.x = THREE.MathUtils.clamp(swing.x + swingSpeed.x * delta, -1, 1);
        swing.y = THREE.MathUtils.clamp(swing.y + swingSpeed.y * delta, -1, 1);
        for (const { object, piece } of this.pupils) {
            object.position.x = piece.x + swing.x * (piece.look ?? 0);
            object.position.y = piece.y + swing.y * (piece.look ?? 0);
        }
    }

    /** How fast it's going, as a share of its top speed (0..1). */
    public get speedShare(): number {
        return Math.min(1, this.velocity.length() / (UFO.speed + UFO.speedPerRadius * this.radius));
    }

    /** Where it hangs (its lowest point). */
    public worldPosition(out: THREE.Vector3): THREE.Vector3 {
        return out.set(this.position.x, this.altitude, this.position.y);
    }

    public grow(amount: number): void {
        this.targetRadius = Math.sqrt(this.targetRadius * this.targetRadius + UFO.growth * amount);
        this.swellGoal = 1;
        this.domeLight = 1;
    }

    /** It's trying for something too big: its beam shows it (call it each frame that's so). */
    public warn(): void {
        this.warning = true;
    }

    /** Whether something's on its way up the beam right now. */
    public setSucking(on: boolean): void {
        this.sucking = on;
    }

    /** One step along `input` (x, z; length 0..1), kept out of what it can't fly over and from flying too far out to sea. */
    public move(input: THREE.Vector2, delta: number, town: UfoTown): void {
        this.radius += (this.targetRadius - this.radius) * Math.min(1, delta * UFO.growSpeed);
        this.altitude = altitudeFor(this.radius);
        const speed = UFO.speed + UFO.speedPerRadius * this.radius;
        const ease = Math.min(1, delta * UFO.accel);
        this.stun = Math.max(0, this.stun - delta);
        this.bounceCooldown = Math.max(0, this.bounceCooldown - delta);
        const steering = this.stun > 0 ? 0 : speed;
        this.velocity.x += (input.x * steering - this.velocity.x) * ease;
        this.velocity.y += (input.y * steering - this.velocity.y) * ease;
        const { position, velocity } = this;
        // Per axis, so it slides along the limit.
        const nextX = position.x + velocity.x * delta;
        if (town.canFlyTo(nextX, position.y)) position.x = nextX;
        else velocity.x = 0;
        const nextZ = position.y + velocity.y * delta;
        if (town.canFlyTo(position.x, nextZ)) position.y = nextZ;
        else velocity.y = 0;
        // Never pushed past the limit: it stays, overlapping, until it moves away or grows over the thing.
        const { x, y } = position;
        this.resolveBlockers(town.blockers);
        if (!town.canFlyTo(position.x, position.y)) position.set(x, y);
    }

    /** Out of every box too tall to fly over (it can also grow into one: the same push). */
    private resolveBlockers(blockers: readonly Blocker[]): void {
        const reach = this.radius * UFO.collideShare;
        const { position } = this;
        this.bumped = null;
        for (const box of blockers) {
            if (box.height <= this.altitude) continue;
            const dx = position.x - box.x;
            const dz = position.y - box.z;
            const nearX = Math.max(-box.halfX, Math.min(box.halfX, dx));
            const nearZ = Math.max(-box.halfZ, Math.min(box.halfZ, dz));
            const awayX = dx - nearX;
            const awayZ = dz - nearZ;
            const away = Math.hypot(awayX, awayZ);
            if (away >= reach) continue;
            if (away > 1e-5) {
                position.x += (awayX / away) * (reach - away);
                position.y += (awayZ / away) * (reach - away);
                this.hit(awayX / away, awayZ / away);
            } else if (box.halfX - Math.abs(dx) < box.halfZ - Math.abs(dz)) {
                // Its middle is inside the box: out by the nearest side.
                position.x = box.x + Math.sign(dx || 1) * (box.halfX + reach);
                this.hit(Math.sign(dx || 1), 0);
            } else {
                position.y = box.z + Math.sign(dz || 1) * (box.halfZ + reach);
                this.hit(0, Math.sign(dz || 1));
            }
            this.bumped = box;
        }
    }

    /** Pushed out along (x, z): a good knock bounces back off it; anything else just stops going that way (it slides). */
    private hit(x: number, z: number): void {
        const into = this.velocity.x * x + this.velocity.y * z;
        if (into >= 0) return;
        const bounces = -into >= BOUNCE.minSpeed && this.bounceCooldown <= 0;
        const change = into * (bounces ? 1 + BOUNCE.restitution : 1);
        this.velocity.x -= change * x;
        this.velocity.y -= change * z;
        if (!bounces) return;
        this.stun = BOUNCE.stunSeconds;
        this.bounceCooldown = BOUNCE.cooldownSeconds;
    }

    public update(delta: number): void {
        this.time += delta;
        this.swellGoal = Math.max(0, this.swellGoal - delta * SWELL.fall);
        this.swell += (this.swellGoal - this.swell) * Math.min(1, delta * SWELL.rise);
        // On while something's coming up, dying away after.
        const lit = this.sucking ? 1 : 0;
        this.domeLight += (lit - this.domeLight) * Math.min(1, delta * (lit > this.domeLight ? DOME_LIGHT.on : DOME_LIGHT.off));
        if (this.dome) this.dome.emissiveIntensity = DOME_LIGHT.rest + (DOME_LIGHT.full - DOME_LIGHT.rest) * this.domeLight;
        const { radius, altitude, position } = this;
        const y = altitude + Math.sin(this.time * BOB.speed) * BOB.height * radius;
        this.body.position.set(position.x, y, position.y);
        this.body.scale.setScalar(radius * (1 + this.swell * SWELL.amount));
        // Leaning into where it's going.
        const speed = UFO.speed + UFO.speedPerRadius * radius;
        const ease = Math.min(1, delta * TILT_SPEED);
        this.body.rotation.x += ((this.velocity.y / speed) * TILT - this.body.rotation.x) * ease;
        this.body.rotation.z += ((-this.velocity.x / speed) * TILT - this.body.rotation.z) * ease;
        if (this.velocity.length() > FACE_MIN_SPEED) {
            const goal = Math.atan2(this.velocity.x, this.velocity.y);
            const difference = Math.atan2(Math.sin(goal - this.heading.rotation.y), Math.cos(goal - this.heading.rotation.y));
            this.heading.rotation.y += difference * Math.min(1, delta * FACE_SPEED);
        }
        // Whichever way the ship faces, the alien faces the camera, leaning into where it's going.
        this.alienTurn.rotation.y = -this.heading.rotation.y + (this.velocity.x / speed) * ALIEN_LEAN;
        this.updatePupils(delta);

        this.beam.update(delta, position.x, position.y, radius, altitude + BELLY * radius, Math.min(1, this.velocity.length() / speed), this.sucking ? 1 : 0, this.warning);
        this.warning = false;
    }

    public destroy(): void {
        this.destroyed = true;
        this.clearLook();
        this.body.removeFromParent();
        this.beam.destroy();
        this.materials.forEach((material) => material.dispose());
        this.geometries.forEach((geometry) => geometry.dispose());
    }
}
