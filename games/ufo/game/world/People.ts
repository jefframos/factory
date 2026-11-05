// People.ts
//
// The town's people, placed in the editor (the level's `people`), two kinds of them:
//
// - Walkers go places along the street paths (waypoints and links), on the right of the way so they pass each other,
//   each at their own pace. They keep going at a junction, sometimes stop for a moment, and wait at the kerb until no
//   car is near before crossing a road.
// - Wanderers hang around a wander area: short strolls, long stops, and now and then they stop with someone close by
//   and face each other for a chat. An area is cast down on what's under it, so one over a building has them on its
//   roof: they stay on the level they're on (a roof's edge stops them), and if the building gets eaten they fall.
//
// Everyone keeps clear of everyone else. They're things to eat, with their items following them (one on a roof takes a
// saucer flying over the roof), and they never block the saucer.
//
// The models and their walk and idle come from tools/build-people.mjs. Everyone gets their own colours, drawn at random
// from people.palette: a model's vertices say which part they are (COLOR_0's alpha), and only those parts take a colour;
// faces, hats and costumes keep their own. Only people on screen are animated.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createGLTFLoader } from 'core/three/GLTFLoaders';
import { DESIGN, Level, MODEL_BASE, PeopleArea, PeoplePalette, PeopleSettings, ROOF_MIN_HALF } from '../data/UfoConfig';
import { bendObject } from '../services/Bend';
import type { Cars } from './Cars';
import { Item, UfoTown } from './UfoTown';

/** The models' own height: fitted to the setting. */
const MODEL_HEIGHT = 1.83;
const STANDING_Y = 0.05;
const ITEM_RADIUS = 0.35;
/** Kept this far from what blocks them, and from a road's edge. */
const CLEARANCE = 0.5;
const ROAD_MARGIN = 0.3;
/** How far the walk clip would really carry a model of MODEL_HEIGHT per second: the feet don't slide at this speed. */
const CLIP_WALK_SPEED = 1.35;
const BLEND_SPEED = 6;
const TURN_SPEED = 6;
const GRAVITY = 18;
const SPAWN_TRIES = 60;
/** A wanderer's next spot: how many random tries, and the check along the way (units). */
const TARGET_TRIES = 8;
const PATH_STEP = 0.6;
/** An area's grid (units), and how big a height step they'll take: a roof's edge is more. */
const CAST_CELL = 0.75;
const CAST_FROM = 200;
const MAX_STEP = 0.4;
/** A surface this close to flat can be walked on (its normal's y). */
const FLAT_NORMAL = 0.75;
const ROOF_Y = 1;
/** Their pace, as shares of people.speed. */
const WALKER_PACE = [1, 1.35];
const WANDERER_PACE = [0.7, 1];
/** A walker: how far right of the way's middle, how close counts as there, its chance of stopping at a waypoint and for how long. */
const LANE = [0.35, 0.95];
const ARRIVED = 0.3;
const STOP_CHANCE = 0.12;
const STOP_SECONDS = [1, 4];
/** A crossing: no car this near the way over; looked at again this often; and they hurry over. */
const CROSSING_CLEAR = 9;
const CROSSING_RECHECK = 0.3;
const CROSSING_PACE = 1.25;
/** A chat: its chance when a wanderer stops, who's near enough, how long it lasts. */
const CHAT_CHANCE = 0.45;
const CHAT_RANGE = 2.6;
const CHAT_SECONDS = [4, 10];
/** Keeping clear of each other: within this they ease apart, this hard, if they're on one level. */
const PERSONAL_SPACE = 0.9;
const AVOID_STRENGTH = 0.8;
const SAME_LEVEL = 1;
/** COLOR_0: alpha x this is the part; for a part, RGB x 2 is the shading on its colour (build-people.mjs). */
const PART_SCALE = 16;
const PART_NAMES: (keyof PeoplePalette)[] = ['skin', 'top', 'bottom', 'shoes', 'hair'];

const between = ([from, to]: readonly number[]) => from + Math.random() * (to - from);

interface PathNode {
    id: string;
    x: number;
    z: number;
    links: PathNode[];
}

/** One spot of an area: what's there. `y` NaN: a wall or a slope, no walking on it while its owner stands. */
interface Cell {
    y: number;
    owner: Item | null;
    /** Whether they can walk here at ground level (not a road), for when the owner's gone. */
    groundOk: boolean;
}

class AreaGrid {
    private readonly minX: number;
    private readonly minZ: number;
    private readonly cols: number;
    private readonly rows: number;
    private readonly cells: (Cell | null)[] = [];

