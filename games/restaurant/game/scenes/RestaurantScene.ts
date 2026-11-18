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
// A pizza order (a stage with a pizza oven: world/Pizza.ts) goes to the oven and its board: tap the dough, the sauce, the
// cheese, the pizza's topping, then the pizza (into the oven: it bakes, comes out), then the pizza again to serve it.
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
import { CameraShot, customerPath, ICE_CREAM_MACHINE, PIZZA_BOARD, PIZZA_OVEN, SUNDAE_BAR, SUNDAE_FREEZER, SHOT_ASPECT, SeatLayout, StationLayout, buildRoom, roomModels, seatsAt, stationAt } from '../world/RestaurantLayout';
import { IceCreamStation, IceTarget } from '../world/IceCream';
import { PizzaStation, PizzaTarget } from '../world/Pizza';
import { WalkGrid } from '../world/WalkGrid';
import { MAX_SCOOPS, SundaeStation, SundaeTarget } from '../world/Sundae';
import exclamationUrl from '../ui/images/icon_exclamation.png';
import { daySettings, stageSettings } from '../data/Settings';
import type { Room } from 'core/rooms/Room';
import { Town } from '../world/Town';
import { bendAll, bendAround } from '../world/Bend';
import { Customer } from '../world/Customers';
import { kitchenModel, loadModels } from '../world/Models';
import { CONE_MODEL, CONE_STACK_MODEL, ICE_CREAM_MODELS, Order, PIZZA_LAYER_MODELS, PIZZA_OVEN_MODEL, PIZZA_SOURCE_MODELS, SUNDAE_MODELS, SWIRL_MODELS, sundaeMatches, BASIC_TOPPINGS, BASIC_PIZZA_TOPPINGS, PIZZA_BASE, SCOOP_FLAVORS, SUNDAE_SAUCES, SUNDAE_TOPPINGS, Topping, matches, payFor, pizzaMatches, pizzaRecipe, randomOrder, randomPizza, randomSundae } from '../data/Recipes';
import { RestaurantSave } from '../data/RestaurantSave';
import { RestaurantHud } from '../ui/RestaurantHud';
import { uiPress } from '../ui/UiParts';
import { RestaurantAudio } from '../audio/RestaurantAudio';

const MOVE_SECONDS = 0.7;
/** How long the order bubble shows before the camera drops to the bench; how long a reaction's watched. */
const ORDER_SECONDS = 1.6;
const REACT_SECONDS = 1.8;
/** A tap while the order's on its way to the station: the camera's move this many times faster. */
const HURRY = 4;
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
/** The day's first customer is already in place (at the counter, or sat at a table): how long till they order (s). */
const START_ORDER_DELAY = 0.8;
const SPOT_NOISE = { across: 0.28, along: 0.18, counter: 0.12 };
/** The ice cream's models (loaded with the kitchen's). */
const ICE_MODELS = [CONE_MODEL, CONE_STACK_MODEL, ...Object.values(SWIRL_MODELS), ...Object.values(ICE_CREAM_MODELS)];
/** The pizza's models: its layers, what they come from, its cutting board, the oven, the plate (the order's picture's). */
const PIZZA_STATION_MODELS = [...new Set([...Object.values(PIZZA_LAYER_MODELS), ...Object.values(PIZZA_SOURCE_MODELS), PIZZA_OVEN_MODEL, 'cuttingboard', 'plate'])];

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
    /** Waiting at the door (a stage with `patience`): how long so far, and the bar over them running down. */
    patience: { waited: number; bar: PatienceBar } | null;
}

/** A bar over a waiting customer's head: full and green, running down to red. Redrawn only when it changes a step. */
class PatienceBar {
    public readonly sprite: THREE.Sprite;
    private readonly canvas = document.createElement('canvas');
    private readonly texture: THREE.CanvasTexture;
    private drawn = -1;

    public constructor() {
        this.canvas.width = 160;
        this.canvas.height = 36;
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthTest: false }));
        this.sprite.renderOrder = 10;
        this.sprite.scale.set(0.9, 0.2, 1);
        this.draw(1);
    }

    /** `left`: 1 (full) to 0 (out of patience). */
    public draw(left: number): void {
        const step = Math.round(THREE.MathUtils.clamp(left, 0, 1) * 40);
        if (step === this.drawn) return;
        this.drawn = step;
        const g = this.canvas.getContext('2d')!;
        const { width, height } = this.canvas;
        g.clearRect(0, 0, width, height);
        g.fillStyle = 'rgba(20, 24, 32, 0.85)';
        g.beginPath();
        g.roundRect(0, 0, width, height, height / 2);
        g.fill();
        const fill = step / 40;
        // Green to orange to red as it runs down.
        g.fillStyle = `hsl(${Math.round(fill * 120)}, 85%, 52%)`;
        g.beginPath();
        g.roundRect(5, 5, Math.max(height - 10, (width - 10) * fill), height - 10, (height - 10) / 2);
        g.fill();
        this.texture.needsUpdate = true;
    }

    public dispose(): void {
        this.sprite.removeFromParent();
        this.texture.dispose();
        this.sprite.material.dispose();
    }
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

/** The "wants to order" icon (the UI kit's exclamation), loaded once and shared by every customer's. */
let exclamationTexture: THREE.Texture | null = null;

/**
 * Over a seated customer who wants to order: the kit's red "!", leaning in toward their head (placed above it, to its
 * right on screen: see updateSigns). Subtle: no badge round it.
 */
