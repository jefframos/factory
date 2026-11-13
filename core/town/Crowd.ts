// Crowd.ts
//
// A town's people, for any game (the UFO game's People, on the ground and without its eating), two kinds:
//
// - Wanderers hang around an area (a rect, `count` people): short strolls, stops, and now and then they stop with someone
//   close by and face each other for a chat.
// - Walkers go places along paths (waypoints and links), on the right of the way so they pass each other, at their own
//   pace. They keep going at a junction, sometimes stop a moment, and wait at the kerb until no car is near before
//   crossing a road.
//
// Everyone keeps clear of everyone else, and only goes where the game says they can stand (`canStand`: off the walls,
// the roads, ...). Everyone gets their own colours from the palette: a model's vertices say which part they are (COLOR_0's
// alpha x 16; the UFO game's tools/build-people.mjs), and only those parts take a colour. Only people on screen animate.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface CrowdPalette {
    skin: string[];
    top: string[];
    bottom: string[];
    shoes: string[];
    hair: string[];
}

export interface CrowdSettings {
    /** Walking speed (units a second), height (the models fitted to it), how far a wanderer strolls, its stops (seconds). */
    speed: number;
    height: number;
    wander: number;
    pauseMin: number;
    pauseMax: number;
    palette: CrowdPalette;
}

export interface CrowdArea {
    x: number;
    z: number;
    width: number;
    depth: number;
    count: number;
}

export interface CrowdPaths {
    waypoints: { id: string; x: number; z: number }[];
    links: [string, string][];
    walkers: number;
}

export interface CrowdAssets {
    models: THREE.Object3D[];
    walk: THREE.AnimationClip;
    idle: THREE.AnimationClip;
    /** The models' own height. */
    modelHeight: number;
}

export interface CrowdOptions {
    settings: CrowdSettings;
    assets: CrowdAssets;
    areas: CrowdArea[];
    paths?: CrowdPaths;
    /** Whether someone can stand at (x, z) (not in a wall, on a road ...). */
    canStand: (x: number, z: number) => boolean;
    /** Whether (x, z) is road (a walker's way over one is a crossing). */
    isRoad?: (x: number, z: number) => boolean;
    /** Whether a car is near the stretch a to b (walkers wait at the kerb while one is). */
    carNear?: (ax: number, az: number, bx: number, bz: number, radius: number) => boolean;
    /** Anything the game does to a person once made (a bend, shadows). */
    prepare?: (root: THREE.Object3D) => void;
}

const STANDING_Y = 0.02;
/** How far the walk clip carries a model of its own height per second: the feet don't slide at this speed. */
const CLIP_WALK_SPEED = 1.35;
const BLEND_SPEED = 6;
const TURN_SPEED = 6;
const SPAWN_TRIES = 60;
const TARGET_TRIES = 8;
const PATH_STEP = 0.6;
const WALKER_PACE = [1, 1.35];
const WANDERER_PACE = [0.7, 1];
const LANE = [0.35, 0.95];
const ARRIVED = 0.3;
const STOP_CHANCE = 0.12;
const STOP_SECONDS = [1, 4];
const CROSSING_CLEAR = 9;
const CROSSING_RECHECK = 0.3;
const CROSSING_PACE = 1.25;
const CHAT_CHANCE = 0.45;
const CHAT_RANGE = 2.6;
const CHAT_SECONDS = [4, 10];
const PERSONAL_SPACE = 0.9;
const AVOID_STRENGTH = 0.8;
const PART_SCALE = 16;
const PART_NAMES: (keyof CrowdPalette)[] = ['skin', 'top', 'bottom', 'shoes', 'hair'];

const between = ([from, to]: readonly number[]) => from + Math.random() * (to - from);
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

function angleTowards(from: number, to: number, step: number): number {
    const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + Math.sign(difference) * Math.min(Math.abs(difference), step);
}

/** The same mesh in someone's own colours (its other attributes shared with every copy of the model). */
export function dressed(source: THREE.BufferGeometry, palette: CrowdPalette): THREE.BufferGeometry {
    const choice = PART_NAMES.map((part) => new THREE.Color(pick(palette[part])));
    const from = source.getAttribute('color');
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
    geometry.setIndex(source.index);
    if (!from) return geometry;
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
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
}

