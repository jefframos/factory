import * as THREE from "three";
import { BendService } from "../services/BendService";

const PULSE_FREQUENCY = 5;   // rad/s
const MIN_OPACITY = 0.18;
const MAX_OPACITY = 0.5;
const SHIELD_COLOR = 0x7CE8FF;
const SHIELD_RADIUS = 0.8;   // relative to the cube's own size=1 geometry — see CubeBuilder's "geometry always built at size=1" convention

/**
 * Soft pulsing translucent bubble shown around the player cube while
 * invincible (see PlayerEntity.isInvincible) — a standalone child mesh with
 * its own dedicated material, so it never touches the cube's own value-keyed
 * shared materials (see CubeBuilder — mutating those in place would repaint
 * every other cube at that value too). Built at the same "size=1, scaled via
 * the parent's own transform" convention as the face decal, so parenting it
 * to the player's mesh (see attachTo) is all that's needed for it to track
 * position/scale automatically.
 *
 * Self-contained and easy to disable: don't call attachTo()/update() (or
 * just don't construct one) and nothing about it runs. PlayerEntity gates
 * both behind SHOW_INVINCIBILITY_SHIELD in ClogConstants.
 */
export class InvincibilityShield {
    private readonly mesh: THREE.Mesh;
    private readonly material: THREE.MeshBasicMaterial;
    private phase = 0;
    private active = false;

    constructor() {
        const geo = new THREE.SphereGeometry(SHIELD_RADIUS, 12, 10);
        this.material = new THREE.MeshBasicMaterial({
            color: SHIELD_COLOR,
            transparent: true,
            opacity: 0,
            depthWrite: false, // avoids z-fighting/occlusion artifacts against the cube it wraps
        });
        BendService.applyBend(this.material);
        this.mesh = new THREE.Mesh(geo, this.material);
        this.mesh.visible = false;
    }

    /** Parent this shield to the player's cube mesh — inherits its position/scale for free. */
    attachTo(parent: THREE.Object3D): void {
        parent.add(this.mesh);
    }

    /** Call whenever the underlying invincibility state changes — cheap to call every frame with the same value. */
    setActive(active: boolean): void {
        if (this.active === active) return;
        this.active = active;
        this.mesh.visible = active;
        if (!active) this.material.opacity = 0;
    }

    /** Call once per frame while active — no-op (and cheap) while inactive. */
    update(delta: number): void {
        if (!this.active) return;
        this.phase += delta * PULSE_FREQUENCY;
        const t = (Math.sin(this.phase) + 1) / 2; // 0..1
        this.material.opacity = MIN_OPACITY + t * (MAX_OPACITY - MIN_OPACITY);
    }

    dispose(): void {
        this.mesh.removeFromParent();
        this.mesh.geometry.dispose();
        this.material.dispose();
    }
}
