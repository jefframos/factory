// TractorRide.ts
//
// The ridden mowers (ui/mow.json tools with `ride`: the Ride-on and up), dig's tractor brought over: with one owned,
// the player rides it wherever the scene's `unfinished(x, z)` says (Mow Town: everywhere) — a smoke puff, the tractor
// appears under the player, they sit in its seat at once — and gets off where it says not to, with another puff. While riding, the wheels turn and the exhaust puffs as it moves, and it cuts from under the tractor to
// its front (cutPoint); on foot with a ridden mower, nothing is cut. One model (`tractor`: dig's tractor — look, seat,
// exhaust, smoke, edited in the editor's Tractor tab) for every ridden mower, painted like dig's vehicles (the
// mower's `greyscale` / `tint`: the grey Digger, the purple Tractor, the Red Tractor; utils/Paint.ts) and scaled by
// its `rideScale`.
//
// The tractor follows the player's body (its position and facing); the seat offset moves the body up / back into it
// after the character has placed itself for the frame.

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { BendService } from '../services/BendService';
import { MOW, ToolDef, toolPaint } from '../data/MowConfig';
import { isBodyMaterial, paintPixels } from '../utils/Paint';
import { MowProgress } from '../data/MowProgress';
import type MowPlayer from './MowPlayer';
import { PLAYER_SCALE } from './MowPlayer';
import type { MowEffects } from '../vfx/MowEffects';
import { MowAudio } from '../audio/MowAudio';

const MODEL_BASE = './mow/models/';
/** Wheel radius the spin is worked out from (world units, at the tractor's base height). */
const WHEEL_RADIUS = 0.4;
/** Built wheels (buildWheels()) this much bigger than the tyres they stand in for. */
const WHEEL_GROW = 1.08;

