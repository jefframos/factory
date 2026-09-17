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
import World from '../../ecs/World';
import MainPlayer from '../../player/MainPlayer';
import { MovementInputHost } from '../../components/PlayerMovementController';
import { FloorBuilder } from '../../builders/FloorBuilder';
import { BendService, WorldBendService } from '../../services/BendService';
import RigidBody from '../../physics/RigidBody';
import { Layers } from '../../physics/PhysicsConstants';
import VirtualCameraSystem from '../../camera/VirtualCameraSystem';
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
    public readonly world = new World();
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

    /**
     * `floorSize`/`floorSegments`/`floorCenterBias` default to the hub's own
     * plain floor (FLOOR_SIZE, a uniform 32x32 grid) — RunnerMinigameScene/
     * SwipeMinigameScene pass their own, larger/denser/center-focused values
     * (see MinigameSettings.RUNNER_FLOOR_SETTINGS and FloorBuilder.build()'s
     * own doc on what centerBias does).
     */
    public constructor(
        threeScene: THREE.Scene,
        bendService: WorldBendService = BendService,
        floorSize: number = FLOOR_SIZE,
        floorSegments: number = 32,
        floorCenterBias: number = 1,
    ) {
        this.threeScene = threeScene;
        this.bendService = bendService;
        this.floorSize = floorSize;

        this.threeScene.background = new THREE.Color(0x0b1020);
        this.threeScene.add(new THREE.AmbientLight(0xffffff, 1.2));
        const sun = new THREE.DirectionalLight(0xffffff, 1.0);
        sun.position.set(5, 10, 5);
        this.threeScene.add(sun);

        FloorBuilder.build(this.threeScene, this.floorSize, 0, 0, this.bendService, floorSegments, floorCenterBias);
        this.buildGroundCollider();

        for (const [id, settings] of Object.entries(CAMERA_SETTINGS_BY_MODE)) {
            this.cameraSystem.register(id, settings);
        }
    }

    /** FloorBuilder only builds the visual mesh — this gives the player's RigidBody something static to land on, sized to match it and positioned so its top face sits exactly at y=0. */
    private buildGroundCollider(): void {
        const ground = this.world.spawn();
        ground.addComponent(new RigidBody({
            halfExtents: new THREE.Vector3(this.floorSize / 2, FLOOR_HALF_THICKNESS, this.floorSize / 2),
            centerOffset: new THREE.Vector3(0, -FLOOR_HALF_THICKNESS, 0),
            isStatic: true,
            layer: Layers.Environment,
        }));
    }

    /** Spawns + starts loading the player's character at `spawnPosition` — `inputHost` is whichever scene owns this environment (a ThreeScene already satisfies MovementInputHost, see MainPlayer.ts's own two-step sync-awake/async-loadCharacter split). */
    public spawnPlayer(inputHost: MovementInputHost, spawnPosition: THREE.Vector3): MainPlayer {
        const player = this.world.add(new MainPlayer(inputHost, this.threeScene, this.bendService));
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
        this.cameraSystem.update(delta);
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