function exclamationSprite(): THREE.Sprite {
    if (!exclamationTexture) {
        exclamationTexture = new THREE.TextureLoader().load(exclamationUrl, (texture) => {
            // Its own proportions (it's tall and narrow), not a square.
            const image = texture.image as { width: number; height: number };
            if (image?.width && image?.height) exclamationAspect = image.width / image.height;
        });
        exclamationTexture.colorSpace = THREE.SRGBColorSpace;
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: exclamationTexture, depthTest: false, transparent: true }));
    sprite.renderOrder = 10;
    sprite.scale.set(MARKERS.exclamation * exclamationAspect, MARKERS.exclamation, 1);
    sprite.userData.exclamation = true;
    return sprite;
}

/** The "!" icon's width over its height (the file's, once loaded: 252 x 420 — the kit's 21 x 35, upscaled x12). */
let exclamationAspect = 21 / 35;

/** A small arrow pointing down (over a dirty plate: clear me). An in-game helper, not the tutorial hand. */
function arrowSprite(): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    const g = canvas.getContext('2d')!;
    g.beginPath();
    g.moveTo(36, 8);
    g.lineTo(60, 8);
    g.lineTo(60, 44);
    g.lineTo(80, 44);
    g.lineTo(48, 86);
    g.lineTo(16, 44);
    g.lineTo(36, 44);
    g.closePath();
    g.fillStyle = '#ffd23f';
    g.fill();
    g.lineWidth = 7;
    g.lineJoin = 'round';
    g.strokeStyle = '#3a2408';
    g.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    sprite.renderOrder = 10;
    sprite.scale.setScalar(MARKERS.arrow);
    return sprite;
}

/**
 * The in-game helpers' sizes (world units) and where they float: the "!" up and to the right of a head (leaning in to
 * it), the arrow over a dirty plate; how far they bob.
 */
const MARKERS = { exclamation: 0.52, arrow: 0.38, up: 0.36, right: 0.32, plateUp: 0.55, bob: 0.06 };

