// WorldEnvironment.ts
//
// The 3D scaffolding every bandit-controller scene needs — lighting, floor +
// its ground collider, the ECS World, player spawn/load, and the orbiting
// follow-camera — factored out so HubScene/RunnerMinigameScene/
// SwipeMinigameScene don't each carry their own copy of it. Gameplay-specific
// stuff (gates, minigame UI, dev-gui wiring) stays in each scene itself.
//
// Not a scene/Entity/Component itself — a scene composes one of these and
// forwards its own update()/fixedUpdate() into it.

import * as THREE from 'three';
import World from 'core/ecs/World';
import MainPlayer from '../../player/MainPlayer';
import { MovementInputHost } from '../../components/PlayerMovementController';
import { FloorBuilder } from '../../builders/FloorBuilder';
import { buildBlueSkyTexture } from '../../builders/SkyBuilder';
import { BendService, WorldBendService } from 'core/services/BendService';
import RigidBody from 'core/physics/RigidBody';
import { Layers } from 'core/physics/PhysicsConstants';
import VirtualCameraSystem from 'core/camera/VirtualCameraSystem';
import { WORLD_SETTINGS } from '../../data/WorldSettings';
import { CAMERA_SETTINGS_BY_MODE, CameraSettings, STANDARD_CAMERA_SETTINGS } from '../../data/GameSettings';

/** Also useful to scenes that need to reason about world bounds (e.g. SwipeMinigameScene sizing its lane visuals to comfortably fit within it). */
export const FLOOR_SIZE = 300;
/** Half-thickness of the floor's (invisible) physics collider — the visual floor mesh is a flat plane at y=0, so the collider's top face is aligned to sit exactly there too. */
const FLOOR_HALF_THICKNESS = 0.5;

/** Spherical orbit around the player: yawDeg (rotation around the player, 0 = behind looking toward -Z), pitchDeg (tilt up/down, 90 = straight overhead), distance (how far back). Converts a CameraSettings' yaw/pitch/distance into a world-space offset from the look-at point. */
function cameraOrbitOffset(settings: CameraSettings): THREE.Vector3 {
    const yaw = settings.yawDeg * (Math.PI / 180);
    const pitch = settings.pitchDeg * (Math.PI / 180);
    const horizontal = settings.distance * Math.cos(pitch);

    return new THREE.Vector3(
        horizontal * Math.sin(yaw),
        settings.distance * Math.sin(pitch),
        horizontal * Math.cos(yaw),
    );
}

/**
 * A small, densely-tessellated floor mesh that stays snapped to whichever
 * grid cell the player is currently nearest to, instead of one huge mesh
 * spanning the whole level at a much coarser resolution — see
 * WorldEnvironment's own doc on recenterFloorPatch() for why this reads as
 * an "infinite", always-fine ground instead of a finite plane.
 */
export interface VisualFloorPatch {
    /** World units per side of the patch. */
    size: number;
    /** Vertices per side — this can be MUCH higher than a full-level floor could ever afford, since the patch only ever needs to cover the area immediately around the player. */
    segments: number;
    /**
     * Optional raised boxes running alongside the patch (e.g. a sidewalk on
     * either side of a runner lane) — same "infinite" recenter trick as the
     * patch itself, but Z-only: each box's own X stays fixed at `centerX`
     * (it represents a fixed distance from the lane, not "wherever the
     * player currently is"), while its Z snaps in lockstep with the
     * patch's own (same floorTileSize, so they never drift out of
     * alignment with each other). `height` sits the box's base at y=0 and
     * its top at y=height (see FloorBuilder.buildBox()'s own doc on why a
     * box with real sides, above street level, instead of a flat plane
     * flush with the ground). Assign your own material to the returned
     * meshes (see sidewalkMeshes) if the default placeholder color isn't
     * what you want.
     */
    sidewalks?: { centerX: number; width: number; height: number }[];
}

