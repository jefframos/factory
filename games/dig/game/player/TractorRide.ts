// TractorRide.ts
//
// The tractor (bought at the ATM, ui/dig.json `tractor`): outside the hub the miner rides it — a smoke puff,
// the tractor appears under them, they're sat in the seat at once (no animation while riding, no tool) and
// drive faster, the wheels turning and the
// exhaust puffing while it moves; back inside the hub another puff and it's gone, the miner on foot again.
// The tractor follows the miner's body (its position and facing); the seat offset moves the body up/back
// into the cab after the character has placed itself for the frame. Three tools are ridden: the Digger (the same
// model with its texture in grey, a little slower: `rideSpeed`), the Tractor in its own colours, and the Red Tractor
// (repainted: `tint`). A power surge (PowerSurge) puts anyone in it too, as the "star" truck: smaller, its paint
// cycling through the rainbow, for as long as the surge lasts (once the model is in: it loads behind the game from
// the first input, for every player).

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { BendService } from '../services/BendService';
import { DIG, toolPaint } from '../data/DigConfig';
import { paintPixels } from '../utils/Paint';
import { DigProgress } from '../data/DigProgress';
import { hubRects } from '../data/HubData';
import type DigPlayer from './DigPlayer';
import type { DigEffects } from '../vfx/DigEffects';
import { DigAudio } from '../audio/DigAudio';
import { EngineSound } from '../audio/EngineSound';
import { PowerSurge } from '../mining/PowerSurge';

const MODEL_BASE = './dig/models/';
/** Wheel radius the spin is worked out from (world units, before the tractor's own scale). */
const WHEEL_RADIUS = 0.4;
/** The power surge's truck, for a player without a vehicle of their own: this size of the tractor. */
const STAR_SCALE = 0.8;
/** The star glow: how strongly the paint glows, and how fast it goes round the rainbow (turns a second). */
const STAR_GLOW = 0.55;
const STAR_SPIN = 0.7;

export class TractorRide {
    private readonly holder = new THREE.Group();
    private readonly wheels: THREE.Object3D[] = [];
    private riding = false;
    /** The model is in (a power surge only rides once it is). */
    private loaded = false;
    /** The star glow is on, the materials' own glow (put back when it ends), and the tractor's size now. */
    private star = false;
    private readonly emissive: { color: THREE.Color; intensity: number }[] = [];
    private scale = 1;
    private exhaustTimer = 0;
    private readonly lastPosition = new THREE.Vector3();
    private readonly seat = new THREE.Vector3();
    private readonly exhaust = new THREE.Vector3();
    /** The model's materials, its texture in its own colours, and repainted ones by paint (swapped by the tool owned: updateLook()). */
    private readonly materials: THREE.MeshStandardMaterial[] = [];
    private colorMap?: THREE.Texture;
    private readonly paintedMaps = new Map<string, THREE.Texture | undefined>();
    /** The paint shown now ('' = its own colours). */
    private paint = '';
    /** The engine, running while the miner rides. */
    private readonly engine = new EngineSound();

    /** The model's download started (load()). */
    private loadStarted = false;

    /**
     * Loads the model at once only for a player who owns a vehicle already; everyone else gets it in the background
     * once they start playing (loadInBackground(), from the scene), long before they can buy one.
     */
    public constructor(threeScene: THREE.Scene, private readonly player: DigPlayer, private readonly effects: DigEffects) {
        this.holder.visible = false;
        threeScene.add(this.holder);
        if (DigProgress.hasTractor) this.loadInBackground();
    }

    public get isRiding(): boolean {
        return this.riding;
    }

    /** Starts the model's download, once. */
    public loadInBackground(): void {
        if (this.loadStarted) return;
        this.loadStarted = true;
        void this.load();
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
            this.paintedMaps.clear();
            this.paint = '';
            this.holder.add(model);
            for (const material of this.materials) this.emissive.push({ color: material.emissive.clone(), intensity: material.emissiveIntensity });
            this.loaded = true;
        } catch (error) {
            console.warn(`[TractorRide] could not load ${config.model}`, error);
        }
    }

    /** A copy of `map` (same settings) repainted (paintPixels): the Digger's grey, the Red Tractor's red. */
    private static paintedTexture(map: THREE.Texture, paint: string): THREE.Texture | undefined {
        const image = map.image as CanvasImageSource & { width: number; height: number };
        if (!image?.width) return undefined;
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        paintPixels(pixels.data, paint);
        context.putImageData(pixels, 0, 0);
        // Its own Source: clone() shares the original's, and writing the image through it would repaint the colour map too.
        const painted = map.clone();
        painted.source = new THREE.Source(canvas);
        painted.needsUpdate = true;
        return painted;
    }

    /** The colours for the vehicle owned: grey for the Digger, its own for the Tractor, red for the Red Tractor. */
    private updateLook(): void {
        const paint = toolPaint(DigProgress.tool) ?? '';
        if (paint === this.paint || !this.colorMap) return;
        if (paint && !this.paintedMaps.has(paint)) this.paintedMaps.set(paint, TractorRide.paintedTexture(this.colorMap, paint));
        const map = paint ? this.paintedMaps.get(paint) : this.colorMap;
        if (!map) return;
        this.paint = paint;
        for (const material of this.materials) {
            if (!material.map) continue;
            material.map = map;
            material.needsUpdate = true;
        }
    }

    /**
     * The power surge's look: the tractor glowing round the rainbow (and, for a player without a vehicle, smaller —
     * the "star" truck); back to its own glow and size when the surge ends.
     */
    private updateStar(): void {
        const star = PowerSurge.active && this.loaded;
        this.scale = star && !DigProgress.hasTractor ? STAR_SCALE : 1;
        this.holder.scale.setScalar(this.scale);
        if (star) {
            const hue = (performance.now() / 1000 * STAR_SPIN) % 1;
            this.materials.forEach((material, i) => {
                material.emissive.setHSL((hue + i * 0.08) % 1, 1, 0.5);
                material.emissiveIntensity = STAR_GLOW;
            });
        } else if (this.star) {
            this.materials.forEach((material, i) => {
                material.emissive.copy(this.emissive[i].color);
                material.emissiveIntensity = this.emissive[i].intensity;
            });
        }
        this.star = star;
    }

    /** Inside the hub's floor (main room and annexes): the miner walks there. */
    private static inHub(x: number, z: number): boolean {
        return hubRects().some((r) => Math.abs(x - r.x) <= r.width / 2 && Math.abs(z - r.z) <= r.depth / 2);
    }

    /** Call after the world has updated (the character has placed itself for this frame). */
    public update(delta: number): void {
        const position = this.player.transform.position;
        // Just bought (or the background load hasn't been asked for): the model now.
        if (DigProgress.hasTractor) this.loadInBackground();
        const surge = PowerSurge.active && this.loaded;
        const ride = (DigProgress.hasTractor || surge) && !TractorRide.inHub(position.x, position.z);
        this.updateLook();
        this.updateStar();
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
        // A vehicle of their own rides at its speed; the power surge's truck at the tractor's.
        this.player.speedMultiplier = on ? (DigProgress.hasTractor ? DigProgress.tool.rideSpeed : undefined) ?? config.speedMultiplier : 1;
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
        this.seat.set(config.seat.x, config.seat.y, config.seat.z).multiplyScalar(this.scale).applyQuaternion(container.quaternion);
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
