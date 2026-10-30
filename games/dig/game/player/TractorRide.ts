// TractorRide.ts
//
// The tractor (bought at the ATM, ui/dig.json `tractor`): outside the hub the miner rides it — a smoke puff,
// the tractor appears under them, they're sat in the seat at once (no animation while riding, no tool) and
// drive faster, the wheels turning and the
// exhaust puffing while it moves; back inside the hub another puff and it's gone, the miner on foot again.
// The tractor follows the miner's body (its position and facing); the seat offset moves the body up/back
// into the cab after the character has placed itself for the frame. Two tools are ridden: the Digger (the same
// model with its texture in grey, a little slower: `rideSpeed`) and then the Tractor in its own colours.

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { BendService } from '../services/BendService';
import { DIG } from '../data/DigConfig';
import { DigProgress } from '../data/DigProgress';
import { hubRects } from '../data/HubData';
import type DigPlayer from './DigPlayer';
import type { DigEffects } from '../vfx/DigEffects';
import { DigAudio } from '../audio/DigAudio';
import { EngineSound } from '../audio/EngineSound';

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
    /** The model's materials, and its texture in colour and in grey (swapped by the tool owned: updateLook()). */
    private readonly materials: THREE.MeshStandardMaterial[] = [];
    private colorMap?: THREE.Texture;
    private greyMap?: THREE.Texture;
    private grey = false;
    /** The engine, running while the miner rides. */
    private readonly engine = new EngineSound();

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
                    (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => {
                        BendService.applyBend(m);
                        if (m instanceof THREE.MeshStandardMaterial) this.materials.push(m);
                    });
                }
                if (/wheel/i.test(child.name)) this.wheels.push(child);
            });
            const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
            if (size.y > 1e-4) model.scale.multiplyScalar(config.height / size.y);
            model.rotation.y = config.rotationY;
            model.updateMatrixWorld(true);
            model.position.y = -new THREE.Box3().setFromObject(model).min.y;
            this.colorMap = this.materials.find((m) => m.map)?.map ?? undefined;
            this.greyMap = this.colorMap ? TractorRide.greyTexture(this.colorMap) : undefined;
            this.grey = false;
            this.holder.add(model);
        } catch (error) {
            console.warn(`[TractorRide] could not load ${config.model}`, error);
        }
    }

    /** A copy of `map` (same settings) with its colours desaturated: the Digger's grey. */
    private static greyTexture(map: THREE.Texture): THREE.Texture | undefined {
        const image = map.image as CanvasImageSource & { width: number; height: number };
        if (!image?.width) return undefined;
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const data = pixels.data;
        for (let i = 0; i < data.length; i += 4) {
            const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            data[i] = data[i + 1] = data[i + 2] = luma;
        }
        context.putImageData(pixels, 0, 0);
        // Its own Source: clone() shares the original's, and writing the image through it would grey the colour map too.
        const grey = map.clone();
        grey.source = new THREE.Source(canvas);
        grey.needsUpdate = true;
        return grey;
    }

    /** The colours for the vehicle owned: grey for the Digger, its own for the Tractor. */
    private updateLook(): void {
        const grey = DigProgress.tool.greyscale === true;
        if (grey === this.grey || !this.colorMap || !this.greyMap) return;
        this.grey = grey;
        for (const material of this.materials) {
            if (!material.map) continue;
            material.map = grey ? this.greyMap : this.colorMap;
            material.needsUpdate = true;
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
        this.updateLook();
        if (ride !== this.riding) this.setRiding(ride);
        if (this.riding) this.place(delta);
        this.lastPosition.copy(position);
    }

    private setRiding(on: boolean): void {
        const config = DIG.tractor;
        this.riding = on;
        const at = this.player.transform.position.clone().setY(0.6);
        this.effects.smoke(at, config.smoke.count, config.smoke.size, new THREE.Color(config.smoke.color));
        DigAudio.play('whoosh');
        this.holder.visible = on;
        if (on) this.engine.start();
        else this.engine.stop();
        this.player.speedMultiplier = on ? DigProgress.tool.rideSpeed ?? config.speedMultiplier : 1;
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
        // Revs with the speed: walking speed (5) x the ride multiplier is about flat out.
        this.engine.update(delta > 0 ? moved / delta / (5 * this.player.speedMultiplier) : 0);
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
        this.engine.stop();
        this.holder.removeFromParent();
    }
}