export interface CameraFollowOptions {
    /** If set, the look-at point's X is pinned to this world value instead of tracking the player's own X — e.g. RunnerMinigameScene locking the camera to the lane's own centerline instead of swaying with the player's lateral pointer-follow steering. */
    lockX?: number;
    /**
     * If true, the look-at point's Y only updates while the player's RigidBody is grounded —
     * frozen at whatever height it last was on solid ground while airborne, then resyncs the
     * instant the player lands. Without this, a jump's own vertical arc bobs the camera up and
     * down in lockstep with the player, which reads as shaky/distracting for a runner-style
     * camera that's meant to hold a stable framing.
     */
    freezeHeightWhileAirborne?: boolean;
}

export class WorldEnvironment {
    public readonly world = new World(WORLD_SETTINGS);
    /** Named virtual cameras (see GameSettings.ts) — cutTo()/blendTo() between them. */
    public readonly cameraSystem = new VirtualCameraSystem(STANDARD_CAMERA_SETTINGS);
    public mainPlayer!: MainPlayer;
    /** The actual floor size THIS environment built (may differ from the FLOOR_SIZE default — see constructor's own floorSize param) — read this instead of the FLOOR_SIZE constant when a scene needs to reason about ITS OWN world bounds (e.g. SwipeMinigameScene sizing lane visuals, RunnerMinigameScene placing obstacles). */
    public readonly floorSize: number;
    /** Resolves once the player's character (FBX mesh + animation clips) has finished loading — see spawnPlayer(). Scenes expose this as their own `ready` so index.ts's scene-transition can hold the radial-cover reveal until the new scene actually has something to show. Starts pre-resolved so reading it before spawnPlayer() is ever called isn't an error. */
    public playerReady: Promise<void> = Promise.resolve();

    private readonly threeScene: THREE.Scene;
    /** Which bend flavor this environment's own floor (and, via spawnPlayer(), its player) use — defaults to the hub's plain radial BendService; RunnerMinigameScene/SwipeMinigameScene pass RunnerBendService instead (see that file's own doc). */
    private readonly bendService: WorldBendService;
    private readonly smoothedTarget = new THREE.Vector3();
    private readonly followTarget = new THREE.Vector3();
    private readonly lookAtPoint = new THREE.Vector3();
    private readonly offsetVector = new THREE.Vector3();
    /** The player's own Y the last time its RigidBody was grounded — see CameraFollowOptions.freezeHeightWhileAirborne. */
    private lastGroundedHeight = 0;
    /** Set only when `visualFloorPatch` is passed — see recenterFloorPatch()'s own doc. Public so a caller can assign its own tiled material after construction (see VisualFloorPatch's own doc). */
    public readonly floorMesh?: THREE.Mesh;
    /** One per `visualFloorPatch.sidewalks` entry, same order — public for the same reason as floorMesh. Each one's own X is set once at construction (VisualFloorPatch.sidewalks' own centerX) and never touched again — see recenterFloorPatch()'s own doc on why only Z ever moves. */
    public readonly sidewalkMeshes: THREE.Mesh[] = [];
    /** World units the floor patch's own position snaps by each time it recenters — exactly one of its own grid cells (size/segments), which is also FloorBuilder's own grid-texture repeat unit, so the snap itself is invisible. */
    private readonly floorTileSize?: number;

