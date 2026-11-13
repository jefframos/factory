// MarketScene.ts
//
// The supermarket, between restaurant days: a market floor of produce crates (everything settings.json's market sells —
// what the burgers need, and plenty they don't) and a shopping list made from the next day's orders (buns, patties and
// the toppings they ask for: no quantities, buying an item stocks the kitchen with it). The game: tap the crates on the
// list. Each one hops, flies to its card and is ticked. A crate not on the list fails the run: the "wrong item" card,
// TRY AGAIN, the list starts over. The whole list ticked: ALL SET!, and the next day opens (`onDone`). No money here:
// coins are the restaurant's upgrade bar. The first visit, a hand points at the next crate on the list.

import * as THREE from 'three';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import SetupThree from 'core/scene/SetupThree';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import { kitchenModel, loadModels, sizeOf } from '../world/Models';
import { Customer } from '../world/Customers';
import { SETTINGS, MarketItem } from '../data/Settings';
import { RestaurantSave } from '../data/RestaurantSave';
import { shoppingList } from '../data/Market';
import { MarketHud } from '../ui/MarketHud';
import { uiPress } from '../ui/UiParts';
import { RestaurantAudio } from '../audio/RestaurantAudio';
import { MARKET_LAYOUT, buildMarketRoom, marketRoomModels } from '../world/MarketLayout';
import type { Room } from 'core/rooms/Room';
import { bendAll, bendAround } from '../world/Bend';

const FOV = 40;
/** The crates' grid (levels/market.json): its middle, columns, the gaps between crates (x, and z: room for the name tags). */
const GRID = MARKET_LAYOUT.market.crates;
/** The view: from the shopper's side (-z), tilted this far from overhead; room beside the grid (units); the shares of
 *  the screen's height the list (top) and the hint (bottom) take, the grid fitted between. */
const VIEW = { tilt: 0.7, padX: 0.7, top: 0.27, bottom: 0.12 };
/** Raw patties have no crate of their own: an empty crate with these on top. */
const PATTY_CRATE = 'crate';
const PATTIES_ON_TOP = 3;
/** After the list's done, how long before the restaurant opens. */
const DONE_SECONDS = 1.6;

const MODELS = [
    ...new Set([...SETTINGS.market.flatMap((item) => [item.crate, item.icon]), 'food_ingredient_burger_uncooked', ...marketRoomModels()]),
];

interface Crate {
    item: MarketItem;
    holder: THREE.Group;
    box: THREE.Mesh;
    tagAt: THREE.Vector3;
}

export default class MarketScene extends ThreeScene {
    private hud!: MarketHud;
    private readonly crates: Crate[] = [];
    private readonly list = shoppingList(RestaurantSave.orders);
    private readonly basket = new Set<string>();
    private cashier: Customer | null = null;
    /** The market's floor, walls and props (levels/market.json). */
    private room: Room | null = null;
    private readonly raycaster = new THREE.Raycaster();
    private readonly pointer = new THREE.Vector2();
    private readonly hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
    /** The grid's bounds on the floor: the camera frames them. */
    private readonly bounds = new THREE.Box3();
    /** Taps count (not loading, not on the wrong-item card, not done). */
    private playing = false;
    private gone = false;

    public constructor(game: Game, private readonly onDone: () => void = () => undefined) {
        super(game);
    }

    public build(): void {
        this.threeScene.background = new THREE.Color(0xcfe7d6);
        const pmrem = new THREE.PMREMGenerator(SetupThree.renderer);
        this.threeScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.threeScene.environmentIntensity = 0.35;
        pmrem.dispose();
        this.threeScene.add(new THREE.HemisphereLight(0xffffff, 0xc9d8c0, 1.15));
        const sun = new THREE.DirectionalLight(0xffffff, 1.5);
        sun.position.set(-5, 12, -7);
        sun.castShadow = true;
        sun.shadow.mapSize.set(1024, 1024);
        Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
        sun.shadow.bias = -0.0008;
        this.threeScene.add(sun, sun.target);
        SetupThree.renderer.shadowMap.enabled = true;
        this.threeCamera.fov = FOV;

        this.hud = new MarketHud();
        this.game.uiLayer.addChild(this.hud);
        window.addEventListener('pointerdown', this.onPointerDown);
        this.buildDebug();
        void this.load();
    }

    private buildDebug(): void {
        const panel = DebugOverlay.instance.panel('Supermarket', { id: 'restaurant.market' });
        panel.button('FILL LIST', () => {
            if (!this.playing) return;
            this.list.forEach((item) => this.basket.add(item.id));
            this.hud.tickList(this.basket);
            this.finish();
        });
        panel.button('RESET DATA', () => {
            RestaurantSave.erase();
            window.location.reload();
        });
    }

