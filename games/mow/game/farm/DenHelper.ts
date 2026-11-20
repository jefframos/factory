// DenHelper.ts
//
// A hired helper in a den (EggLoopDef.helper / truckHelper): one of the people (People.ts) in the den's uniform (a blue
// shirt, dark trousers) with a backpack (the player's rucksack, in blue) the packs stack on. Its job, round and round:
//   1. walk to the grid with the most packs on it (the packing machine's or the gold machine's) and pick up to `carry`;
//   2. walk to where they go (the SELL square: the customer at the counter; or the truck dock: the parked truck) and
//      hand them over one at a time (paid the usual way: onto a cash square);
//   3. with nothing to hand over (or no one taking it) and cash on its cash square, walk there and take it: it's the
//      player's.
// The den answers where things are and does the handing over (DenHelperHooks); the helper walks, carries and shows it.

import * as THREE from 'three';
import { playerScale } from '../player/MowPlayer';
import { bagColor, buildRucksack } from '../player/Backpack';
import { farmItem, FarmItem, ITEM_HEIGHT } from './FarmModels';
import { loadPeople, People, PERSON_COUNT, PERSON_HEIGHT, PERSON_MODEL_HEIGHT, personCopy, randomOutfit } from './People';

const CLIP_WALK_SPEED = 1.38;
const BLEND_SPEED = 6;
const TURN_SPEED = 8;
const ARRIVE = 0.12;
/** Seconds between packs picked up / handed over. */
const PICK_SEC = 0.25;
const GIVE_SEC = 0.3;
/** The den's uniform: shirt, trousers, shoes. */
const UNIFORM = { top: '#2f6fd8', bottom: '#1f2a44', shoes: '#2b2b2f' };
/** The people models with no hat or costume (People.ts / ufo build-people: person-01, -02, -05): helpers are one of these. */
const PLAIN_PEOPLE = [0, 1, 4];
/** The backpack on its back (at the player's size 1): how high its bottom is, how far behind; its colour (a bag level's). */
const BAG = { bottom: 0.7, back: 0.3, level: 2 };

type Job = 'toPick' | 'picking' | 'toSell' | 'selling' | 'toCash' | 'waiting';

export interface DenHelperHooks {
    /** Where packs can be picked up now (den-local) and of what kind (the grid with the most); null: none. */
    pickSpot(): { at: THREE.Vector3; kind: 'goldTray' | 'tray' } | null;
    /** Takes one pack of `kind` off its grid; false if there's none. */
    take(kind: 'goldTray' | 'tray'): boolean;
    /** The SELL square and the cash square (world). */
    sellSpot(): THREE.Vector3;
    cashSpot(): THREE.Vector3;
    /** Hands a pack of `kind` from `from` (world) to the customer at the counter; false if no one's there to take it. */
    serve(kind: 'goldTray' | 'tray', from: THREE.Vector3): boolean;
    /** Money on the cash square; takes it all from `from` (the player's now). */
    cashWaiting(): number;
    collect(from: THREE.Vector3): void;
}

export class DenHelper {
    public readonly root = new THREE.Group();
    private readonly position = new THREE.Vector3();
    private readonly target = new THREE.Vector3();
    private mixer?: THREE.AnimationMixer;
    private walkAction?: THREE.AnimationAction;
    private idleAction?: THREE.AnimationAction;
    private walkWeight = 0;
    private readonly geometries: THREE.BufferGeometry[] = [];
    private job: Job = 'waiting';
    private timer = 0;
    /** What it carries (kinds, bottom up) and their drawn stack. */
    private readonly carried: ('goldTray' | 'tray')[] = [];
    private readonly stack = new THREE.Group();
    private gone = false;