    /**
     * `floorSize`/`floorSegments`/`floorCenterBias` default to the hub's own
     * plain floor (FLOOR_SIZE, a uniform 32x32 grid, static — no recentering).
     * `visualFloorPatch`, if passed (RunnerMinigameScene/SwipeMinigameScene
     * do — see MinigameSettings.RUNNER_FLOOR_SETTINGS), swaps the VISUAL
     * floor for a small, densely-tessellated patch that recenterFloorPatch()
     * keeps snapped under the player instead — `floorSize` still governs the
     * (separate, invisible) ground collider either way, so the player can
     * always walk the whole level regardless of how small the visible patch
     * is.
     */
    public constructor(
        threeScene: THREE.Scene,
        bendService: WorldBendService = BendService,
        floorSize: number = FLOOR_SIZE,
        floorSegments: number = 32,
        floorCenterBias: number = 1,
        visualFloorPatch?: VisualFloorPatch,
    ) {
        this.threeScene = threeScene;
        this.bendService = bendService;
        this.floorSize = floorSize;

        this.threeScene.background = buildBlueSkyTexture();
        this.threeScene.add(new THREE.AmbientLight(0xffffff, 1.2));
        const sun = new THREE.DirectionalLight(0xffffff, 1.0);
        sun.position.set(5, 10, 5);
        this.threeScene.add(sun);

        if (visualFloorPatch) {
            this.floorMesh = FloorBuilder.build(this.threeScene, visualFloorPatch.size, 0, 0, this.bendService, visualFloorPatch.segments, 1);
            this.floorTileSize = visualFloorPatch.size / visualFloorPatch.segments;

            for (const sidewalk of visualFloorPatch.sidewalks ?? []) {
                // Same Z-length/segment count as the main patch — sharing floorTileSize is what
                // keeps this box's own snap in lockstep with the patch's, so the seam between
                // them never drifts.
                const mesh = FloorBuilder.buildBox(
                    this.threeScene,
                    sidewalk.width,
                    sidewalk.height,
                    visualFloorPatch.size,
                    sidewalk.centerX,
                    sidewalk.height / 2,
                    0,
                    this.bendService,
                    visualFloorPatch.segments,
                );
                this.sidewalkMeshes.push(mesh);
            }
        } else {
            FloorBuilder.build(this.threeScene, this.floorSize, 0, 0, this.bendService, floorSegments, floorCenterBias);
        }
        this.buildGroundCollider();

        for (const [id, settings] of Object.entries(CAMERA_SETTINGS_BY_MODE)) {
            this.cameraSystem.register(id, settings);
        }
    }

    /** FloorBuilder only builds the visual mesh — this gives the player's RigidBody something static to land on, sized to match it and positioned so its top face sits exactly at y=0. */
    private buildGroundCollider(): void {
        const ground = this.world.spawn();
        // Entity.transform only renders once something parents it into the scene (see
        // Entity.ts's own doc) — the ground has no visual of its own (FloorBuilder.build()
        // above is a separate free-standing mesh), so without this its debug collider
        // wireframe (PHYSICS_DEBUG — see RigidBody.awake()) is built but never actually shown.
        this.threeScene.add(ground.transform);
        ground.addComponent(new RigidBody({
            halfExtents: new THREE.Vector3(this.floorSize / 2, FLOOR_HALF_THICKNESS, this.floorSize / 2),
            centerOffset: new THREE.Vector3(0, -FLOOR_HALF_THICKNESS, 0),
            isStatic: true,
            layer: Layers.Environment,
            bendService: this.bendService,
        }));
    }

    /**
     * Spawns + starts loading the player's character at `spawnPosition` — `inputHost` is
     * whichever scene owns this environment (a ThreeScene already satisfies
     * MovementInputHost, see MainPlayer.ts's own two-step sync-awake/async-loadCharacter
     * split). `getMoveSpeed` defaults to MainPlayer's own hub speed function — RunnerMinigameScene/
     * SwipeMinigameScene pass their own constant forward pace instead (see
     * MinigameSettings.ts's forwardSpeed fields).
     */
    public spawnPlayer(inputHost: MovementInputHost, spawnPosition: THREE.Vector3, getMoveSpeed?: (sprinting: boolean) => number): MainPlayer {
        const player = this.world.add(new MainPlayer(inputHost, this.threeScene, this.bendService, getMoveSpeed));
        player.transform.position.copy(spawnPosition);
        this.threeScene.add(player.transform);
        this.playerReady = player.loadCharacter();

        this.mainPlayer = player;
        this.smoothedTarget.copy(spawnPosition);
        this.lastGroundedHeight = spawnPosition.y;
        return player;
    }

    public fixedUpdate(delta: number): void {
        this.world.fixedUpdate(delta);
        this.bendService.updateOrigin(this.mainPlayer.transform.position);
        this.recenterFloorPatch();
        this.cameraSystem.update(delta);
    }

