// ControllerScene.ts
//
// The whole game: a bent wireframe-grid floor and a player-controlled
// character with walk/run/jump/dodge — nothing else. Owns the ECS World
// (physics + entities) and a VirtualCameraSystem-driven follow camera.

import * as THREE from 'three';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import { DevGuiManager } from 'core/utils/DevGuiManager';
import World from '../ecs/World';
import MainPlayer from '../player/MainPlayer';
import { FloorBuilder } from '../builders/FloorBuilder';
import { BendService } from '../services/BendService';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { CAMERA_SETTINGS_BY_MODE, CameraSettings, DEFAULT_CAMERA_MODE, STANDARD_CAMERA_SETTINGS } from '../data/GameSettings';
import VirtualCameraSystem from '../camera/VirtualCameraSystem';
import { laneOffset } from '../data/LaneMath';
import GameUI from '../ui/GameUI';

const FLOOR_SIZE = 300;
/** Half-thickness of the floor's (invisible) physics collider — the visual floor mesh is a flat plane at y=0, so the collider's top face is aligned to sit exactly there too (see buildGroundCollider()). */
const FLOOR_HALF_THICKNESS = 0.5;
/** How long a demo camera-switch (see the 1/2/3 keybinds in awakeCameraHotkeys()) takes to blend — see VirtualCameraSystem.blendTo(). */
const CAMERA_BLEND_SEC = 1.0;
/** Demo keybinds mapping to whichever modes GameSettings.CAMERA_SETTINGS_BY_MODE happens to define — see awakeCameraHotkeys(). Extra keys beyond however many modes exist are simply never reachable. */
const CAMERA_HOTKEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];

/**
 * The runner lane's own fixed world direction — must match the "runner"
 * camera preset's yawDeg=0 (behind, looking toward -Z, see GameSettings.ts's
 * own doc), so the camera ends up looking the same way the player is
 * actually forced to run. Enter/exit gates sit along it, RUNNER_LANE_LENGTH
 * apart, both well within the floor's own extents.
 */
const RUNNER_LANE_DIRECTION = new THREE.Vector3(0, 0, -1);
const RUNNER_ENTER_GATE_Z = -10;
const RUNNER_LANE_LENGTH = 80;
const RUNNER_EXIT_GATE_Z = RUNNER_ENTER_GATE_Z - RUNNER_LANE_LENGTH;
/** Gate trigger box — wide enough to catch the player across the whole lane width, tall enough to catch a jump, thin along the lane so it reads as a line the player crosses rather than a room they linger in. */
const GATE_HALF_EXTENTS = new THREE.Vector3(4, 2, 0.3);
const GATE_HEIGHT = 2;

/**
 * Second, parallel corridor — same Z positions/direction as the free-mode
 * lane above, offset sideways with a small gap from its edge (the free
 * lane's own gate spans x in [-GATE_HALF_EXTENTS.x, +GATE_HALF_EXTENTS.x]).
 * This is the DISCRETE-lane swipe controller's own lane, see
 * SwipeRunnerController — entering it hands movement off to that component
 * entirely instead of PlayerMovementController's continuous pointer-follow.
 */
const SWIPE_LANE_GAP = 2;
const SWIPE_LANE_CENTER_X = GATE_HALF_EXTENTS.x + SWIPE_LANE_GAP + GATE_HALF_EXTENTS.x;
const SWIPE_LANE_COUNT = 3;
const SWIPE_LANE_WIDTH = 2.5;
/** Width of each lane's visible stripe (see buildSwipeLaneMarkers()) — thin, just enough to read as a line. */
const LANE_MARKER_WIDTH = 0.15;
/** Where the player starts, and where the "Reset" button (see GameUI) puts them back. */
const PLAYER_SPAWN_POSITION = new THREE.Vector3(0, 0, 0);

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