    public constructor(parent: THREE.Object3D, at: THREE.Vector3, private readonly carry: number, private readonly speed: number,
        private readonly hooks: DenHelperHooks) {
        this.position.copy(at);
        this.target.copy(at);
        this.root.position.copy(at);
        parent.add(this.root);
        // The backpack on its back, the packs stacked on top of it (as the player's).
        const color = bagColor(BAG.level);
        const bag = buildRucksack(new THREE.MeshStandardMaterial({ color, roughness: 0.85 }), new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.72), roughness: 0.85 }));
        bag.scale.setScalar(playerScale());
        bag.position.set(0, BAG.bottom * playerScale(), -BAG.back * playerScale());
        this.root.add(bag);
        this.stack.position.set(0, (BAG.bottom + 0.56) * playerScale(), -BAG.back * playerScale());
        this.root.add(this.stack);
        void loadPeople().then((source) => this.build(source)).catch((error) => console.warn('[DenHelper] people', error));
    }

    private build(source: People): void {
        if (this.gone) return;
        const outfit = { ...randomOutfit(), ...UNIFORM };
        // One of the people with no hat or costume of their own (the uniform's theirs).
        const index = PLAIN_PEOPLE[Math.floor(Math.random() * PLAIN_PEOPLE.length)] % PERSON_COUNT;
        const { model, meshes } = personCopy(source, index, outfit);
        meshes.forEach(({ mesh }) => this.geometries.push(mesh.geometry));
        const scale = (PERSON_HEIGHT * playerScale()) / PERSON_MODEL_HEIGHT;
        model.scale.setScalar(scale);
        this.root.add(model);
        this.mixer = new THREE.AnimationMixer(model);
        this.walkAction = this.mixer.clipAction(source.clips.walk);
        this.idleAction = this.mixer.clipAction(source.clips.idle);
        this.walkAction.timeScale = (this.speed * playerScale()) / (CLIP_WALK_SPEED * scale);
        this.walkAction.setEffectiveWeight(0);
        this.walkAction.play();
        this.idleAction.play();
    }

    /** The top of what it carries (world): packs fly from here. */
    private hands(out = new THREE.Vector3()): THREE.Vector3 {
        return out.copy(this.position).setY(this.stack.position.y + this.carried.length * ITEM_HEIGHT.tray);
    }

    private redrawStack(): void {
        this.stack.clear();
        this.carried.forEach((kind, i) => {
            const item = farmItem(kind as FarmItem);
            item.position.y = i * ITEM_HEIGHT.tray;
            this.stack.add(item);
        });
    }

    /** Walks toward `target`: true while still on the way. */
    private walk(delta: number): boolean {
        const dx = this.target.x - this.position.x;
        const dz = this.target.z - this.position.z;
        const distance = Math.hypot(dx, dz);
        const walking = distance > ARRIVE;
        if (walking) {
            const step = Math.min(distance, this.speed * playerScale() * delta);
            this.position.x += (dx / distance) * step;
            this.position.z += (dz / distance) * step;
            const heading = Math.atan2(dx, dz);
            const difference = Math.atan2(Math.sin(heading - this.root.rotation.y), Math.cos(heading - this.root.rotation.y));
            this.root.rotation.y += Math.sign(difference) * Math.min(Math.abs(difference), TURN_SPEED * delta);
        }
        this.root.position.copy(this.position);
        this.walkWeight += ((walking ? 1 : 0) - this.walkWeight) * Math.min(1, BLEND_SPEED * delta);
        this.walkAction?.setEffectiveWeight(this.walkWeight);
        this.idleAction?.setEffectiveWeight(1 - this.walkWeight);
        return walking;
    }

    /** Its next job: packs to fetch, packs to sell, cash to take, or wait a moment. */
    private next(): void {
        if (this.carried.length) {
            this.job = 'toSell';
            this.target.copy(this.hooks.sellSpot());
            return;
        }
        if (this.hooks.cashWaiting() > 0) {
            this.job = 'toCash';
            this.target.copy(this.hooks.cashSpot());
            return;
        }
        const spot = this.hooks.pickSpot();
        if (spot) {
            this.job = 'toPick';
            this.target.copy(spot.at);
            return;
        }
        this.job = 'waiting';
        this.timer = 0.6;
    }

    public update(delta: number): void {
        this.mixer?.update(delta);
        const walking = this.walk(delta);
        this.timer -= delta;
        switch (this.job) {
            case 'waiting':
                if (this.timer <= 0) this.next();
                return;
            case 'toPick':
            case 'toSell':
            case 'toCash':
                if (walking) return;
                if (this.job === 'toCash') {
                    this.hooks.collect(this.hands());
                    this.next();
                    return;
                }
                this.job = this.job === 'toPick' ? 'picking' : 'selling';
                this.timer = 0;
                return;
            case 'picking': {
                if (this.timer > 0) return;
                const spot = this.hooks.pickSpot();
                if (this.carried.length >= this.carry || !spot || !this.hooks.take(spot.kind)) {
                    this.next();
                    return;
                }
                this.timer = PICK_SEC;
                this.carried.push(spot.kind);
                this.redrawStack();
                return;
            }
            case 'selling': {
                if (this.timer > 0) return;
                const kind = this.carried[this.carried.length - 1];
                if (!kind) {
                    this.next();
                    return;
                }
                if (!this.hooks.serve(kind, this.hands())) {
                    // No one at the counter: take the cash meanwhile, if there's any; else wait here.
                    if (this.hooks.cashWaiting() > 0) {
                        this.job = 'toCash';
                        this.target.copy(this.hooks.cashSpot());
                    } else this.timer = 0.4;
                    return;
                }
                this.carried.pop();
                this.redrawStack();
                this.timer = GIVE_SEC;
            }
        }
    }

    public destroy(): void {
        this.gone = true;
        this.mixer?.stopAllAction();
        this.geometries.forEach((geometry) => geometry.dispose());
        this.root.removeFromParent();
    }
}