    public constructor(public readonly area: PeopleArea, town: UfoTown, isRoad: (x: number, z: number) => boolean) {
        this.minX = area.x - area.width / 2;
        this.minZ = area.z - area.depth / 2;
        this.cols = Math.max(1, Math.ceil(area.width / CAST_CELL));
        this.rows = Math.max(1, Math.ceil(area.depth / CAST_CELL));
        const roofs = town.items.filter((item) => item.blocker && Math.min(item.blocker.halfX, item.blocker.halfZ) >= ROOF_MIN_HALF);
        const ray = new THREE.Raycaster();
        const down = new THREE.Vector3(0, -1, 0);
        const normal = new THREE.Vector3();
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const x = this.minX + (c + 0.5) * CAST_CELL;
                const z = this.minZ + (r + 0.5) * CAST_CELL;
                if (!town.isOverIsland(x, z)) {
                    this.cells.push(null);
                    continue;
                }
                const groundOk = !isRoad(x, z);
                ray.set(new THREE.Vector3(x, CAST_FROM, z), down);
                let cell: Cell = { y: 0, owner: null, groundOk };
                let top = -Infinity;
                for (const roof of roofs) {
                    const hit = ray.intersectObject(roof.object, true)[0];
                    if (!hit || hit.point.y <= top) continue;
                    top = hit.point.y;
                    normal.copy(hit.face?.normal ?? down).transformDirection(hit.object.matrixWorld);
                    cell = { y: normal.y >= FLAT_NORMAL ? hit.point.y : NaN, owner: roof, groundOk };
                }
                this.cells.push(cell);
            }
        }
    }

    /** How high you'd stand at (x, z); null if you can't stand there. */
    public heightAt(x: number, z: number): number | null {
        const c = Math.floor((x - this.minX) / CAST_CELL);
        const r = Math.floor((z - this.minZ) / CAST_CELL);
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return null;
        const cell = this.cells[r * this.cols + c];
        if (!cell) return null;
        if (cell.owner && !cell.owner.gone) return Number.isNaN(cell.y) ? null : cell.y;
        return cell.groundOk ? 0 : null;
    }

    public randomPoint(): THREE.Vector2 {
        return new THREE.Vector2(this.minX + Math.random() * this.area.width, this.minZ + Math.random() * this.area.depth);
    }
}

interface Person {
    root: THREE.Group;
    mixer: THREE.AnimationMixer;
    walkAction: THREE.AnimationAction;
    idleAction: THREE.AnimationAction;
    item: Item;
    position: THREE.Vector2;
    y: number;
    fallSpeed: number;
    /** Which way it's facing (radians), and the way to turn to while it stands. */
    facing: number;
    lookAt: number | null;
    pace: number;
    pause: number;
    walk: number;
    center: THREE.Vector3;
    moving: boolean;
    /** A wanderer's area and spot. */
    grid: AreaGrid | null;
    target: THREE.Vector2 | null;
    chatting: boolean;
    /** A walker's way: the stretch it's on, its side of the way, and waiting at the kerb. */
    from: PathNode | null;
    to: PathNode | null;
    lane: number;
    crossing: boolean;
}

interface Assets {
    models: THREE.Object3D[];
    walk: THREE.AnimationClip;
    idle: THREE.AnimationClip;
}

/** Loaded once: PLAY AGAIN reuses them. */
let assets: Promise<Assets | null> | null = null;

function loadAssets(config: PeopleSettings): Promise<Assets | null> {
    assets ??= (async () => {
        const loader = createGLTFLoader();
        try {
            const [animations, ...models] = await Promise.all([
                loader.loadAsync(`${MODEL_BASE}${config.animations}`),
                ...config.models.map((model) => loader.loadAsync(`${MODEL_BASE}${model}`)),
            ]);
            const walk = THREE.AnimationClip.findByName(animations.animations, 'walk');
            const idle = THREE.AnimationClip.findByName(animations.animations, 'idle');
            if (!walk || !idle) throw new Error('people-anims has no walk or idle');
            return { models: models.map((gltf) => gltf.scene), walk, idle };
        } catch (error) {
            console.warn('[People] could not load the people', error);
            return null;
        }
    })();
    return assets;
}

