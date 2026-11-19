// DeliveryScene.ts
//
// The pizza delivery minigame (a restaurant with its pizza oven: after the day, before the supermarket). The town round
// the restaurant (its street: roads, traffic, people — Town in its 'delivery' mode — and the buildings: the level's
// props), and the car (world/DeliveryCar.ts) waiting outside the restaurant (settings.json delivery.start):
//   1. a pizza box hops from the restaurant onto its roof;
//   2. arrows on the ground lead to a house (one of the town's homes, a glowing beacon at its door): drive there;
//   3. there, the box hops to the door — coins (settings.json delivery.pay);
//   4. the arrows lead back to the restaurant for the next box — `deliveries` times; then back once more: done (the
//      card; the coins go in the restaurant's bar).
// Driving: drag anywhere (a joystick there) the way to go on screen — the car turns to it and goes (how far: how fast) —
// or the arrow keys / WASD the same way; the camera's high over it, north up. The arrows (Mow's and Dig's guide arrows:
// world/GuideArrows.ts) follow the way round the buildings (a car-sized walk grid's routes, kept fresh as it drives).
// Whatever stands between the camera and the car fades out (as Pizza's and Mow's occlusion fade), so it's never lost
// behind a building; it bumps into the traffic and bounces off; the streets have no people. Stand-alone from the debug
// panel (Areas: PIZZA DELIVERY), as the supermarket.

import * as THREE from 'three';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import SetupThree from 'core/scene/SetupThree';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import type { Room } from 'core/rooms/Room';
import { LAYOUT_DATA, buildRoom, roomModels } from '../world/RestaurantLayout';
import { Town } from '../world/Town';
import { WalkGrid } from '../world/WalkGrid';
import { DeliveryCar, DriveInput } from '../world/DeliveryCar';
import { GuideArrows } from '../world/GuideArrows';
import { kitchenModel, loadModels } from '../world/Models';
import { bendAll, bendAround } from '../world/Bend';
import { SETTINGS } from '../data/Settings';
import { RestaurantSave } from '../data/RestaurantSave';
import { Track } from '../data/Track';
import { DeliveryHud, STICK } from '../ui/DeliveryHud';
import { uiPress } from '../ui/UiParts';
import { RestaurantAudio } from '../audio/RestaurantAudio';

/**
 * The camera: high over the car and a little south of it (mostly from above), north up — it doesn't turn with the car,
 * so the joystick's "up" is always up the screen; it looks `lead` ahead of where the car's going (more the faster);
 * how fast it catches up; its view.
 */
const CAMERA = { up: 19, back: 9.5, lead: 3.5, follow: 4, fov: 50 };
/**
 * The car's walk grid: its cells and the room it needs round things (about a car's half width), and what it drives
 * through (the street's small things — snagging on them is no fun).
 */
const CAR_GRID = { cell: 0.6, clearance: 1.0, ignore: /tree|lamp|bench|trash|hydrant|sign|bus[-_]stop|traffic[-_]light|fountain|statue|menu|chair|stool/i };
/**
 * The guide arrows (Mow's and Dig's, sized for the road: x `scale`): from how far ahead of the car, how far apart, how
 * many, none this near the stop; how often the way's worked out again (s).
 */
const ARROWS = { scale: 4.5, start: 3.5, spacing: 2.6, max: 22, near: 2.5, every: 0.35 };
/**
 * Seeing the car behind things (as Pizza's and Mow's occlusion fade): anything standing at least `minHeight` tall
 * between the camera and the car fades to `opacity` (and back once it's clear), `speed` a second.
 */
const OCCLUDE = { minHeight: 2.2, opacity: 0.22, speed: 6 };
/** Bumping into the traffic: the bump sound at most this often (s). */
const BUMP_SOUND = 0.4;
/** The beacons over where to go: their colour (a house, the restaurant), height. */
const BEACON = { house: '#ff8a1f', restaurant: '#4cd06a', height: 7 };
/** The restaurant's middle (the boxes hop from there); a house's door: this far out from its front. */
const RESTAURANT_DOOR = new THREE.Vector3(2, 1.2, 12);
const DOOR_OUT = 2.5;

type Phase = 'loading' | 'loadingBox' | 'toHouse' | 'dropping' | 'toRestaurant' | 'done';

