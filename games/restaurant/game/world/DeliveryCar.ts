// DeliveryCar.ts
//
// The pizza delivery car: a city car (settings.json delivery.car, one of the street's cars: fitted to its length, its
// front +z, as core/town/Traffic fits them), a driver sat in it (one of the customers, with their sit clip — as Mow's and
// Dig's riders sit in their tractors: the person in the vehicle's seat, moving with it) and the pizza boxes on its
// roof. Driven point-and-go: it turns toward the way it's pointed and drives; it won't go where the walk grid (a
// car-sized one) says something's in the way — it slides along it instead.

import * as THREE from 'three';
import gsap from 'gsap';
import { kitchenModel, townModel } from './Models';
import { Customer } from './Customers';
import { SETTINGS } from '../data/Settings';
import type { WalkGrid } from './WalkGrid';

/** The driver (x a customer's size: the cars are small), where they sit (the car's own space: x across, y up, z along). */
const DRIVER = { scale: 0.55, seat: new THREE.Vector3(-0.38, 0.42, 0.05) };
/** The pizza boxes on the roof: each this wide (x the kit's 2 across), stacked this far apart. */
const BOX = { width: 0.75, step: 0.12 };
/** A box hopping on or off: how long, how high. */
const HOP = { seconds: 0.55, height: 2.2 };

/**
 * Where the player points the car: a world direction (x, z; null: let go) and how hard (0 to 1). The car turns to it
 * and drives — point and go.
 */
export interface DriveInput {
    direction: { x: number; z: number } | null;
    push: number;
}

/** When it runs into something: the angles it tries instead (radians off its way: it slides along), nearest first. */
const SLIDE_ANGLES = [0.35, -0.35, 0.7, -0.7, 1.05, -1.05];
/** Turning: how much slower it goes while turning hard (at a right angle: x this). */
const TURN_SLOW = 0.45;
/**
 * Bumping into the traffic: each car's a circle this wide (x its length); a bump knocks this car back this fast (and
 * more the faster it hit), the knock fading this fast, and keeps this much of its speed.
 */
const BUMP = { radius: 0.4, knock: 4, knockPerSpeed: 0.55, fade: 4, keep: 0.25 };

export class DeliveryCar {
    public readonly root = new THREE.Group();
    private body: THREE.Object3D | null = null;
    private driver: Customer | null = null;
    private readonly boxes: THREE.Object3D[] = [];
    /** Facing (radians round y; 0: +z) and speed (units a second; < 0: backing up). */
    public heading: number;
    public speed = 0;
    /** A bump's knock (world units a second, fading). */
    private readonly knock = new THREE.Vector3();
    /** The roof's height (once the model's in). */
    private roof = 1.4;
    private readonly config = SETTINGS.delivery;

    public constructor(private readonly scene: THREE.Object3D, at: THREE.Vector3, heading: number) {
        this.heading = heading;
        this.root.position.copy(at);
        this.root.rotation.y = heading;
        scene.add(this.root);
    }

