// TractorRide.ts
//
// The ridden mowers (ui/mow.json tools with `ride`: the Ride-on and up), dig's tractor brought over: with one owned,
// stepping into a section that isn't restored yet mounts it — a smoke puff, the tractor appears under the player, they
// sit in its seat at once — and stepping out (onto a pavement, an ATM, a restored section) gets them off again with
// another puff. While riding, the wheels turn and the exhaust puffs as it moves, and it cuts from under the tractor to
// its front (cutPoint); on foot with a ridden mower, nothing is cut. One model (`tractor`: look, seat, exhaust, smoke,
// edited in the editor's Tractor tab) for every ridden mower, tinted with the mower's colour and scaled by its
// `rideScale`.
//
// The tractor follows the player's body (its position and facing); the seat offset moves the body up / back into it
// after the character has placed itself for the frame.

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { BendService } from '../services/BendService';
import { MOW, ToolDef } from '../data/MowConfig';
import { MowProgress } from '../data/MowProgress';
import type MowPlayer from './MowPlayer';
import type { MowEffects } from '../vfx/MowEffects';
import { MowAudio } from '../audio/MowAudio';

const MODEL_BASE = './mow/models/';
/** Wheel radius the spin is worked out from (world units, at the tractor's base height). */
const WHEEL_RADIUS = 0.4;
/** How much of the mower's colour tints the tractor (0 = its own colours). */
const TINT = 0.45;

export class TractorRide {
    private readonly holder = new THREE.Group();
    /** The model, fitted to the base height (the holder scales it per mower). */
    private model?: THREE.Object3D;
    private readonly wheels: THREE.Object3D[] = [];
    private readonly materials: { material: THREE.MeshStandardMaterial; color: THREE.Color }[] = [];
    private riding = false;
    private lookFor?: ToolDef;
    private exhaustTimer = 0;
    private readonly lastPosition = new THREE.Vector3();
    private readonly seat = new THREE.Vector3();
    private readonly exhaust = new THREE.Vector3();
    private readonly forward = new THREE.Vector3();

    /** `unfinished(x, z)`: whether that spot is in an open section not restored yet (where the tractor is ridden). */
    public constructor(threeScene: THREE.Scene, private readonly player: MowPlayer, private readonly effects: MowEffects,
        private readonly unfinished: (x: number, z: number) => boolean) {
        this.holder.visible = false;
        threeScene.add(this.holder);
        void this.load();
    }

    public get isRiding(): boolean {
        return this.riding;
    }

    /** The current mower's size on the tractor (1 = the base height). */
    private get scale(): number {
        return MowProgress.tool.rideScale ?? 1;
    }

    private async load(): Promise<void> {
        const config = MOW.tractor;
        try {
            const model = await ModelLoaderManager.instance.loadModel(`${MODEL_BASE}${config.model}`);
            model.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.material = Array.isArray(child.material) ? child.material.map((m) => m.clone()) : child.material.clone();
                    (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => {
                        BendService.applyBend(m);
                        if (m instanceof THREE.MeshStandardMaterial) this.materials.push({ material: m, color: m.color.clone() });
                    });
                }
                if (/wheel/i.test(child.name)) this.wheels.push(child);
            });
            const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
            if (size.y > 1e-4) model.scale.multiplyScalar(config.height / size.y);
            model.rotation.y = config.rotationY;
            model.updateMatrixWorld(true);
            model.position.y = -new THREE.Box3().setFromObject(model).min.y;
            this.model = model;
            this.lookFor = undefined;
            this.holder.add(model);
        } catch (error) {
            console.warn(`[TractorRide] could not load ${config.model}`, error);
        }
    }

    /** The current mower's look: its colour over the tractor's, its size. */
    private updateLook(): void {
        const tool = MowProgress.tool;
        if (tool === this.lookFor || !this.model) return;
        this.lookFor = tool;
        const tint = new THREE.Color(tool.color);
        for (const { material, color } of this.materials) material.color.copy(color).lerp(tint, TINT);
        this.holder.scale.setScalar(this.scale);
    }

    /** Call after the world has updated (the character has placed itself for this frame). */
    public update(delta: number): void {
        const position = this.player.transform.position;
        const ride = MowProgress.tool.ride === true && this.unfinished(position.x, position.z);
        this.updateLook();
        if (ride !== this.riding) this.setRiding(ride);
        if (this.riding) this.place(delta);
        this.lastPosition.copy(position);
    }

    private setRiding(on: boolean): void {
        const config = MOW.tractor;
        this.riding = on;
        this.player.riding = on;
        const at = this.player.transform.position.clone().setY(0.6);
        this.effects.smoke(at, config.smoke.count, config.smoke.size * this.scale, new THREE.Color(config.smoke.color));
        MowAudio.play('whoosh');
        this.holder.visible = on;
        this.player.character?.body.sitNow(on);
    }

    /** Where it cuts while ridden: from under the tractor to just past its front (the mower's width across). */
    public cutPoint(out: THREE.Vector3): THREE.Vector3 {
        const container = this.player.character?.container;
        this.forward.set(0, 0, 1);
        if (container) this.forward.applyQuaternion(container.quaternion).setY(0).normalize();
        return out.copy(this.player.transform.position).addScaledVector(this.forward, MOW.tractor.cutAhead * this.scale).setY(0);
    }

    /** Puts the tractor under the player (facing where they face) and the player in the seat. */
    private place(delta: number): void {
        const config = MOW.tractor;
        const character = this.player.character;
        if (!character) return;
        const container = character.container;
        const feet = this.player.transform.position;
        this.holder.position.set(feet.x, 0, feet.z);
        this.holder.quaternion.copy(container.quaternion);
        this.seat.set(config.seat.x, config.seat.y, config.seat.z).multiplyScalar(this.scale).applyQuaternion(container.quaternion);
        container.position.add(this.seat);

        const moved = Math.hypot(feet.x - this.lastPosition.x, feet.z - this.lastPosition.z);
        const spin = moved / (WHEEL_RADIUS * (config.height / 1.5) * this.scale);
        for (const wheel of this.wheels) wheel.rotation.x += spin;
        if (moved > 1e-3) {
            this.exhaustTimer -= delta;
            if (this.exhaustTimer <= 0) {
                this.exhaustTimer = config.exhaust.interval;
                this.exhaust.set(config.exhaust.x, config.exhaust.y, config.exhaust.z).multiplyScalar(this.scale)
                    .applyQuaternion(container.quaternion).add(this.holder.position);
                this.effects.smoke(this.exhaust, 1, config.exhaust.size * this.scale, new THREE.Color(config.smoke.color), 0.25);
            }
        }
    }

    public destroy(): void {
        this.holder.removeFromParent();
    }
}