export default class DeliveryScene extends ThreeScene {
    private readonly config = SETTINGS.delivery;
    /** Made once the models are in (its pictures are drawn from them). */
    private hud: DeliveryHud | null = null;
    private room: Room | null = null;
    private town: Town | null = null;
    private grid: WalkGrid | null = null;
    private car: DeliveryCar | null = null;
    private phase: Phase = 'loading';
    /** The houses to deliver to (where to stop by each), in order; how many done; the coins. */
    private houses: THREE.Vector3[] = [];
    private delivered = 0;
    private coins = 0;
    private target: THREE.Vector3 | null = null;
    private readonly start = new THREE.Vector3(SETTINGS.delivery.start.x, 0, SETTINGS.delivery.start.z);
    private guide: GuideArrows | null = null;
    private beacon: THREE.Group | null = null;
    private way: THREE.Vector3[] = [];
    private wayTimer = 0;
    private time = 0;
    /** The joystick (screen points: where the drag began, where the finger is) and the keys held. */
    private stickFrom: { x: number; y: number } | null = null;
    private stickAt: { x: number; y: number } | null = null;
    private readonly keys = new Set<string>();
    /** Where the camera looks (eased after the car). */
    private readonly look = new THREE.Vector3();
    /** What can stand between the camera and the car (its bounds, its own materials, how faded it is now). */
    private readonly occluders: { box: THREE.Box3; materials: THREE.Material[]; opacity: number }[] = [];
    private readonly sightRay = new THREE.Ray();
    private lastBump = -1;
    private gone = false;

    /** `onDone`: the card's CONTINUE (on to the supermarket). */
    public constructor(game: Game, private readonly onDone: () => void = () => undefined) {
        super(game);
    }

    public build(): void {
        this.threeScene.background = new THREE.Color(0xbfe3f2);
        const pmrem = new THREE.PMREMGenerator(SetupThree.renderer);
        this.threeScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.threeScene.environmentIntensity = 0.35;
        pmrem.dispose();
        this.threeScene.add(new THREE.HemisphereLight(0xfff6ea, 0xb9d29a, 1.15));
        const sun = new THREE.DirectionalLight(0xffffff, 1.5);
        sun.position.set(-6, 14, -8);
        this.threeScene.add(sun, sun.target);
        this.threeCamera.fov = CAMERA.fov;

        window.addEventListener('pointerdown', this.onPointerDown);
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
        window.addEventListener('pointercancel', this.onPointerUp);
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
        this.buildDebug();
        void this.load();
    }

    private buildDebug(): void {
        const panel = DebugOverlay.instance.panel('Delivery', { id: 'restaurant.delivery' });
        // The car straight to where it's going (the stop works as if driven there).
        panel.button('JUMP TO THE STOP', () => {
            if (!this.car || !this.target) return;
            this.car.position.copy(this.target);
            this.car.speed = 0;
        });
        panel.button('FINISH', () => {
            if (this.phase !== 'done') this.finish();
        });
    }

    private async load(): Promise<void> {
        const stage = RestaurantSave.stage;
        try {
            await loadModels([...new Set([...roomModels(stage), 'pizzabox_closed', 'pizzabox_stacked'])]);
        } catch (error) {
            console.error('[Delivery] could not load the models', error);
            return;
        }
        if (this.gone) return;
        this.hud = new DeliveryHud(this.config.deliveries);
        this.game.uiLayer.addChild(this.hud);
        this.room = buildRoom(stage);
        this.threeScene.add(this.room.group);
        this.town = new Town(stage, 'delivery');
        this.threeScene.add(this.town.group);
        this.collectOccluders();
        // Where the car can go: the town's roads and round them (a grid the car's size).
        this.grid = new WalkGrid(this.room, this.townArea(), CAR_GRID);
        this.houses = this.pickHouses();
        this.car = new DeliveryCar(this.threeScene, this.start.clone(), this.config.start.rotationY);
        try {
            await this.car.load();
        } catch (error) {
            console.error('[Delivery] could not load the car', error);
        }
        if (this.gone) return;
        this.guide = new GuideArrows(this.threeScene, ARROWS);
        this.look.copy(this.car.position);
        this.placeCamera(1);
        this.hud?.setDelivered(0);
        this.hud?.banner('PIZZA DELIVERY', `${this.houses.length} pizzas to deliver`);
        gsap.delayedCall(0.8, () => this.loadBox());
    }