function angleTowards(from: number, to: number, step: number): number {
    const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + Math.sign(difference) * Math.min(Math.abs(difference), step);
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/**
 * The same mesh in this person's colours. Its other attributes stay shared with every copy of the model, so only the
 * colours take memory. Models carry RGBA colours; this person's replace them.
 */
function dressed(source: THREE.BufferGeometry, palette: PeoplePalette): THREE.BufferGeometry {
    const choice = PART_NAMES.map((part) => new THREE.Color(pick(palette[part])));
    const from = source.getAttribute('color');
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

export class People {
    private readonly config: PeopleSettings = DESIGN.people;
    private readonly group = new THREE.Group();
    private readonly people: Person[] = [];
    /** Everyone made, eaten or not: freed at the end. */
    private readonly spawned: { model: THREE.Object3D; mixer: THREE.AnimationMixer; geometries: THREE.BufferGeometry[] }[] = [];
    private readonly pavementRoads: Level['pavements'];
    private readonly roadCells = new Set<string>();
    private readonly roadTile: number;
    private readonly nodes = new Map<string, PathNode>();
    /** Which stretches cross a road, by "a|b". */
    private readonly crossings = new Set<string>();
    private destroyed = false;
    public readonly ready: Promise<void>;

    public constructor(threeScene: THREE.Scene, private readonly level: Level, private readonly town: UfoTown, private readonly cars: Cars) {
        threeScene.add(this.group);
        this.pavementRoads = level.pavements.filter((pavement) => pavement.id.startsWith('road'));
        this.roadTile = DESIGN.roadKit?.tile ?? 15;
        for (const [i, j] of level.roads?.cells ?? []) this.roadCells.add(`${i},${j}`);
        this.buildPaths();
        this.ready = this.load();
    }

    private buildPaths(): void {
        const people = this.level.people;
        for (const point of people?.waypoints ?? []) this.nodes.set(point.id, { id: point.id, x: point.x, z: point.z, links: [] });
        for (const [a, b] of people?.links ?? []) {
            const from = this.nodes.get(a);
            const to = this.nodes.get(b);
            if (!from || !to || from === to || from.links.includes(to)) continue;
            from.links.push(to);
            to.links.push(from);
            const length = Math.hypot(to.x - from.x, to.z - from.z);
            const steps = Math.max(1, Math.ceil(length / PATH_STEP));
            for (let i = 0; i <= steps; i++) {
                if (!this.isRoad(from.x + ((to.x - from.x) * i) / steps, from.z + ((to.z - from.z) * i) / steps)) continue;
                this.crossings.add(`${a}|${b}`).add(`${b}|${a}`);
                break;
            }
        }
    }

    private async load(): Promise<void> {
        // The areas are cast on the town's models, so those come first.
        const [loaded] = await Promise.all([loadAssets(this.config), this.town.ready]);
        const people = this.level.people;
        if (this.destroyed || !loaded || !people) return;
        let made = 0;
        const model = () => loaded.models[made++ % loaded.models.length];
        for (const area of people.areas ?? []) {
            const grid = new AreaGrid(area, this.town, (x, z) => this.isRoad(x, z));
            for (let i = 0; i < area.count; i++) {
                const at = this.findSpot(grid);
                if (at) this.spawnWanderer(loaded, model(), grid, at.point, at.y);
            }
        }
        const starts = [...this.nodes.values()].filter((node) => node.links.length);
        if (!starts.length) return;
        for (let i = 0; i < (people.walkers ?? 0); i++) this.spawnWalker(loaded, model(), pick(starts));
    }

    private isRoad(x: number, z: number): boolean {
        if (this.pavementRoads.some((road) => Math.abs(x - road.x) <= road.width / 2 + ROAD_MARGIN && Math.abs(z - road.z) <= road.depth / 2 + ROAD_MARGIN)) return true;
        return this.roadCells.has(`${Math.round(x / this.roadTile)},${Math.round(z / this.roadTile)}`);
    }

    /** Clear of what stands on the ground (someone on a roof is above it all). */
    private isClearOnGround(x: number, z: number): boolean {
        return !this.town.blockers.some((box) => Math.abs(x - box.x) <= box.halfX + CLEARANCE && Math.abs(z - box.z) <= box.halfZ + CLEARANCE);
    }

    /** How high they'd stand at (x, z) in this area, coming from height `y` (any, without one); null if they can't go there. */
    private standAt(grid: AreaGrid, x: number, z: number, y: number | null): number | null {
        const height = grid.heightAt(x, z);
        if (height === null || (y !== null && Math.abs(height - y) > MAX_STEP)) return null;
        if (height < ROOF_Y && !this.isClearOnGround(x, z)) return null;
        return height;
    }

    private findSpot(grid: AreaGrid): { point: THREE.Vector2; y: number } | null {
        for (let i = 0; i < SPAWN_TRIES; i++) {
            const point = grid.randomPoint();
            const y = this.standAt(grid, point.x, point.y, null);
            if (y !== null) return { point, y };
        }
        return null;
    }

    private makePerson({ walk, idle }: Assets, template: THREE.Object3D, at: THREE.Vector2, y: number, pace: number): Person {
        const { height, palette } = this.config;
        const model = cloneSkinned(template);
        const geometries: THREE.BufferGeometry[] = [];
        model.traverse((child) => {
            if (!(child instanceof THREE.SkinnedMesh)) return;
            child.geometry = dressed(child.geometry, palette);
            geometries.push(child.geometry);
            for (const material of [child.material].flat()) material.vertexColors = true;
        });
        const root = new THREE.Group();
        const scale = height / MODEL_HEIGHT;
        root.scale.setScalar(scale);
        root.add(model);
        bendObject(root);
        this.group.add(root);

        const mixer = new THREE.AnimationMixer(model);
        const walkAction = mixer.clipAction(walk);
        const idleAction = mixer.clipAction(idle);
        walkAction.timeScale = (this.config.speed * pace) / (CLIP_WALK_SPEED * scale);
        // Everyone at their own point in the clips, so nobody moves in step.
        walkAction.time = Math.random() * walk.duration;
        idleAction.time = Math.random() * idle.duration;
        walkAction.setEffectiveWeight(0);
        walkAction.play();
        idleAction.play();
        this.spawned.push({ model, mixer, geometries });

        const item: Item = {
            object: root, x: at.x, z: at.y, radius: ITEM_RADIUS, height: y + height,
            value: UfoTown.valueOf(ITEM_RADIUS * ITEM_RADIUS * 4 * height),
            bounds: new THREE.Box3(), opacity: 1,
        };
        const person: Person = {
            root, mixer, walkAction, idleAction, item, position: at.clone(), y, fallSpeed: 0, facing: Math.random() * Math.PI * 2, lookAt: null,
            pace, pause: 0, walk: 0, center: new THREE.Vector3(at.x, y + height / 2, at.y), moving: false,
            grid: null, target: null, chatting: false, from: null, to: null, lane: 0, crossing: false,
        };
        root.position.set(at.x, y + STANDING_Y, at.y);
        root.rotation.y = person.facing;
        this.town.culler.add(root, person.center, height);
        this.people.push(person);
        this.town.addItem(item);
        return person;
    }

    private spawnWanderer(loaded: Assets, template: THREE.Object3D, grid: AreaGrid, at: THREE.Vector2, y: number): void {
        const person = this.makePerson(loaded, template, at, y, between(WANDERER_PACE));
        person.grid = grid;
        person.pause = Math.random() * this.config.pauseMax;
    }

    private spawnWalker(loaded: Assets, template: THREE.Object3D, node: PathNode): void {
        const to = pick(node.links);
        const along = Math.random();
        const at = new THREE.Vector2(node.x + (to.x - node.x) * along, node.z + (to.z - node.z) * along);
        const person = this.makePerson(loaded, template, at, 0, between(WALKER_PACE));
        person.from = node;
        person.to = to;
        person.lane = between(LANE);
        person.crossing = this.crossings.has(`${node.id}|${to.id}`);
    }

    // ---------------------------------------------------------------- wanderers

    /** A spot nearby on the level it's on, with a clear walk to it, or null (it tries again later). */
    private pickTarget(person: Person, grid: AreaGrid): THREE.Vector2 | null {
        const from = person.position;
        for (let i = 0; i < TARGET_TRIES; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = this.config.wander * (0.3 + Math.random() * 0.7);
            let clear = true;
            for (let along = PATH_STEP; along <= distance && clear; along += PATH_STEP) {
                clear = this.standAt(grid, from.x + Math.cos(angle) * along, from.y + Math.sin(angle) * along, person.y) !== null;
            }
            if (clear) return new THREE.Vector2(from.x + Math.cos(angle) * distance, from.y + Math.sin(angle) * distance);
        }
        return null;
    }

    /** It stops: for a moment, or for a chat with someone near who's standing about too. */
    private stopWandering(person: Person): void {
        person.target = null;
        const { pauseMin, pauseMax } = this.config;
        person.pause = between([pauseMin, pauseMax]);
        person.chatting = false;
        person.lookAt = null;
        if (Math.random() > CHAT_CHANCE) return;
        const friend = this.people.find((other) => other !== person && other.grid && !other.target && !other.chatting && Math.abs(other.y - person.y) < SAME_LEVEL
            && other.position.distanceTo(person.position) < CHAT_RANGE);
        if (!friend) return;
        const seconds = between(CHAT_SECONDS);
        const towards = Math.atan2(friend.position.x - person.position.x, friend.position.y - person.position.y);
        person.chatting = friend.chatting = true;
        person.pause = friend.pause = seconds;
        person.lookAt = towards;
        friend.lookAt = towards + Math.PI;
    }

    private updateWanderer(person: Person, grid: AreaGrid, delta: number): void {
        const { position, target } = person;
        if (!target) {
            person.pause -= delta;
            if (person.pause > 0) return;
            person.chatting = false;
            person.lookAt = null;
            person.target = this.pickTarget(person, grid);
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
        const y = this.standAt(grid, x, z, person.y);
        if (y === null) return this.stopWandering(person);
        position.set(x, z);
        person.y = y;
        person.moving = true;
    }

    // ---------------------------------------------------------------- walkers

    /** Where it's heading: the end of its stretch, on its side of the way. */
    private laneTarget(person: Person, from: PathNode, to: PathNode): THREE.Vector2 {
        const length = Math.hypot(to.x - from.x, to.z - from.z) || 1;
        // The right of a heading (x, z) is (-z, x).
        return new THREE.Vector2(to.x - ((to.z - from.z) / length) * person.lane, to.z + ((to.x - from.x) / length) * person.lane);
    }

    /** At a waypoint: on down another link (the straightest likelier, back only at a dead end), maybe stopping first. */
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
        // At the kerb: over only when no car's near the way across.
        if (person.crossing && this.isKerbside(person, from) && this.cars.anyNear(from.x, from.z, to.x, to.z, CROSSING_CLEAR)) {
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

    /** Whether it's still at the start of its stretch, not out on the road yet. */
    private isKerbside(person: Person, from: PathNode): boolean {
        return !this.isRoad(person.position.x, person.position.y) && Math.hypot(person.position.x - from.x, person.position.y - from.z) < 2;
    }

    // ---------------------------------------------------------------- everyone

    /** Anyone walking eases round whoever is too close. Wanderers stay where they can stand. */
    private keepApart(person: Person, delta: number): void {
        const { position } = person;
        let pushX = 0;
        let pushZ = 0;
        for (const other of this.people) {
            if (other === person || Math.abs(other.y - person.y) > SAME_LEVEL) continue;
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
        if (!person.grid) position.set(x, z);
        else if (this.standAt(person.grid, x, z, person.y) !== null) position.set(x, z);
    }

    /** Its building eaten from under it: down it comes. Returns whether it's in the air. */
    private fall(person: Person, delta: number): boolean {
        if (!person.grid) return false;
        const floor = person.grid.heightAt(person.position.x, person.position.y);
        if (floor === null ? person.y <= 0 : person.y <= floor + 0.01) {
            person.fallSpeed = 0;
            return false;
        }
        const below = floor ?? 0;
        if (person.y - below <= MAX_STEP && person.fallSpeed === 0) return false;
        person.target = null;
        person.chatting = false;
        person.fallSpeed += GRAVITY * delta;
        person.y = Math.max(below, person.y - person.fallSpeed * delta);
        if (person.y <= below) person.fallSpeed = 0;
        return true;
    }

    public update(delta: number): void {
        const { height } = this.config;
        for (const person of this.people) {
            person.moving = false;
            if (!this.fall(person, delta)) {
                if (person.grid) this.updateWanderer(person, person.grid, delta);
                else if (person.from && person.to) this.updateWalker(person, person.from, person.to, delta);
                if (person.moving) this.keepApart(person, delta);
            }
            if (person.lookAt !== null) person.facing = angleTowards(person.facing, person.lookAt, TURN_SPEED * delta);
            person.walk += ((person.moving ? 1 : 0) - person.walk) * Math.min(1, delta * BLEND_SPEED);
            const { root, item, center, position, y } = person;
            root.position.set(position.x, y + STANDING_Y, position.y);
            item.x = center.x = position.x;
            item.z = center.z = position.y;
            center.y = y + height / 2;
            item.height = y + height;
            root.rotation.y = person.facing;
            if (!root.visible) continue;
            person.walkAction.setEffectiveWeight(person.walk);
            person.idleAction.setEffectiveWeight(1 - person.walk);
            person.mixer.update(delta);
        }
    }

    /** That item was a person: it stops walking (the caller animates it away). */
    public release(item: Item): void {
        const i = this.people.findIndex((person) => person.item === item);
        if (i >= 0) this.people.splice(i, 1);
    }

    public destroy(): void {
        this.destroyed = true;
        this.group.removeFromParent();
        for (const { model, mixer, geometries } of this.spawned) {
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