export default class ControllerScene extends ThreeScene {
    private readonly world = new World();
    /** Named virtual cameras (see GameSettings.ts) the real camera below blends between — press 1/2/3 while playing to try it (see awakeCameraHotkeys()). */
    private readonly cameraSystem = new VirtualCameraSystem(STANDARD_CAMERA_SETTINGS);
    private mainPlayer!: MainPlayer;
    private readonly smoothedTarget = new THREE.Vector3();
    private readonly lookAtPoint = new THREE.Vector3();
    private readonly offsetVector = new THREE.Vector3();
    private cameraHotkeyIds: string[] = [];
    private gameUI!: GameUI;

    public constructor(game: Game) {
        super(game);
    }

    public build(): void {
        this.threeScene.background = new THREE.Color(0x0b1020);
        this.threeScene.add(new THREE.AmbientLight(0xffffff, 1.2));
        const sun = new THREE.DirectionalLight(0xffffff, 1.0);
        sun.position.set(5, 10, 5);
        this.threeScene.add(sun);

        FloorBuilder.build(this.threeScene, FLOOR_SIZE);
        this.buildGroundCollider();

        this.mainPlayer = this.world.add(new MainPlayer(this, this.threeScene));
        this.mainPlayer.transform.position.copy(PLAYER_SPAWN_POSITION);
        this.threeScene.add(this.mainPlayer.transform);
        void this.mainPlayer.loadCharacter();

        this.gameUI = new GameUI(() => this.resetPlayer());
        this.game.uiLayer.addChild(this.gameUI);

        for (const [id, settings] of Object.entries(CAMERA_SETTINGS_BY_MODE)) {
            this.cameraSystem.register(id, settings);
        }
        this.cameraSystem.cutTo(DEFAULT_CAMERA_MODE);
        this.awakeCameraHotkeys();
        this.buildRunnerLane();

        this.smoothedTarget.copy(this.mainPlayer.transform.position);
        this.updateCamera(0);

        // Dev-only tuning sliders (dat.GUI, ?dev in the URL — see DevGuiManager.initialize())
        // — edit the currently active/blended virtual camera's live output directly.
        const current = this.cameraSystem.current;
        DevGuiManager.instance.addProperties(current, ['yawDeg'], [-180, 180], 'Camera', 'Camera');
        DevGuiManager.instance.addProperties(current, ['pitchDeg'], [0, 89], 'Camera', 'Camera');
        DevGuiManager.instance.addProperties(current, ['distance'], [2, 20], 'Camera', 'Camera');
        DevGuiManager.instance.addProperties(current, ['followSpeed'], [0.5, 20], 'Camera', 'Camera');
        DevGuiManager.instance.addProperties(current.offset, ['x', 'y', 'z'], [-3, 3], 'Camera Offset', 'Camera');
    }

    public update(delta: number): void {
        this.world.update(delta);
        super.update(delta);
    }

    public fixedUpdate(delta: number): void {
        this.world.fixedUpdate(delta);
        BendService.updateOrigin(this.mainPlayer.transform.position);
        this.cameraSystem.update(delta);
        this.updateCamera(delta);
    }

    /** FloorBuilder only builds the visual mesh — this gives the player's RigidBody something static to land on, sized to match it and positioned so its top face sits exactly at y=0. */
    private buildGroundCollider(): void {
        const ground = this.world.spawn();
        ground.addComponent(new RigidBody({
            halfExtents: new THREE.Vector3(FLOOR_SIZE / 2, FLOOR_HALF_THICKNESS, FLOOR_SIZE / 2),
            centerOffset: new THREE.Vector3(0, -FLOOR_HALF_THICKNESS, 0),
            isStatic: true,
            layer: Layers.Environment,
        }));
    }

    /** Demo hookup for VirtualCameraSystem.blendTo() — press a number key to smoothly blend to that virtual camera (registered in build(), in GameSettings.CAMERA_SETTINGS_BY_MODE's own insertion order). Swap this for real gameplay triggers (a zone trigger, a cutscene, ...) whenever this controller grows beyond a demo. */
    private awakeCameraHotkeys(): void {
        this.cameraHotkeyIds = Object.keys(CAMERA_SETTINGS_BY_MODE);
        window.addEventListener('keydown', this.onCameraHotkey);
    }