    /**
     * Everything tall enough to hide the car (the town's buildings, trees, the restaurant's tall things): each with its
     * own copy of its materials (so fading one doesn't fade every one of its model) and its bounds.
     */
    private collectOccluders(): void {
        for (const { object } of this.room?.placed ?? []) {
            object.updateWorldMatrix(true, true);
            const box = new THREE.Box3().setFromObject(object);
            if (box.isEmpty() || box.max.y - box.min.y < OCCLUDE.minHeight) continue;
            const materials: THREE.Material[] = [];
            object.traverse((child) => {
                const mesh = child as THREE.Mesh;
                if (!mesh.isMesh) return;
                const own = (m: THREE.Material) => {
                    const copy = m.clone();
                    materials.push(copy);
                    return copy;
                };
                mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
            });
            this.occluders.push({ box, materials, opacity: 1 });
        }
    }

    /** What stands between the camera and the car fades out; the rest fades back in. */
    private fadeOccluders(dt: number): void {
        const car = this.car;
        if (!car) return;
        const eye = this.threeCamera.position;
        const at = car.position.clone().add(new THREE.Vector3(0, 1, 0));
        const toCar = eye.distanceTo(at);
        this.sightRay.set(eye, at.clone().sub(eye).normalize());
        const hit = new THREE.Vector3();
        const step = Math.min(1, dt * OCCLUDE.speed);
        for (const occluder of this.occluders) {
            const inTheWay = Boolean(this.sightRay.intersectBox(occluder.box, hit)) && eye.distanceTo(hit) < toCar - 0.5;
            const want = inTheWay ? OCCLUDE.opacity : 1;
            if (Math.abs(occluder.opacity - want) < 0.005) continue;
            occluder.opacity += (want - occluder.opacity) * step;
            if (Math.abs(occluder.opacity - want) < 0.01) occluder.opacity = want;
            const solid = occluder.opacity >= 0.999;
            for (const material of occluder.materials) {
                material.transparent = !solid;
                material.opacity = occluder.opacity;
                material.depthWrite = solid;
            }
        }
    }

    /** The town's extent: its roads (the kit's tiles), and a margin. */
    private townArea(): { minX: number; maxX: number; minZ: number; maxZ: number } {
        const roads = LAYOUT_DATA.roads;
        const tile = SETTINGS.town.roadKit.tile;
        const origin = roads?.origin ?? { x: 0, z: 0 };
        const cells = roads?.cells ?? [[0, 0]];
        const xs = cells.map(([i]) => origin.x + i * tile);
        const zs = cells.map(([, j]) => origin.z + j * tile);
        return { minX: Math.min(...xs) - tile, maxX: Math.max(...xs) + tile, minZ: Math.min(...zs) - tile, maxZ: Math.max(...zs) + tile };
    }

    /**
     * The houses to deliver to: the town's homes (living buildings) a drive away (settings.json houseDistance), each by
     * its front door (the building models' front: their -z, as they're turned), at the nearest spot the car can be.
     * Shuffled; as many as the deliveries.
     */
    private pickHouses(): THREE.Vector3[] {
        const room = this.room;
        const grid = this.grid;
        if (!room || !grid) return [];
        const [near, far] = this.config.houseDistance;
        const stops: THREE.Vector3[] = [];
        for (const { prop, object } of room.placed) {
            if (!/building[-_]living/i.test(prop.model)) continue;
            object.updateWorldMatrix(true, true);
            const box = new THREE.Box3().setFromObject(object);
            const middle = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const turn = prop.rotationY ?? 0;
            const front = new THREE.Vector3(-Math.sin(turn), 0, -Math.cos(turn));
            const reach = Math.abs(front.x) * size.x / 2 + Math.abs(front.z) * size.z / 2 + DOOR_OUT;
            const door = middle.clone().setY(0).addScaledVector(front, reach);
            const stop = grid.nearestFreePoint(door.x, door.z);
            if (!stop) continue;
            const distance = stop.distanceTo(this.start);
            if (distance < near || distance > far) continue;
            stops.push(stop);
        }
        return stops.sort(() => Math.random() - 0.5).slice(0, this.config.deliveries);
    }

    // ---------------------------------------------------------------- the run