interface PathNode {
    id: string;
    x: number;
    z: number;
    links: PathNode[];
}

interface Person {
    root: THREE.Group;
    model: THREE.Object3D;
    mixer: THREE.AnimationMixer;
    walkAction: THREE.AnimationAction;
    idleAction: THREE.AnimationAction;
    geometries: THREE.BufferGeometry[];
    position: THREE.Vector2;
    facing: number;
    lookAt: number | null;
    pace: number;
    pause: number;
    walk: number;
    moving: boolean;
    area: CrowdArea | null;
    target: THREE.Vector2 | null;
    chatting: boolean;
    from: PathNode | null;
    to: PathNode | null;
    lane: number;
    crossing: boolean;
}

export class Crowd {
    public readonly group = new THREE.Group();
    private readonly config: CrowdSettings;
    private readonly people: Person[] = [];
    private readonly nodes = new Map<string, PathNode>();
    private readonly crossings = new Set<string>();

    public constructor(private readonly options: CrowdOptions) {
        this.group.name = 'crowd';
        this.config = options.settings;
        this.buildPaths();
        const { models } = options.assets;
        if (!models.length) return;
        let made = 0;
        const model = () => models[made++ % models.length];
        for (const area of options.areas) {
            for (let i = 0; i < area.count; i++) {
                const at = this.findSpot(area);
                if (!at) continue;
                const person = this.makePerson(model(), at, between(WANDERER_PACE));
                person.area = area;
                person.pause = Math.random() * this.config.pauseMax;
            }
        }
        const starts = [...this.nodes.values()].filter((node) => node.links.length);
        if (starts.length) for (let i = 0; i < (options.paths?.walkers ?? 0); i++) this.spawnWalker(model(), pick(starts));
    }

    private buildPaths(): void {
        const paths = this.options.paths;
        for (const point of paths?.waypoints ?? []) this.nodes.set(point.id, { id: point.id, x: point.x, z: point.z, links: [] });
        for (const [a, b] of paths?.links ?? []) {
            const from = this.nodes.get(a);
            const to = this.nodes.get(b);
            if (!from || !to || from === to || from.links.includes(to)) continue;
            from.links.push(to);
            to.links.push(from);
            if (!this.options.isRoad) continue;
            const length = Math.hypot(to.x - from.x, to.z - from.z);
            const steps = Math.max(1, Math.ceil(length / PATH_STEP));
            for (let i = 0; i <= steps; i++) {
                if (!this.options.isRoad(from.x + ((to.x - from.x) * i) / steps, from.z + ((to.z - from.z) * i) / steps)) continue;
                this.crossings.add(`${a}|${b}`).add(`${b}|${a}`);
                break;
            }
        }
    }

    private inArea(area: CrowdArea, x: number, z: number): boolean {
        return Math.abs(x - area.x) <= area.width / 2 && Math.abs(z - area.z) <= area.depth / 2;
    }

    private standable(area: CrowdArea | null, x: number, z: number): boolean {
        return (!area || this.inArea(area, x, z)) && this.options.canStand(x, z);
    }

    private findSpot(area: CrowdArea): THREE.Vector2 | null {
        for (let i = 0; i < SPAWN_TRIES; i++) {
            const point = new THREE.Vector2(area.x + (Math.random() - 0.5) * area.width, area.z + (Math.random() - 0.5) * area.depth);
            if (this.standable(area, point.x, point.y)) return point;
        }
        return null;
    }

    private makePerson(template: THREE.Object3D, at: THREE.Vector2, pace: number): Person {
        const { height, palette, speed } = this.config;
        const { walk, idle, modelHeight } = this.options.assets;
        const model = cloneSkinned(template);
        const geometries: THREE.BufferGeometry[] = [];
        model.traverse((child) => {
            if (!(child instanceof THREE.SkinnedMesh)) return;
            child.geometry = dressed(child.geometry, palette);
            geometries.push(child.geometry);
            for (const material of [child.material].flat()) material.vertexColors = true;
            child.castShadow = true;
        });
        const root = new THREE.Group();
        const scale = height / modelHeight;
        root.scale.setScalar(scale);
        root.add(model);
        this.options.prepare?.(root);
        this.group.add(root);
        const mixer = new THREE.AnimationMixer(model);
        const walkAction = mixer.clipAction(walk);
        const idleAction = mixer.clipAction(idle);
        walkAction.timeScale = (speed * pace) / (CLIP_WALK_SPEED * scale);
        walkAction.time = Math.random() * walk.duration;
        idleAction.time = Math.random() * idle.duration;
        walkAction.setEffectiveWeight(0);
        walkAction.play();
        idleAction.play();
        const person: Person = {
            root, model, mixer, walkAction, idleAction, geometries, position: at.clone(), facing: Math.random() * Math.PI * 2, lookAt: null,
            pace, pause: 0, walk: 0, moving: false, area: null, target: null, chatting: false, from: null, to: null, lane: 0, crossing: false,
        };
        root.position.set(at.x, STANDING_Y, at.y);
        root.rotation.y = person.facing;
        this.people.push(person);
        return person;
    }