    private readonly onCameraHotkey = (e: KeyboardEvent): void => {
        const index = CAMERA_HOTKEYS.indexOf(e.code);
        const id = index >= 0 ? this.cameraHotkeyIds[index] : undefined;
        if (id) {
            this.cameraSystem.blendTo(id, CAMERA_BLEND_SEC);
        }
    };

    /**
     * Two parallel pairs of trigger gates the player walks through under
     * free movement:
     *  - at x=0: snaps into PlayerMovementController's continuous
     *    pointer-follow runner mode (see enterRunnerMode()).
     *  - at x=SWIPE_LANE_CENTER_X, a little gap over: hands movement off to
     *    the DIFFERENT discrete-lane SwipeRunnerController instead.
     * Either pair's exit gate reverts back to free movement + the standard
     * camera once the player reaches the far end of its lane.
     */
    private buildRunnerLane(): void {
        this.buildGateMarker(RUNNER_ENTER_GATE_Z, 0, 0x44ff88);
        this.buildGateMarker(RUNNER_EXIT_GATE_Z, 0, 0xff8844);

        this.buildTriggerGate(RUNNER_ENTER_GATE_Z, 0, () => {
            this.mainPlayer.movementController.enterRunnerMode(RUNNER_LANE_DIRECTION);
            this.cameraSystem.blendTo('runner', CAMERA_BLEND_SEC);
        });

        this.buildTriggerGate(RUNNER_EXIT_GATE_Z, 0, () => {
            this.mainPlayer.movementController.exitRunnerMode();
            this.cameraSystem.blendTo(DEFAULT_CAMERA_MODE, CAMERA_BLEND_SEC);
        });

        this.buildGateMarker(RUNNER_ENTER_GATE_Z, SWIPE_LANE_CENTER_X, 0x44ccff);
        this.buildGateMarker(RUNNER_EXIT_GATE_Z, SWIPE_LANE_CENTER_X, 0xff44cc);

        this.buildTriggerGate(RUNNER_ENTER_GATE_Z, SWIPE_LANE_CENTER_X, () => {
            this.mainPlayer.movementController.enabled = false;
            this.mainPlayer.swipeRunnerController.activate(RUNNER_LANE_DIRECTION, SWIPE_LANE_COUNT, SWIPE_LANE_WIDTH);
            this.cameraSystem.blendTo('runner', CAMERA_BLEND_SEC);
        });

        this.buildTriggerGate(RUNNER_EXIT_GATE_Z, SWIPE_LANE_CENTER_X, () => {
            this.mainPlayer.swipeRunnerController.deactivate();
            this.mainPlayer.movementController.enabled = true;
            this.cameraSystem.blendTo(DEFAULT_CAMERA_MODE, CAMERA_BLEND_SEC);
        });

        this.buildSwipeLaneMarkers();
    }

    /**
     * One visible stripe per swipe-lane, running the length of the corridor
     * between the two swipe-lane gates — drawn from the EXACT SAME
     * laneOffset()/SWIPE_LANE_COUNT/SWIPE_LANE_WIDTH math SwipeRunnerController
     * itself snaps to (see activate()), so the visible lanes and the ones the
     * player actually lands on can never drift apart.
     */
    private buildSwipeLaneMarkers(): void {
        const length = Math.abs(RUNNER_EXIT_GATE_Z - RUNNER_ENTER_GATE_Z);
        const centerZ = (RUNNER_ENTER_GATE_Z + RUNNER_EXIT_GATE_Z) / 2;

        for (let i = 0; i < SWIPE_LANE_COUNT; i++) {
            const x = SWIPE_LANE_CENTER_X + laneOffset(i, SWIPE_LANE_COUNT, SWIPE_LANE_WIDTH);
            this.buildLaneStripe(x, centerZ, length);
        }
    }

