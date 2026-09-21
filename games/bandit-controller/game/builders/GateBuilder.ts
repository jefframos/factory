// GateBuilder.ts
//
// Trigger-gate boilerplate shared by every scene that needs a "walk through
// this to trigger something" volume — HubScene's minigame-entry gates,
// RunnerMinigameScene's finish line. Always built as a pair: a purely
// visual translucent marker plane (buildGateMarker()) plus the actual
// static trigger RigidBody (buildTriggerGate()) — kept in separate
// functions rather than one combined call since a caller occasionally wants
// only one half (e.g. a marker with no trigger yet).

import * as THREE from 'three';
import World from 'core/ecs/World';
import RigidBody from 'core/physics/RigidBody';
import { Layers } from 'core/physics/PhysicsConstants';
import { BendService, WorldBendService } from 'core/services/BendService';

/** Gate trigger box — wide enough to catch the player across a lane's width, tall enough to catch a jump, thin along the direction of travel so it reads as a line the player crosses rather than a room they linger in. */
export const GATE_HALF_EXTENTS = new THREE.Vector3(4, 2, 0.3);
export const GATE_HEIGHT = 2;

/** Purely visual marker for a gate's position — a thin translucent plane, no collider of its own (see buildTriggerGate() for the actual trigger volume). */
export function buildGateMarker(threeScene: THREE.Scene, x: number, z: number, color: number, bendService: WorldBendService = BendService): void {
    const geometry = new THREE.PlaneGeometry(GATE_HALF_EXTENTS.x * 2, GATE_HEIGHT);
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
    bendService.applyBend(material);
    const marker = new THREE.Mesh(geometry, material);
    marker.position.set(x, GATE_HEIGHT / 2, z);
    threeScene.add(marker);
}

/** A static trigger volume at (`x`, `z`) — fires `onEnter` once when the PLAYER's RigidBody crosses into it (ignores everything else, e.g. the ground). `bendService` defaults the same way buildGateMarker()'s own does — pass the SAME one given to the matching buildGateMarker() call so the (debug-only) trigger wireframe bends together with its visual marker. */
export function buildTriggerGate(world: World, threeScene: THREE.Scene, x: number, z: number, onEnter: () => void, bendService: WorldBendService = BendService): void {
    const gate = world.spawn();
    // Entity.transform only renders once something parents it into the scene (see
    // Entity.ts's own doc) — this gate has no visual of its own (buildGateMarker() is a
    // separate free-standing mesh), so without this its debug trigger wireframe
    // (PHYSICS_TRIGGER_DEBUG — see RigidBody.awake()) is built but never actually shown.
    threeScene.add(gate.transform);
    gate.transform.position.set(x, GATE_HALF_EXTENTS.y, z);

    const rigidBody = gate.addComponent(new RigidBody({
        halfExtents: GATE_HALF_EXTENTS,
        isStatic: true,
        isTrigger: true,
        layer: Layers.Environment,
        bendService,
    }));

    rigidBody.onTriggerEnter.add((other) => {
        if (other.layer === Layers.Player) {
            onEnter();
        }
    });
}
