// RampBuilder.ts
//
// A walkable sloped surface — run up it from ground level and arrive at an elevated height
// with no jump needed, e.g. placed right before a TRAIN obstacle (see MinigameSettings.
// OBSTACLE_KINDS) so its own roof is reachable on foot as an alternative to jumping onto it.
//
// This engine's RigidBody is ALWAYS an axis-aligned box (no rotation) and its collide-and-
// slide resolves X, then Z, then Y separately using the player's CURRENT (start-of-tick) Y —
// see PhysicsWorld.ts's own doc. A real solid ramp box, even a very short/shallow one, would
// act as a wall the instant the player's own Y-range overlaps it (exactly the "always hits"
// problem ObstacleBuilder.ts's own doc describes for a naive full-height obstacle), so a ramp
// can't be built the same box+platform way those use.
//
// Instead this is a pure TRIGGER (never blocks X/Y/Z at all) spanning the ramp's whole
// footprint. While the player is inside it AND at-or-below the ramp's own interpolated
// height at their current Z, onTriggerEnter/Stay directly sets their feet
// (transform.position.y) to that height, zeros any downward velocity, and marks them
// grounded — the same "supports you like a floor" behavior a real sloped collider would give,
// just computed by hand every tick instead of resolved by the physics engine's own box math.
// A player who's ABOVE the ramp's own surface (e.g. jumping clean over it) is deliberately
// left alone rather than yanked back down onto it mid-air.
//
// The visual is a simple staircase of flat, unrotated boxes rather than a single tilted box
// or a hand-built wedge — no rotation math to get the sign of wrong, reusing the exact same
// BoxGeometry+bend pattern as every other obstacle. The player's own height still interpolates
// smoothly across it (see supportPlayer() below), so it climbs like a ramp even though it
// LOOKS like stairs — a fine placeholder for a first pass, easy to swap for a real wedge mesh
// later.

import * as THREE from 'three';
import World from 'core/ecs/World';
import RigidBody from 'core/physics/RigidBody';
import { Layers } from 'core/physics/PhysicsConstants';
import { WorldBendService } from 'core/services/BendService';

/**
 * World units of slop the "at or below the ramp surface" check allows — without this,
 * ordinary per-tick float noise in a player's own Y (the same kind PhysicsWorld's push-out
 * cycle already produces elsewhere) could read as "above the ramp" for one tick and drop
 * them back to gravity, then "at/below" the next, producing a visible stutter right at the
 * ramp's own surface.
 */
const SUPPORT_EPSILON = 0.05;
/** How many flat steps the visual staircase is built from — purely cosmetic (see this file's own doc); the player's own height still interpolates continuously regardless of this. */
const STEP_COUNT = 8;
const STEP_THICKNESS = 0.3;
/** World units of headroom ABOVE the ramp's own top the support trigger still reaches — generous enough that a standing player arriving right at the ramp's base is caught immediately, not just once they've already sunk partway through it. */
const TRIGGER_HEADROOM = 2.5;

/**
 * Builds one ramp: rises from `baseY` at `entryZ` to `topY` at `exitZ` (both plain world-Z,
 * same convention every other builder in this codebase already uses — RunnerMinigameScene/
 * SwipeMinigameScene convert their own "distance down the lane" to world Z before calling
 * this), `2 * halfWidth` wide, centered on `x`. Never a hazard — there is no hit-detection
 * here at all, only support.
 */
export function buildRamp(
    world: World,
    threeScene: THREE.Scene,
    x: number,
    entryZ: number,
    exitZ: number,
    baseY: number,
    topY: number,
    halfWidth: number,
    bendService: WorldBendService,
    color: number,
): void {
    const rise = topY - baseY;

    for (let i = 0; i < STEP_COUNT; i++) {
        const t0 = i / STEP_COUNT;
        const t1 = (i + 1) / STEP_COUNT;
        const stepZ0 = THREE.MathUtils.lerp(entryZ, exitZ, t0);
        const stepZ1 = THREE.MathUtils.lerp(entryZ, exitZ, t1);
        const stepTop = baseY + rise * t1;
        const stepDepth = Math.abs(stepZ1 - stepZ0);

        const geometry = new THREE.BoxGeometry(halfWidth * 2, STEP_THICKNESS, stepDepth);
        const material = new THREE.MeshStandardMaterial({ color });
        bendService.applyBend(material);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, stepTop - STEP_THICKNESS / 2, (stepZ0 + stepZ1) / 2);
        threeScene.add(mesh);
    }

    const minZ = Math.min(entryZ, exitZ);
    const maxZ = Math.max(entryZ, exitZ);
    const lowY = Math.min(baseY, topY) - STEP_THICKNESS;
    const highY = Math.max(baseY, topY) + TRIGGER_HEADROOM;

    const rampVolume = world.spawn();
    // Entity.transform only renders/registers once something parents it into the scene (see
    // Entity.ts's own doc) — same reasoning as every other trigger-only entity in this
    // codebase (ObstacleBuilder.ts/GateBuilder.ts).
    threeScene.add(rampVolume.transform);
    rampVolume.transform.position.set(x, (lowY + highY) / 2, (minZ + maxZ) / 2);
    const trigger = rampVolume.addComponent(new RigidBody({
        halfExtents: new THREE.Vector3(halfWidth, (highY - lowY) / 2, (maxZ - minZ) / 2),
        isStatic: true,
        isTrigger: true,
        layer: Layers.Environment,
        mask: Layers.Player,
        bendService,
    }));

    const playerMin = new THREE.Vector3();
    const supportPlayer = (other: RigidBody): void => {
        if (other.layer !== Layers.Player) {
            return;
        }

        const t = THREE.MathUtils.clamp((other.entity.transform.position.z - entryZ) / (exitZ - entryZ), 0, 1);
        const rampHeight = baseY + rise * t;

        other.getMin(playerMin);
        if (playerMin.y > rampHeight + SUPPORT_EPSILON) {
            // Above the ramp's own surface (e.g. mid-jump clearing it) — leave them be, let
            // normal gravity keep resolving instead of yanking them back down onto it.
            return;
        }

        other.entity.transform.position.y = rampHeight;
        if (other.velocity.y < 0) {
            other.velocity.y = 0;
        }
        other.grounded = true;
    };

    trigger.onTriggerEnter.add(supportPlayer);
    trigger.onTriggerStay.add(supportPlayer);
}