    /** The car's model and its driver (the people's models loaded first: Models.loadModels). */
    public async load(): Promise<void> {
        const model = await townModel(this.config.car);
        model.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const scale = this.config.length / Math.max(1e-4, size.z);
        model.scale.multiplyScalar(scale);
        model.position.set(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale);
        model.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) child.castShadow = child.receiveShadow = true;
        });
        this.body = new THREE.Group();
        this.body.add(model);
        this.root.add(this.body);
        this.roof = size.y * scale;
        // The driver, sat in their seat (in the car's space: they go where it goes).
        const driver = new Customer(this.root, DRIVER.seat.clone());
        driver.root.scale.setScalar(DRIVER.scale);
        driver.sitAt(DRIVER.seat.clone(), 0, DRIVER.seat.y / DRIVER.scale);
        this.driver = driver;
    }

    public get position(): THREE.Vector3 {
        return this.root.position;
    }

    public get forward(): THREE.Vector3 {
        return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    }

    /** Where the next box on the roof goes (world). */
    private roofPoint(level: number): THREE.Vector3 {
        return this.root.localToWorld(new THREE.Vector3(0, this.roof + 0.02 + level * BOX.step, -0.35));
    }

    /** A box hops from `from` (world) onto the roof (on top of the others there); `done` once it's on. */
    public loadBox(from: THREE.Vector3, done: () => void): void {
        const box = kitchenModel('pizzabox_closed');
        box.scale.setScalar(BOX.width / 2);
        this.scene.add(box);
        box.position.copy(from);
        const level = this.boxes.length;
        this.boxes.push(box);
        const start = from.clone();
        const state = { t: 0 };
        gsap.to(state, {
            t: 1, duration: HOP.seconds, ease: 'none',
            onUpdate: () => {
                box.position.lerpVectors(start, this.roofPoint(level), state.t);
                box.position.y += Math.sin(state.t * Math.PI) * HOP.height;
                box.rotation.y = this.heading + (1 - state.t) * 2;
            },
            onComplete: () => {
                // On the roof: it rides with the car now.
                this.root.attach(box);
                box.position.copy(this.root.worldToLocal(this.roofPoint(level)));
                box.rotation.set(0, 0, 0);
                gsap.fromTo(box.scale, { x: BOX.width / 2 * 1.15, y: BOX.width / 2 * 0.8, z: BOX.width / 2 * 1.15 }, { x: BOX.width / 2, y: BOX.width / 2, z: BOX.width / 2, duration: 0.25, ease: 'back.out(3)' });
                done();
            },
        });
    }

    /** The top box hops off the roof to `to` (world: a house's door) and is gone; `done` once it's there. */
    public dropBox(to: THREE.Vector3, done: () => void): void {
        const box = this.boxes.pop();
        if (!box) {
            done();
            return;
        }
        this.scene.attach(box);
        const start = box.position.clone();
        const state = { t: 0 };
        gsap.to(state, {
            t: 1, duration: HOP.seconds, ease: 'none',
            onUpdate: () => {
                box.position.lerpVectors(start, to, state.t);
                box.position.y += Math.sin(state.t * Math.PI) * HOP.height;
            },
            onComplete: () => {
                gsap.to(box.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.25, delay: 0.15, ease: 'back.in(2)', onComplete: () => { box.removeFromParent(); } });
                done();
            },
        });
    }

    /**
     * A frame's driving, point and go: it turns toward the way it's pointed (fast, even slow — no reversing needed) and
     * gets up to the speed the push asks (slower while turning hard). Running into something it slides along it (the
     * nearest angle that's clear, turning that way a little) instead of stopping dead; if it's ever inside something
     * (pushed there), it's eased out to the nearest clear spot.
     */
    /**
     * Bumped into one of `others` (the traffic: where each is)? This car's pushed out of it and knocked back (the faster
     * it hit, the harder), slowed right down. Returns which one (its index), or -1.
     */
    public bump(others: readonly { x: number; z: number }[], grid: WalkGrid | null): number {
        const at = this.root.position;
        const reach = this.config.length * BUMP.radius * 2;
        const index = others.findIndex((o) => Math.hypot(o.x - at.x, o.z - at.z) < reach);
        if (index < 0) return -1;
        const other = others[index];
        const away = new THREE.Vector3(at.x - other.x, 0, at.z - other.z);
        const distance = away.length();
        if (distance < 1e-3) away.copy(this.forward).negate();
        away.normalize();
        // Out of it (where that's clear), and knocked away from it.
        const out = at.clone().addScaledVector(away, reach - distance);
        if (!grid || grid.free(out.x, out.z)) at.copy(out);
        this.knock.copy(away).multiplyScalar(BUMP.knock + Math.abs(this.speed) * BUMP.knockPerSpeed);
        this.speed *= BUMP.keep;
        return index;
    }

    public update(dt: number, input: DriveInput, grid: WalkGrid | null): void {
        const c = this.config;
        // A knock from a bump: it slides the car back, fading out (blocked by what's in the way, as driving is).
        if (this.knock.lengthSq() > 1e-4) {
            const step = this.knock.clone().multiplyScalar(dt);
            const to = this.root.position.clone().add(step);
            if (!grid || grid.free(to.x, to.z)) this.root.position.copy(to);
            this.knock.multiplyScalar(Math.exp(-BUMP.fade * dt));
        }
        let turn = 0;
        if (input.direction && input.push > 0) {
            const want = Math.atan2(input.direction.x, input.direction.z);
            const diff = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
            const step = c.turnRate * dt;
            turn = THREE.MathUtils.clamp(diff, -step, step);
            this.heading += turn;
            // Slower through a hard turn (it swings round rather than flying off).
            const sharp = Math.abs(diff) / (Math.PI / 2);
            const target = input.push * c.maxSpeed * THREE.MathUtils.lerp(1, TURN_SLOW, THREE.MathUtils.clamp(sharp, 0, 1));
            this.speed += THREE.MathUtils.clamp(target - this.speed, -c.brake * dt, c.accel * dt);
        } else {
            this.speed += THREE.MathUtils.clamp(-this.speed, -c.brake * dt, c.brake * dt);
        }
        const at = this.root.position;
        const free = (x: number, z: number) => !grid || grid.free(x, z);
        if (grid && !free(at.x, at.z)) {
            // Inside something: out to the nearest clear spot.
            const out = grid.nearestFreePoint(at.x, at.z);
            if (out) at.lerp(out.setY(at.y), Math.min(1, dt * 6));
        } else if (this.speed > 0.01) {
            const distance = this.speed * dt;
            const ahead = (angle: number) => new THREE.Vector3(Math.sin(this.heading + angle), 0, Math.cos(this.heading + angle)).multiplyScalar(distance * Math.cos(angle));
            const straight = ahead(0);
            if (free(at.x + straight.x, at.z + straight.z)) {
                at.add(straight);
            } else {
                const slide = SLIDE_ANGLES.find((angle) => {
                    const step = ahead(angle);
                    return free(at.x + step.x, at.z + step.z);
                });
                if (slide !== undefined) {
                    at.add(ahead(slide));
                    // Along the wall: turned that way a little, a little slower.
                    this.heading += slide * Math.min(1, dt * 4);
                    this.speed *= 1 - Math.min(0.5, dt * 1.5);
                } else {
                    this.speed *= 0.5;
                }
            }
        }
        this.root.rotation.y = this.heading;
        // A little lean into turns, and a bob with speed.
        if (this.body) {
            const grip = THREE.MathUtils.clamp(this.speed / 4, 0, 1);
            this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, -Math.sign(turn) * grip * 0.06, Math.min(1, dt * 8));
            this.body.position.y = Math.abs(Math.sin(performance.now() / 90)) * 0.015 * grip;
        }
        this.driver?.update(dt);
    }

    public destroy(): void {
        for (const box of this.boxes) gsap.killTweensOf(box.scale);
        this.driver?.destroy();
        this.root.removeFromParent();
    }
}