    /** At the restaurant: a box hops out onto the roof, then off to the next house. */
    private loadBox(): void {
        if (this.gone || !this.car) return;
        const house = this.houses[this.delivered];
        if (!house) {
            this.finish();
            return;
        }
        this.phase = 'loadingBox';
        this.setTarget(null);
        RestaurantAudio.play('pick');
        this.car.loadBox(RESTAURANT_DOOR.clone(), () => {
            if (this.gone) return;
            RestaurantAudio.play('drop');
            this.phase = 'toHouse';
            this.setTarget(house, BEACON.house);
            this.hud?.showHint(this.delivered === 0 ? 'Follow the arrows! Drag to drive' : 'Follow the arrows to the next house');
        });
    }

    /** At the house: the box to its door, the coins; then back to the restaurant. */
    private dropBox(): void {
        const car = this.car!;
        const house = this.target!.clone();
        this.phase = 'dropping';
        this.setTarget(null);
        car.speed = 0;
        RestaurantAudio.play('whoosh');
        car.dropBox(house.clone().setY(0.8), () => {
            if (this.gone) return;
            this.delivered++;
            this.coins += this.config.pay;
            RestaurantAudio.play('coins');
            this.hud?.setDelivered(this.delivered);
            this.hud?.setCoins(this.coins);
            const at = this.worldToScreen(house.clone().setY(2));
            if (at) this.hud?.popCoins(this.config.pay, at);
            this.phase = 'toRestaurant';
            this.setTarget(this.start.clone(), BEACON.restaurant);
            this.hud?.showHint(this.delivered >= this.houses.length ? 'All delivered! Back to the restaurant' : 'Back to the restaurant for the next pizza');
        });
    }

    /** Every pizza's there and the car's back: the card (the coins into the restaurant's bar), then on. */
    private finish(): void {
        if (this.phase === 'done') return;
        Track.event('delivery', RestaurantSave.day, 'complete');
        this.phase = 'done';
        this.setTarget(null);
        if (this.car) this.car.speed = 0;
        RestaurantAudio.play('happy');
        RestaurantSave.addProgress(this.coins);
        this.hud?.showDone(this.delivered, this.coins, () => {
            if (!this.gone) this.onDone();
        });
    }

    // ---------------------------------------------------------------- where to go: the beacon and the arrows

    /** The beacon over `at` (null: none) in `color`, and the arrows lead there. */
    private setTarget(at: THREE.Vector3 | null, color = BEACON.house): void {
        this.target = at;
        this.beacon?.removeFromParent();
        this.beacon = null;
        this.way = [];
        this.wayTimer = 0;
        if (!at) return;
        const beacon = new THREE.Group();
        const radius = this.config.arriveRadius;
        const light = new THREE.Mesh(
            new THREE.CylinderGeometry(radius * 0.55, radius * 0.7, BEACON.height, 24, 1, true),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
        );
        light.position.y = BEACON.height / 2;
        const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.8, radius, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.12;
        beacon.add(light, ring);
        // Over a house, a pizza box turning; over the restaurant, nothing (it's where they come from).
        if (color === BEACON.house) {
            const box = kitchenModel('pizzabox_closed');
            box.scale.setScalar(0.6);
            box.position.y = 3.2;
            box.name = 'spinner';
            beacon.add(box);
        }
        beacon.position.copy(at).setY(0);
        this.threeScene.add(beacon);
        this.beacon = beacon;
    }

    /** The guide arrows along the way there (round the buildings: the car's walk grid), kept fresh as it drives. */
    private layArrows(dt: number): void {
        const car = this.car;
        if (!car || !this.target || !this.grid) {
            this.guide?.update(dt, []);
            return;
        }
        if (this.wayTimer <= 0) {
            this.wayTimer = ARROWS.every;
            this.way = [car.position.clone().setY(0), ...this.grid.route(car.position, this.target)];
        } else if (this.way.length) {
            this.way[0].set(car.position.x, 0, car.position.z);
        }
        this.guide?.update(dt, this.way);
    }

    // ---------------------------------------------------------------- driving

    private readonly onPointerDown = (event: PointerEvent): void => {
        RestaurantAudio.unlock();
        if (uiPress.taken) {
            uiPress.taken = false;
            return;
        }
        this.stickFrom = { x: event.clientX, y: event.clientY };
        this.stickAt = { ...this.stickFrom };
    };

    private readonly onPointerMove = (event: PointerEvent): void => {
        if (this.stickFrom) this.stickAt = { x: event.clientX, y: event.clientY };
    };