    private async load(): Promise<void> {
        try {
            await loadModels(MODELS);
        } catch (error) {
            console.error('[Restaurant] could not load the market', error);
            return;
        }
        if (this.gone) return;
        this.buildMarket();
        this.hud.showList(this.list);
        this.hud.showHint('Buy everything on the list!', 2.5);
        this.fitCamera();
        this.playing = true;
    }

    private buildMarket(): void {
        const items = SETTINGS.market;
        // Each crate (raw patties: an empty one with patties on top), measured for the grid's spacing.
        const holders = items.map((item) => {
            const holder = new THREE.Group();
            const crate = kitchenModel(item.crate);
            holder.add(crate);
            if (item.crate === PATTY_CRATE) {
                const top = sizeOf(crate).y;
                for (let i = 0; i < PATTIES_ON_TOP; i++) {
                    const patty = kitchenModel('food_ingredient_burger_uncooked');
                    patty.scale.setScalar(0.8);
                    patty.position.set((i - 1) * 0.3, top * 0.75 + i * 0.05, (i % 2) * 0.15 - 0.05);
                    patty.rotation.y = i * 0.8;
                    holder.add(patty);
                }
            }
            return holder;
        });
        const size = holders.reduce((most, h) => most.max(sizeOf(h)), new THREE.Vector3());
        const rows = Math.ceil(items.length / GRID.columns);
        const stepX = size.x + GRID.gapX;
        const stepZ = size.z + GRID.gapZ;
        // Shuffled, so the list's items aren't always in the same spots.
        const spots = items.map((_, i) => i).sort(() => Math.random() - 0.5);
        items.forEach((item, i) => {
            const column = spots[i] % GRID.columns;
            const row = Math.floor(spots[i] / GRID.columns);
            const holder = holders[i];
            holder.position.set(GRID.x + (column - (GRID.columns - 1) / 2) * stepX, 0, GRID.z + ((rows - 1) / 2 - row) * stepZ);
            holder.rotation.y = (Math.random() - 0.5) * 0.12;
            this.threeScene.add(holder);
            const box = new THREE.Mesh(new THREE.BoxGeometry(size.x + 0.2, size.y + 0.4, size.z + 0.2), this.hitMaterial);
            box.position.copy(holder.position).setY(size.y / 2);
            this.threeScene.add(box);
            this.crates.push({ item, holder, box, tagAt: holder.position.clone().add(new THREE.Vector3(0, 0, -size.z / 2 - 0.3)) });
        });
        const halfX = (GRID.columns * stepX) / 2;
        const halfZ = (rows * stepZ) / 2;
        this.bounds.set(new THREE.Vector3(GRID.x - halfX, 0, GRID.z - halfZ), new THREE.Vector3(GRID.x + halfX, size.y, GRID.z + halfZ));

        // The room (floor, walls, fridges and shelves: levels/market.json) and the cashier.
        this.room = buildMarketRoom();
        this.threeScene.add(this.room.group);
        const { cashier } = MARKET_LAYOUT.market;
        this.cashier = new Customer(this.threeScene, new THREE.Vector3(cashier.x, 0, cashier.z));
        this.cashier.root.rotation.y = cashier.rotationY ?? Math.PI;
        this.cashier.root.scale.setScalar(cashier.scale ?? 1);

        bendAround(GRID.x, GRID.z);
        bendAll(this.threeScene);
    }

    // ---------------------------------------------------------------- shopping

    private readonly onPointerDown = (event: PointerEvent): void => {
        RestaurantAudio.unlock();
        if (uiPress.taken) {
            uiPress.taken = false;
            return;
        }
        if (!this.playing) return;
        const rect = SetupThree.renderer.domElement.getBoundingClientRect();
        this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(this.pointer, this.threeCamera);
        const hit = this.raycaster.intersectObjects(this.crates.map((c) => c.box), false)[0];
        const crate = hit && this.crates.find((c) => c.box === hit.object);
        if (crate) this.pick(crate);
    };

    private pick(crate: Crate): void {
        const { item, holder } = crate;
        const onList = this.list.some((i) => i.id === item.id);
        if (onList && this.basket.has(item.id)) {
            // Already in: no harm done.
            RestaurantAudio.play('wrong');
            this.hud.showHint('Already in your basket', 1.4);
            this.wobble(holder);
            return;
        }
        if (!onList) {
            this.fail(crate);
            return;
        }
        this.basket.add(item.id);
        RestaurantAudio.play('pick', 0.9 + Math.random() * 0.2);
        gsap.fromTo(holder.scale, { x: 1.15, y: 0.85, z: 1.15 }, { x: 1, y: 1, z: 1, duration: 0.35, ease: 'back.out(3)' });
        const from = this.worldToScreen(holder.position.clone().setY(0.8)) ?? { x: 0, y: 0 };
        this.hud.flyBought(item, from, () => {
            if (this.gone) return;
            RestaurantAudio.play('drop');
            this.hud.tickList(this.basket);
        });
        if (this.basket.size === this.list.length) this.finish();
    }

