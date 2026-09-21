// ObstacleBuilder.ts
//
// Box obstacles shared by both runner minigames, built from TWO separate
// colliders rather than one full-height solid box:
//
//   - a THIN solid platform, flush with the obstacle's own top — gives the
//     player something to physically land on and run along (same Y-only
//     collide-and-slide support as the ground itself), without ever
//     blocking horizontal movement.
//   - a full-height TRIGGER (never physically blocks anything) that decides
//     whether contact counts as a HIT: only if the player's own base is
//     still below the platform's height when it fires — i.e. a genuine
//     side hit, or catching it from below — not a landing.
//
// A single full-height SOLID box was tried first and didn't work like a
// runner game: the moment the player's forward-moving body touched its
// front face below the top, collide-and-slide zeroed their forward
// velocity right there, every single frame, regardless of how high they'd
// jumped — since the player can't control WHEN their automatic forward
// motion reaches the obstacle, only WHEN they jump, that made clearing an
// obstacle require already being at full jump height well before reaching
// it, which is essentially never achievable, so it read as "always hits."
// Splitting the top surface (solid, Y-only) from the hit judgment (trigger,
// never blocks X/Z) means a jump in progress always keeps carrying the
// player forward, and only their height at the moment of contact decides
// whether they clear it, land on it, or get hit.
//
// ObstacleOptions.baseY turns the same box into a floating piece (a raised
// bar to duck under, a tunnel roof to walk under, ...) instead of a ground
// hurdle — the hit trigger simply never extends below baseY, so a player
// whose own collider is short enough (sliding) or who's just walking under
// it entirely passes underneath with no extra logic needed. See
// buildObstacleKind() below and MinigameSettings.OBSTACLE_KINDS for the
// actual catalog of shapes/heights/colors built from this.

import * as THREE from 'three';
import World from 'core/ecs/World';
import RigidBody from 'core/physics/RigidBody';
import { Layers } from 'core/physics/PhysicsConstants';
import { WorldBendService } from 'core/services/BendService';
import { ObstacleKind } from '../data/MinigameSettings';

/**
 * World units of slop allowed when deciding "is the player resting on top
 * of this obstacle" — collide-and-slide's own push-out doesn't necessarily
 * land perfectly flush (floating point), so a strict >= comparison would
 * occasionally misclassify a genuine top-landing as a hit.
 */
const TOP_LANDING_EPSILON = 0.05;
/**
 * World units per subdivision along a box's own DEPTH (Z) axis — RunnerBendService's/
 * BendService's bend is a per-VERTEX displacement computed from each vertex's own world Z
 * (see either service's own doc), so a plain 1-segment BoxGeometry only actually bends at
 * its 8 corners; anything longer than a couple of these per side reads as a visibly flat,
 * sheared slab instead of a smooth curve — exactly the problem TRAIN (12 units long) and
 * TUNNEL (8 units long) would have without this. Same box+bend pattern (and the same
 * "why" — see FloorBuilder.buildBox()'s own doc) already used for sidewalks; this mirrors
 * it for obstacles rather than sharing that method directly, since obstacles want a lit
 * MeshStandardMaterial, not buildBox()'s unlit MeshBasicMaterial.
 */
const BEND_SEGMENT_SIZE = 1;
/** Half-thickness of the top platform collider — thin on purpose, see this file's own doc. */
const PLATFORM_HALF_THICKNESS = 0.1;

/** Default box color for a ground-level hurdle obstacle (see ObstacleOptions.color). */
const DEFAULT_OBSTACLE_COLOR = 0xb5342a;

export interface ObstacleOptions {
    /**
     * World units off the ground the box's own BOTTOM sits at — 0 (the default) is a
     * ground-level hurdle you jump over or land on. A positive value (see
     * MinigameSettings.OBSTACLE_KINDS) makes this a floating piece instead: since the
     * hit-detection trigger's own box only ever spans [baseY, baseY + halfExtents.y * 2],
     * there is NO collider at all below baseY — nothing else needed to let a player whose
     * own collider is short enough (sliding), or who's just walking underneath entirely,
     * pass underneath untouched; the physics engine simply never reports an overlap down
     * there.
     */
    baseY?: number;
    /** Visual box color — defaults to DEFAULT_OBSTACLE_COLOR. Callers placing a floating piece typically pass a different color so it visually reads as its own distinct thing. */
    color?: number;
    /**
     * False makes this piece PURELY a landable platform — the top-landing collider still
     * gets built (so standing/jumping onto it from above still works exactly the same), but
     * no hit-detection trigger is built at all, so there is NO WAY to "get hit" by this piece
     * — touching its underside, its sides, jumping into it without quite reaching the top,
     * all just harmlessly pass through (or physically bump the solid top-platform corner the
     * same as any static geometry would, but never end the run). For a piece that's meant to
     * read as a bonus/optional elevated path rather than a hazard to dodge (see
     * MinigameSettings.OBSTACLE_KINDS' TUNNEL entry). Default true — every ground hurdle and
     * duck-under bar IS meant to end the run on contact.
     */
    hazard?: boolean;
}

