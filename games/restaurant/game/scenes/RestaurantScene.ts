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
import { CUSTOMER_PATH, CameraShot, SHOT_ASPECT, StationLayout, buildRoom, roomModels, stationAt } from '../world/RestaurantLayout';
import type { Room } from 'core/rooms/Room';
import { bendAll, bendAround } from '../world/Bend';
import { Customer } from '../world/Customers';
import { loadModels } from '../world/Models';
import { Order, matches, payFor } from '../data/Recipes';
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
const QUEUE = { arriveGap: 0.6, spacing: 1.15, stepAside: 1.6, personalSpace: 0.8 };

type Phase = 'loading' | 'waiting' | 'ordering' | 'cooking' | 'serving' | 'leaving' | 'dayEnd';

export default class RestaurantScene extends ThreeScene {
    private kitchen: Kitchen | null = null;
    /** The restaurant round the kitchen, as it is at the player's stage (levels/restaurant.json). */
    private room: Room | null = null;
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
            await loadModels([...KITCHEN_MODELS, ...roomModels(RestaurantSave.stage)]);
        } catch (error) {
            console.error('[Restaurant] could not load the models', error);
            return;
        }
        if (this.gone) return;
        this.room = buildRoom(RestaurantSave.stage);
        this.threeScene.add(this.room.group);
        this.station = stationAt(RestaurantSave.stage);
        this.kitchen = new Kitchen(this.threeScene, this.station);
        this.kitchen.onCooked = () => RestaurantAudio.play('pick', 1.3);
        bendAround(this.station.x, this.station.z);
        bendAll(this.threeScene);
        this.fitCamera();
        this.startDay();
    }

    private buildDebug(): void {
        const panel = DebugOverlay.instance.panel('Restaurant', { id: 'restaurant.debug' });
        panel.button('+50 TO THE BAR', () => {
            RestaurantSave.addProgress(50);
            this.hud.stageBar.set(RestaurantSave.stage, RestaurantSave.progress);
        });
        panel.button('SKIP CUSTOMER (served right)', () => this.skipCustomer());
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
        // Everyone comes in, one after another, and lines up.
        this.orders.forEach((_, k) => gsap.delayedCall(k * QUEUE.arriveGap, () => {
            if (this.gone) return;
            const customer = new Customer(this.threeScene, CUSTOMER_PATH.outside);
            this.queue.push(customer);
            this.sendToPlace(customer, [CUSTOMER_PATH.inside]);
        }));
    }

    /** Place `k` in the line (0: the counter), facing the cook: the station's customer spot, then back toward the door. */
    private queueSpot(k: number): THREE.Vector3 {
        const spot = this.kitchen!.customerSpot;
        const back = CUSTOMER_PATH.inside.clone().sub(spot).setY(0).normalize();
        return spot.clone().addScaledVector(back, QUEUE.spacing * k);
    }

    /** `customer` to their place in the line (through `via` first); the one reaching the counter orders. */
    private sendToPlace(customer: Customer, via: THREE.Vector3[] = []): void {
        const k = this.queue.indexOf(customer);
        if (k < 0) return;
        void customer.walkTo([...via, this.queueSpot(k)], Math.PI).then(() => {
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
            front.root.position.copy(this.queueSpot(0));
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
        this.moveView(0);
        this.react(true, payFor(this.order!));
    }

    private startCooking(): void {
        if (this.gone || this.phase !== 'ordering') return;
        this.phase = 'cooking';
        this.hud.hideOrder();
        this.hud.showTicket(this.order!);
        this.hud.tickTicket([]);
        this.moveView(1, () => this.hud.setButtons(true));
        RestaurantAudio.play('whoosh');
    }

    private trash(): void {
        if (this.phase !== 'cooking' || !this.kitchen?.plateHasFood) return;
        this.kitchen.trash();
        RestaurantAudio.play('drop', 0.8);
        this.hud.tickTicket([]);
    }

    private serve(): void {
        const kitchen = this.kitchen;
        if (this.phase !== 'cooking' || !kitchen || !this.order || !this.customer) return;
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
        kitchen.serve(() => {
            if (!this.gone) this.react(right, pay);
        });
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
        // Out past the line: a step to its side, along it to the door, out.
        const spot = this.queueSpot(0);
        const back = CUSTOMER_PATH.inside.clone().sub(spot).setY(0).normalize();
        const side = new THREE.Vector3(back.z, 0, -back.x).multiplyScalar(QUEUE.stepAside);
        void customer.walkTo([spot.clone().add(side), CUSTOMER_PATH.inside.clone().add(side), CUSTOMER_PATH.outside]).then(() => {
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

    // ---------------------------------------------------------------- taps on the benches

    private readonly onPointerDown = (event: PointerEvent): void => {
        RestaurantAudio.unlock();
        // A HUD button's press isn't a tap on the bench under it.
        if (uiPress.taken) {
            uiPress.taken = false;
            return;
        }
        const kitchen = this.kitchen;
        if (this.phase !== 'cooking' || !kitchen || this.view.t < 0.9) return;
        // The target whose middle is nearest the tap on screen, within its radius (measured across the screen).
        const rect = SetupThree.renderer.domElement.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const across = new THREE.Vector3().setFromMatrixColumn(this.threeCamera.matrixWorld, 0);
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

    /** The first day: what to tap next (the hand), as a 3D point: bottom bun, patty, toppings, top bun. */
    private nextHint(): THREE.Vector3 | null {
        const kitchen = this.kitchen;
        if (RestaurantSave.day > 0 || this.phase !== 'cooking' || !kitchen || !this.order || this.view.t < 0.99) return null;
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
        const { order, bench } = station.cameras;
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
        this.room?.update(dt, [...this.queue, ...this.leaving].map((c) => c.root.position));
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
            const ready = this.phase === 'cooking' && this.kitchen.dishReady;
            if (ready !== this.dishWasReady) {
                this.dishWasReady = ready;
                this.kitchen.setReadyPulse(ready);
                if (ready) RestaurantAudio.play('coins', 1.3);
            }
            this.hud.setReady(ready ? this.worldToScreen(this.kitchen.platePoint) : null);
            const hint = this.nextHint();
            this.hud.pointAt(hint ? this.worldToScreen(hint) : null);
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
        this.kitchen?.destroy();
        this.room?.dispose();
        this.hud?.destroy();
        super.destroy();
    }
}
