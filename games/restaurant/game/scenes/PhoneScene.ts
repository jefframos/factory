// PhoneScene.ts
//
// Phone orders: a minigame after a day with the pizza oven, before the delivery. The camera's close on the pizza station
// (the stage's own: the room's oven and board), a phone on its own little table in front of the station's left, the boxes' pile on top of the
// oven, and a window cut in the wall behind the ingredients (the pile goes out through it).
//   1. The phone rings (it shakes; the hand points at it): tap it — the handset comes up and the order shows as a
//      customer's does (the pizza they want, in the speech bubble), the handset goes back.
//   2. Make it at the station (world/Pizza.ts, as in the restaurant — the same ticket at the top ticking each layer, the
//      same timer over the oven, the same ready badge), then tap it baked (or SERVE): into a box on the pile, the lid
//      shuts. Not the order: tossed, make it again.
//   3. The phone rings again, as many times as there are pizzas to deliver (settings.json delivery.deliveries).
// All boxed: the pile goes out through the window, the card (DELIVER!), on to the delivery — which takes those boxes out.

import { DebugOverlay } from 'core/debug/DebugOverlay';
import { Game } from 'core/Game';
import type { Room } from 'core/rooms/Room';
import SetupThree from 'core/scene/SetupThree';
import { ThreeScene } from 'core/scene/ThreeScene';
import gsap from 'gsap';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RestaurantAudio } from '../audio/RestaurantAudio';
import { BASIC_PIZZA_TOPPINGS, PIZZA_BASE, PIZZA_LAYER_MODELS, PIZZA_OVEN_MODEL, PIZZA_SOURCE_MODELS, PizzaTopping, pizzaMatches, pizzaRecipe, randomPizza } from '../data/Recipes';
import { RestaurantSave } from '../data/RestaurantSave';
import { SETTINGS, stageSettings } from '../data/Settings';
import { PhoneHud } from '../ui/PhoneHud';
import { RestaurantHud } from '../ui/RestaurantHud';
import { uiPress } from '../ui/UiParts';
import { bendAll, bendAround } from '../world/Bend';
import { kitchenModel, loadModels } from '../world/Models';
import { PizzaStation, PizzaTarget } from '../world/Pizza';
import { PIZZA_BOARD, PIZZA_OVEN, SHOT_ASPECT, buildRoom, roomModels, wallAhead } from '../world/RestaurantLayout';

const MODELS = [...new Set([...Object.values(PIZZA_LAYER_MODELS), ...Object.values(PIZZA_SOURCE_MODELS), PIZZA_OVEN_MODEL, 'cuttingboard', 'plate', 'pizzabox_open', 'pizzabox_closed', 'pizzabox_stacked', 'kitchentable_A'])];
/**
 * The station's things: the phone and the pile this far in from its front corners (along the camera's right and
 * away from it); a box's size (x the kit's) and how far up the next one goes; what counts as the station's counters
 * (props this near the board, their tops at about a counter's height).
 */
/** The phone's own little table, in front of the station (toward the camera): how far out, its size (x the kit's 2 x 1 x 2 table). */
const PHONE_TABLE = { out: 0.75, scale: 0.42, height: 1.0 };
/** (The phone's table: this far left of the board's middle, this far out in front of it.) */
const SPOTS = { phoneLeft: 0.5, phoneOut: 1.8, inside: 0.45, box: 0.55, boxStep: 0.2, near: 3.4, counter: [0.7, 1.4] as const };
/** The window cut behind the station: how wide, its bottom (just over the counters) and its height. */
const WINDOW = { width: 1.8, bottom: 1.05, height: 1.1, thickness: 0.6 };
/** The phone: its tap reach (screen pixels), its bell (s between rings), the handset's lift and the talk (s). */
const PHONE = { reach: 110, ringEvery: 0.55, lift: 0.35, talk: 1.6 };
/** Between orders: the next call this long after a box shuts (s). */
const NEXT_CALL = 1.0;
/** The camera: close on the station — round its things (`margin`), pulled back only for the HUD (`back`). */
const VIEW = { margin: 0.3, back: 1.0, left: 0 };