/** A single obstacle box — visual mesh, top-landing platform, and hit-detection trigger, all centered at (x, z). `onHit` is guarded to fire at most once per obstacle even if the physics engine's own contact bookkeeping (enter/stay/exit) reports more than one enter for the same overlap. See ObstacleOptions.baseY for the ground-hurdle-vs-raised-bar distinction. */
export function buildObstacle(
    world: World,
    threeScene: THREE.Scene,
    x: number,
    z: number,
    halfExtents: THREE.Vector3,
    bendService: WorldBendService,
    onHit: () => void,
    options: ObstacleOptions = {},
): void {
    const baseY = options.baseY ?? 0;
    const color = options.color ?? DEFAULT_OBSTACLE_COLOR;
    const hazard = options.hazard ?? true;

    const depthSegments = Math.max(1, Math.ceil((halfExtents.z * 2) / BEND_SEGMENT_SIZE));
    const geometry = new THREE.BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2, 2, 2, depthSegments);
    const material = new THREE.MeshStandardMaterial({ color });
    bendService.applyBend(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, baseY + halfExtents.y, z);
    threeScene.add(mesh);

    const topY = baseY + halfExtents.y * 2;

    const platform = world.spawn();
    // Entity.transform is a plain THREE.Group that only renders once something parents it
    // into the scene (see Entity.ts's own doc) — neither of these two entities has any OTHER
    // visual of its own (the obstacle's actual mesh, above, is a separate free-standing
    // THREE.Mesh, not tied to either entity), so without this the debug collider/trigger
    // wireframe RigidBody.awake() attaches as a CHILD of this transform (see PHYSICS_DEBUG/
    // PHYSICS_TRIGGER_DEBUG) is built but never actually rendered — same reason
    // WorldEnvironment.spawnPlayer() does `threeScene.add(player.transform)` for the player.
    threeScene.add(platform.transform);
    platform.transform.position.set(x, topY - PLATFORM_HALF_THICKNESS, z);
    platform.addComponent(new RigidBody({
        halfExtents: new THREE.Vector3(halfExtents.x, PLATFORM_HALF_THICKNESS, halfExtents.z),
        isStatic: true,
        layer: Layers.Environment,
        bendService,
    }));

    if (!hazard) {
        // See ObstacleOptions.hazard's own doc — a pure platform, no hit-detection at all.
        return;
    }

    const hitZone = world.spawn();
    threeScene.add(hitZone.transform);
    hitZone.transform.position.set(x, baseY + halfExtents.y, z);
    const trigger = hitZone.addComponent(new RigidBody({
        halfExtents,
        isStatic: true,
        isTrigger: true,
        layer: Layers.Environment,
        bendService,
    }));

    let hit = false;
    const playerMin = new THREE.Vector3();

    trigger.onTriggerEnter.add((other) => {
        if (hit || other.layer !== Layers.Player) {
            return;
        }

        // Same "is the player's own base already flush with the top" check the platform
        // itself would otherwise resolve physically — the trigger has no such resolution
        // (it never blocks), so this is what tells a landing apart from an actual hit. For a
        // raised bar (baseY > 0), a player ducked low enough never satisfies the trigger's
        // own Y-overlap in the first place (see ObstacleOptions.baseY's own doc), so this
        // enter handler never even fires for them — nothing extra needed here for that case.
        other.getMin(playerMin);
        if (playerMin.y >= topY - TOP_LANDING_EPSILON) {
            return;
        }

        hit = true;
        onHit();
    });
}

/**
 * Places every piece of `kind` at the same (x, z) — see ObstacleKind's own doc
 * (MinigameSettings.ts) for why a kind can be more than one box. `onHit` fires from
 * whichever piece the player actually touches first; each piece guards its own single fire
 * independently (see buildObstacle()'s own `hit` flag), so touching a second piece the same
 * run is simply a no-op rather than double-firing.
 */
export function buildObstacleKind(
    world: World,
    threeScene: THREE.Scene,
    x: number,
    z: number,
    kind: ObstacleKind,
    bendService: WorldBendService,
    onHit: () => void,
): void {
    for (const piece of kind.pieces) {
        buildObstacle(world, threeScene, x, z, piece.halfExtents, bendService, onHit, {
            baseY: piece.baseY,
            color: piece.color,
            hazard: piece.hazard,
        });
    }
}
