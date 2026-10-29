// TractorRide.ts
//
// The tractor (bought at the ATM, ui/dig.json `tractor`): outside the hub the miner rides it — a smoke puff,
// the tractor appears under them, they're sat in the seat at once (no animation while riding, no tool) and
// drive faster, the wheels turning and the
// exhaust puffing while it moves; back inside the hub another puff and it's gone, the miner on foot again.
// The tractor follows the miner's body (its position and facing); the seat offset moves the body up/back
// into the cab after the character has placed itself for the frame.

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { BendService } from '../services/BendService';
import { DIG } from '../data/DigConfig';
import { DigProgress } from '../data/DigProgress';
import { hubRects } from '../data/HubData';
import type DigPlayer from './DigPlayer';
import type { DigEffects } from '../vfx/DigEffects';

const MODEL_BASE = './dig/models/';
/** Wheel radius the spin is worked out from (world units, before the tractor's own scale). */
const WHEEL_RADIUS = 0.4;

export class TractorRide {
    private readonly holder = new THREE.Group();
    private readonly wheels: THREE.Object3D[] = [];
    private riding = false;
    private exhaustTimer = 0;
    private readonly lastPosition = new THREE.Vector3();
    private readonly seat = new THREE.Vector3();
    private readonly exhaust = new THREE.Vector3();

    public constructor(threeScene: THREE.Scene, private readonly player: DigPlayer, private readonly effects: DigEffects) {
        this.holder.visible = false;
        threeScene.add(this.holder);
        void this.load();
    }

    public get isRiding(): boolean {
        return this.riding;
    }

    private async load(): Promise<void> {
        const config = DIG.tractor;
        try {
            const model = await ModelLoaderManager.instance.loadModel(`${MODEL_BASE}${config.model}`);
            model.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.material = Array.isArray(child.material) ? child.material.map((m) => m.clone()) : child.material.clone();
                    (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => BendService.applyBend(m));
                }
                if (/wheel/i.test(child.name)) this.wheels.push(child);
            });
            const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
            if (size.y > 1e-4) model.scale.multiplyScalar(config.height / size.y);
            model.rotation.y = config.rotationY;
            model.updateMatrixWorld(true);
            model.position.y = -new THREE.Box3().setFromObject(model).min.y;
            this.holder.add(model);
        } catch (error) {
            console.warn(`[TractorRide] could not load ${config.model}`, error);
        }
    }

    /** Inside the hub's floor (main room and annexes): the miner walks there. */
    private static inHub(x: number, z: number): boolean {
        return hubRects().some((r) => Math.abs(x - r.x) <= r.width / 2 && Math.abs(z - r.z) <= r.depth / 2);
    }

    /** Call after the world has updated (the character has placed itself for this frame). */
    public update(delta: number): void {
        const position = this.player.transform.position;
        const ride = DigProgress.hasTractor && !TractorRide.inHub(position.x, position.z);
        if (ride !== this.riding) this.setRiding(ride);
        if (this.riding) this.place(delta);
        this.lastPosition.copy(position);
    }

    private setRiding(on: boolean): void {
        const config = DIG.tractor;
        this.riding = on;
        const at = this.player.transform.position.clone().setY(0.6);
        this.effects.smoke(at, config.smoke.count, config.smoke.size, new THREE.Color(config.smoke.color));
        this.holder.visible = on;
        this.player.speedMultiplier = on ? config.speedMultiplier : 1;
        this.player.seated = on;
        const character = this.player.character;
        if (on) {
            // Just sit: drop whatever the hands were doing.
            character?.stopAction();
            character?.showTool(undefined);
        }
        character?.body.sitNow(on);
    }

    /** Puts the tractor under the miner (facing where they face) and the miner in the seat. */
    private place(delta: number): void {
        const config = DIG.tractor;
        const character = this.player.character;
        if (!character) return;
        const container = character.container;
        const feet = this.player.transform.position;
        this.holder.position.set(feet.x, 0, feet.z);
        this.holder.quaternion.copy(container.quaternion);
        this.seat.set(config.seat.x, config.seat.y, config.seat.z).applyQuaternion(container.quaternion);
        container.position.add(this.seat);

        const moved = Math.hypot(feet.x - this.lastPosition.x, feet.z - this.lastPosition.z);
        const spin = moved / (WHEEL_RADIUS * (config.height / 1.5));
        for (const wheel of this.wheels) wheel.rotation.x += spin;
        if (moved > 1e-3) {
            this.exhaustTimer -= delta;
            if (this.exhaustTimer <= 0) {
                this.exhaustTimer = config.exhaust.interval;
                this.exhaust.set(config.exhaust.x, config.exhaust.y, config.exhaust.z).applyQuaternion(container.quaternion).add(this.holder.position);
                this.effects.smoke(this.exhaust, 1, config.exhaust.size, new THREE.Color(config.smoke.color), 0.25);
            }
        }
    }

    public destroy(): void {
        this.holder.removeFromParent();
    }
}