    private wobble(holder: THREE.Group): void {
        const x = holder.position.x;
        gsap.fromTo(holder.position, { x: x - 0.12 }, { x, duration: 0.4, ease: 'elastic.out(1, 0.3)' });
    }

    /** A wrong item: the run's failed — the card, then the list from the start (the coins back). */
    private fail(crate: Crate): void {
        this.playing = false;
        this.wobble(crate.holder);
        RestaurantAudio.play('sad');
        this.hud.showHint(null);
        gsap.delayedCall(0.35, () => {
            if (this.gone) return;
            this.hud.showWrong(crate.item, () => {
                this.basket.clear();
                this.hud.tickList(this.basket);
                this.playing = true;
            });
        });
    }

    /** The whole list's in the basket: off to the restaurant. */
    private finish(): void {
        this.playing = false;
        gsap.delayedCall(0.6, () => {
            if (this.gone) return;
            RestaurantAudio.play('happy');
            this.hud.banner('ALL SET!', 'Everything for tomorrow');
        });
        gsap.delayedCall(DONE_SECONDS + 0.6, () => {
            if (!this.gone) this.onDone();
        });
    }

    /** The first visit: the next crate on the list that's not in the basket. */
    private nextHint(): THREE.Vector3 | null {
        if (RestaurantSave.day > 1 || !this.playing) return null;
        const next = this.list.find((item) => !this.basket.has(item.id));
        const crate = next && this.crates.find((c) => c.item.id === next.id);
        return crate ? crate.holder.position.clone().setY(1) : null;
    }

    // ---------------------------------------------------------------- the camera

    /** The crates framed (with room for the list above and the hint below), from the shopper's side. */
    private fitCamera(): void {
        const camera = this.threeCamera;
        camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
        const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const size = this.bounds.getSize(new THREE.Vector3());
        const width = size.x + VIEW.padX * 2;
        // The grid as seen (its depth, foreshortened, and the crates' height), in the share of the screen left for it.
        const seen = size.z * Math.cos(VIEW.tilt) + size.y * Math.sin(VIEW.tilt);
        const share = 1 - VIEW.top - VIEW.bottom;
        const distance = Math.max(seen / share / 2 / tan, width / 2 / (tan * camera.aspect));
        // The grid's middle sits that much lower on screen than the middle: aim that much further back.
        const frameHeight = 2 * distance * tan;
        const lower = ((VIEW.top - VIEW.bottom) / 2) * frameHeight;
        const aim = this.bounds.getCenter(new THREE.Vector3()).setY(size.y / 2).add(new THREE.Vector3(0, 0, lower / Math.cos(VIEW.tilt)));
        camera.position.copy(aim).add(new THREE.Vector3(0, Math.cos(VIEW.tilt), -Math.sin(VIEW.tilt)).multiplyScalar(distance));
        camera.lookAt(aim);
        camera.updateProjectionMatrix();
    }

    // ---------------------------------------------------------------- frame

    public update(delta: number): void {
        const dt = Math.min(delta, 0.1);
        this.cashier?.update(dt);
        this.room?.update(dt, []);
        // (Crates hop and fly; anything new bends too.)
        bendAll(this.threeScene);
        if (this.crates.length) {
            this.threeCamera.updateMatrixWorld();
            this.hud.setTags(this.crates.map(({ item, tagAt }) => ({ item, at: this.worldToScreen(tagAt) })));
            const hint = this.nextHint();
            this.hud.pointAt(hint ? this.worldToScreen(hint) : null);
        }
        super.update(delta);
    }

    public resize(): void {
        this.hud?.reposition();
        if (this.crates.length) this.fitCamera();
    }

    public destroy(): void {
        this.gone = true;
        window.removeEventListener('pointerdown', this.onPointerDown);
        DebugOverlay.instance.removePanel('restaurant.market');
        this.crates.forEach(({ holder, box }) => {
            gsap.killTweensOf([holder.position, holder.scale]);
            box.geometry.dispose();
        });
        this.hitMaterial.dispose();
        this.cashier?.destroy();
        this.room?.dispose();
        this.hud?.destroy();
        super.destroy();
    }
}
