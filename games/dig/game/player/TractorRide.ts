// TractorRide.ts
//
// The tractors (every tool after the pickaxe; ui/dig.json `tractor`): outside the hub the miner rides theirs — a smoke puff,
// it appears under them, they're sat in its seat at once (no animation while riding, no tool) and drive, the wheels and the
// blades turning and the exhaust puffing while it moves; back inside the hub another puff and it's gone, the miner on foot.
// One model (a lawn tractor) for all of them: each in its colour and a little bigger (rideScale), dressed in what the player
// picked for it (a paint, a part: DigProgress.tractorLook, TractorDress), with its blades (their level) across its front,
// as wide as what it digs. All of it digs (digs(): MiningController), so no rock ever holds it.
//
// The tractor follows the miner's body (its position and facing); the seat offset moves the body up / back into it after
// the character has placed itself for the frame. A power surge (PowerSurge) puts anyone in it too, as the "star" tractor:
// glowing round the rainbow for as long as the surge lasts (once the model is in: it loads behind the game from the first
// input, for every player).

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { BendService } from '../services/BendService';
import { DIG, ToolDef, toolPaint } from '../data/DigConfig';
import { isBodyMaterial } from '../utils/Paint';
import { DigProgress } from '../data/DigProgress';
import { hubRects } from '../data/HubData';
import type DigPlayer from './DigPlayer';
import type { DigEffects } from '../vfx/DigEffects';
import { DigAudio } from '../audio/DigAudio';
import { EngineSound } from '../audio/EngineSound';
import { PowerSurge } from '../mining/PowerSurge';
import { MowerBlades } from './MowerBlades';
import { buildPart, fitTractor, freePart, paintTile, wrapBody } from './TractorDress';
import { tractorPaint, tractorPart } from '../data/TractorSkins';

const MODEL_BASE = './dig/models/';
/** The star glow: how strongly the paint glows, and how fast it goes round the rainbow (turns a second). */
const STAR_GLOW = 0.55;
const STAR_SPIN = 0.7;
/** Built wheels this much bigger than the tyres they stand in for. */
const WHEEL_GROW = 1.08;
/** The body digs this much past its own edges (world units), and the blades' past theirs. */
const REACH = 0.22;
/** A tractor's size eases to a new one's (a surge's): per second. */
const GROW = 8;

/** What a tractor digs, in its own frame (its nose toward +z): half across, behind and ahead of its middle. */
export interface DigArea {
    side: number;
    back: number;
    front: number;
}

export class TractorRide {
    private readonly holder = new THREE.Group();
    private model?: THREE.Object3D;
    private readonly wheels: THREE.Object3D[] = [];
    private wheelRadius = 0.25;
    private readonly materials: THREE.MeshStandardMaterial[] = [];
    /** The body's materials and their own colours (updateLook() repaints them). */
    private readonly bodyColors = new Map<THREE.MeshStandardMaterial, THREE.Color>();
    private readonly blades = new MowerBlades((material) => BendService.applyBend(material));
    private riding = false;
    private loadStarted = false;
    /** What it looks like now (its tool and skins), the part on it. */
    private lookFor = '';
    private part?: THREE.Object3D;
    private partId = '';
    private star = false;
    private size = 1;
    private exhaustTimer = 0;
    private destroyed = false;
    private readonly lastPosition = new THREE.Vector3();
    private readonly seat = new THREE.Vector3();
    private readonly exhaust = new THREE.Vector3();
    private readonly ahead = new THREE.Vector3(0, 0, 1);
    /** The engine, running while the miner rides. */
    private readonly engine = new EngineSound();

    /**
     * Loads the model at once only for a player who owns a tractor already; everyone else gets it in the background
     * once they start playing (loadInBackground(), from the scene).
     */
    public constructor(threeScene: THREE.Scene, private readonly player: DigPlayer, private readonly effects: DigEffects) {
        this.holder.visible = false;
        threeScene.add(this.holder);
        if (DigProgress.hasTractor) this.loadInBackground();
    }

    public get isRiding(): boolean {
        return this.riding;
    }

    /** The tractor driven now (a surge's, or the one owned). */
    private get tool(): ToolDef {
        return PowerSurge.digTool;
    }

    /** Its size (1 = the base height). */
    public get scale(): number {
        return this.tool.rideScale ?? 1;
    }

