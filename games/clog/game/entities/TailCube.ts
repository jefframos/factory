import * as THREE from "three";
import { CubeBuilder } from "../builders/CubeBuilder";
import { BOUNCE_AMPLITUDE, BOUNCE_DURATION, sizeForValue } from "../ClogConstants";
import { BlobShadow } from "./BlobShadow";
import { FloatBob } from "../components/FloatBob";

const POP_DURATION = 0.45; // seconds for the spawn-pop animation

export class TailCube {
    public value: number;
    public transform: THREE.Group;
    public mesh: THREE.Mesh;

    /** True while this cube is actively sliding toward its merge target (skip snake-follow). */
    public isMerging = false;
    /** True while this cube is queued as the source of a pending merge (allow snake-follow, block re-scheduling). */
    public isScheduled = false;
    /** True while this cube is the destination of a queued merge (block re-scheduling). */
    public isLocked = false;

    private bounceTimer = 0;
    private popTimer    = 0;
    private shadow: BlobShadow;
    private floatBob: FloatBob;

    constructor(value: number, scene: THREE.Scene, position?: THREE.Vector3) {
        this.value = value;
        this.mesh = CubeBuilder.buildNumbered(value);
        this.transform = new THREE.Group();
        this.transform.add(this.mesh);
        if (position) this.transform.position.copy(position);
        scene.add(this.transform);
        this.applyScale();
        this.shadow = new BlobShadow(scene);
        this.shadow.update(this.transform.position.x, this.transform.position.z, sizeForValue(value));
        this.floatBob = new FloatBob(Math.random() * Math.PI * 2);
    }

    get position(): THREE.Vector3 {
        return this.transform.position;
    }

    private applyScale(): void {
        const s = sizeForValue(this.value);
        this.mesh.scale.setScalar(s);
        this.mesh.position.y = s * 0.5;
    }

    setValue(newValue: number): void {
        this.value = newValue;
        CubeBuilder.updateTextures(this.mesh, newValue, false);
        this.applyScale();
    }

    startBounce(): void {
        this.bounceTimer = BOUNCE_DURATION;
    }

    /** Play an elastic pop-in from scale 0 — call immediately after spawning as a collectible. */
    startSpawnPop(): void {
        this.popTimer = POP_DURATION;
        this.mesh.scale.setScalar(0);
        this.mesh.position.y = 0;
    }

    update(delta: number): void {
        this.shadow.update(this.position.x, this.position.z, sizeForValue(this.value));

        const floatY = this.floatBob.update(delta);
        const s = sizeForValue(this.value);

        if (this.popTimer > 0) {
            this.popTimer = Math.max(0, this.popTimer - delta);
            const t = 1 - this.popTimer / POP_DURATION;
            const ps = s * TailCube.elasticOut(t);
            this.mesh.scale.setScalar(ps);
            this.mesh.position.y = ps * 0.5 + floatY;
            return;
        }

        if (this.bounceTimer > 0) {
            this.bounceTimer = Math.max(0, this.bounceTimer - delta);
            const t = 1 - this.bounceTimer / BOUNCE_DURATION;
            const punch = 1 + BOUNCE_AMPLITUDE * Math.sin(t * Math.PI);
            const bs = s * punch;
            this.mesh.scale.setScalar(bs);
            this.mesh.position.y = bs * 0.5 + floatY;
            return;
        }

        this.mesh.position.y = s * 0.5 + floatY;
    }

    /** Elastic ease-out: starts at 0, overshoots to ~1.25×, settles at 1. */
    private static elasticOut(t: number): number {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        return Math.pow(2, -8 * t) * Math.sin((t * 4 - 0.5) * Math.PI) + 1;
    }

    destroy(): void {
        this.shadow.destroy();
        CubeBuilder.disposeMesh(this.mesh);
        this.transform.removeFromParent();
    }
}