/**
 * The phone orders' pizzas: the stage's toppings and settings.json phone's (a minigame gets more to make than the
 * stage's service: its plain cheese pizza alone was dull), as many toppings as either allows.
 */
function phoneToppings(stage: number): { toppings: PizzaTopping[]; maxToppings: number } {
    const pizza = stageSettings(stage).pizza;
    const phone = SETTINGS.phone;
    const toppings = [...new Set([...(pizza?.toppings ?? BASIC_PIZZA_TOPPINGS), ...(phone?.toppings ?? [])])];
    return { toppings, maxToppings: Math.max(pizza?.maxToppings ?? 2, phone?.maxToppings ?? 0) };
}

type Phase = 'loading' | 'ringing' | 'talking' | 'making' | 'boxing' | 'out' | 'done';

export default class PhoneScene extends ThreeScene {
    private hud: RestaurantHud | null = null;
    private boxesHud: PhoneHud | null = null;
    private room: Room | null = null;
    private pizza: PizzaStation | null = null;
    /** The oven prop (the boxes pile on its top). */
    private oven: THREE.Object3D | null = null;
    private readonly orders: PizzaTopping[][] = [];
    private current = 0;
    private phase: Phase = 'loading';
    private readonly phone = new THREE.Group();
    private phoneTable: THREE.Object3D | null = null;
    private readonly handset = new THREE.Group();
    private readonly boxes: THREE.Object3D[] = [];
    private pileAt = new THREE.Vector3();
    /** The window behind the station (its middle; null: no wall there, the boxes just go). */
    private window: THREE.Vector3 | null = null;
    private ringTimer = 0;
    private wasReady = false;
    private time = 0;
    private gone = false;

