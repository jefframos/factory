// ZoneTutorial3dArrow.ts
//
// A real-3D guide arrow, flat on the ground at the player's own base, pointing toward whatever
// the current zone tutorial step wants them to go next — the real-3D counterpart to
// ZoneTutorialArrow.ts's flat screen-space sprite, and an ADDITIONAL layer on top of it (see
// ZoneTutorialController's own doc — both run together whenever a zone's own
// ZoneTutorialConfig.use3dArrow is true; this never replaces the 2D one).
//
// Deliberately simple — no orbiting, no bob, no distance-based fade. It's a guide, not a
// decoration: visible the whole time ZoneTutorialController has a real target to point it at,
// hidden the moment it doesn't.
//
// A plain class managing one raw THREE.Mesh added directly to the real THREE.Scene, NOT an ECS
// Entity/Component — nothing here needs physics, per-entity pooling, or any other ECS machinery
// ZoneTutorialArrow's own ScreenAnchorComponent route needs for ITS screen-projection problem;
// this only ever needs a world-space position/rotation, updated once a frame from whoever
// already computes the player/target positions (ZoneTutorialController).

import * as THREE from 'three';
import { ArrowBuilder } from '../builders/ArrowBuilder';

/** Small clearance above the player's own base (feet) so the arrow doesn't z-fight with the ground plane it's resting flat on. */
const GROUND_CLEARANCE = 0.15;
/** How far out from the player's own base the arrow sits, toward the target — see update()'s own doc. */
const OFFSET_FROM_PLAYER = 0.5;
/** Big enough to read clearly at normal play-camera distance without dwarfing the player. */
const ARROW_SCALE = 1.2;
/** Same green DropZone's "Drop Zone" nameplate uses (TextStyleRegistry.ZoneTitle) — "you're on the right track" reads the same whether it's a floating label or this arrow. */
const ARROW_COLOR = 0x33cc66;

export default class ZoneTutorial3dArrow {
    private readonly scene: THREE.Scene;
    private readonly mesh: THREE.Mesh;
    /** Scratch — avoids allocating a new Vector3 every frame in update(). */
    private readonly scratchLookTarget = new THREE.Vector3();

    private destroyed = false;

    public constructor(scene: THREE.Scene) {
        this.scene = scene;

        this.mesh = ArrowBuilder.build({ color: ARROW_COLOR });
        this.mesh.scale.setScalar(ARROW_SCALE);
        this.mesh.visible = false;
        this.scene.add(this.mesh);
    }

    /**
     * Plants the arrow OFFSET_FROM_PLAYER out from the player's own base, toward
     * `targetPosition`, and yaws it to keep pointing at that same target — call every frame
     * this arrow is active (see ZoneTutorialController's own doc). Safe to call after destroy()
     * (no-ops).
     */
    public update(playerPosition: THREE.Vector3, targetPosition: THREE.Vector3): void {
        if (this.destroyed) {
            return;
        }

        this.mesh.visible = true;

        const dx = targetPosition.x - playerPosition.x;
        const dz = targetPosition.z - playerPosition.z;
        const horizontalDistance = Math.hypot(dx, dz);
        // Falls back to "no offset" if the target is essentially on top of the player, so this
        // never degenerates to a zero-length direction.
        const dirX = horizontalDistance > 1e-4 ? dx / horizontalDistance : 0;
        const dirZ = horizontalDistance > 1e-4 ? dz / horizontalDistance : 0;

        this.mesh.position.set(
            playerPosition.x + dirX * OFFSET_FROM_PLAYER,
            playerPosition.y + GROUND_CLEARANCE,
            playerPosition.z + dirZ * OFFSET_FROM_PLAYER,
        );

        // Same height as the arrow itself (not the target's own height) keeps this yaw-only, so
        // it always lies flat on the ground rather than pitching up or down at the target.
        // Object3D.lookAt() points local -Z at the target — ArrowBuilder's own tip ended up on
        // local +Z instead (confirmed visually: the arrow pointed exactly away from the actual
        // target), hence the extra half-turn below rather than trusting lookAt() alone.
        this.scratchLookTarget.set(targetPosition.x, this.mesh.position.y, targetPosition.z);
        this.mesh.lookAt(this.scratchLookTarget);
        this.mesh.rotateY(Math.PI);
    }

    public hide(): void {
        this.mesh.visible = false;
    }

    /** Tears this down for good — removes the mesh from the scene and disposes its own (never-shared, see ArrowBuilder.ts's own doc) material. Safe to call more than once. */
    public destroy(): void {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.scene.remove(this.mesh);
        (this.mesh.material as THREE.Material).dispose();
    }
}