    private spawnWalker(template: THREE.Object3D, node: PathNode): void {
        const to = pick(node.links);
        const along = Math.random();
        const at = new THREE.Vector2(node.x + (to.x - node.x) * along, node.z + (to.z - node.z) * along);
        const person = this.makePerson(template, at, between(WALKER_PACE));
        person.from = node;
        person.to = to;
        person.lane = between(LANE);
        person.crossing = this.crossings.has(`${node.id}|${to.id}`);
    }

    // ---------------------------------------------------------------- wanderers

    private pickTarget(person: Person, area: CrowdArea): THREE.Vector2 | null {
        const from = person.position;
        for (let i = 0; i < TARGET_TRIES; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = this.config.wander * (0.3 + Math.random() * 0.7);
            let clear = true;
            for (let along = PATH_STEP; along <= distance && clear; along += PATH_STEP) {
                clear = this.standable(area, from.x + Math.cos(angle) * along, from.y + Math.sin(angle) * along);
            }
            if (clear) return new THREE.Vector2(from.x + Math.cos(angle) * distance, from.y + Math.sin(angle) * distance);
        }
        return null;
    }

    private stopWandering(person: Person): void {
        person.target = null;
        person.pause = between([this.config.pauseMin, this.config.pauseMax]);
        person.chatting = false;
        person.lookAt = null;
        if (Math.random() > CHAT_CHANCE) return;
        const friend = this.people.find((other) => other !== person && other.area && !other.target && !other.chatting && other.position.distanceTo(person.position) < CHAT_RANGE);
        if (!friend) return;
        const seconds = between(CHAT_SECONDS);
        const towards = Math.atan2(friend.position.x - person.position.x, friend.position.y - person.position.y);
        person.chatting = friend.chatting = true;
        person.pause = friend.pause = seconds;
        person.lookAt = towards;
        friend.lookAt = towards + Math.PI;
    }

    private updateWanderer(person: Person, area: CrowdArea, delta: number): void {
        const { position, target } = person;
        if (!target) {
            person.pause -= delta;
            if (person.pause > 0) return;
            person.chatting = false;
            person.lookAt = null;
            person.target = this.pickTarget(person, area);
            if (!person.target) this.stopWandering(person);
            return;
        }
        const dx = target.x - position.x;
        const dz = target.y - position.y;
        const distance = Math.hypot(dx, dz);
        const step = this.config.speed * person.pace * delta;
        person.facing = angleTowards(person.facing, Math.atan2(dx, dz), TURN_SPEED * delta);
        if (distance <= step) return this.stopWandering(person);
        const x = position.x + (dx / distance) * step;
        const z = position.y + (dz / distance) * step;
        if (!this.standable(area, x, z)) return this.stopWandering(person);
        position.set(x, z);
        person.moving = true;
    }

    // ---------------------------------------------------------------- walkers

    private laneTarget(person: Person, from: PathNode, to: PathNode): THREE.Vector2 {
        const length = Math.hypot(to.x - from.x, to.z - from.z) || 1;
        return new THREE.Vector2(to.x - ((to.z - from.z) / length) * person.lane, to.z + ((to.x - from.x) / length) * person.lane);
    }

