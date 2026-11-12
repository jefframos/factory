// Customers.ts
//
// A customer: one of the UFO game's people (a random model, dressed in random colours as UFO's are), walking in from the
// door to the counter, standing there while their order's made (idle), reacting to the dish (a happy hop, or a shake of
// the head) and walking out again. Walk and idle are the people's own clips, blended; the walk's played at the speed
// that keeps the feet from sliding.

import * as THREE from 'three';
import gsap from 'gsap';
import { personModel, PERSON_COUNT, PERSON_MODEL_HEIGHT } from './Models';
import { SETTINGS } from '../data/Settings';

/** Model colours: COLOR_0's alpha x PART_SCALE is the part; for a part, RGB x 2 is the shading on its colour. */
const PART_SCALE = 16;
const PALETTE = {
    skin: ['#ffe0c4', '#f7cba4', '#eab084', '#d09060', '#a86f45', '#7d4e30', '#5a3722'],
    top: ['#e8483f', '#f39a2d', '#f5d547', '#58b957', '#2fa8a0', '#3f86e0', '#7b5be0', '#e65fa8', '#f4f1ea', '#39414f'],
    bottom: ['#2f4a7a', '#4c6ea8', '#39414f', '#5b5148', '#8a7a5c', '#c9b48a', '#6c7d4e', '#7a3f3f'],
    shoes: ['#f4f1ea', '#2b2b2f', '#c0392b', '#2d6cc0', '#8a5a33', '#e6b422'],
    hair: ['#1f1a17', '#3a2a20', '#5e3c23', '#8f5a2c', '#d9b160', '#b5482a', '#9a9a9a'],
};
const PARTS: (keyof typeof PALETTE)[] = ['skin', 'top', 'bottom', 'shoes', 'hair'];
/** How far the walk clip carries a model of PERSON_MODEL_HEIGHT per second (feet don't slide at this pace). */
const CLIP_WALK_SPEED = 1.35;
const BLEND_SPEED = 6;
const TURN_SPEED = 8;

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

function dressed(source: THREE.BufferGeometry): THREE.BufferGeometry {
    const choice = PARTS.map((part) => new THREE.Color(pick(PALETTE[part])));
    const from = source.getAttribute('color');
    if (!from) return source;
    const colors = new Float32Array(from.count * 3);
    for (let i = 0; i < from.count; i++) {
        const part = Math.round(from.getW(i) * PART_SCALE);
        if (part === 0) colors.set([from.getX(i), from.getY(i), from.getZ(i)], i * 3);
        else {
            const shade = from.getX(i) * 2;
            const color = choice[part - 1];
            colors.set([color.r * shade, color.g * shade, color.b * shade], i * 3);
        }
    }
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(source.index);
    return geometry;
}

const angleTowards = (from: number, to: number, step: number): number => {
    const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + Math.sign(difference) * Math.min(Math.abs(difference), step);
};

export class Customer {
    public readonly root = new THREE.Group();
    private readonly body = new THREE.Group();
    private readonly mixer: THREE.AnimationMixer;
    private readonly walkAction: THREE.AnimationAction;
    private readonly idleAction: THREE.AnimationAction;
    private readonly geometries: THREE.BufferGeometry[] = [];
    private path: THREE.Vector3[] = [];
    private arrived: (() => void) | null = null;
    /** Which way they face once they stop (radians round y; null: as they came). */
    private faceAt: number | null = null;
    private walkWeight = 0;

    public constructor(parent: THREE.Object3D, at: THREE.Vector3) {
        const { model, walk, idle } = personModel(Math.floor(Math.random() * PERSON_COUNT));
        model.traverse((child) => {
            if (!(child instanceof THREE.SkinnedMesh)) return;
            child.geometry = dressed(child.geometry);
            this.geometries.push(child.geometry);
            child.castShadow = true;
            child.frustumCulled = false;
            for (const material of [child.material].flat()) material.vertexColors = true;
        });
        const scale = SETTINGS.customer.height / PERSON_MODEL_HEIGHT;
        this.body.scale.setScalar(scale);
        this.body.add(model);
        this.root.add(this.body);
        this.root.position.copy(at);
        parent.add(this.root);
        this.mixer = new THREE.AnimationMixer(model);
        this.walkAction = this.mixer.clipAction(walk);
        this.idleAction = this.mixer.clipAction(idle);
        this.walkAction.timeScale = SETTINGS.customer.walkSpeed / (CLIP_WALK_SPEED * scale);
        this.walkAction.setEffectiveWeight(0);
        this.idleAction.time = Math.random() * idle.duration;
        this.walkAction.play();
        this.idleAction.play();
    }

    /** The top of their head (world). */
    public get headTop(): THREE.Vector3 {
        return this.root.position.clone().add(new THREE.Vector3(0, SETTINGS.customer.height * 1.02, 0));
    }

    /** Walks through `points`; then turns to `face` (radians round y). */
    public walkTo(points: THREE.Vector3[], face: number | null = null): Promise<void> {
        this.path = points.map((p) => p.clone());
        this.faceAt = face;
        return new Promise((resolve) => (this.arrived = resolve));
    }

    /** A happy little hop (twice). */
    public cheer(): void {
        gsap.timeline()
            .to(this.body.position, { y: 0.35, duration: 0.18, ease: 'power2.out' })
            .to(this.body.position, { y: 0, duration: 0.2, ease: 'bounce.out' })
            .to(this.body.position, { y: 0.25, duration: 0.16, ease: 'power2.out' })
            .to(this.body.position, { y: 0, duration: 0.2, ease: 'bounce.out' });
    }

    /** A shake of the head (the whole body, a little). */
    public grumble(): void {
        const yaw = this.body.rotation.y;
        gsap.timeline()
            .to(this.body.rotation, { y: yaw + 0.35, duration: 0.1 })
            .to(this.body.rotation, { y: yaw - 0.35, duration: 0.16, repeat: 3, yoyo: true })
            .to(this.body.rotation, { y: yaw, duration: 0.1 });
    }

    public update(dt: number): void {
        const target = this.path[0];
        const moving = Boolean(target);
        if (target) {
            const to = target.clone().sub(this.root.position).setY(0);
            const distance = to.length();
            const step = SETTINGS.customer.walkSpeed * dt;
            if (distance <= step) {
                this.root.position.copy(target);
                this.path.shift();
            } else {
                this.root.position.addScaledVector(to.normalize(), step);
            }
            if (distance > 0.01) this.root.rotation.y = angleTowards(this.root.rotation.y, Math.atan2(to.x, to.z), TURN_SPEED * dt);
            if (!this.path.length) {
                const done = this.arrived;
                this.arrived = null;
                done?.();
            }
        } else if (this.faceAt !== null) {
            this.root.rotation.y = angleTowards(this.root.rotation.y, this.faceAt, TURN_SPEED * dt);
        }
        const weight = moving ? 1 : 0;
        this.walkWeight += Math.sign(weight - this.walkWeight) * Math.min(Math.abs(weight - this.walkWeight), BLEND_SPEED * dt);
        this.walkAction.setEffectiveWeight(this.walkWeight);
        this.idleAction.setEffectiveWeight(1 - this.walkWeight);
        this.mixer.update(dt);
    }

    public destroy(): void {
        gsap.killTweensOf(this.body.position);
        gsap.killTweensOf(this.body.rotation);
        this.mixer.stopAllAction();
        this.root.removeFromParent();
        this.geometries.forEach((g) => g.dispose());
    }
}
