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
// Drawn as the "tutorialArrow" sprite (ui atlas) on a flat quad — NOT ArrowBuilder's extruded
// mesh anymore — sitting just above FloorLayers' top layer (floor labels) and drawn after the
// floor decals, so the ground layers / store floor / dropper outlines never cover it.
//
// A plain class managing one raw THREE.Mesh added directly to the real THREE.Scene, NOT an ECS
// Entity/Component — nothing here needs physics, per-entity pooling, or any other ECS machinery
// ZoneTutorialArrow's own ScreenAnchorComponent route needs for ITS screen-projection problem;
// this only ever needs a world-space position/rotation, updated once a frame from whoever
// already computes the player/target positions (ZoneTutorialController).

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import { pixiTextureToThree } from '../builders/PixiIconToThree';
import { BendService } from '../services/BendService';
import { FloorLayers } from '../world/FloorLayers';

/** The arrow's sprite in the ui atlas — drawn tip-up, so the tip is the quad's +Y (see buildMesh()). */
const ARROW_TEXTURE_ID = 'tutorialArrow';
/** Clearance above the highest floor layer (labels) — or the player's own feet, if higher — so no ground layer ever z-fights or covers it. */
const GROUND_CLEARANCE = 0.02;
/** Drawn after the floor decals (DottedLineBuilder's DECAL_RENDER_ORDER = 10) and floor labels. */
const ARROW_RENDER_ORDER = 11;
/** How far out from the player's own base the arrow sits, toward the target — see update()'s own doc. */
const OFFSET_FROM_PLAYER = 1;
/** Arrow length (tail to tip), world units — big enough to read clearly at normal play-camera distance without dwarfing the player. Width follows the sprite's own aspect. */
const ARROW_SCALE = 1.2;

export default class ZoneTutorial3dArrow {
    private readonly scene: THREE.Scene;
    private readonly mesh: THREE.Mesh;

    private destroyed = false;

    public constructor(scene: THREE.Scene) {
        this.scene = scene;

        this.mesh = ZoneTutorial3dArrow.buildMesh();
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
            Math.max(playerPosition.y, FloorLayers.labelY) + GROUND_CLEARANCE,
            playerPosition.z + dirZ * OFFSET_FROM_PLAYER,
        );

        // Yaw only, so it always lies flat. The tip is local -Z (see buildMesh()); rotation.y = θ
        // turns -Z into (-sin θ, 0, -cos θ), so θ = atan2(-dirX, -dirZ) points it at (dirX, dirZ).
        if (horizontalDistance > 1e-4) {
            this.mesh.rotation.y = Math.atan2(-dirX, -dirZ);
        }
    }

    public hide(): void {
        this.mesh.visible = false;
    }

    /** Tears this down for good — removes the mesh from the scene and disposes its own geometry/material (the texture is PixiIconToThree's shared cache — never disposed). Safe to call more than once. */
    public destroy(): void {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
    }

    /** A flat quad lying on the ground, the sprite's tip (+Y) turned to local -Z, tail-to-tip ARROW_SCALE long, tail at the origin. */
    private static buildMesh(): THREE.Mesh {
        const pixiTexture = PIXI.Texture.from(ARROW_TEXTURE_ID);
        const map = pixiTextureToThree(pixiTexture);
        if (!map) {
            console.warn(`[ZoneTutorial3dArrow] texture "${ARROW_TEXTURE_ID}" not found — the ground arrow will be blank`);
        }
        const aspect = pixiTexture.orig.height > 0 ? pixiTexture.orig.width / pixiTexture.orig.height : 1;

        const geometry = new THREE.PlaneGeometry(ARROW_SCALE * aspect, ARROW_SCALE);
        // Face up: the plane's +Y (sprite top = tip) becomes -Z. Then the tail moves to the
        // origin, so `mesh.position` places the tail (same footprint the old extruded arrow had).
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, 0, -ARROW_SCALE / 2);

        const material = new THREE.MeshBasicMaterial({
            map,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        BendService.applyBend(material);

        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = ARROW_RENDER_ORDER;
        return mesh;
    }
}
