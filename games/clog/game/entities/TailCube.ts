import * as THREE from "three";
import { CubeBuilder } from "../builders/CubeBuilder";
import { BOUNCE_AMPLITUDE, BOUNCE_DURATION, sizeForValue } from "../ClogConstants";

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

    constructor(value: number, scene: THREE.Scene, position?: THREE.Vector3) {
        this.value = value;
        this.mesh = CubeBuilder.buildNumbered(value);
        this.transform = new THREE.Group();
        this.transform.add(this.mesh);
        if (position) this.transform.position.copy(position);
        scene.add(this.transform);
        this.applyScale();
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
        CubeBuilder.updateTextures(this.mesh, newValue);
        this.applyScale();
    }

    startBounce(): void {
        this.bounceTimer = BOUNCE_DURATION;
    }

    update(delta: number): void {
        if (this.bounceTimer <= 0) return;
        this.bounceTimer = Math.max(0, this.bounceTimer - delta);
        const t = 1 - this.bounceTimer / BOUNCE_DURATION;
        const punch = 1 + BOUNCE_AMPLITUDE * Math.sin(t * Math.PI);
        const s = sizeForValue(this.value) * punch;
        this.mesh.scale.setScalar(s);
        this.mesh.position.y = s * 0.5;
    }

    destroy(): void {
        CubeBuilder.disposeMesh(this.mesh);
        this.transform.removeFromParent();
    }
}
