// RestaurantScene.ts
//
// A restaurant day. Its orders were dealt ahead (RestaurantSave: the supermarket's list was made from them), and the
// customers come in one at a time:
//   1. the customer walks in from the door to the counter (the camera on them, from the cook's side of the counter);
//   2. they say what they want (a speech bubble: a burger and its toppings);
//   3. the camera drops to the benches: tap a bottom bun, cook a patty (tap the raw patties: one hops into the pan; tap
//      the pan once it's done), tap each topping asked for, tap a top bun; TRASH starts the plate again, SERVE sends it;
//   4. the camera comes back up, the plate slides across: right (bun, one patty, exactly the toppings, bun on top) and
//      the customer's happy and pays, wrong and they're sad; then they walk out.
// An ice cream order (a stage with the ice cream machine: world/IceCream.ts) goes to the machine instead of the bench: the
// camera turns to it; tap the cones (one onto the tray), tap the flavour's handle (the swirl comes out), tap the cone.
// A stage served 'seated' (settings.json stages[].service: the small diner) goes another way:
//   1. each customer takes a free seat (the layout's `seats`; all taken: they wait by the door) and sits down;
//   2. after a moment a "!" bobs over them: tap them for their order (the bubble), then the bench as above;
//   3. SERVE sends the plate onto their table; they eat (the food goes, bite by bite) and leave — the plate stays;
//   4. tap the dirty plate (sparkles over it) to clear it: only then can the next customer sit there.
//   The stage's first day can use fewer seats than there are customers (settings.json stages[].firstDay), to teach it.
// After the day's customers, the day's card (stars for the happy ones, the coins made), and off to the
// supermarket for the next day (`onDayDone`). The first day, a hand points at what to tap next.
//
// 3D (THREE, behind) and the HUD (PIXI, over it); a tap on the benches goes to the Kitchen target nearest it on screen.
// The day's coins are saved when it ends.

import * as THREE from 'three';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import SetupThree from 'core/scene/SetupThree';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import { KITCHEN_MODELS, Kitchen, TargetKind } from '../world/Kitchen';
import { CameraShot, customerPath, ICE_CREAM_MACHINE, SHOT_ASPECT, SeatLayout, StationLayout, buildRoom, roomModels, seatsAt, stationAt } from '../world/RestaurantLayout';
import { IceCreamStation, IceTarget } from '../world/IceCream';
import { stageSettings } from '../data/Settings';
import type { Room } from 'core/rooms/Room';
import { Town } from '../world/Town';
import { bendAll, bendAround } from '../world/Bend';
import { Customer } from '../world/Customers';
import { loadModels } from '../world/Models';
import { CONE_MODEL, CONE_STACK_MODEL, ICE_CREAM_MODELS, Order, SWIRL_MODELS, matches, payFor } from '../data/Recipes';
import { RestaurantSave } from '../data/RestaurantSave';
import { RestaurantHud } from '../ui/RestaurantHud';
import { uiPress } from '../ui/UiParts';
import { RestaurantAudio } from '../audio/RestaurantAudio';

const MOVE_SECONDS = 0.7;
/** How long the order bubble shows before the camera drops to the bench; how long a reaction's watched. */
const ORDER_SECONDS = 1.6;
const REACT_SECONDS = 1.8;
/**
 * The queue: the day's customers all come in at once, this far apart (s), and line up behind the station's customer spot
 * (toward the door), this far apart (units). A served one steps this far to the side and walks out past the line;
 * walking out, they keep this far from anyone (and ease round them).
 */
const QUEUE = { spacing: 1.15, stepAside: 1.6, personalSpace: 0.8 };
/**
 * Customers arriving: the first after `first` seconds, then one every `gap` seconds or so (each gap x 1 ± `noise`), and
 * where each stands off their spot in the line: up to `across` either side and `along` nearer or further (at the counter:
 * `counter` either side only, so they still face the cook).
 */
const ARRIVE = { first: [0.3, 1.2], gap: 2.2, noise: 0.55 };
const SPOT_NOISE = { across: 0.28, along: 0.18, counter: 0.12 };
/** The ice cream's models (loaded with the kitchen's). */
const ICE_MODELS = [CONE_MODEL, CONE_STACK_MODEL, ...Object.values(SWIRL_MODELS), ...Object.values(ICE_CREAM_MODELS)];

type Phase = 'loading' | 'waiting' | 'ordering' | 'cooking' | 'serving' | 'leaving' | 'dayEnd';

/**
 * Seated service: once sat, how long before a customer wants to order (s, at random between); how long they eat (s);
 * how far behind their seat they come up to it from; how close (screen px) a tap must be to a customer's "!" or a
 * dirty plate; where waiting customers stand (from just inside the door, back toward it, this far apart).
 */
const SEATED = { readyAfter: [0.8, 2.2], eatSeconds: 5, approach: 0.7, tapRadius: 70, waitSpacing: 0.9, bodyHalfWidth: 0.45, plateHalfWidth: 0.35 };

/** A seated customer: who, their seat, what they'll order, and where they're at. */
interface Diner {
    customer: Customer;
    order: Order;
    seat: SeatState | null;
    state: 'arriving' | 'waiting' | 'seating' | 'seated' | 'ready' | 'ordering' | 'served' | 'eating' | 'leaving';
    marker: THREE.Sprite | null;
}

/** A seat: its layout, who's on it, and the plate left on its table (dirty, to clear). */
interface SeatState {
    def: SeatLayout;
    diner: Diner | null;
    plate: THREE.Object3D | null;
    marker: THREE.Sprite | null;
}