export class TractorRide {
    private readonly holder = new THREE.Group();
    /** The model, fitted to the base height (the holder scales it per mower). */
    private model?: THREE.Object3D;
    private readonly wheels: THREE.Object3D[] = [];
    private readonly materials: THREE.MeshStandardMaterial[] = [];
    /** The body's materials in a model without a texture, with their own colours (updateLook() repaints them). */
    private readonly bodyColors = new Map<THREE.MeshStandardMaterial, THREE.Color>();
    /** The model's texture in its own colours, and repainted copies by paint (updateLook()). */
    private colorMap?: THREE.Texture;
    private readonly paintedMaps = new Map<string, THREE.Texture | undefined>();
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
        // With the player's size (MowDesign.playerScale): the tractor, its seat, wheel grip and exhaust together.
        return (MowProgress.tool.rideScale ?? 1) * PLAYER_SCALE;
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
                        if (!(m instanceof THREE.MeshStandardMaterial)) return;
                        this.materials.push(m);
                        // A saturated colour and no texture: the body (recoloured per mower in updateLook()).
                        if (isBodyMaterial(m)) this.bodyColors.set(m, m.color.clone());
                    });
                }
                if (/wheel/i.test(child.name)) this.wheels.push(child);
            });
            const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
            if (size.y > 1e-4) model.scale.multiplyScalar(config.height / size.y);
            model.rotation.y = config.rotationY;
            model.updateMatrixWorld(true);
            model.position.y = -new THREE.Box3().setFromObject(model).min.y;
            model.updateMatrixWorld(true);
            // No wheels of its own to turn (the lawn tractor's four tyres are one mesh): spinning ones in their place.
            if (!this.wheels.length) this.buildWheels(model);
            this.model = model;
            this.colorMap = this.materials.find((m) => m.map)?.map ?? undefined;
            this.paintedMaps.clear();
            this.lookFor = undefined;
            this.holder.add(model);
        } catch (error) {
            console.warn(`[TractorRide] could not load ${config.model}`, error);
        }
    }

    /**
     * Replaces a merged tyre mesh (the biggest mesh in a "tire" material) with four spinning wheels: its vertices split
     * by corner (front / back, left / right), each corner's box gives a wheel's centre, radius and width, a little
     * bigger (WHEEL_GROW) so the old tyre doesn't show through. Each wheel: a faceted tyre, a light hub and a bolt bar
     * off-centre on the hub, so the turn shows. They're children of the model (its scale and turn).
     */
    private buildWheels(model: THREE.Object3D): void {
        let tyres: THREE.Mesh | undefined;
        let most = 0;
        model.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            const material = Array.isArray(child.material) ? child.material[0] : child.material;
            const count = child.geometry.getAttribute('position')?.count ?? 0;
            if (/tire|tyre|wheel/i.test(material?.name ?? '') && count > most) {
                most = count;
                tyres = child;
            }
        });
        if (!tyres) return;
        // The tyre mesh's vertices in the model's frame.
        const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert().multiply(tyres.matrixWorld);
        const position = tyres.geometry.getAttribute('position');
        const points: THREE.Vector3[] = [];
        const all = new THREE.Box3();
        for (let i = 0; i < position.count; i++) {
            const point = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(toModel);
            points.push(point);
            all.expandByPoint(point);
        }
        const centre = all.getCenter(new THREE.Vector3());
        const corners = [0, 1, 2, 3].map(() => new THREE.Box3());
        for (const point of points) corners[(point.x > centre.x ? 1 : 0) + (point.z > centre.z ? 2 : 0)].expandByPoint(point);
        tyres.visible = false;
        const tyreMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.9, flatShading: true });
        const hubMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.6, flatShading: true });
        [tyreMaterial, hubMaterial].forEach((material) => BendService.applyBend(material));
        let radii = 0;
        for (const box of corners) {
            if (box.isEmpty()) continue;
            const size = box.getSize(new THREE.Vector3());
            const radius = (Math.max(size.y, size.z) / 2) * WHEEL_GROW;
            const width = size.x * WHEEL_GROW;
            const wheel = new THREE.Group();
            box.getCenter(wheel.position);
            const tyre = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 14), tyreMaterial);
            tyre.rotation.z = Math.PI / 2;
            const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, width * 1.06, 10), hubMaterial);
            hub.rotation.z = Math.PI / 2;
            // A bar across the hub (sticking out a touch both sides): the spin is visible on it.
            const bar = new THREE.Mesh(new THREE.BoxGeometry(width * 1.1, radius * 0.16, radius * 0.8), tyreMaterial);
            wheel.add(tyre, hub, bar);
            model.add(wheel);
            this.wheels.push(wheel);
            radii += radius;
        }
        if (this.wheels.length) this.wheelRadius = (radii / this.wheels.length) * model.scale.x;
    }

    /** Built wheels' radius (holder units, at the base height), for their spin. */
    private wheelRadius?: number;

    /** A copy of `map` (same settings) repainted (paintPixels): grey, or a colour. */
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

    /** The current mower's look: its paint (toolPaint) and its size. */
    private updateLook(): void {
        const tool = MowProgress.tool;
        if (tool === this.lookFor || !this.model) return;
        this.lookFor = tool;
        const paint = toolPaint(tool);
        if (paint && !this.paintedMaps.has(paint) && this.colorMap) this.paintedMaps.set(paint, TractorRide.paintedTexture(this.colorMap, paint));
        const map = (paint ? this.paintedMaps.get(paint) : undefined) ?? this.colorMap;
        for (const material of this.materials) {
            if (!material.map || !map) continue;
            material.map = map;
            material.needsUpdate = true;
        }
        // A model in plain colours (no texture to repaint): its body colour (the colourful parts: not the tyres, seat
        // or trim) takes the paint, a colour, or grey for `greyscale`.
        for (const [material, original] of this.bodyColors) {
            if (!paint) material.color.copy(original);
            else if (paint === 'grey') material.color.setRGB(0.55, 0.55, 0.55);
            else material.color.set(paint);
        }
        this.holder.scale.setScalar(this.scale);
    }

    /** Call after the world has updated (the character has placed itself for this frame). */
    public update(delta: number): void {
        const position = this.player.transform.position;
        const ride = MowProgress.tool.ride === true && this.unfinished(position.x, position.z);
        this.updateLook();
        if (ride !== this.riding) this.setRiding(ride);
        // Mounted before the character had loaded (riding from the first frame, now it's ridden everywhere): seat it
        // as soon as it's there.
        if (this.riding && !this.seated && this.player.character) {
            this.player.character.body.sitNow(true);
            this.seated = true;
        }
        if (this.riding) {
            this.place(delta);
            this.holdWheel();
        }
        this.lastPosition.copy(position);
    }

    /** The character is in the seat pose (sitNow(true) reached a loaded character). */
    private seated = false;

    private setRiding(on: boolean): void {
        const config = MOW.tractor;
        this.riding = on;
        this.player.riding = on;
        const at = this.player.transform.position.clone().setY(0.6);
        this.effects.smoke(at, config.smoke.count, config.smoke.size * this.scale, new THREE.Color(config.smoke.color));
        MowAudio.play('whoosh');
        this.holder.visible = on;
        this.player.character?.body.sitNow(on);
        this.seated = !!this.player.character && on;
    }

    /** Where it cuts while ridden: from under the tractor to just past its front (the mower's width across). */
    public cutPoint(out: THREE.Vector3): THREE.Vector3 {
        const container = this.player.character?.container;
        this.forward.set(0, 0, 1);
        if (container) this.forward.applyQuaternion(container.quaternion).setY(0).normalize();
        return out.copy(this.player.transform.position).addScaledVector(this.forward, MOW.tractor.cutAhead * this.scale).setY(0);
    }

    /** The hands on the steering wheel (MOW.tractor.steer), either side of its middle. */
    private holdWheel(): void {
        const steer = MOW.tractor.steer;
        const container = this.player.character?.container;
        if (!steer || !container) return;
        container.updateMatrixWorld(true);
        const middle = this.wheelLeft.set(steer.x, steer.y, steer.z).multiplyScalar(this.scale).applyQuaternion(container.quaternion).add(this.holder.position);
        const side = this.wheelSide.set(steer.spread * this.scale, 0, 0).applyQuaternion(container.quaternion);
        this.wheelRight.copy(middle).sub(side);
        middle.add(side);
        this.player.holdWheel(middle, this.wheelRight, steer.hand);
    }

    private readonly wheelLeft = new THREE.Vector3();
    private readonly wheelRight = new THREE.Vector3();
    private readonly wheelSide = new THREE.Vector3();

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
        const radius = this.wheelRadius ?? WHEEL_RADIUS * (config.height / 1.5);
        const spin = moved / (radius * this.scale);
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