    /** Where its nose points (the miner's facing). */
    public forward(out: THREE.Vector3): THREE.Vector3 {
        const container = this.player.character?.container;
        out.set(0, 0, 1);
        if (container) out.applyQuaternion(container.quaternion).setY(0).normalize();
        return out;
    }

    /** The circles the rock stops (off its middle, in the world): always inside what it digs. */
    public circles(): [number, number, number][] {
        const { radius, nose, noseRadius } = DIG.tractor.collide;
        const scale = this.scale;
        this.forward(this.ahead);
        return [[0, 0, radius * scale], [this.ahead.x * nose * scale, this.ahead.z * nose * scale, noseRadius * scale]];
    }

    /** What it digs: all of its body, and its blades across its front. */
    public get digs(): DigArea {
        const { body, collide } = DIG.tractor;
        const scale = this.scale;
        return {
            side: Math.max(PowerSurge.width / 2, Math.max(body.side, collide.radius) * scale + REACH),
            back: body.back * scale,
            front: Math.max(body.front * scale + this.blades.radius * scale, (collide.nose + collide.noseRadius) * scale) + REACH,
        };
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
                if (!(child instanceof THREE.Mesh)) return;
                child.material = Array.isArray(child.material) ? child.material.map((m) => m.clone()) : child.material.clone();
                (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => {
                    BendService.applyBend(m);
                    if (!(m instanceof THREE.MeshStandardMaterial)) return;
                    this.materials.push(m);
                    if (isBodyMaterial(m)) this.bodyColors.set(m, m.color.clone());
                });
                // (The game's flat under it: lifted with the ground, its own bounds aren't where it's drawn.)
                child.frustumCulled = false;
            });
            fitTractor(model);
            wrapBody(model);
            this.buildWheels(model);
            this.model = model;
            this.lookFor = '';
            this.holder.add(model, this.blades.group);
        } catch (error) {
            console.warn(`[TractorRide] could not load ${config.model}`, error);
        }
    }

    /**
     * Four spinning wheels in place of the model's tyres (one mesh, all four): its vertices split by corner, each corner's
     * box a wheel — a faceted tyre, a light hub and a bolt bar on it, so the turn shows.
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
        const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert().multiply(tyres.matrixWorld);
        const position = tyres.geometry.getAttribute('position');
        const points = Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(toModel));
        const centre = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
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
            const bar = new THREE.Mesh(new THREE.BoxGeometry(width * 1.1, radius * 0.16, radius * 0.8), tyreMaterial);
            wheel.add(tyre, hub, bar);
            model.add(wheel);
            this.wheels.push(wheel);
            radii += radius;
        }
        if (this.wheels.length) this.wheelRadius = (radii / this.wheels.length) * model.scale.x;
    }

    /** The tractor's colour, or the paint the player put on it, and the part. */
    private updateLook(): void {
        const { tool } = this;
        const look = DigProgress.tractorLook;
        const lookFor = `${tool.id}|${look.paints}|${look.parts}`;
        if (lookFor === this.lookFor || !this.model) return;
        this.lookFor = lookFor;
        const tint = toolPaint(tool);
        for (const [material, original] of this.bodyColors) {
            if (tint) material.color.set(tint);
            else material.color.copy(original);
            this.setTile(material, null);
        }
        const worn = tractorPaint(look.paints);
        if (worn) {
            void paintTile(worn).then((tile) => {
                if (!tile || this.lookFor !== lookFor) return;
                for (const material of this.bodyColors.keys()) {
                    material.color.set(0xffffff);
                    this.setTile(material, tile);
                }
            });
        }
        void this.setPart(look.parts);
    }

    private setTile(material: THREE.MeshStandardMaterial, tile: THREE.Texture | null): void {
        if (material.map === tile) return;
        // (A program with a texture and one without aren't the same.)
        material.needsUpdate = !material.map !== !tile;
        material.map = tile;
    }

    /** The part on it ('' none). */
    private async setPart(id: string): Promise<void> {
        if (id === this.partId) return;
        this.partId = id;
        if (this.part) freePart(this.part);
        this.part = undefined;
        const part = tractorPart(id);
        if (!part) return;
        const built = await buildPart(part, (material) => BendService.applyBend(material));
        if (this.partId !== id || this.destroyed) {
            freePart(built);
            return;
        }
        built.traverse((child) => (child.frustumCulled = false));
        this.part = built;
        this.holder.add(built);
    }

    /** The power surge's look: the tractor glowing round the rainbow; its own again when the surge ends. */
    private updateStar(): void {
        const star = PowerSurge.active && !!this.model;
        if (star) {
            const hue = (performance.now() / 1000 * STAR_SPIN) % 1;
            this.materials.forEach((material, i) => {
                material.emissive.setHSL((hue + i * 0.08) % 1, 1, 0.5);
                material.emissiveIntensity = STAR_GLOW;
            });
        } else if (this.star) {
            this.materials.forEach((material) => material.emissive.set(0x000000));
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
        if (DigProgress.hasTractor) this.loadInBackground();
        // (A tractor of their own is ridden even before its model's in: it digs all the same.)
        const ride = (DigProgress.hasTractor || (PowerSurge.active && !!this.model)) && !TractorRide.inHub(position.x, position.z);
        this.updateLook();
        this.updateStar();
        if (ride !== this.riding) this.setRiding(ride);
        if (this.riding) {
            this.size += (this.scale - this.size) * Math.min(1, delta * GROW);
            this.place(delta);
        } else this.size = this.scale;
        this.lastPosition.copy(position);
    }

    private setRiding(on: boolean): void {
        const { smoke } = DIG.tractor;
        this.riding = on;
        this.effects.smoke(this.player.transform.position.clone().setY(0.6), smoke.count, smoke.size * this.scale, new THREE.Color(smoke.color));
        DigAudio.play('whoosh');
        this.holder.visible = on;
        if (on) this.engine.start();
        else this.engine.stop();
        this.player.seated = on;
        const character = this.player.character;
        if (on) {
            // Just sit: drop whatever the hands were doing.
            character?.stopAction();
            character?.showTool(undefined);
        }
        character?.body.sitNow(on);
        this.seated = on && !!character;
        if (!on) this.player.speedMultiplier = 1;
    }

    /** The character's in the seat pose (it can load after the ride began). */
    private seated = false;

    /** Puts the tractor under the miner (facing where they face) and the miner in the seat. */
    private place(delta: number): void {
        const config = DIG.tractor;
        const character = this.player.character;
        if (!character) return;
        if (!this.seated) {
            character.body.sitNow(true);
            this.seated = true;
        }
        const { size } = this;
        const container = character.container;
        const feet = this.player.transform.position;
        this.holder.position.set(feet.x, 0, feet.z);
        this.holder.quaternion.copy(container.quaternion);
        this.holder.scale.setScalar(size);
        this.seat.set(config.seat.x * size, config.seat.y * size + config.seat.lift, config.seat.z * size).applyQuaternion(container.quaternion);
        container.position.add(this.seat);
        const moved = Math.hypot(feet.x - this.lastPosition.x, feet.z - this.lastPosition.z);

        // The blades: their level, across what it digs, low against its front.
        this.blades.set(DigProgress.bladesLevel, PowerSurge.width / size);
        this.blades.group.position.set(0, config.blades.lift / size, config.body.front + this.blades.radius * config.blades.ahead);
        this.blades.spin(delta, moved > 1e-3);

        // Revs with the speed.
        this.engine.update(delta > 0 ? moved / delta / (5 * Math.max(0.5, this.player.speedMultiplier)) : 0);
        const spin = moved / (this.wheelRadius * size);
        for (const wheel of this.wheels) wheel.rotation.x += spin;
        if (moved <= 1e-3) return;
        this.exhaustTimer -= delta;
        if (this.exhaustTimer > 0) return;
        this.exhaustTimer = config.exhaust.interval;
        this.exhaust.set(config.exhaust.x, config.exhaust.y, config.exhaust.z).multiplyScalar(size).applyQuaternion(container.quaternion).add(this.holder.position);
        this.effects.smoke(this.exhaust, 1, config.exhaust.size * size, new THREE.Color(config.smoke.color), 0.25);
    }

    public destroy(): void {
        this.destroyed = true;
        this.engine.stop();
        if (this.part) freePart(this.part);
        this.blades.dispose();
        this.holder.removeFromParent();
    }
}