    /** A thin, bright strip lying flat on the floor at `x`, centered on `centerZ` and running `length` world units along Z — purely visual. */
    private buildLaneStripe(x: number, centerZ: number, length: number): void {
        const geometry = new THREE.PlaneGeometry(LANE_MARKER_WIDTH, length);
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
        BendService.applyBend(material);
        const stripe = new THREE.Mesh(geometry, material);
        stripe.rotation.x = -Math.PI / 2;
        // Tiny lift above the floor (y=0) to avoid z-fighting — bent by the exact same
        // amount as the floor at any given XZ, so the gap never visibly changes along the lane.
        stripe.position.set(x, 0.02, centerZ);
        this.threeScene.add(stripe);
    }

    /** A static trigger volume spanning the lane's width at (`x`, `z`) — fires `onEnter` once when the PLAYER's RigidBody crosses into it (ignores everything else, e.g. the ground). */
    private buildTriggerGate(z: number, x: number, onEnter: () => void): void {
        const gate = this.world.spawn();
        gate.transform.position.set(x, GATE_HALF_EXTENTS.y, z);

        const rigidBody = gate.addComponent(new RigidBody({
            halfExtents: GATE_HALF_EXTENTS,
            isStatic: true,
            isTrigger: true,
            layer: Layers.Environment,
        }));

        rigidBody.onTriggerEnter.add((other) => {
            if (other.layer === Layers.Player) {
                onEnter();
            }
        });
    }

    /** Purely visual marker for a gate's position — a thin translucent plane, no collider of its own (buildTriggerGate() owns the actual trigger volume). */
    private buildGateMarker(z: number, x: number, color: number): void {
        const geometry = new THREE.PlaneGeometry(GATE_HALF_EXTENTS.x * 2, GATE_HEIGHT);
        const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
        BendService.applyBend(material);
        const marker = new THREE.Mesh(geometry, material);
        marker.position.set(x, GATE_HEIGHT / 2, z);
        this.threeScene.add(marker);
    }

    /** GameUI's "Reset" button — puts the player back at spawn with zero velocity, drops out of whichever runner mode (if any) it was in, and cuts (not blends — this is a hard correction, not a cinematic beat) the camera back to standard. */
    private resetPlayer(): void {
        this.mainPlayer.transform.position.copy(PLAYER_SPAWN_POSITION);
        this.mainPlayer.rigidBody.velocity.set(0, 0, 0);

        this.mainPlayer.movementController.exitRunnerMode();
        this.mainPlayer.swipeRunnerController.deactivate();
        this.mainPlayer.movementController.enabled = true;

        this.cameraSystem.cutTo(DEFAULT_CAMERA_MODE);
        this.smoothedTarget.copy(PLAYER_SPAWN_POSITION);
        this.updateCamera(0);
    }

    public resize(): void {
        this.gameUI?.reposition();
    }

    private updateCamera(delta: number): void {
        const settings = this.cameraSystem.current;
        const followT = delta > 0 ? 1 - Math.exp(-settings.followSpeed * delta) : 1;
        this.smoothedTarget.lerp(this.mainPlayer.transform.position, followT);

        // settings.offset shifts the look-at point itself (e.g. up to chest/head height) —
        // the orbit (yaw/pitch/distance) is then computed around THAT point, not the
        // player's raw feet-level transform position.
        const lookAtPoint = this.lookAtPoint.copy(this.smoothedTarget).add(
            this.offsetVector.set(settings.offset.x, settings.offset.y, settings.offset.z),
        );

        this.threeCamera.position.copy(lookAtPoint).add(cameraOrbitOffset(settings));
        this.threeCamera.lookAt(lookAtPoint);
    }

    public destroy(): void {
        window.removeEventListener('keydown', this.onCameraHotkey);
        this.gameUI?.destroy();
        super.destroy();
    }
}