    /**
     * Snaps the visual floor patch's own X/Z to the player's current
     * position, ROUNDED to the nearest multiple of floorTileSize — a plain
     * "always exactly under the player" follow would slide the mesh by a
     * fraction of a grid cell every frame, which is exactly what would make
     * the grid-texture/bend pattern visibly crawl. Snapping in whole
     * floorTileSize steps instead means the patch only ever jumps by
     * exactly one repeat of its own grid texture, which is indistinguishable
     * from not having moved at all — while still always keeping the player
     * within half a patch-size of its center, so a small mesh can stand in
     * for an effectively infinite one. No-op for the hub, which never
     * passes a visualFloorPatch (see constructor's own doc).
     */
    private recenterFloorPatch(): void {
        if (!this.floorMesh || !this.floorTileSize) {
            return;
        }

        const playerPosition = this.mainPlayer.transform.position;
        const snappedZ = Math.round(playerPosition.z / this.floorTileSize) * this.floorTileSize;

        this.floorMesh.position.x = Math.round(playerPosition.x / this.floorTileSize) * this.floorTileSize;
        this.floorMesh.position.z = snappedZ;

        // Sidewalk strips only ever recenter along Z, in lockstep with the main patch (same
        // snappedZ) — their own X stays fixed at sidewalkCenterX, since they represent a fixed
        // distance from the lane rather than "wherever the player currently is".
        for (let i = 0; i < this.sidewalkMeshes.length; i++) {
            this.sidewalkMeshes[i].position.z = snappedZ;
        }
    }

    /**
     * Tears down the player entity — call from every scene's own destroy().
     * SceneManager.changeScene() destroys the OUTGOING scene by clearing its
     * THREE.Scene graph (ThreeScene.destroy()) and removing its PIXI
     * container, but nothing about that touches this World or its entities.
     * Without this, MainPlayer's components (PlayerMovementController,
     * SwipeRunnerController) — which attach their input handling via plain
     * `window.addEventListener(...)`, not anything PIXI/THREE-tree-scoped —
     * keep listening forever: every scene transition would leak another
     * live-but-orphaned player still reading keyboard/pointer/analog-stick
     * input and mutating its own (now unrendered, unstepped) RigidBody. Worse,
     * a still-`enabled` SwipeRunnerController left over from a previous
     * SwipeMinigameScene visit would keep reacting to swipe gestures too.
     */
    public destroy(): void {
        if (this.mainPlayer) {
            this.world.remove(this.mainPlayer);
        }
    }

    public update(delta: number): void {
        this.world.update(delta);
    }

    /**
     * Positions/aims `threeCamera` from the camera system's current blended
     * settings — `delta = 0` snaps instantly (e.g. right after a cutTo()),
     * rather than easing from wherever smoothedTarget last was. The base
     * follow target is always the player's own `transform.position` (feet
     * level) plus `settings.offset` (see below) — `options` only overrides
     * individual AXES of that base target (see CameraFollowOptions' own doc).
     */
    public updateCamera(threeCamera: THREE.PerspectiveCamera, delta: number, options: CameraFollowOptions = {}): void {
        const settings = this.cameraSystem.current;
        const playerPosition = this.mainPlayer.transform.position;
        const grounded = this.mainPlayer.rigidBody.grounded;

        if (!options.freezeHeightWhileAirborne || grounded) {
            this.lastGroundedHeight = playerPosition.y;
        }

        this.followTarget.set(
            options.lockX ?? playerPosition.x,
            options.freezeHeightWhileAirborne ? this.lastGroundedHeight : playerPosition.y,
            playerPosition.z,
        );

        const followT = delta > 0 ? 1 - Math.exp(-settings.followSpeed * delta) : 1;
        this.smoothedTarget.lerp(this.followTarget, followT);

        // settings.offset shifts the look-at point itself (e.g. up to chest/head height) —
        // the orbit (yaw/pitch/distance) is then computed around THAT point, not the
        // player's raw feet-level transform position.
        const lookAtPoint = this.lookAtPoint.copy(this.smoothedTarget).add(
            this.offsetVector.set(settings.offset.x, settings.offset.y, settings.offset.z),
        );

        threeCamera.position.copy(lookAtPoint).add(cameraOrbitOffset(settings));
        threeCamera.lookAt(lookAtPoint);
    }
}
