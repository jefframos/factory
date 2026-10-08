// StallAnimal.ts
//
// One animal living in an animal stall's pen (see AnimalStallTypes.ts /
// PizzaScene.setupAnimalStalls()): wanders to random points inside the pen, pausing between
// walks — the same idle-breathe / hop-while-walking feel as a wild AnimalNode, without any of its
// catching/following — and every AnimalStallConfig.produceIntervalSec asks `tryProduce` to lay
// one item (an egg) into the stall's box. A refused lay (the box is full) is retried each frame,
// so production simply pauses until the player collects. Laying gives a little squash.
//
// Not physical (no RigidBody): the pen's own fence keeps the player out, and the animal never
// leaves the pen rect it's given.

import * as THREE from 'three';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import GlbVisualComponent from '../components/GlbVisualComponent';
import { ModelSnapshotTool } from '../debug/ModelSnapshotTool';
import { pickRandom } from '../world/AssetLibraryRegistry';
import { turnTowardSmoothed } from './AnimalNode';
import type { AnimalStallConfig } from '../data/AnimalStallTypes';

/** Within this of its target = arrived. */
const ARRIVE_EPSILON = 0.15;
const TURN_SMOOTHING_RATE = 10;
/** Same feel as AnimalNode's idle breathe / walking hop. */
const IDLE_BREATH_SCALE = 1.06;
const IDLE_BREATH_DURATION_SEC = 0.9;
const MOVE_HOP_HEIGHT = 0.1;
const MOVE_HOP_UP_SEC = 0.14;
const MOVE_HOP_DOWN_SEC = 0.12;
/** The squash when an item is laid. */
const LAY_SQUASH_SCALE = 0.8;
const LAY_SQUASH_SEC = 0.12;

export interface PenArea {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

type State = 'idle' | 'moving';

export default class StallAnimal extends Entity {
    private readonly config: AnimalStallConfig;
    private readonly pen: PenArea;
    /** Lays one item — returns false when it can't (the box is full), so it's retried next frame. */
    private readonly tryProduce: (animal: StallAnimal) => boolean;

    private visual?: GlbVisualComponent;
    private baseScale = 1;
    private ready = false;
    private ambientTween?: gsap.core.Animation;
    private state: State = 'idle';
    private idleRemainingSec = 0;
    private readonly target = new THREE.Vector3();
    private produceTimerSec: number;

    public constructor(config: AnimalStallConfig, pen: PenArea, position: THREE.Vector3, tryProduce: (animal: StallAnimal) => boolean) {
        super();
        this.config = config;
        this.pen = pen;
        this.tryProduce = tryProduce;
        this.transform.position.copy(position);
        // Several animals in one pen don't all lay on the same frame.
        this.produceTimerSec = Math.random() * config.produceIntervalSec;
        this.idleRemainingSec = Math.random() * config.maxPauseSec;
    }

    public get position(): THREE.Vector3 {
        return this.transform.position;
    }

    public override awake(): void {
        const modelDef = ModelSnapshotTool.resolveModelRef(this.config.animalModels.length > 0 ? pickRandom(this.config.animalModels) : undefined);
        if (!modelDef) {
            console.warn('[StallAnimal] the stall\'s animal model doesn\'t resolve — the animal is invisible');
            return;
        }
        const visual: GlbVisualComponent = new GlbVisualComponent(modelDef, new THREE.Vector3(), this.config.animalScale, 0, () => {
            this.ready = true;
            this.baseScale = visual.mesh.scale.x || 1;
            this.playAmbient();
        });
        this.visual = this.addComponent(visual);
    }

    public override update(delta: number): void {
        super.update(delta);
        this.updateWander(delta);
        this.updateProduce(delta);
    }

    public override destroy(): void {
        this.ambientTween?.kill();
        super.destroy();
    }

    private updateWander(delta: number): void {
        if (this.state === 'idle') {
            this.idleRemainingSec -= delta;
            if (this.idleRemainingSec > 0) {
                return;
            }
            this.target.set(
                THREE.MathUtils.lerp(this.pen.minX, this.pen.maxX, Math.random()),
                this.transform.position.y,
                THREE.MathUtils.lerp(this.pen.minZ, this.pen.maxZ, Math.random()),
            );
            this.state = 'moving';
            this.playAmbient();
            return;
        }

        const toTarget = this.target.clone().sub(this.transform.position).setY(0);
        const distance = toTarget.length();
        if (distance <= ARRIVE_EPSILON) {
            this.state = 'idle';
            const { minPauseSec, maxPauseSec } = this.config;
            this.idleRemainingSec = minPauseSec + Math.random() * Math.max(0, maxPauseSec - minPauseSec);
            this.playAmbient();
            return;
        }
        const direction = toTarget.normalize();
        this.transform.position.addScaledVector(direction, Math.min(distance, this.config.wanderSpeed * delta));
        const facing = Math.atan2(direction.x, direction.z) + THREE.MathUtils.degToRad(this.config.animalYawOffsetDeg ?? 0);
        this.transform.rotation.y = turnTowardSmoothed(this.transform.rotation.y, facing, TURN_SMOOTHING_RATE, delta);
    }

    private updateProduce(delta: number): void {
        this.produceTimerSec += delta;
        if (this.produceTimerSec < this.config.produceIntervalSec) {
            return;
        }
        if (this.tryProduce(this)) {
            this.produceTimerSec = 0;
            this.playLaySquash();
        }
    }

    /** Idle: a gentle breathe. Moving: little hops. */
    private playAmbient(): void {
        if (!this.ready || !this.visual) {
            return;
        }
        const mesh = this.visual.mesh;
        this.ambientTween?.kill();
        mesh.position.y = 0;
        mesh.scale.setScalar(this.baseScale);
        if (this.state === 'idle') {
            this.ambientTween = gsap.to(mesh.scale, {
                y: this.baseScale * IDLE_BREATH_SCALE,
                duration: IDLE_BREATH_DURATION_SEC,
                ease: 'sine.inOut',
                yoyo: true,
                repeat: -1,
            });
            return;
        }
        this.ambientTween = gsap.timeline({ repeat: -1 })
            .to(mesh.position, { y: MOVE_HOP_HEIGHT, duration: MOVE_HOP_UP_SEC, ease: 'sine.out' }, 0)
            .to(mesh.scale, { y: this.baseScale * 1.12, x: this.baseScale * 0.9, z: this.baseScale * 0.9, duration: MOVE_HOP_UP_SEC, ease: 'sine.out' }, 0)
            .to(mesh.position, { y: 0, duration: MOVE_HOP_DOWN_SEC, ease: 'sine.in' })
            .to(mesh.scale, { x: this.baseScale, y: this.baseScale, z: this.baseScale, duration: MOVE_HOP_DOWN_SEC, ease: 'back.out(2)' }, '<');
    }

    private playLaySquash(): void {
        if (!this.ready || !this.visual) {
            return;
        }
        const mesh = this.visual.mesh;
        this.ambientTween?.kill();
        gsap.timeline({ onComplete: () => this.playAmbient() })
            .to(mesh.scale, { y: this.baseScale * LAY_SQUASH_SCALE, x: this.baseScale * 1.12, z: this.baseScale * 1.12, duration: LAY_SQUASH_SEC, ease: 'sine.out' })
            .to(mesh.scale, { x: this.baseScale, y: this.baseScale, z: this.baseScale, duration: LAY_SQUASH_SEC * 1.5, ease: 'back.out(2)' });
    }
}