    private readonly onPointerUp = (): void => {
        this.stickFrom = this.stickAt = null;
    };

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        this.keys.add(event.key.toLowerCase());
    };

    private readonly onKeyUp = (event: KeyboardEvent): void => {
        this.keys.delete(event.key.toLowerCase());
    };

    /**
     * Where the player points the car (point and go): the keys (up the screen: north, as the camera sees it), else the
     * joystick — the way it's dragged on screen is the way on the ground (the camera's north up: screen x is world x,
     * screen down is world +z), how far (up to its ring) how hard.
     */
    private input(): DriveInput {
        const held = (...keys: string[]) => keys.some((k) => this.keys.has(k));
        const kx = (held('arrowright', 'd') ? 1 : 0) - (held('arrowleft', 'a') ? 1 : 0);
        const kz = (held('arrowdown', 's') ? 1 : 0) - (held('arrowup', 'w') ? 1 : 0);
        if (kx || kz) return { direction: { x: kx, z: kz }, push: 1 };
        if (!this.stickFrom || !this.stickAt) return { direction: null, push: 0 };
        const dx = this.stickAt.x - this.stickFrom.x;
        const dy = this.stickAt.y - this.stickFrom.y;
        const push = Math.min(1, Math.hypot(dx, dy) / STICK.radius);
        if (push < 0.12) return { direction: null, push: 0 };
        return { direction: { x: dx, z: dy }, push };
    }

    // ---------------------------------------------------------------- the camera

    /** High over the car, north up, looking a little ahead of where it's going; `catchUp` 1: there at once, else easing after it. */
    private placeCamera(catchUp: number): void {
        const car = this.car;
        if (!car) return;
        const camera = this.threeCamera;
        camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
        const lead = car.forward.multiplyScalar(CAMERA.lead * Math.min(1, Math.max(0, car.speed) / this.config.maxSpeed));
        this.look.lerp(car.position.clone().add(lead), catchUp);
        camera.position.copy(this.look).add(new THREE.Vector3(0, CAMERA.up, CAMERA.back));
        camera.lookAt(this.look);
        camera.updateProjectionMatrix();
    }

    // ---------------------------------------------------------------- frame

    public update(delta: number): void {
        const dt = Math.min(delta, 0.1);
        this.time += dt;
        this.wayTimer -= dt;
        this.town?.update(dt);
        const car = this.car;
        if (car) {
            const driving = this.phase === 'toHouse' || this.phase === 'toRestaurant';
            // The engine: idling, louder with speed.
            RestaurantAudio.loop('car', this.phase !== 'done', 0.35 + 0.65 * Math.min(1, Math.abs(car.speed) / this.config.maxSpeed));
            car.update(dt, driving ? this.input() : { direction: null, push: 0 }, this.grid);
            // Into the traffic: a bump (it stops; this car's knocked back).
            const bumped = car.bump(this.town?.cars ?? [], this.grid);
            if (bumped >= 0) {
                this.town?.stopCar(bumped);
                if (this.time - this.lastBump > BUMP_SOUND) RestaurantAudio.play('drop', 0.7);
                this.lastBump = this.time;
            }
            this.placeCamera(1 - Math.exp(-dt * CAMERA.follow));
            // The world curves away round the car.
            bendAround(car.position.x, car.position.z);
            // There?
            if (driving && this.target && car.position.distanceTo(this.target) < this.config.arriveRadius) {
                if (this.phase === 'toHouse') this.dropBox();
                else if (this.delivered >= this.houses.length) this.finish();
                else this.loadBox();
            }
        }
        this.layArrows(dt);
        this.fadeOccluders(dt);
        const spinner = this.beacon?.getObjectByName('spinner');
        if (spinner) {
            spinner.rotation.y += dt * 1.8;
            spinner.position.y = 3.2 + Math.sin(this.time * 2.5) * 0.25;
        }
        this.hud?.setStick(this.stickFrom, this.stickAt);
        bendAll(this.threeScene);
        super.update(delta);
    }

    public resize(): void {
        this.hud?.reposition();
        this.placeCamera(1);
    }

    public destroy(): void {
        RestaurantAudio.stopLoops();
        this.gone = true;
        window.removeEventListener('pointerdown', this.onPointerDown);
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointercancel', this.onPointerUp);
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        DebugOverlay.instance.removePanel('restaurant.delivery');
        this.car?.destroy();
        this.guide?.destroy();
        this.room?.dispose();
        this.town?.dispose();
        this.hud?.destroy();
        super.destroy();
    }
}