    /** `onDone`: DELIVER! (on to the delivery). */
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
        window.addEventListener('pointerdown', this.onPointerDown);
        const panel = DebugOverlay.instance.panel('Phone orders', { id: 'restaurant.phone' });
        panel.button('FINISH', () => this.sendOut());
        void this.load();
    }

    private async load(): Promise<void> {
        const stage = RestaurantSave.stage;
        try {
            await loadModels([...new Set([...MODELS, ...roomModels(stage)])]);
        } catch (error) {
            console.error('[Phone] could not load the models', error);
            return;
        }
        if (this.gone) return;
        // Built once to find the station and which way it faces; then again with the window cut in the wall behind it.
        if (!this.buildStation(stage)) {
            console.warn('[Phone] no pizza oven at this stage: on to the delivery');
            gsap.delayedCall(0.1, () => { if (!this.gone) this.onDone(); });
            return;
        }
        const { back } = this.axes();
        // (Behind the ingredients' grid — the cheese and toppings — not the board: that's in front of the oven.)
        const grid = this.pizza!.targets.filter((t) => !['dough', 'sauce', 'pizza', 'oven'].includes(t.kind)).map((t) => t.at);
        const from = grid.length ? grid.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / grid.length) : this.pizza!.dishPoint;
        const hit = wallAhead(stage, { x: from.x, z: from.z }, { x: back.x, z: back.z });
        if (hit) {
            const corners = [-1, 1].flatMap((u) => [-1, 1].map((v) => ({
                x: hit.at.x + hit.along.x * u * WINDOW.width / 2 - hit.along.z * v * WINDOW.thickness / 2,
                z: hit.at.z + hit.along.z * u * WINDOW.width / 2 + hit.along.x * v * WINDOW.thickness / 2,
            })));
            const opening = {
                kind: 'window' as const, bottom: WINDOW.bottom, height: WINDOW.height,
                minX: Math.min(...corners.map((c) => c.x)), maxX: Math.max(...corners.map((c) => c.x)),
                minZ: Math.min(...corners.map((c) => c.z)), maxZ: Math.max(...corners.map((c) => c.z)),
            };
            this.pizza?.destroy();
            this.room?.dispose();
            this.room?.group.removeFromParent();
            this.buildStation(stage, [{ wall: hit.wall, opening }]);
            this.window = new THREE.Vector3(hit.at.x, WINDOW.bottom + WINDOW.height / 2, hit.at.z);
        }
        const { toppings, maxToppings } = phoneToppings(stage);
        for (let i = 0; i < SETTINGS.delivery.deliveries; i++) {
            this.orders.push(randomPizza(maxToppings, toppings));
        }
        this.hud = new RestaurantHud(() => this.trash(), () => this.boxIt());
        this.hud.phoneMode();
        this.hud.setPips('PHONE ORDERS', [], this.orders.length);
        this.boxesHud = new PhoneHud(this.orders.length, () => this.trash());
        this.game.uiLayer.addChild(this.boxesHud, this.hud);
        this.placeThings();
        const at = this.pizza!.ovenPoint;
        bendAround(at.x, at.z);
        bendAll(this.threeScene);
        this.placeCamera();
        gsap.delayedCall(0.8, () => this.ring());
    }

    /** The room (with `extra` openings) and the pizza station in it, at this stage's ingredients; false: no oven. */
    private buildStation(stage: number, extra?: Parameters<typeof buildRoom>[1]): boolean {
        this.room = buildRoom(stage, extra);
        this.threeScene.add(this.room.group);
        const oven = this.room.group.children.find((child) => PIZZA_OVEN.test(child.name));
        if (!oven) return false;
        this.oven = oven;
        const { toppings } = phoneToppings(stage);
        this.pizza = new PizzaStation(this.threeScene, oven, this.room.props.get(PIZZA_BOARD) ?? null, [...PIZZA_BASE, ...toppings]);
        return true;
    }

    // ---------------------------------------------------------------- the phone and the pile

    /** The camera's right and its "away" (both flat), from the station's own shot. */
    private axes(): { right: THREE.Vector3; back: THREE.Vector3 } {
        const shot = this.pizza!.shot;
        const toCamera = new THREE.Vector3(shot.position.x - shot.target.x, 0, shot.position.z - shot.target.z).normalize();
        return { right: new THREE.Vector3(toCamera.z, 0, -toCamera.x), back: toCamera.clone().negate() };
    }

    /** The station's counters (props near the board at a counter's height): their extent along the camera's axes. */
    private stationExtent(): { left: number; right: number; front: number; top: number } {
        const { right, back } = this.axes();
        const board = this.pizza!.dishPoint;
        let left = -1.5, far = 1.5, front = -1, top = board.y;
        let found = false;
        for (const { object } of this.room?.placed ?? []) {
            const box = new THREE.Box3().setFromObject(object);
            if (box.isEmpty() || box.max.y < SPOTS.counter[0] || box.max.y > SPOTS.counter[1]) continue;
            const middle = box.getCenter(new THREE.Vector3());
            if (Math.hypot(middle.x - board.x, middle.z - board.z) > SPOTS.near) continue;
            for (const x of [box.min.x, box.max.x]) {
                for (const z of [box.min.z, box.max.z]) {
                    const d = new THREE.Vector3(x - board.x, 0, z - board.z);
                    const r = d.dot(right);
                    const b = d.dot(back);
                    if (!found) {
                        left = far = r;
                        front = b;
                        found = true;
                    }
                    left = Math.min(left, r);
                    far = Math.max(far, r);
                    front = Math.min(front, b);
                }
            }
            top = Math.max(top, box.max.y);
        }
        return { left, right: far, front, top: found ? top : board.y };
    }

    private placeThings(): void {
        const pizza = this.pizza!;
        const { right, back } = this.axes();
        const board = pizza.dishPoint;
        // The phone on a little table of its own, just in front of the station's left (before the board and the oven),
        // facing the camera.
        const spot = board.clone().addScaledVector(right, -SPOTS.phoneLeft).addScaledVector(back, -SPOTS.phoneOut);
        this.buildPhone();
        this.phone.rotation.y = Math.atan2(-back.x, -back.z);
        const table = kitchenModel('kitchentable_A');
        table.scale.set(PHONE_TABLE.scale, PHONE_TABLE.height, PHONE_TABLE.scale);
        table.position.set(spot.x, 0, spot.z);
        table.rotation.y = this.phone.rotation.y;
        this.threeScene.add(table);
        this.phoneTable = table;
        this.phone.position.set(spot.x, new THREE.Box3().setFromObject(table).max.y, spot.z);
        this.threeScene.add(this.phone);
        // The pile on top of the oven (out of the making's way).
        const ovenBox = new THREE.Box3().setFromObject(this.oven!);
        const ovenMiddle = ovenBox.getCenter(new THREE.Vector3());
        this.pileAt = new THREE.Vector3(ovenMiddle.x, ovenBox.max.y, ovenMiddle.z);
    }

    /** A desk phone: a red body, a white dial on its front, the handset across its top (it lifts when picked up). */
    private buildPhone(): void {
        const red = new THREE.MeshStandardMaterial({ color: 0xe84a4a, roughness: 0.45 });
        const white = new THREE.MeshStandardMaterial({ color: 0xfaf3e6, roughness: 0.5 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x3a2b2b, roughness: 0.6 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.32), red);
        body.position.y = 0.09;
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.2), red);
        top.position.set(0, 0.2, -0.03);
        const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 20), white);
        dial.rotation.x = Math.PI / 2 - 0.5;
        dial.position.set(0, 0.11, 0.165);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 12), dark);
        hub.rotation.x = dial.rotation.x;
        hub.position.set(0, 0.112, 0.172);
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 12), red);
        grip.rotation.z = Math.PI / 2;
        const ends = [-1, 1].map((side) => {
            const end = new THREE.Mesh(new THREE.SphereGeometry(0.065, 14, 10), red);
            end.scale.set(1, 0.7, 1.2);
            end.position.set(side * 0.19, -0.01, 0);
            return end;
        });
        this.handset.add(grip, ...ends);
        this.handset.position.set(0, 0.27, -0.03);
        this.phone.add(body, top, dial, hub, this.handset);
        this.phone.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) child.castShadow = child.receiveShadow = true;
        });
        this.phone.scale.setScalar(1.25);
    }

    /** Close on the station: its way of looking, back just far enough for its targets, the phone and the pile. */
    private placeCamera(): void {
        const pizza = this.pizza;
        if (!pizza) return;
        const shot = pizza.shot;
        const { right, back } = this.axes();
        // (The whole oven, and the phone's table: nothing cut at the edges.)
        const corners = (object: THREE.Object3D | null) => {
            if (!object) return [];
            const box = new THREE.Box3().setFromObject(object);
            return [box.min.x, box.max.x].flatMap((x) => [box.min.z, box.max.z].map((z) => new THREE.Vector3(x, box.max.y * 0.5, z)));
        };
        const points = [this.phone.position.clone(), this.pileAt.clone(), pizza.ovenPoint, ...pizza.targets.map((t) => t.at), ...corners(this.oven), ...corners(this.phoneTable)];
        const middle = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length);
        const spread = (axis: THREE.Vector3) => {
            const along = points.map((p) => p.clone().sub(middle).dot(axis));
            return Math.max(...along) - Math.min(...along) + VIEW.margin * 2;
        };
        const aspect = Math.min(this.threeCamera.aspect, SHOT_ASPECT * 1.6);
        const tan = Math.tan(THREE.MathUtils.degToRad(shot.fov / 2));
        const distance = Math.max(spread(right) / 2 / (tan * aspect), spread(back) / 2 / tan) * VIEW.back;
        const direction = new THREE.Vector3(shot.position.x - shot.target.x, shot.position.y - shot.target.y, shot.position.z - shot.target.z).normalize();
        const aim = middle.clone();
        aim.y = pizza.dishPoint.y;
        // A little to the left (the oven's whole front in, the phone's table still at the right).
        aim.addScaledVector(right, -VIEW.left);
        this.threeCamera.fov = shot.fov;
        this.threeCamera.position.copy(aim).addScaledVector(direction, distance);
        this.threeCamera.lookAt(aim);
        this.threeCamera.updateProjectionMatrix();
        this.threeCamera.updateMatrixWorld();
    }

    private get phoneTop(): THREE.Vector3 {
        return this.phone.position.clone().add(new THREE.Vector3(0, 0.35, 0));
    }

    // ---------------------------------------------------------------- the calls

    /** The next call: the phone rings (shakes, rings; the hand on it) till it's picked up. */
    private ring(): void {
        if (this.gone || this.current >= this.orders.length) return;
        this.phase = 'ringing';
        this.ringTimer = 0;
        this.hud?.showHint(this.current === 0 ? 'The phone\'s ringing! Pick it up' : 'Another call!', 30);
    }

    /** Picked up: the handset up, the order shown (as a customer's: the caller's face, the pizza); then make it. */
    private answer(): void {
        if (this.phase !== 'ringing' || !this.hud) return;
        this.phase = 'talking';
        RestaurantAudio.play('pick', 1.2);
        this.hud.showHint(null);
        this.phone.rotation.z = 0;
        const order = { toppings: [], pizza: this.orders[this.current] };
        const rest = this.handset.position.clone();
        gsap.timeline({
            onComplete: () => {
                if (this.gone || !this.hud) return;
                this.hud.hideOrder();
                this.hud.showTicket(order);
                this.hud.setButtons(true);
                this.phase = 'making';
            },
        })
            .to(this.handset.position, { y: rest.y + 0.35, z: rest.z + 0.15, duration: PHONE.lift, ease: 'back.out(2)' })
            .call(() => {
                const at = this.worldToScreen(this.phoneTop);
                if (at) this.hud?.showOrder(order, at);
            })
            .to(this.handset.rotation, { z: 0.25, duration: 0.15, yoyo: true, repeat: 3 })
            .to(this.handset.position, { x: rest.x, y: rest.y, z: rest.z, duration: PHONE.lift, ease: 'power2.in' }, `+=${PHONE.talk * 0.5}`)
            .call(() => RestaurantAudio.play('drop', 1.3))
            .to({}, { duration: PHONE.talk * 0.3 });
    }

    // ---------------------------------------------------------------- taps

    private readonly onPointerDown = (event: PointerEvent): void => {
        RestaurantAudio.unlock();
        if (uiPress.taken) {
            uiPress.taken = false;
            return;
        }
        const pizza = this.pizza;
        if (!pizza) return;
        const rect = SetupThree.renderer.domElement.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        if (this.phase === 'ringing') {
            const at = this.worldToScreen(this.phone.position.clone().add(new THREE.Vector3(0, 0.2, 0)));
            if (at && Math.hypot(x - at.x, y - at.y) <= PHONE.reach) this.answer();
            return;
        }
        if (this.phase !== 'making') return;
        // The target whose middle is nearest the tap on screen, within its radius.
        const across = new THREE.Vector3().setFromMatrixColumn(this.threeCamera.matrixWorld, 0);
        let nearest: { kind: PizzaTarget; score: number } | null = null;
        for (const target of pizza.targets) {
            const middle = this.worldToScreen(target.at);
            const edge = this.worldToScreen(target.at.clone().addScaledVector(across, target.radius));
            if (!middle || !edge) continue;
            const score = Math.hypot(x - middle.x, y - middle.y) / Math.max(1, Math.hypot(edge.x - middle.x, edge.y - middle.y));
            if (score <= 1 && (!nearest || score < nearest.score)) nearest = { kind: target.kind, score };
        }
        if (nearest) this.tap(nearest.kind);
    };

    private tap(kind: PizzaTarget): void {
        const pizza = this.pizza!;
        const result = pizza.take(kind);
        if (result === 'serve') {
            this.boxIt();
            return;
        }
        if (result === 'bake') {
            RestaurantAudio.play('whoosh', 0.9);
            return;
        }
        if (result !== 'done') {
            RestaurantAudio.play('wrong');
            const why: Record<string, string> = {
                noDough: 'Start with the dough',
                has: kind === 'dough' ? 'There\'s a pizza on the board already' : 'It has that already',
                baking: 'Still baking...',
                baked: 'It\'s baked: tap it to box it!',
            };
            this.hud?.showHint(why[result] ?? null);
            return;
        }
        RestaurantAudio.play('pick', 0.9 + Math.random() * 0.2);
        gsap.delayedCall(0.33, () => {
            RestaurantAudio.play('drop');
            this.hud?.tickTicket(pizza.made);
        });
    }

    private trash(): void {
        if (this.phase !== 'making' || !this.pizza?.hasPizza) return;
        if (this.pizza.trash(null)) {
            RestaurantAudio.play('whoosh', 0.8);
            this.hud?.tickTicket([]);
        } else {
            this.hud?.showHint('Wait till it\'s out of the oven');
        }
    }

    /** The baked pizza tapped (or SERVE): the order's (into a box on the pile, the lid shuts) or not (tossed: again). */
    private boxIt(): void {
        const pizza = this.pizza;
        const order = this.orders[this.current];
        if (!pizza || !order || this.phase !== 'making') return;
        if (!pizza.ready) {
            RestaurantAudio.play('wrong');
            this.hud?.showHint(!pizza.hasPizza ? 'Start with the dough' : pizza.inOven ? 'Still baking...' : 'Bake it first: tap the pizza');
            return;
        }
        if (!pizzaMatches(order, pizza.layers, pizza.baked)) {
            RestaurantAudio.play('sad');
            this.hud?.showHint('That\'s not the order! Make it again', 2.2);
            pizza.trash(null);
            this.hud?.tickTicket([]);
            return;
        }
        this.phase = 'boxing';
        RestaurantSave.learnPizza();
        RestaurantAudio.play('whoosh');
        this.hud?.setButtons(false);
        this.hud?.hideTicket();
        this.hud?.setReady(null);
        const index = this.boxes.length;
        const spot = this.pileAt.clone().add(new THREE.Vector3(0, index * SPOTS.boxStep, 0));
        // An open box waits on the pile; the pizza lands in it, the lid shuts.
        const open = kitchenModel('pizzabox_open');
        open.scale.setScalar(SPOTS.box);
        open.position.copy(spot);
        open.rotation.y = this.phone.rotation.y;
        this.threeScene.add(open);
        gsap.from(open.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.25, ease: 'back.out(2)' });
        pizza.serveTo(spot.clone().add(new THREE.Vector3(0, 0.05, 0)), (plate) => {
            plate.removeFromParent();
            open.removeFromParent();
            if (this.gone) return;
            const closed = kitchenModel('pizzabox_closed');
            closed.scale.setScalar(SPOTS.box);
            closed.position.copy(spot);
            closed.rotation.y = this.phone.rotation.y;
            this.threeScene.add(closed);
            this.boxes.push(closed);
            gsap.fromTo(closed.scale, { x: SPOTS.box * 1.15, y: SPOTS.box * 0.7, z: SPOTS.box * 1.15 }, { x: SPOTS.box, y: SPOTS.box, z: SPOTS.box, duration: 0.3, ease: 'back.out(3)' });
            RestaurantAudio.play('coins', 1.2);
            this.boxesHud?.boxFilled(index);
            this.hud?.setPips('PHONE ORDERS', this.boxes.map(() => true), this.orders.length);
            this.current++;
            if (this.current >= this.orders.length) gsap.delayedCall(0.5, () => this.sendOut());
            else gsap.delayedCall(NEXT_CALL, () => this.ring());
        });
    }

    /** The pile out through the window behind the station (box by box: up, over, through and away), then the card. */
    private sendOut(): void {
        if (this.gone || this.phase === 'out' || this.phase === 'done' || !this.pizza) return;
        this.phase = 'out';
        this.hud?.setButtons(false);
        this.hud?.hideTicket();
        this.hud?.showHint('Out for delivery!', 30);
        const { back } = this.axes();
        const opening = this.window ?? this.pizza.dishPoint.clone().addScaledVector(back, 2).setY(1.6);
        const away = opening.clone().addScaledVector(back, 2.5);
        this.boxes.forEach((box, i) => {
            const delay = (this.boxes.length - 1 - i) * 0.3;
            const from = box.position.clone();
            const state = { t: 0 };
            gsap.timeline({ delay })
                .to(state, {
                    t: 1, duration: 0.6, ease: 'power1.inOut',
                    onUpdate: () => {
                        box.position.lerpVectors(from, opening, state.t);
                        box.position.y += Math.sin(state.t * Math.PI) * 0.6;
                    },
                })
                .call(() => RestaurantAudio.play('whoosh', 1.2))
                .to(box.position, { x: away.x, z: away.z, duration: 0.35, ease: 'power1.in' })
                .to(box.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.2 }, '<0.15');
        });
        gsap.delayedCall(this.boxes.length * 0.3 + 1.3, () => this.finish());
    }

    private finish(): void {
        if (this.gone || this.phase === 'done' || !this.boxesHud) return;
        this.phase = 'done';
        this.hud?.showHint(null);
        RestaurantAudio.play('happy');
        this.boxesHud.showDone(this.orders.length, () => {
            if (!this.gone) this.onDone();
        });
    }

    // ---------------------------------------------------------------- the hand

    /** What to tap next: the ringing phone; then (till they've made a pizza right) each step. */
    private hint(): THREE.Vector3 | null {
        const pizza = this.pizza;
        if (!pizza) return null;
        if (this.phase === 'ringing') return this.phone.position.clone().add(new THREE.Vector3(0, 0.2, 0));
        if (this.phase !== 'making') return null;
        const order = this.orders[this.current];
        // (A baked pizza has its own badge and arrow.)
        if (pizza.ready || pizza.inOven || !pizza.hasPizza && RestaurantSave.pizzaLearned) return null;
        const missing = pizzaRecipe(order).find((layer) => !pizza.layers.includes(layer));
        // Everything on (and nothing else): always the hand on the pizza — tap it into the oven.
        if (pizza.hasPizza && !missing && pizza.layers.length === pizzaRecipe(order).length) return pizza.targetPoint('pizza');
        // Till they've made one right: each step.
        if (RestaurantSave.pizzaLearned) return null;
        if (!pizza.hasPizza) return pizza.targetPoint('dough');
        return missing ? pizza.targetPoint(missing) : null;
    }

    // ---------------------------------------------------------------- the frame

    public update(delta: number): void {
        const dt = Math.min(delta, 0.1);
        this.time += dt;
        const pizza = this.pizza;
        const hud = this.hud;
        if (pizza && hud) {
            pizza.update(dt);
            // Ringing: the bell every so often, the phone shaking.
            if (this.phase === 'ringing') {
                this.ringTimer -= dt;
                if (this.ringTimer <= 0) {
                    this.ringTimer = PHONE.ringEvery;
                    RestaurantAudio.play('click', 1.8);
                }
                this.phone.rotation.z = Math.sin(this.time * 40) * 0.08;
                this.handset.position.y = 0.27 + Math.abs(Math.sin(this.time * 20)) * 0.03;
            }
            bendAll(this.threeScene);
            this.threeCamera.updateMatrixWorld();
            hud.setCooking(this.phase === 'making' ? pizza.bakeProgress : null, this.worldToScreen(pizza.ovenPoint));
            const ready = this.phase === 'making' && pizza.ready;
            if (ready !== this.wasReady) {
                this.wasReady = ready;
                pizza.setReadyPulse(ready);
                if (ready) RestaurantAudio.play('coins', 1.3);
            }
            hud.setReady(ready ? this.worldToScreen(pizza.dishPoint) : null);
            const hint = this.hint();
            hud.pointAt(hint ? this.worldToScreen(hint) : null);
        }
        // (The 3D view's drawn here.)
        super.update(delta);
    }

    public resize(): void {
        this.hud?.reposition();
        this.boxesHud?.reposition();
        this.placeCamera();
    }

    public destroy(): void {
        this.gone = true;
        window.removeEventListener('pointerdown', this.onPointerDown);
        DebugOverlay.instance.removePanel('restaurant.phone');
        gsap.killTweensOf([this.handset.position, this.handset.rotation]);
        this.boxes.forEach((box) => gsap.killTweensOf([box.position, box.scale]));
        this.pizza?.destroy();
        this.room?.dispose();
        this.hud?.destroy();
        this.boxesHud?.destroy();
        super.destroy();
    }
}