/** A sign over something tappable: a bobbing word or symbol on a round badge. */
function signSprite(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d')!;
    g.fillStyle = color;
    g.beginPath();
    g.arc(64, 64, 56, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = 'bold 76px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 64, 70);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
    sprite.renderOrder = 10;
    sprite.scale.setScalar(0.55);
    return sprite;
}

export default class RestaurantScene extends ThreeScene {
    private kitchen: Kitchen | null = null;
    /** The customers' way in at this stage (its station's: the truck's and the diner's doors differ). */
    private readonly path = customerPath(RestaurantSave.stage);
    /** The ice cream machine's station (a stage whose room has the machine), and what's being made now. */
    private iceCream: IceCreamStation | null = null;
    private making: 'burger' | 'iceCream' = 'burger';
    /** The restaurant round the kitchen, as it is at the player's stage (levels/restaurant.json). */
    private room: Room | null = null;
    /** The street round it (roads, cars, lawns, people). */
    private town: Town | null = null;
    /** Debug: the camera high over the street instead of the station's shots. */
    private overview = false;
    /** The burger station at the player's stage: its pieces and camera shots (levels/restaurant.json). */
    private station: StationLayout | null = null;
    private hud!: RestaurantHud;
    /** The customer at the counter (ordering, waiting for their food, reacting). */
    private customer: Customer | null = null;
    /** The day's customers still to be served, in order: the first at the counter (or walking up to it). */
    private readonly queue: Customer[] = [];
    private readonly leaving: Customer[] = [];
    private readonly orders = RestaurantSave.orders;
    private order: Order | null = null;
    private phase: Phase = 'loading';
    private results: boolean[] = [];
    private dayCoins = 0;
    /** Each happy customer's coins today (the chest gives them out a tap each). */
    private pays: number[] = [];
    /** 0: the order view, 1: the bench view (tweened between). */
    private readonly view = { t: 0 };
    private gone = false;
    /** The dish was done last frame (its "ready" signs go on and off with it). */
    private dishWasReady = false;
    /** Seated service (the stage's settings): its seats, its customers (in the order they came), who's waiting for a seat. */
    private readonly seated = stageSettings(RestaurantSave.stage).service === 'seated';
    private seats: SeatState[] = [];
    private readonly diners: Diner[] = [];
    /** Seated taps: the ray into the dining room. */
    private readonly tapRay = new THREE.Raycaster();
    private readonly waitingForSeat: Diner[] = [];
    /** The seated customer whose order's being made. */
    private diner: Diner | null = null;
    private time = 0;

    /** `onDayDone`: the day's card closed (to the supermarket). */
    public constructor(game: Game, private readonly onDayDone: () => void = () => undefined) {
        super(game);
    }

    public build(): void {
        this.threeScene.background = new THREE.Color(0xbfe3f2);
        const pmrem = new THREE.PMREMGenerator(SetupThree.renderer);
        this.threeScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.threeScene.environmentIntensity = 0.35;
        pmrem.dispose();
        this.threeScene.add(new THREE.HemisphereLight(0xfff6ea, 0xd9b08a, 1.1));
        const sun = new THREE.DirectionalLight(0xffffff, 1.6);
        sun.position.set(-4, 12, -6);
        sun.target.position.set(0, 0, 1);
        sun.castShadow = true;
        sun.shadow.mapSize.set(1024, 1024);
        Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
        sun.shadow.bias = -0.0008;
        this.threeScene.add(sun, sun.target);
        SetupThree.renderer.shadowMap.enabled = true;
        SetupThree.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.hud = new RestaurantHud(() => this.trash(), () => this.serve());
        this.hud.setCoins(0);
        this.hud.stageBar.set(RestaurantSave.stage, RestaurantSave.progress);
        this.game.uiLayer.addChild(this.hud);
        window.addEventListener('pointerdown', this.onPointerDown);
        this.buildDebug();
        void this.load();
    }

    private async load(): Promise<void> {
        try {
            await loadModels([...KITCHEN_MODELS, ...ICE_MODELS, ...roomModels(RestaurantSave.stage)]);
        } catch (error) {
            console.error('[Restaurant] could not load the models', error);
            return;
        }
        if (this.gone) return;
        this.room = buildRoom(RestaurantSave.stage);
        this.threeScene.add(this.room.group);
        // The street round it: roads, cars, lawns, people.
        this.town = new Town(RestaurantSave.stage);
        this.threeScene.add(this.town.group);
        this.station = stationAt(RestaurantSave.stage);
        this.kitchen = new Kitchen(this.threeScene, this.station);
        this.kitchen.onCooked = () => RestaurantAudio.play('pick', 1.3);
        // The ice cream machine, if the room has one (a prop of its model).
        const machine = this.room.group.children.find((child) => ICE_CREAM_MACHINE.test(child.name));
        if (machine) {
            const station = new IceCreamStation(this.threeScene, machine);
            if (station.usable) this.iceCream = station;
            else station.destroy();
        }
        bendAround(this.station.x, this.station.z);
        bendAll(this.threeScene);
        this.fitCamera();
        this.startDay();
    }

    private buildDebug(): void {
        const panel = DebugOverlay.instance.panel('Restaurant', { id: 'restaurant.debug' });
        // For poking at it from the console (and headless tests): window.restaurant.
        const query = new URLSearchParams(window.location.search);
        if (query.has('dev') || query.has('debug')) (window as unknown as { restaurant: unknown }).restaurant = this;
        panel.button('+50 TO THE BAR', () => {
            RestaurantSave.addProgress(50);
            this.hud.stageBar.set(RestaurantSave.stage, RestaurantSave.progress);
        });
        panel.button('SKIP CUSTOMER (served right)', () => this.skipCustomer());
        // A look at the whole street (roads, cars, lawns, people) from high up; again: back to the station.
        panel.button('OVERVIEW CAMERA (toggle)', () => {
            this.overview = !this.overview;
            if (!this.overview) this.fitCamera();
        });
        panel.button('END DAY', () => {
            if (this.phase !== 'dayEnd' && this.kitchen) this.endDay();
        });
        panel.button('RESET DATA', () => {
            RestaurantSave.erase();
            window.location.reload();
        });
    }

    // ---------------------------------------------------------------- the day

    private startDay(): void {
        this.results = [];
        this.dayCoins = 0;
        this.pays = [];
        const day = RestaurantSave.day;
        this.hud.setDay(day, this.results, this.orders.length);
        this.hud.banner(`DAY ${day + 1}`, `${this.orders.length} customers today`);
        this.phase = 'waiting';
        this.moveView(0);
        if (this.seated) {
            this.startSeatedDay();
            return;
        }
        // Everyone comes in from the street, one after another at uneven gaps, and lines up.
        let at = ARRIVE.first[0] + Math.random() * (ARRIVE.first[1] - ARRIVE.first[0]);
        this.orders.forEach(() => {
            gsap.delayedCall(at, () => {
                if (this.gone) return;
                const customer = new Customer(this.threeScene, this.path.start);
                this.queue.push(customer);
                this.sendToPlace(customer, [this.path.outside, this.path.inside]);
            });
            at += ARRIVE.gap * (1 + (Math.random() * 2 - 1) * ARRIVE.noise);
        });
    }

    /** Place `k` in the line (0: the counter), facing the cook: the station's customer spot, then back toward the door. */
    private queueSpot(k: number): THREE.Vector3 {
        const spot = this.kitchen!.customerSpot;
        const back = this.path.inside.clone().sub(spot).setY(0).normalize();
        return spot.clone().addScaledVector(back, QUEUE.spacing * k);
    }

    /** Their own spot near place `k`: a little off it, as people stand (at the counter only a little to the side). */
    private spotFor(customer: Customer, k: number): THREE.Vector3 {
        const spot = this.queueSpot(k);
        const back = this.path.inside.clone().sub(this.kitchen!.customerSpot).setY(0).normalize();
        const side = new THREE.Vector3(back.z, 0, -back.x);
        if (k === 0) return spot.addScaledVector(side, customer.offset.across * SPOT_NOISE.counter);
        return spot.addScaledVector(side, customer.offset.across * SPOT_NOISE.across).addScaledVector(back, customer.offset.along * SPOT_NOISE.along);
    }

    /** `customer` to their place in the line (through `via` first); the one reaching the counter orders. */
    private sendToPlace(customer: Customer, via: THREE.Vector3[] = []): void {
        const k = this.queue.indexOf(customer);
        if (k < 0) return;
        void customer.walkTo([...via, this.spotFor(customer, k)], Math.PI).then(() => {
            if (!this.gone && this.queue[0] === customer && this.phase === 'waiting') this.takeOrder(customer);
        });
    }

    /** The front of the line is at the counter: their order. */
    private takeOrder(customer: Customer): void {
        this.customer = customer;
        this.order = this.orders[this.results.length];
        this.phase = 'ordering';
        RestaurantAudio.play('pick');
        this.hud.showOrder(this.order!, this.headOnScreen() ?? { x: 0, y: 0 });
        gsap.delayedCall(ORDER_SECONDS, () => this.startCooking());
    }

    /** The debug panel: the customer at the front's done at once, served right (the line moves on). */
    private skipCustomer(): void {
        const front = this.queue[0];
        if (!front || !this.kitchen || !['waiting', 'ordering', 'cooking'].includes(this.phase)) return;
        if (this.customer !== front) {
            front.root.position.copy(this.spotFor(front, 0));
            front.root.rotation.y = Math.PI;
            // (Their walk up's over: standing there now.)
            void front.walkTo([], Math.PI);
            this.customer = front;
            this.order = this.orders[this.results.length];
        }
        this.phase = 'serving';
        this.hud.hideOrder();
        this.hud.hideTicket();
        this.hud.setButtons(false);
        this.hud.showHint(null);
        this.hud.pointAt(null);
        this.kitchen.trash();
        this.iceCream?.trash(null);
        this.moveView(0);
        this.react(true, payFor(this.order!));
    }

    private startCooking(): void {
        if (this.gone || this.phase !== 'ordering') return;
        this.phase = 'cooking';
        // An ice cream's made at the machine (the camera turns to it); the rest at the bench.
        this.making = this.order!.iceCream && this.iceCream ? 'iceCream' : 'burger';
        this.hud.hideOrder();
        this.hud.showTicket(this.order!);
        this.hud.tickTicket([]);
        this.moveView(1, () => this.hud.setButtons(true));
        RestaurantAudio.play('whoosh');
    }

    private trash(): void {
        if (this.phase !== 'cooking') return;
        if (this.making === 'iceCream') {
            if (!this.iceCream?.hasCone) return;
            this.iceCream.trash(this.trashCan());
            RestaurantAudio.play('drop', 0.8);
            this.hud.tickTicket([]);
            return;
        }
        if (!this.kitchen?.plateHasFood) return;
        // Into the trash can, if the layout has one (a prop whose model or id says trash); else just gone.
        const bin = this.trashCan();
        if (bin) this.kitchen.trashInto(bin);
        else this.kitchen.trash();
        RestaurantAudio.play('drop', 0.8);
        this.hud.tickTicket([]);
    }

    /** The trash can in the room (a prop named trash / bin), if any. */
    private trashCan(): THREE.Object3D | null {
        let found: THREE.Object3D | null = null;
        this.room?.group.traverse((child) => {
            if (!found && child.parent === this.room!.group && /trash|(^|[^a-z])bin([^a-z]|$)/i.test(child.name)) found = child;
        });
        return found;
    }

    private serve(): void {
        const kitchen = this.kitchen;
        if (this.phase !== 'cooking' || !kitchen || !this.order || !this.customer) return;
        // (Seated: this.customer is the diner being served.)
        if (this.making === 'iceCream') {
            this.serveIceCream();
            return;
        }
        if (!kitchen.plateHasFood) {
            RestaurantAudio.play('wrong');
            this.hud.showHint('The plate is empty!');
            return;
        }
        this.phase = 'serving';
        const right = matches(this.order, kitchen.onPlate);
        const pay = right ? payFor(this.order) : 0;
        this.hud.setButtons(false);
        this.hud.hideTicket();
        this.hud.showHint(null);
        this.hud.pointAt(null);
        this.moveView(0);
        RestaurantAudio.play('whoosh');
        if (this.seated && this.diner?.seat) {
            const diner = this.diner;
            const seat = diner.seat!;
            diner.state = 'served';
            kitchen.serveTo(this.platePoint(seat.def), (plate) => {
                seat.plate = plate;
                if (!this.gone) this.reactSeated(diner, right, pay);
            });
            return;
        }
        kitchen.serve(() => {
            if (!this.gone) this.react(right, pay);
        });
    }

    /** The cone (done: its swirl on) out to the customer: their table (seated) or the counter. */
    private serveIceCream(): void {
        const ice = this.iceCream;
        if (!ice || !this.order) return;
        if (!ice.ready) {
            RestaurantAudio.play('wrong');
            this.hud.showHint(ice.hasCone ? 'Pull a handle for the ice cream' : 'Grab a cone first');
            return;
        }
        this.phase = 'serving';
        const right = ice.flavor === this.order.iceCream;
        const pay = right ? payFor(this.order) : 0;
        if (right) RestaurantSave.learnIceCream();
        this.hud.setButtons(false);
        this.hud.hideTicket();
        this.hud.showHint(null);
        this.hud.pointAt(null);
        this.moveView(0);
        RestaurantAudio.play('whoosh');
        if (this.seated && this.diner?.seat) {
            const diner = this.diner;
            const seat = diner.seat!;
            diner.state = 'served';
            ice.serveTo(this.platePoint(seat.def), (plate) => {
                seat.plate = plate;
                if (!this.gone) this.reactSeated(diner, right, pay);
            });
            return;
        }
        ice.serveTo(this.kitchen!.servedPoint, () => {
            if (!this.gone) this.react(right, pay);
        }, false);
    }

    /** The customer at the counter takes their dish: happy (and pays) or not, then leaves. */
    private react(right: boolean, pay: number): void {
        const customer = this.customer!;
        this.results.push(right);
        this.hud.setDay(RestaurantSave.day, this.results, this.orders.length);
        if (right) {
            customer.cheer();
            RestaurantAudio.play('happy');
            this.dayCoins += pay;
            this.pays.push(pay);
            gsap.delayedCall(0.4, () => {
                RestaurantAudio.play('coins');
                this.hud.setCoins(this.dayCoins, true);
            });
        } else {
            customer.grumble();
            RestaurantAudio.play('sad');
        }
        this.hud.react(right, this.headOnScreen() ?? { x: 0, y: 0 }, pay);
        gsap.delayedCall(REACT_SECONDS, () => this.customerLeaves());
    }

    private customerLeaves(): void {
        if (this.gone || !this.customer) return;
        const customer = this.customer;
        this.customer = null;
        this.queue.splice(this.queue.indexOf(customer), 1);
        this.leaving.push(customer);
        this.kitchen?.clearServed();
        this.iceCream?.clearServed();
        // Out past the line: a step to its side, along it to the door, out.
        const spot = this.queueSpot(0);
        const back = this.path.inside.clone().sub(spot).setY(0).normalize();
        const side = new THREE.Vector3(back.z, 0, -back.x).multiplyScalar(QUEUE.stepAside);
        void customer.walkTo([spot.clone().add(side), this.path.inside.clone().add(side), this.path.outside, this.path.start]).then(() => {
            this.leaving.splice(this.leaving.indexOf(customer), 1);
            customer.destroy();
        });
        if (this.results.length >= this.orders.length) {
            gsap.delayedCall(0.9, () => {
                if (!this.gone && this.phase !== 'dayEnd') this.endDay();
            });
            return;
        }
        // The line moves up; the new front orders once they're at the counter.
        this.phase = 'waiting';
        this.queue.forEach((c) => this.sendToPlace(c));
    }

    /** Walking out, a customer keeps clear of everyone else (eased aside, not through them). */
    private keepApart(dt: number): void {
        const everyone = [...this.queue, ...this.leaving];
        for (const walker of this.leaving) {
            for (const other of everyone) {
                if (other === walker) continue;
                const away = walker.root.position.clone().sub(other.root.position).setY(0);
                const distance = away.length();
                if (distance > 1e-3 && distance < QUEUE.personalSpace) {
                    walker.root.position.addScaledVector(away.normalize(), Math.min(QUEUE.personalSpace - distance, 3 * dt));
                }
            }
        }
    }

    private endDay(): void {
        this.phase = 'dayEnd';
        this.hud.setButtons(false);
        this.hud.hideTicket();
        this.hud.hideOrder();
        const happy = this.results.filter(Boolean).length;
        const day = RestaurantSave.day;
        // Saved now (the chest just plays it out): the coins into the bar, the next day's orders.
        const from = { stage: RestaurantSave.stage, progress: RestaurantSave.progress };
        RestaurantSave.endDay(this.dayCoins);
        RestaurantAudio.play('day');
        this.hud.showDayEnd(day, happy, this.orders.length, this.pays, from, () => this.onDayDone());
    }

    // ---------------------------------------------------------------- seated service

    private startSeatedDay(): void {
        // The stage's first day can use fewer seats (the rest stay empty).
        const limit = RestaurantSave.stageDay === 0 ? stageSettings(RestaurantSave.stage).firstDay?.seats : undefined;
        this.seats = seatsAt(RestaurantSave.stage, limit).map((def) => ({ def, diner: null, plate: null, marker: null }));
        if (!this.seats.length) console.warn('[Restaurant] a seated stage with no seats: add some in the editor');
        let at = ARRIVE.first[0] + Math.random() * (ARRIVE.first[1] - ARRIVE.first[0]);
        this.orders.forEach((order) => {
            gsap.delayedCall(at, () => {
                if (this.gone) return;
                const diner: Diner = { customer: new Customer(this.threeScene, this.path.start), order, seat: null, state: 'arriving', marker: null };
                this.diners.push(diner);
                void diner.customer.walkTo([this.path.outside, this.path.inside]).then(() => {
                    if (!this.gone && diner.state === 'arriving') this.findSeat(diner);
                });
            });
            at += ARRIVE.gap * (1 + (Math.random() * 2 - 1) * ARRIVE.noise);
        });
    }

    private seatPoint(def: SeatLayout): THREE.Vector3 {
        return new THREE.Vector3(def.x, 0, def.z);
    }

    /** Where a seat's plate goes (world: on the table). */
    private platePoint(def: SeatLayout): THREE.Vector3 {
        return new THREE.Vector3(def.plate.x, def.plate.y ?? 1, def.plate.z);
    }

    /** A free seat (no one on it, its table cleared) for `diner`, or the wait by the door. */
    private findSeat(diner: Diner): void {
        const seat = this.seats.find((s) => !s.diner && !s.plate);
        if (!seat) {
            diner.state = 'waiting';
            if (!this.waitingForSeat.includes(diner)) this.waitingForSeat.push(diner);
            this.lineUpWaiting();
            return;
        }
        const waiting = this.waitingForSeat.indexOf(diner);
        if (waiting >= 0) this.waitingForSeat.splice(waiting, 1);
        seat.diner = diner;
        diner.seat = seat;
        diner.state = 'seating';
        const { def } = seat;
        // Up to the seat from behind it (the side away from the table), then down onto it.
        const behind = this.seatPoint(def).add(new THREE.Vector3(-Math.sin(def.rotationY), 0, -Math.cos(def.rotationY)).multiplyScalar(SEATED.approach));
        void diner.customer.walkTo([behind], def.rotationY).then(() => {
            if (this.gone || diner.state !== 'seating') return;
            diner.customer.sitAt(this.seatPoint(def), def.rotationY, def.height ?? 0.5);
            diner.state = 'seated';
            const wait = SEATED.readyAfter[0] + Math.random() * (SEATED.readyAfter[1] - SEATED.readyAfter[0]);
            gsap.delayedCall(wait, () => {
                if (this.gone || diner.state !== 'seated') return;
                diner.state = 'ready';
                diner.marker = signSprite('!', '#ff8a1f');
                this.threeScene.add(diner.marker);
                RestaurantAudio.play('pick', 1.2);
            });
        });
        this.lineUpWaiting();
    }

    /** Those waiting for a seat: lined up just inside the door, back toward it. */
    private lineUpWaiting(): void {
        const back = this.path.outside.clone().sub(this.path.inside).setY(0).normalize();
        this.waitingForSeat.forEach((diner, k) => {
            const spot = this.path.inside.clone().addScaledVector(back, SEATED.waitSpacing * k);
            spot.x += diner.customer.offset.across * 0.2;
            void diner.customer.walkTo([spot]);
        });
    }

    /** A ready customer tapped: their order (the bubble), then the bench. */
    private takeSeatedOrder(diner: Diner): void {
        if (this.phase !== 'waiting' || diner.state !== 'ready') return;
        diner.state = 'ordering';
        diner.marker?.removeFromParent();
        diner.marker = null;
        this.diner = diner;
        this.customer = diner.customer;
        this.order = diner.order;
        this.phase = 'ordering';
        RestaurantAudio.play('pick');
        this.hud.showOrder(this.order, this.headOnScreen() ?? { x: 0, y: 0 });
        gsap.delayedCall(ORDER_SECONDS, () => this.startCooking());
    }

    /** Their plate's on the table: happy (and pay) or not; then they eat it, or (wrong) just leave. */
    private reactSeated(diner: Diner, right: boolean, pay: number): void {
        this.results.push(right);
        this.hud.setDay(RestaurantSave.day, this.results, this.orders.length);
        if (right) {
            diner.customer.cheer();
            RestaurantAudio.play('happy');
            this.dayCoins += pay;
            this.pays.push(pay);
            gsap.delayedCall(0.4, () => {
                RestaurantAudio.play('coins');
                this.hud.setCoins(this.dayCoins, true);
            });
        } else {
            diner.customer.grumble();
            RestaurantAudio.play('sad');
        }
        this.hud.react(right, this.worldToScreen(diner.customer.headTop) ?? { x: 0, y: 0 }, pay);
        // The kitchen's free for the next order straight away.
        this.diner = null;
        this.customer = null;
        this.order = null;
        this.phase = 'waiting';
        if (!right) {
            gsap.delayedCall(REACT_SECONDS, () => this.dinerLeaves(diner));
            return;
        }
        diner.state = 'eating';
        // Bite by bite: the top piece first, the plate itself stays.
        const plate = diner.seat?.plate;
        const pieces = plate ? [...Kitchen.foodOn(plate)].reverse() : [];
        const each = SEATED.eatSeconds / Math.max(1, pieces.length);
        pieces.forEach((piece, i) => {
            gsap.to(piece.scale, { x: 0.001, y: 0.001, z: 0.001, duration: each * 0.6, delay: 0.6 + i * each, ease: 'power1.in', onComplete: () => { piece.removeFromParent(); } });
        });
        gsap.delayedCall(0.6 + SEATED.eatSeconds + 0.4, () => this.dinerLeaves(diner));
    }

    /** Up and out (back to where they came from); their plate stays on the table, to clear. */
    private dinerLeaves(diner: Diner): void {
        if (this.gone || diner.state === 'leaving') return;
        diner.state = 'leaving';
        const seat = diner.seat;
        if (seat) {
            seat.diner = null;
            // The dirty plate: sparkles over it until it's tapped.
            if (seat.plate && !seat.marker) {
                seat.marker = signSprite('✦', '#3fb8ff');
                this.threeScene.add(seat.marker);
            }
        }
        diner.customer.standUp();
        const behind = seat ? this.seatPoint(seat.def).add(new THREE.Vector3(-Math.sin(seat.def.rotationY), 0, -Math.cos(seat.def.rotationY)).multiplyScalar(SEATED.approach)) : diner.customer.root.position.clone();
        void diner.customer.walkTo([behind, this.path.inside, this.path.outside, this.path.start]).then(() => {
            const k = this.diners.indexOf(diner);
            if (k >= 0) this.diners.splice(k, 1);
            diner.customer.destroy();
        });
    }

    /** A dirty plate tapped: off the table (the seat's free again: the next one waiting sits there). */
    private clearPlate(seat: SeatState): void {
        const plate = seat.plate;
        if (!plate) return;
        seat.plate = null;
        seat.marker?.removeFromParent();
        seat.marker = null;
        RestaurantAudio.play('pick', 1.4);
        gsap.to(plate.position, { y: plate.position.y + 0.6, duration: 0.25, ease: 'power2.out' });
        gsap.to(plate.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.3, delay: 0.1, ease: 'back.in(2)', onComplete: () => { plate.removeFromParent(); } });
        const next = this.waitingForSeat[0];
        if (next) this.findSeat(next);
    }

    /** The day's done once everyone's been served, has gone, and every plate's cleared. */
    private seatedDayDone(): boolean {
        return this.results.length >= this.orders.length && this.diners.length === 0 && this.seats.every((s) => !s.plate);
    }

    /**
     * A tap in the dining view: a ready customer (anywhere on their body, feet to the "!" over them) or a dirty plate (it
     * and its sign). Each is a box in the world; the nearest one the tap's ray goes through wins. A near miss still counts
     * when it's within SEATED.tapRadius of a sign. Whether it took it.
     */
    private seatedTap(x: number, y: number, rect: DOMRect): boolean {
        this.tapRay.setFromCamera(new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1), this.threeCamera);
        const ray = this.tapRay.ray;
        const hit = new THREE.Vector3();
        let best: { score: number; act: () => void } | null = null;
        const tryBox = (box: THREE.Box3, act: () => void) => {
            if (!ray.intersectBox(box, hit)) return;
            const distance = hit.distanceTo(ray.origin);
            if (!best || distance < best.score) best = { score: distance, act };
        };
        const readyDiners = this.diners.filter((diner) => diner.state === 'ready');
        const dirtySeats = this.seats.filter((seat) => seat.plate);
        for (const diner of readyDiners) tryBox(this.dinerBox(diner), () => this.takeSeatedOrder(diner));
        for (const seat of dirtySeats) tryBox(this.plateBox(seat), () => this.clearPlate(seat));
        if (!best) {
            // No box under the tap: the nearest sign within reach on screen.
            const near = (sprite: THREE.Sprite | null, act: () => void) => {
                const at = sprite && this.worldToScreen(sprite.position);
                if (!at) return;
                const distance = Math.hypot(x - at.x, y - at.y);
                if (distance <= SEATED.tapRadius && (!best || distance < best.score)) best = { score: distance, act };
            };
            for (const diner of readyDiners) near(diner.marker, () => this.takeSeatedOrder(diner));
            for (const seat of dirtySeats) near(seat.marker, () => this.clearPlate(seat));
        }
        const chosen = best as { score: number; act: () => void } | null;
        chosen?.act();
        return !!chosen;
    }

    /** A customer's tap box: round them (SEATED.bodyHalfWidth), from their feet to over their head's sign. */
    private dinerBox(diner: Diner): THREE.Box3 {
        const at = diner.customer.root.position;
        const w = SEATED.bodyHalfWidth;
        const top = Math.max(diner.customer.headTop.y, diner.marker ? diner.marker.position.y + 0.25 : 0) + 0.1;
        return new THREE.Box3(new THREE.Vector3(at.x - w, at.y, at.z - w), new THREE.Vector3(at.x + w, top, at.z + w));
    }

    /** A dirty plate's tap box: round it (SEATED.plateHalfWidth), up to over its sign. */
    private plateBox(seat: SeatState): THREE.Box3 {
        const at = seat.plate!.position;
        const w = SEATED.plateHalfWidth;
        const top = (seat.marker ? seat.marker.position.y + 0.25 : at.y + 0.3);
        return new THREE.Box3(new THREE.Vector3(at.x - w, at.y - 0.1, at.z - w), new THREE.Vector3(at.x + w, top, at.z + w));
    }

    /** The signs bob over their customers and plates. */
    private updateSigns(): void {
        const bob = Math.sin(this.time * 5) * 0.08;
        for (const diner of this.diners) diner.marker?.position.copy(diner.customer.headTop).add(new THREE.Vector3(0, 0.35 + bob, 0));
        for (const seat of this.seats) if (seat.marker && seat.plate) seat.marker.position.copy(seat.plate.position).add(new THREE.Vector3(0, 0.55 + bob, 0));
    }

    // ---------------------------------------------------------------- taps on the benches

    private readonly onPointerDown = (event: PointerEvent): void => {
        RestaurantAudio.unlock();
        // A HUD button's press isn't a tap on the bench under it.
        if (uiPress.taken) {
            uiPress.taken = false;
            return;
        }
        const kitchen = this.kitchen;
        const rect = SetupThree.renderer.domElement.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        // Seated: in the dining view, a tap on a ready customer or a dirty plate.
        if (this.seated && this.phase === 'waiting' && this.view.t < 0.1) {
            this.seatedTap(x, y, rect);
            return;
        }
        if (this.phase !== 'cooking' || !kitchen || this.view.t < 0.9) return;
        // The target whose middle is nearest the tap on screen, within its radius (measured across the screen).
        const across = new THREE.Vector3().setFromMatrixColumn(this.threeCamera.matrixWorld, 0);
        if (this.making === 'iceCream' && this.iceCream) {
            let nearest: { kind: IceTarget; score: number } | null = null;
            for (const target of this.iceCream.targets) {
                // (The cone's spot follows it along the tray.)
                const at = target.kind === 'cone' ? this.iceCream.dishPoint.setY(target.at.y) : target.at;
                const middle = this.worldToScreen(at);
                const edge = this.worldToScreen(at.clone().addScaledVector(across, target.radius));
                if (!middle || !edge) continue;
                const score = Math.hypot(x - middle.x, y - middle.y) / Math.max(1, Math.hypot(edge.x - middle.x, edge.y - middle.y));
                if (score <= 1 && (!nearest || score < nearest.score)) nearest = { kind: target.kind, score };
            }
            if (nearest) this.tapIceCream(nearest.kind);
            return;
        }
        let best: { kind: TargetKind; score: number } | null = null;
        for (const target of kitchen.targets) {
            const middle = this.worldToScreen(target.at);
            const edge = this.worldToScreen(target.at.clone().addScaledVector(across, target.radius));
            if (!middle || !edge) continue;
            const radius = Math.hypot(edge.x - middle.x, edge.y - middle.y);
            const score = Math.hypot(x - middle.x, y - middle.y) / Math.max(1, radius);
            if (score <= 1 && (!best || score < best.score)) best = { kind: target.kind, score };
        }
        if (best) this.tap(best.kind);
    };

    private tap(kind: TargetKind): void {
        // The plate: a finished dish is served; otherwise, what it still needs.
        if (kind === 'plate') {
            const kitchen = this.kitchen!;
            if (kitchen.dishReady) {
                this.serve();
                return;
            }
            RestaurantAudio.play('wrong');
            this.hud.showHint(kitchen.plateHasFood ? 'Not done yet: a top bun finishes it' : 'Start with a bottom bun');
            return;
        }
        const result = this.kitchen!.take(kind);
        if (result !== 'done') {
            RestaurantAudio.play('wrong');
            const why: Record<string, string> = {
                busy: 'The pan is busy',
                raw: 'Still cooking...',
                empty: 'Tap the raw patties to cook one',
                full: 'The plate is full!',
            };
            this.hud.showHint(why[result] ?? null);
            return;
        }
        RestaurantAudio.play('pick', 0.9 + Math.random() * 0.2);
        gsap.delayedCall(0.33, () => {
            if (this.phase !== 'cooking' || !this.kitchen) return;
            RestaurantAudio.play('drop');
            this.hud.tickTicket(this.kitchen.onPlate);
        });
    }

    /** A tap at the ice cream machine: the cones, a handle, the cone (done: served). */
    private tapIceCream(kind: IceTarget): void {
        const ice = this.iceCream!;
        const result = ice.take(kind);
        if (result === 'serve') {
            this.serve();
            return;
        }
        if (result !== 'done') {
            RestaurantAudio.play('wrong');
            const why: Record<string, string> = {
                busy: ice.hasCone ? 'Pull a handle for the ice cream' : 'One moment...',
                noCone: 'Grab a cone first',
                poured: 'It has its ice cream: serve it!',
            };
            this.hud.showHint(why[result] ?? null);
            return;
        }
        RestaurantAudio.play(kind === 'cones' ? 'pick' : 'sizzle', 0.9 + Math.random() * 0.2);
        gsap.delayedCall(kind === 'cones' ? 0.33 : 1.2, () => {
            if (this.phase !== 'cooking' || this.making !== 'iceCream') return;
            RestaurantAudio.play('drop');
            this.hud.tickTicket(ice.made);
        });
    }

    /** At the machine, till they've served one right: cones, the flavour's handle, the cone. */
    private iceCreamHint(): THREE.Vector3 | null {
        const ice = this.iceCream;
        if (!ice || !this.order?.iceCream || RestaurantSave.iceCreamLearned || this.view.t < 0.99) return null;
        if (!ice.hasCone) return ice.targetPoint('cones');
        if (ice.ready) return ice.flavor === this.order.iceCream ? ice.dishPoint : null;
        if (!ice.flavor) return ice.targetPoint(this.order.iceCream);
        return null;
    }

    /** The first day: what to tap next (the hand), as a 3D point: bottom bun, patty, toppings, top bun. */
    private nextHint(): THREE.Vector3 | null {
        const kitchen = this.kitchen;
        if (this.phase === 'cooking' && this.making === 'iceCream') return this.iceCreamHint();
        if (this.seated && RestaurantSave.stageDay === 0 && this.phase === 'waiting' && this.view.t < 0.1) {
            const ready = this.diners.find((d) => d.state === 'ready' && d.marker);
            if (ready) return ready.marker!.position;
            const dirty = this.seats.find((s) => s.plate && s.marker);
            return dirty ? dirty.marker!.position : null;
        }
        if (this.seated && RestaurantSave.stageDay === 0 && this.phase === 'cooking') {
            // The bench: as the first day's.
        } else if (this.seated) {
            return null;
        }
        if ((RestaurantSave.day > 0 && !(this.seated && RestaurantSave.stageDay === 0)) || this.phase !== 'cooking' || !kitchen || !this.order || this.view.t < 0.99) return null;
        const parts = kitchen.onPlate;
        if (!parts.length) return kitchen.targetPoint('bunBottom');
        if (!parts.includes('patty')) {
            if (kitchen.pattyReady) return kitchen.targetPoint('pan');
            if (kitchen.panEmpty) return kitchen.targetPoint('patty');
            return null;
        }
        const missing = this.order.toppings.find((t) => !parts.includes(t));
        if (missing) return kitchen.targetPoint(missing);
        if (!parts.includes('bunTop')) return kitchen.targetPoint('bunTop');
        // Done: the dish itself (tap it to serve).
        return kitchen.dishReady ? kitchen.platePoint : null;
    }

    // ---------------------------------------------------------------- the camera

    /** To the order view (0) or the bench view (1). */
    private moveView(to: 0 | 1, done?: () => void): void {
        gsap.killTweensOf(this.view);
        gsap.to(this.view, { t: to, duration: MOVE_SECONDS, ease: 'power2.inOut', onUpdate: () => this.fitCamera(), onComplete: done });
    }

    /**
     * A station camera shot (levels/restaurant.json, framed in the editor for a 720 x 1080 screen): its position and
     * target; a screen narrower than that pulls back along the view, so the shot's width still fits (wider shows more).
     */
    private pose(shot: CameraShot): { position: THREE.Vector3; aim: THREE.Vector3 } {
        const aim = new THREE.Vector3(shot.target.x, shot.target.y, shot.target.z);
        const position = new THREE.Vector3(shot.position.x, shot.position.y, shot.position.z);
        const aspect = this.threeCamera.aspect;
        if (aspect < SHOT_ASPECT) {
            // The same width at a narrower aspect: tan(h) x aspect x distance stays, so distance x SHOT_ASPECT / aspect.
            position.sub(aim).multiplyScalar(SHOT_ASPECT / aspect).add(aim);
        }
        return { position, aim };
    }

    private fitCamera(): void {
        const camera = this.threeCamera;
        const station = this.station;
        if (!station) return;
        camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
        const { order } = station.cameras;
        // The bench, or (an ice cream) the machine.
        const bench = this.making === 'iceCream' && this.iceCream ? this.iceCream.shot : station.cameras.bench;
        const from = this.pose(order);
        const to = this.pose(bench);
        const t = this.view.t;
        camera.fov = THREE.MathUtils.lerp(order.fov, bench.fov, t);
        camera.position.lerpVectors(from.position, to.position, t);
        camera.lookAt(new THREE.Vector3().lerpVectors(from.aim, to.aim, t));
        camera.updateProjectionMatrix();
    }

    /** The customer's head on screen (CSS pixels). */
    private headOnScreen(): { x: number; y: number } | null {
        return this.customer ? this.worldToScreen(this.customer.headTop) : null;
    }

    // ---------------------------------------------------------------- frame

    public update(delta: number): void {
        const dt = Math.min(delta, 0.1);
        this.kitchen?.update(dt);
        // The doors open for the customers.
        this.time += dt;
        this.room?.update(dt, [...this.queue, ...this.leaving, ...this.diners.map((d) => d.customer)].map((c) => c.root.position));
        this.diners.forEach((d) => d.customer.update(dt));
        if (this.seated) {
            this.updateSigns();
            if (this.phase === 'waiting' && this.seats.length && this.seatedDayDone()) this.endDay();
        }
        this.town?.update(dt);
        this.queue.forEach((c) => c.update(dt));
        this.leaving.forEach((c) => c.update(dt));
        this.keepApart(dt);
        // Food, dishes and customers come and go: they bend too.
        bendAll(this.threeScene);
        if (this.kitchen) {
            this.threeCamera.updateMatrixWorld();
            if (this.phase === 'ordering') this.hud.placeOrder(this.headOnScreen());
            this.hud.setCooking(this.phase === 'cooking' ? this.kitchen.cookProgress : null, this.worldToScreen(this.kitchen.panPoint));
            // A finished dish: it bounces, a check over it, SERVE pulses (the first time: a word on it too).
            const ice = this.making === 'iceCream' ? this.iceCream : null;
            const ready = this.phase === 'cooking' && (ice ? ice.ready : this.kitchen.dishReady);
            if (ready !== this.dishWasReady) {
                this.dishWasReady = ready;
                if (ice) ice.setReadyPulse(ready);
                else this.kitchen.setReadyPulse(ready);
                if (ready) RestaurantAudio.play('coins', 1.3);
            }
            this.hud.setReady(ready ? this.worldToScreen(ice ? ice.dishPoint : this.kitchen.platePoint) : null);
            const hint = this.nextHint();
            this.hud.pointAt(hint ? this.worldToScreen(hint) : null);
        }
        if (this.overview) {
            // Debug: high over the street, looking down at the restaurant.
            const centre = this.station ? new THREE.Vector3(this.station.x, 0, this.station.z + 8) : new THREE.Vector3();
            this.threeCamera.position.set(centre.x, 38, centre.z + 34);
            this.threeCamera.lookAt(centre);
        }
        super.update(delta);
    }

    public resize(): void {
        this.hud?.reposition();
        if (this.kitchen) this.fitCamera();
    }

    public destroy(): void {
        this.gone = true;
        window.removeEventListener('pointerdown', this.onPointerDown);
        DebugOverlay.instance.removePanel('restaurant.debug');
        gsap.killTweensOf(this.view);
        this.queue.forEach((c) => c.destroy());
        this.leaving.forEach((c) => c.destroy());
        this.diners.forEach((d) => {
            d.customer.destroy();
            d.marker?.removeFromParent();
        });
        this.seats.forEach((s) => {
            s.plate?.removeFromParent();
            s.marker?.removeFromParent();
        });
        this.kitchen?.destroy();
        this.iceCream?.destroy();
        this.room?.dispose();
        this.town?.dispose();
        this.hud?.destroy();
        super.destroy();
    }
}