export default class RestaurantScene extends ThreeScene {
    private kitchen: Kitchen | null = null;
    /** The customers' way in at this stage (its station's: the truck's and the diner's doors differ). */
    private readonly path = customerPath(RestaurantSave.stage);
    /** The ice cream machine's station (a stage whose room has the machine), and what's being made now. */
    private iceCream: IceCreamStation | null = null;
    /** The pizza oven's station (a stage whose room has an oven). */
    private pizza: PizzaStation | null = null;
    private making: 'burger' | 'iceCream' | 'pizza' | 'sundae' = 'burger';
    /** The sundae bar's station (a stage whose room has its freezer and bar). */
    private sundae: SundaeStation | null = null;
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
    /**
     * Seated with a wait at the door (the stage's `patience`, seconds): customers come one at a time, the next once the
     * one at the door has sat down or given up. `pending`: the day's orders still to come in.
     */
    private readonly patience = stageSettings(RestaurantSave.stage).patience;
    private readonly pending: Order[] = [];
    /** The dining room framed (seats, the door) when the station's order camera doesn't show every seat. */
    private diningShot: CameraShot | null = null;
    /** The order bubble's wait before the station (a tap cuts it short), and the camera's move (a tap speeds it up). */
    private orderWait: gsap.core.Tween | null = null;
    private viewMove: gsap.core.Tween | null = null;
    /** The hand's coming at the hint from above (the dining room) rather than from below (the benches). */
    private hintAbove = false;
    /** Where customers can walk (seated: their way round the tables). */
    private walkGrid: WalkGrid | null = null;
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
            await loadModels([...new Set([...KITCHEN_MODELS, ...ICE_MODELS, ...PIZZA_STATION_MODELS, ...SUNDAE_MODELS, 'plate_dirty', ...roomModels(RestaurantSave.stage)])]);
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
        // Its piles: the buns, the patties, and this stage's toppings.
        const toppings = stageSettings(RestaurantSave.stage).toppings ?? BASIC_TOPPINGS;
        this.kitchen = new Kitchen(this.threeScene, this.station, ['bunBottom', 'bunTop', 'patty', ...toppings]);
        this.kitchen.onCooked = () => RestaurantAudio.play('pick', 1.3);
        // The ice cream machine, if the room has one (a prop of its model).
        const machine = this.room.group.children.find((child) => ICE_CREAM_MACHINE.test(child.name));
        if (machine) {
            const station = new IceCreamStation(this.threeScene, machine);
            if (station.usable) this.iceCream = station;
            else station.destroy();
        }
        // The pizza oven, if the room has one (a prop of its model), and the board to make pizzas on (a prop with its id).
        const oven = this.room.group.children.find((child) => PIZZA_OVEN.test(child.name));
        // (Each station's ingredients are this stage's: the same station shows more at a bigger stage.)
        const stage = stageSettings(RestaurantSave.stage);
        if (oven) this.pizza = new PizzaStation(this.threeScene, oven, this.room.props.get(PIZZA_BOARD) ?? null, [...PIZZA_BASE, ...(stage.pizza?.toppings ?? BASIC_PIZZA_TOPPINGS)]);
        // The sundae bar, if the room has its freezer and its bar (props with their ids).
        const freezer = this.room.props.get(SUNDAE_FREEZER);
        const bar = this.room.props.get(SUNDAE_BAR);
        if (freezer && bar) {
            this.sundae = new SundaeStation(this.threeScene, freezer, bar, {
                flavors: stage.sundae?.flavors ?? SCOOP_FLAVORS,
                sauces: stage.sundae?.sauces ?? SUNDAE_SAUCES,
                toppings: stage.sundae?.toppings ?? SUNDAE_TOPPINGS,
            });
        }
        bendAround(this.station.x, this.station.z);
        bendAll(this.threeScene);
        this.fitCamera();
        this.fitOrdersToKitchen(toppings);
        this.startDay();
    }

    /**
     * Every order is one this kitchen can make — it can't be otherwise: a dish whose station isn't in the room (a save
     * dealt for another stage, a station moved in the editor), or that asks for something the station doesn't stock,
     * becomes one that can be made (the same dish from what's there, else a burger of the stage's toppings). Saved back.
     */
    private fitOrdersToKitchen(toppings: readonly Topping[]): void {
        const stage = stageSettings(RestaurantSave.stage);
        const { maxToppings } = daySettings(RestaurantSave.day);
        const burger = () => randomOrder(maxToppings, toppings);
        const pizzaToppings = stage.pizza?.toppings ?? BASIC_PIZZA_TOPPINGS;
        const sundaeStock = { flavors: stage.sundae?.flavors ?? SCOOP_FLAVORS, sauces: stage.sundae?.sauces ?? SUNDAE_SAUCES, toppings: stage.sundae?.toppings ?? SUNDAE_TOPPINGS };
        let changed = false;
        this.orders.forEach((order, i) => {
            let fixed: Order | null = null;
            if (order.iceCream) {
                if (!this.iceCream) fixed = burger();
            } else if (order.pizza) {
                if (!this.pizza) fixed = burger();
                else if (order.pizza.some((t) => !pizzaToppings.includes(t))) fixed = { toppings: [], pizza: randomPizza(stage.pizza?.maxToppings ?? 2, pizzaToppings) };
            } else if (order.sundae) {
                const s = order.sundae;
                const stocked = s.scoops.every((f) => sundaeStock.flavors.includes(f)) && (!s.sauce || sundaeStock.sauces.includes(s.sauce)) && s.toppings.every((t) => sundaeStock.toppings.includes(t));
                if (!this.sundae) fixed = burger();
                else if (!stocked) fixed = { toppings: [], sundae: randomSundae(stage.sundae ?? {}) };
            } else if (order.toppings.some((t) => !toppings.includes(t))) {
                fixed = burger();
            }
            if (fixed) {
                this.orders[i] = fixed;
                changed = true;
            }
        });
        if (changed) {
            console.warn('[Restaurant] orders the kitchen could not make were swapped for ones it can');
            RestaurantSave.replaceOrders(this.orders);
        }
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
        // The first is already at the counter when the day opens (something to do straight away), and orders.
        if (this.orders.length) {
            const first = new Customer(this.threeScene, this.path.start);
            this.queue.push(first);
            first.root.position.copy(this.spotFor(first, 0));
            first.root.rotation.y = Math.PI;
            void first.walkTo([], Math.PI);
            gsap.delayedCall(START_ORDER_DELAY, () => {
                if (!this.gone && this.queue[0] === first && this.phase === 'waiting') this.takeOrder(first);
            });
        }
        // The rest come in from the street, one after another at uneven gaps, and line up.
        let at = ARRIVE.first[0] + Math.random() * (ARRIVE.first[1] - ARRIVE.first[0]);
        this.orders.slice(1).forEach(() => {
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
        // On the way in: only the way-in points still ahead of their place in the line — a long line reaches past "just
        // inside" (even outside), and walking to it would take them into the line, then back out to its end.
        const spot = this.spotFor(customer, k);
        const counter = this.kitchen!.customerSpot;
        const back = this.path.inside.clone().sub(counter).setY(0).normalize();
        const along = (p: THREE.Vector3) => p.clone().sub(counter).setY(0).dot(back);
        const ahead = via.filter((p) => along(p) > along(spot) + QUEUE.spacing * 0.5);
        void customer.walkTo([...ahead, spot], Math.PI).then(() => {
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
        this.orderWait = gsap.delayedCall(ORDER_SECONDS, () => this.startCooking());
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
        this.pizza?.reset();
        this.sundae?.reset();
        this.moveView(0);
        this.react(true, payFor(this.order!));
    }

    private startCooking(): void {
        if (this.gone || this.phase !== 'ordering') return;
        this.phase = 'cooking';
        // An ice cream's made at the machine, a pizza at the oven (the camera turns to it); the rest at the bench.
        this.making = this.order!.iceCream && this.iceCream ? 'iceCream' : this.order!.pizza && this.pizza ? 'pizza' : this.order!.sundae && this.sundae ? 'sundae' : 'burger';
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
        if (this.making === 'pizza') {
            if (!this.pizza?.hasPizza) return;
            if (!this.pizza.trash(this.trashCan())) {
                RestaurantAudio.play('wrong');
                this.hud.showHint('Wait till it\'s out of the oven');
                return;
            }
            RestaurantAudio.play('drop', 0.8);
            this.hud.tickTicket([]);
            return;
        }
        if (this.making === 'sundae') {
            if (!this.sundae?.trash(this.trashCan())) return;
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
        if (this.making === 'pizza') {
            this.servePizza();
            return;
        }
        if (this.making === 'sundae') {
            this.serveSundae();
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

    /** The sundae (a scoop on it at least) out to the customer: their table (seated) or the counter. */
    private serveSundae(): void {
        const station = this.sundae;
        const order = this.order?.sundae;
        const made = station?.made;
        if (!station || !order) return;
        if (!made || !made.scoops.length) {
            RestaurantAudio.play('wrong');
            this.hud.showHint(made ? 'Add a scoop: tap a tub' : 'Start with a cone or a bowl');
            return;
        }
        this.phase = 'serving';
        const right = sundaeMatches(order, made);
        const pay = right ? payFor(this.order!) : 0;
        if (right) RestaurantSave.learnSundae();
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
            station.serveTo(this.platePoint(seat.def), (plate) => {
                seat.plate = plate;
                if (!this.gone) this.reactSeated(diner, right, pay);
            });
            return;
        }
        station.serveTo(this.kitchen!.servedPoint, () => {
            if (!this.gone) this.react(right, pay);
        }, false);
    }

    /** A tap at the sundae bar: a cone or bowl, a tub (a scoop), a sauce, a topping, the sundae (served). */
    private tapSundae(target: SundaeTarget): void {
        const station = this.sundae!;
        const result = station.take(target);
        if (result === 'serve') {
            this.serve();
            return;
        }
        if (result !== 'done') {
            RestaurantAudio.play('wrong');
            const why: Record<string, string> = {
                noBase: 'Start with a cone or a bowl',
                hasBase: 'It has its cone or bowl already',
                full: `${MAX_SCOOPS} scoops at most!`,
                noScoop: 'Add a scoop first: tap a tub',
                has: 'It has that already',
                busy: 'One moment...',
            };
            this.hud.showHint(why[result] ?? null);
            return;
        }
        RestaurantAudio.play('pick', 0.9 + Math.random() * 0.2);
        gsap.delayedCall(0.33, () => {
            if (this.phase !== 'cooking' || this.making !== 'sundae' || !this.order?.sundae) return;
            RestaurantAudio.play('drop');
            this.hud.tickTicket(station.ticks(this.order.sundae));
        });
    }

    /** At the sundae bar, till they've served one right: the base, each scoop still missing, the sauce, the toppings. */
    private sundaeHint(): THREE.Vector3 | null {
        const station = this.sundae;
        const order = this.order?.sundae;
        if (!station || !order || RestaurantSave.sundaeLearned || this.view.t < 0.99) return null;
        const made = station.made;
        if (!made) return station.targetPoint({ kind: 'base', base: order.base });
        const left = [...made.scoops];
        const missing = order.scoops.find((flavor) => {
            const k = left.indexOf(flavor);
            if (k < 0) return true;
            left.splice(k, 1);
            return false;
        });
        if (missing && made.scoops.length < MAX_SCOOPS) return station.targetPoint({ kind: 'tub', flavor: missing });
        if (order.sauce && !made.sauce) return station.targetPoint({ kind: 'sauce', sauce: order.sauce });
        const topping = order.toppings.find((t) => !made.toppings.includes(t));
        return topping ? station.targetPoint({ kind: 'topping', topping }) : null;
    }

    /** The pizza (done: baked) out to the customer: their table (seated) or the counter. */
    private servePizza(): void {
        const pizza = this.pizza;
        if (!pizza || !this.order?.pizza) return;
        if (!pizza.ready) {
            RestaurantAudio.play('wrong');
            this.hud.showHint(!pizza.hasPizza ? 'Start with the dough' : pizza.inOven ? 'Still baking...' : 'Bake it first: tap the pizza');
            return;
        }
        this.phase = 'serving';
        const right = pizzaMatches(this.order.pizza, pizza.layers, pizza.baked);
        const pay = right ? payFor(this.order) : 0;
        if (right) RestaurantSave.learnPizza();
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
            pizza.serveTo(this.platePoint(seat.def), (plate) => {
                seat.plate = plate;
                if (!this.gone) this.reactSeated(diner, right, pay);
            });
            return;
        }
        pizza.serveTo(this.kitchen!.servedPoint, () => {
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
        this.pizza?.clearServed();
        this.sundae?.clearServed();
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
        this.diningShot = this.frameDining();
        // The way round the tables: a grid over the room (its walls, the seats, the way in, with a margin).
        if (this.room) {
            const xs = [...this.room.wallBoxes.flatMap((b) => [b.x - b.halfX, b.x + b.halfX]), ...this.seats.map((s) => s.def.x), this.path.start.x, this.path.outside.x, this.path.inside.x];
            const zs = [...this.room.wallBoxes.flatMap((b) => [b.z - b.halfZ, b.z + b.halfZ]), ...this.seats.map((s) => s.def.z), this.path.start.z, this.path.outside.z, this.path.inside.z];
            this.walkGrid = new WalkGrid(this.room, { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
        }
        this.fitCamera();
        // The first customer's already sat at a table when the day opens, about to want to order (something to tap
        // straight away); the rest come in.
        const rest = this.orders.slice(this.seatFirst(this.orders[0]) ? 1 : 0);
        const first = ARRIVE.first[0] + Math.random() * (ARRIVE.first[1] - ARRIVE.first[0]);
        if (this.patience) {
            // One at a time: the next comes once the one at the door has sat down or given up.
            this.pending.push(...rest);
            gsap.delayedCall(first, () => this.arriveNext());
            return;
        }
        let at = first;
        rest.forEach((order) => {
            gsap.delayedCall(at, () => this.arrive(order));
            at += ARRIVE.gap * (1 + (Math.random() * 2 - 1) * ARRIVE.noise);
        });
    }

    /**
     * `customer`'s way through `stops` (from where they are), round the tables, counters and walls in between (the
     * walk grid's routes, leg by leg). Without a grid: straight to each stop.
     */
    private routeVia(customer: Customer, stops: THREE.Vector3[]): THREE.Vector3[] {
        const grid = this.walkGrid;
        if (!grid) return stops;
        const way: THREE.Vector3[] = [];
        let at = customer.root.position.clone();
        for (const stop of stops) {
            way.push(...grid.route(at, stop));
            at = stop;
        }
        return way;
    }

    /** A customer in from the street to just inside the door, then to a free seat (or the wait). */
    private arrive(order: Order): void {
        if (this.gone) return;
        const diner: Diner = { customer: new Customer(this.threeScene, this.path.start), order, seat: null, state: 'arriving', marker: null, patience: null };
        this.diners.push(diner);
        void diner.customer.walkTo(this.routeVia(diner.customer, [this.path.outside, this.path.inside])).then(() => {
            if (!this.gone && diner.state === 'arriving') this.findSeat(diner);
        });
    }

    /** The day's first customer (`order`) put straight on the first seat, sat down; soon their "!". Whether there was one. */
    private seatFirst(order: Order | undefined): boolean {
        const seat = this.seats[0];
        if (!order || !seat) return false;
        const diner: Diner = { customer: new Customer(this.threeScene, this.seatPoint(seat.def)), order, seat, state: 'seated', marker: null, patience: null };
        this.diners.push(diner);
        seat.diner = diner;
        diner.customer.sitAt(this.seatPoint(seat.def), seat.def.rotationY, seat.def.height ?? 0.5);
        gsap.delayedCall(START_ORDER_DELAY, () => {
            if (this.gone || diner.state !== 'seated') return;
            diner.state = 'ready';
            diner.marker = exclamationSprite();
            this.threeScene.add(diner.marker);
            RestaurantAudio.play('pick', 1.2);
        });
        return true;
    }

    /** The door's free (no one coming in, no one waiting): the next customer, if any are still to come. */
    private arriveNext(): void {
        if (this.gone || !this.pending.length) return;
        if (this.diners.some((d) => d.state === 'arriving') || this.waitingForSeat.length) return;
        this.arrive(this.pending.shift()!);
    }

    /** The next one comes in a moment later (the one at the door has sat down or gone). */
    private scheduleNext(): void {
        if (!this.patience) return;
        gsap.delayedCall(ARRIVE.gap * (1 + (Math.random() * 2 - 1) * ARRIVE.noise), () => this.arriveNext());
    }

    /** Waiting at the door: their patience runs down; out of it, they're annoyed and leave (an unhappy customer). */
    private updatePatience(dt: number): void {
        if (!this.patience) return;
        for (const diner of [...this.waitingForSeat]) {
            const patience = diner.patience;
            if (!patience) continue;
            patience.waited += dt;
            patience.bar.draw(1 - patience.waited / this.patience);
            patience.bar.sprite.position.copy(diner.customer.headTop).add(new THREE.Vector3(0, 0.4, 0));
            if (patience.waited >= this.patience) this.giveUp(diner);
        }
    }

    private giveUp(diner: Diner): void {
        const k = this.waitingForSeat.indexOf(diner);
        if (k >= 0) this.waitingForSeat.splice(k, 1);
        diner.patience?.bar.dispose();
        diner.patience = null;
        diner.state = 'leaving';
        this.results.push(false);
        this.hud.setDay(RestaurantSave.day, this.results, this.orders.length);
        diner.customer.grumble();
        RestaurantAudio.play('sad');
        // (Seen only from the dining room: at the bench, just the sound and the day's tally.)
        if (this.view.t < 0.5) this.hud.react(false, this.worldToScreen(diner.customer.headTop) ?? { x: 0, y: 0 }, 0);
        gsap.delayedCall(0.6, () => {
            if (this.gone) return;
            void diner.customer.walkTo(this.routeVia(diner.customer, [this.path.outside, this.path.start])).then(() => {
                const at = this.diners.indexOf(diner);
                if (at >= 0) this.diners.splice(at, 1);
                diner.customer.destroy();
            });
        });
        this.lineUpWaiting();
        this.scheduleNext();
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
            // A wait at the door: their patience starts running down.
            if (this.patience && !diner.patience) {
                diner.patience = { waited: 0, bar: new PatienceBar() };
                this.threeScene.add(diner.patience.bar.sprite);
            }
            this.lineUpWaiting();
            return;
        }
        const waiting = this.waitingForSeat.indexOf(diner);
        if (waiting >= 0) this.waitingForSeat.splice(waiting, 1);
        diner.patience?.bar.dispose();
        diner.patience = null;
        // Sat down: the door's free for the next one.
        this.scheduleNext();
        seat.diner = diner;
        diner.seat = seat;
        diner.state = 'seating';
        const { def } = seat;
        // Up to the seat from behind it (the side away from the table), then down onto it.
        const behind = this.seatPoint(def).add(new THREE.Vector3(-Math.sin(def.rotationY), 0, -Math.cos(def.rotationY)).multiplyScalar(SEATED.approach));
        void diner.customer.walkTo(this.routeVia(diner.customer, [behind]), def.rotationY).then(() => {
            if (this.gone || diner.state !== 'seating') return;
            diner.customer.sitAt(this.seatPoint(def), def.rotationY, def.height ?? 0.5);
            diner.state = 'seated';
            const wait = SEATED.readyAfter[0] + Math.random() * (SEATED.readyAfter[1] - SEATED.readyAfter[0]);
            gsap.delayedCall(wait, () => {
                if (this.gone || diner.state !== 'seated') return;
                diner.state = 'ready';
                diner.marker = exclamationSprite();
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
            void diner.customer.walkTo(this.routeVia(diner.customer, [spot]));
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
        this.orderWait = gsap.delayedCall(ORDER_SECONDS, () => this.startCooking());
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
        gsap.delayedCall(0.6 + SEATED.eatSeconds + 0.4, () => {
            // Eaten: a dirty plate left (to clear).
            if (plate && !this.gone) this.makeDirty(plate);
            this.dinerLeaves(diner);
        });
    }

    /** A plate eaten from: its clean plate model swapped for the dirty one (same size, same spot). */
    private makeDirty(plate: THREE.Object3D): void {
        const dish = plate.children[0];
        if (!dish) return;
        const dirty = kitchenModel('plate_dirty');
        dirty.position.copy(dish.position);
        dirty.rotation.copy(dish.rotation);
        dirty.scale.copy(dish.scale);
        plate.remove(dish);
        plate.add(dirty);
        // (Kept first: the plate's food is the children after it.)
        plate.children.unshift(plate.children.pop()!);
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
                seat.marker = arrowSprite();
                this.threeScene.add(seat.marker);
            }
        }
        diner.customer.standUp();
        const behind = seat ? this.seatPoint(seat.def).add(new THREE.Vector3(-Math.sin(seat.def.rotationY), 0, -Math.cos(seat.def.rotationY)).multiplyScalar(SEATED.approach)) : diner.customer.root.position.clone();
        void diner.customer.walkTo(this.routeVia(diner.customer, [behind, this.path.inside, this.path.outside, this.path.start])).then(() => {
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

    /** A plate left behind to clear: its customer's gone (its arrow's up), not one still being eaten from. */
    private toClear(seat: SeatState): boolean {
        return Boolean(seat.plate && seat.marker && !seat.diner);
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
        // (A plate's only to clear once its customer's gone: not while they're still eating from it.)
        const dirtySeats = this.seats.filter((seat) => this.toClear(seat));
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
        const bob = Math.sin(this.time * 5) * MARKERS.bob;
        // The "!": above the head and to its right on screen (whichever way the camera looks), leaning in to it.
        const right = new THREE.Vector3().setFromMatrixColumn(this.threeCamera.matrixWorld, 0).setY(0).normalize();
        for (const diner of this.diners) {
            if (!diner.marker) continue;
            diner.marker.position.copy(diner.customer.headTop).addScaledVector(right, MARKERS.right).add(new THREE.Vector3(0, MARKERS.up + bob, 0));
            // (The icon's own proportions: known once its file's loaded.)
            if (diner.marker.userData.exclamation) diner.marker.scale.set(MARKERS.exclamation * exclamationAspect, MARKERS.exclamation, 1);
        }
        // The arrow over a dirty plate, bobbing down at it.
        for (const seat of this.seats) if (seat.marker && seat.plate) seat.marker.position.copy(seat.plate.position).add(new THREE.Vector3(0, MARKERS.plateUp + Math.abs(bob) * 2, 0));
    }

    // ---------------------------------------------------------------- taps on the benches

    private readonly onPointerDown = (event: PointerEvent): void => {
        RestaurantAudio.unlock();
        // A HUD button's press isn't a tap on the bench under it.
        if (uiPress.taken) {
            uiPress.taken = false;
            return;
        }
        // Tapping while the order shows (or the camera's on its way to the station): get there faster.
        if (this.hurry()) return;
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
        if (this.making === 'sundae' && this.sundae) {
            let nearest: { target: SundaeTarget; score: number } | null = null;
            for (const { target, at, radius } of this.sundae.targets) {
                const middle = this.worldToScreen(at);
                const edge = this.worldToScreen(at.clone().addScaledVector(across, radius));
                if (!middle || !edge) continue;
                const score = Math.hypot(x - middle.x, y - middle.y) / Math.max(1, Math.hypot(edge.x - middle.x, edge.y - middle.y));
                if (score <= 1 && (!nearest || score < nearest.score)) nearest = { target, score };
            }
            if (nearest) this.tapSundae(nearest.target);
            return;
        }
        if (this.making === 'pizza' && this.pizza) {
            let nearest: { kind: PizzaTarget; score: number } | null = null;
            for (const target of this.pizza.targets) {
                const middle = this.worldToScreen(target.at);
                const edge = this.worldToScreen(target.at.clone().addScaledVector(across, target.radius));
                if (!middle || !edge) continue;
                const score = Math.hypot(x - middle.x, y - middle.y) / Math.max(1, Math.hypot(edge.x - middle.x, edge.y - middle.y));
                if (score <= 1 && (!nearest || score < nearest.score)) nearest = { kind: target.kind, score };
            }
            if (nearest) this.tapPizza(nearest.kind);
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

    /** A tap at the pizza station: an ingredient, the pizza or the oven (into it; baked: served). */
    private tapPizza(kind: PizzaTarget): void {
        const pizza = this.pizza!;
        const result = pizza.take(kind);
        if (result === 'serve') {
            this.serve();
            return;
        }
        if (result !== 'done' && result !== 'bake') {
            RestaurantAudio.play('wrong');
            const why: Record<string, string> = {
                noDough: 'Start with the dough',
                has: kind === 'dough' ? 'There\'s a pizza on the board already' : 'It has that already',
                baking: pizza.inOven ? 'Still baking...' : 'One moment...',
                baked: 'It\'s baked: serve it!',
            };
            this.hud.showHint(why[result] ?? null);
            return;
        }
        if (result === 'bake') {
            RestaurantAudio.play('whoosh', 0.9);
            return;
        }
        RestaurantAudio.play('pick', 0.9 + Math.random() * 0.2);
        gsap.delayedCall(0.33, () => {
            if (this.phase !== 'cooking' || this.making !== 'pizza') return;
            RestaurantAudio.play('drop');
            this.hud.tickTicket(pizza.made);
        });
    }

    /** At the oven, till they've served one right: the dough, each layer the order needs, the pizza (to bake), then serve it. */
    private pizzaHint(): THREE.Vector3 | null {
        const pizza = this.pizza;
        const kind = this.order?.pizza;
        if (!pizza || !kind || this.view.t < 0.99) return null;
        // Everything on (and nothing else), not baked yet: always the hand on the pizza — tap it into the oven.
        const all = pizzaRecipe(kind);
        if (pizza.hasPizza && !pizza.inOven && !pizza.ready && pizza.layers.length === all.length && all.every((layer) => pizza.layers.includes(layer))) return pizza.targetPoint('pizza');
        // The rest: only till they've served one right.
        if (RestaurantSave.pizzaLearned) return null;
        if (!pizza.hasPizza) return pizza.targetPoint('dough');
        if (pizza.inOven) return null;
        if (pizza.ready) return pizzaMatches(kind, pizza.layers, true) ? pizza.dishPoint : null;
        const missing = pizzaRecipe(kind).find((layer) => !pizza.layers.includes(layer));
        if (missing) return pizza.targetPoint(missing);
        // Everything's on (and nothing else): into the oven.
        return pizza.layers.length === pizzaRecipe(kind).length ? pizza.targetPoint('pizza') : null;
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

    /** Where the dish being made is, once it's done (any dish: a burger, a cone, a pizza), else null. */
    private readyDishPoint(): THREE.Vector3 | null {
        if (this.making === 'iceCream') return this.iceCream?.ready ? this.iceCream.dishPoint : null;
        if (this.making === 'pizza') return this.pizza?.ready ? this.pizza.dishPoint : null;
        if (this.making === 'sundae') return this.order?.sundae && this.sundae?.complete(this.order.sundae) ? this.sundae.dishPoint : null;
        return this.kitchen?.dishReady ? this.kitchen.platePoint : null;
    }

    /**
     * What to tap next (the hand), as a 3D point. Always: a finished dish (tap it to serve) and, in the dining room, a
     * dirty plate (tap it to clear). The first day (and a stage's first): every step — bottom bun, patty, toppings, top
     * bun; a seated customer's "!"; the first cone and pizza, step by step.
     */
    private nextHint(): THREE.Vector3 | null {
        const kitchen = this.kitchen;
        this.hintAbove = false;
        // A finished dish has its own arrow (the ready badge's, bouncing over it): no hand on top of it.
        if (this.phase === 'cooking' && this.readyDishPoint()) return null;
        if (this.phase === 'cooking' && this.making === 'iceCream') return this.iceCreamHint();
        if (this.phase === 'cooking' && this.making === 'pizza') return this.pizzaHint();
        if (this.phase === 'cooking' && this.making === 'sundae') return this.sundaeHint();
        if (this.seated && this.phase === 'waiting' && this.view.t < 0.1) {
            // The tutorial hand: only a stage's first day (the rest of the time the in-game helpers do it — the "!" over
            // a customer, the arrow over a dirty plate). From above, pointing down at the head / the plate.
            if (RestaurantSave.stageDay !== 0) return null;
            this.hintAbove = true;
            const ready = this.diners.find((d) => d.state === 'ready');
            if (ready) return ready.customer.headTop;
            const dirty = this.seats.find((s) => this.toClear(s));
            return dirty ? dirty.plate!.position.clone().add(new THREE.Vector3(0, 0.1, 0)) : null;
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
            // (A cooked patty has its own arrow over the pan: no hand on top of it.)
            if (kitchen.pattyReady) return null;
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
        this.viewMove = gsap.to(this.view, { t: to, duration: MOVE_SECONDS, ease: 'power2.inOut', onUpdate: () => this.fitCamera(), onComplete: () => {
            this.viewMove = null;
            done?.();
        } });
    }

    /**
     * A tap while the order's on its way to the station: in a hurry. During the order bubble, straight to the station;
     * during the camera's move there, the rest of it faster. (No tap: it all keeps its own pace.) Whether it took the tap.
     */
    private hurry(): boolean {
        if (this.phase === 'ordering' && this.orderWait) {
            this.orderWait.kill();
            this.orderWait = null;
            this.startCooking();
            this.viewMove?.timeScale(HURRY);
            return true;
        }
        if (this.phase === 'cooking' && this.viewMove && this.view.t < 0.99) {
            this.viewMove.timeScale(HURRY);
            return true;
        }
        return false;
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

    /**
     * Seated: the dining room's shot when the station's order camera (framed for its counter) doesn't show every seat
     * and the door: looking the same way, as steeply, pulled back and centred till they all fit (a 720 x 1080 screen,
     * with room for the HUD). Null when the order camera already shows them all.
     */
    private frameDining(): CameraShot | null {
        const order = this.station?.cameras.order;
        if (!order || !this.seats.length) return null;
        const points = [...this.seats.flatMap(({ def }) => [new THREE.Vector3(def.x, 1.9, def.z), this.platePoint(def)]), this.path.inside.clone().setY(1.9)];
        const lens = new THREE.PerspectiveCamera(order.fov, SHOT_ASPECT, 0.1, 500);
        lens.position.set(order.position.x, order.position.y, order.position.z);
        lens.lookAt(order.target.x, order.target.y, order.target.z);
        lens.updateMatrixWorld();
        const seen = points.every((p) => {
            const ndc = p.clone().project(lens);
            return ndc.z < 1 && Math.abs(ndc.x) < 0.9 && Math.abs(ndc.y) < 0.8;
        });
        if (seen) return null;
        const forward = new THREE.Vector3(order.target.x - order.position.x, order.target.y - order.position.y, order.target.z - order.position.z).normalize();
        const flat = forward.clone().setY(0).normalize();
        const side = new THREE.Vector3(flat.z, 0, -flat.x);
        const tilt = Math.max(0.5, Math.asin(-forward.y));
        const middle = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length);
        const spread = (axis: THREE.Vector3) => {
            const along = points.map((p) => p.clone().sub(middle).dot(axis));
            return Math.max(...along) - Math.min(...along);
        };
        const tan = Math.tan(THREE.MathUtils.degToRad(order.fov / 2));
        // Across: the screen's width; in depth: foreshortened by the tilt, in the screen's height less the HUD's (~30%).
        const distance = Math.max(spread(side) / 2 / (tan * SHOT_ASPECT), (spread(flat) * Math.sin(tilt) + 1.9 * Math.cos(tilt)) / 2 / (tan * 0.7)) * 1.08;
        const aim = middle.clone().setY(0.8);
        const look = flat.clone().multiplyScalar(Math.cos(tilt)).setY(-Math.sin(tilt));
        const position = aim.clone().addScaledVector(look, -distance);
        return { position: { x: position.x, y: position.y, z: position.z }, target: { x: aim.x, y: aim.y, z: aim.z }, fov: order.fov };
    }

    private fitCamera(): void {
        const camera = this.threeCamera;
        const station = this.station;
        if (!station) return;
        camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
        // The order view: the station's (its counter), or (seated, when it doesn't show every seat) the dining room's.
        const order = this.diningShot ?? station.cameras.order;
        // The bench, or (an ice cream) the machine, or (a pizza) the oven and its board.
        const bench = this.making === 'iceCream' && this.iceCream ? this.iceCream.shot
            : this.making === 'pizza' && this.pizza ? this.pizza.shot
            : this.making === 'sundae' && this.sundae ? this.sundae.shot
                : station.cameras.bench;
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
        this.pizza?.update(dt);
        // The doors open for the customers.
        this.time += dt;
        this.room?.update(dt, [...this.queue, ...this.leaving, ...this.diners.map((d) => d.customer)].map((c) => c.root.position));
        this.diners.forEach((d) => d.customer.update(dt));
        if (this.seated) {
            this.updatePatience(dt);
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
            // The cooking ring: over the pan, or (a pizza) over the oven while it bakes.
            const pizza = this.making === 'pizza' ? this.pizza : null;
            if (pizza) this.hud.setCooking(this.phase === 'cooking' ? pizza.bakeProgress : null, this.worldToScreen(pizza.ovenPoint));
            else this.hud.setCooking(this.phase === 'cooking' ? this.kitchen.cookProgress : null, this.worldToScreen(this.kitchen.panPoint));
            // A cooked patty in the pan (making a burger): the arrow over it, every time — take it.
            const pattyDone = this.phase === 'cooking' && this.making === 'burger' && this.kitchen.pattyReady && this.view.t > 0.9;
            this.hud.setPanReady(pattyDone ? this.worldToScreen(this.kitchen.panPoint) : null);
            // A finished dish: it bounces, a check over it, SERVE pulses (the first time: a word on it too).
            const ice = this.making === 'iceCream' ? this.iceCream : null;
            const sundae = this.making === 'sundae' && this.order?.sundae ? this.sundae : null;
            const ready = this.phase === 'cooking' && (ice ? ice.ready : pizza ? pizza.ready : sundae ? sundae.complete(this.order!.sundae!) : this.kitchen.dishReady);
            if (ready !== this.dishWasReady) {
                this.dishWasReady = ready;
                if (ice) ice.setReadyPulse(ready);
                else if (pizza) pizza.setReadyPulse(ready);
                else if (sundae) sundae.setReadyPulse(ready);
                else this.kitchen.setReadyPulse(ready);
                if (ready) RestaurantAudio.play('coins', 1.3);
            }
            this.hud.setReady(ready ? this.worldToScreen(ice ? ice.dishPoint : pizza ? pizza.dishPoint : sundae ? sundae.dishPoint : this.kitchen.platePoint) : null);
            const hint = this.nextHint();
            this.hud.pointAt(hint ? this.worldToScreen(hint) : null, this.hintAbove);
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
            d.patience?.bar.dispose();
        });
        this.seats.forEach((s) => {
            s.plate?.removeFromParent();
            s.marker?.removeFromParent();
        });
        this.kitchen?.destroy();
        this.iceCream?.destroy();
        this.pizza?.destroy();
        this.sundae?.destroy();
        this.room?.dispose();
        this.town?.dispose();
        this.hud?.destroy();
        super.destroy();
    }
}