    private nextStretch(person: Person, from: PathNode, at: PathNode): void {
        const ways = at.links.filter((link) => link !== from);
        const choices = ways.length ? ways : [from];
        const inX = at.x - from.x;
        const inZ = at.z - from.z;
        const inLength = Math.hypot(inX, inZ) || 1;
        const straightness = (link: PathNode) => {
            const length = Math.hypot(link.x - at.x, link.z - at.z) || 1;
            return ((link.x - at.x) * inX + (link.z - at.z) * inZ) / (length * inLength);
        };
        const straightest = choices.reduce((best, link) => (straightness(link) > straightness(best) ? link : best));
        person.from = at;
        person.to = Math.random() < 0.6 ? straightest : pick(choices);
        person.crossing = this.crossings.has(`${at.id}|${person.to.id}`);
        if (Math.random() < STOP_CHANCE && !person.crossing) person.pause = between(STOP_SECONDS);
    }

    private updateWalker(person: Person, from: PathNode, to: PathNode, delta: number): void {
        if (person.pause > 0) {
            person.pause -= delta;
            return;
        }
        const atKerb = !this.options.isRoad?.(person.position.x, person.position.y) && Math.hypot(person.position.x - from.x, person.position.y - from.z) < 2;
        if (person.crossing && atKerb && this.options.carNear?.(from.x, from.z, to.x, to.z, CROSSING_CLEAR)) {
            person.pause = CROSSING_RECHECK;
            person.lookAt = Math.atan2(to.x - from.x, to.z - from.z);
            return;
        }
        person.lookAt = null;
        const { position } = person;
        const target = this.laneTarget(person, from, to);
        const dx = target.x - position.x;
        const dz = target.y - position.y;
        const distance = Math.hypot(dx, dz);
        const step = this.config.speed * person.pace * (person.crossing ? CROSSING_PACE : 1) * delta;
        person.facing = angleTowards(person.facing, Math.atan2(dx, dz), TURN_SPEED * delta);
        if (distance <= Math.max(step, ARRIVED)) return this.nextStretch(person, from, to);
        position.x += (dx / distance) * step;
        position.y += (dz / distance) * step;
        person.moving = true;
    }

    // ---------------------------------------------------------------- everyone

    private keepApart(person: Person, delta: number): void {
        const { position } = person;
        let pushX = 0;
        let pushZ = 0;
        for (const other of this.people) {
            if (other === person) continue;
            const dx = position.x - other.position.x;
            const dz = position.y - other.position.y;
            if (Math.abs(dx) > PERSONAL_SPACE || Math.abs(dz) > PERSONAL_SPACE) continue;
            const distance = Math.hypot(dx, dz);
            if (distance >= PERSONAL_SPACE || distance < 1e-4) continue;
            const strength = (1 - distance / PERSONAL_SPACE) / distance;
            pushX += dx * strength;
            pushZ += dz * strength;
        }
        if (!pushX && !pushZ) return;
        const amount = this.config.speed * AVOID_STRENGTH * delta;
        const x = position.x + pushX * amount;
        const z = position.y + pushZ * amount;
        if (!person.area || this.standable(person.area, x, z)) position.set(x, z);
    }

    /** How many there are. */
    public get count(): number {
        return this.people.length;
    }

    public update(delta: number): void {
        for (const person of this.people) {
            person.moving = false;
            if (person.area) this.updateWanderer(person, person.area, delta);
            else if (person.from && person.to) this.updateWalker(person, person.from, person.to, delta);
            if (person.moving) this.keepApart(person, delta);
            if (person.lookAt !== null) person.facing = angleTowards(person.facing, person.lookAt, TURN_SPEED * delta);
            person.walk += ((person.moving ? 1 : 0) - person.walk) * Math.min(1, delta * BLEND_SPEED);
            person.root.position.set(person.position.x, STANDING_Y, person.position.y);
            person.root.rotation.y = person.facing;
            if (!person.root.visible) continue;
            person.walkAction.setEffectiveWeight(person.walk);
            person.idleAction.setEffectiveWeight(1 - person.walk);
            person.mixer.update(delta);
        }
    }

    public destroy(): void {
        this.group.removeFromParent();
        for (const { model, mixer, geometries } of this.people) {
            mixer.stopAllAction();
            mixer.uncacheRoot(model);
            geometries.forEach((geometry) => geometry.dispose());
            model.traverse((child) => {
                if (child instanceof THREE.SkinnedMesh) child.skeleton.dispose();
            });
        }
        this.people.length = 0;
    }
}
