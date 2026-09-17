// ControllerScene.ts
//
// The whole game: a bent wireframe-grid floor and a player-controlled
// character with walk/run/jump/dodge — nothing else. Owns the ECS World
// (physics + entities) and a VirtualCameraSystem-driven follow camera.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import { DevGuiManager } from 'core/utils/DevGuiManager';
import World from '../ecs/World';
import MainPlayer from '../player/MainPlayer';
import Collectible from '../entities/Collectible';
import { FloorBuilder } from '../builders/FloorBuilder';
import { BendService } from '../services/BendService';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { CAMERA_SETTINGS_BY_MODE, CameraSettings, DEFAULT_CAMERA_MODE, STANDARD_CAMERA_SETTINGS } from '../data/GameSettings';
import VirtualCameraSystem from '../camera/VirtualCameraSystem';
import { laneOffset } from '../data/LaneMath';
import { LANE_SETTINGS } from '../data/LaneSettings';
import { PLAYER_SETTINGS } from '../data/PlayerSettings';
import { WORLD_SETTINGS } from '../data/WorldSettings';
import { MONEY_PILE_SMALL, generateCollectibleSpawnPositions, resolveCollectibleIconPath } from '../data/CollectibleSettings';
import { spawnFlyingIconToOverlayPoint } from '../ui/FlyingResourceIcon';
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
/** The corridor's own fixed middle-lane position — passed to SwipeRunnerController.activate() so it measures the player's actual entry offset against the SAME point the visible lane rectangles (see buildSwipeLaneMarkers()) are drawn from. */
const SWIPE_LANE_ORIGIN = new THREE.Vector3(SWIPE_LANE_CENTER_X, 0, RUNNER_ENTER_GATE_Z);
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
    /** Live pickups still waiting to be collected — pruned in update() once Collectible flags itself `collected` (see that file's own doc on why it can't despawn itself mid-tick). */
    private readonly collectibles: Collectible[] = [];
    private collectedMoney = 0;
    /** Loaded once in build() (see preloadMoneyIconTexture()) — shared by every flyRewardToWallet-style flying icon, same "one icon, loaded once" convention bandit/legacy's AssetLibraryRegistry uses. Falls back to PIXI.Texture.WHITE (matching bandit's own getAssetIcon() fallback) on the vanishingly unlikely chance a pickup is collected before this local webp finishes loading. */
    private moneyIconTexture?: PIXI.Texture;

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
        this.buildCollectibles();
        void this.preloadMoneyIconTexture();

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

        // Player + World tuning — edits PlayerSettings.ts/WorldSettings.ts directly, which
        // every reader (ThirdPersonCharacter, PlayerMovementController, SwipeRunnerController,
        // CharacterVisualComponent, PhysicsWorld) reads LIVE, so these take effect immediately.
        DevGuiManager.instance.addProperties(PLAYER_SETTINGS, ['walkSpeed'], [1, 15], 'Player', 'Player');
        DevGuiManager.instance.addProperties(PLAYER_SETTINGS, ['runSpeedMultiplier'], [1, 4], 'Player', 'Player');
        DevGuiManager.instance.addProperties(PLAYER_SETTINGS, ['jumpSpeed'], [2, 25], 'Player', 'Player');
        DevGuiManager.instance.addProperties(PLAYER_SETTINGS, ['rollDuration'], [0.1, 2], 'Player', 'Player');
        DevGuiManager.instance.addProperties(PLAYER_SETTINGS, ['slideDuration'], [0.1, 2], 'Player', 'Player');
        DevGuiManager.instance.addProperties(WORLD_SETTINGS, ['gravity'], [-60, -2], 'World', 'World');
        DevGuiManager.instance.addProperties(WORLD_SETTINGS, ['maxPhysicsDelta'], [0.01, 0.1], 'World', 'World');
    }

    public update(delta: number): void {
        this.world.update(delta);
        this.pruneCollectedPickups();
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
            this.mainPlayer.swipeRunnerController.activate(RUNNER_LANE_DIRECTION, LANE_SETTINGS.count, LANE_SETTINGS.width, SWIPE_LANE_ORIGIN);
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
     * One full-width, differently-colored rectangle per swipe-lane, running
     * the length of the corridor between the two swipe-lane gates — drawn
     * from LANE_SETTINGS (count/width/colors) with the EXACT SAME
     * laneOffset() math SwipeRunnerController itself snaps to (see
     * activate()), so the visible lanes and the ones the player actually
     * lands on can never drift apart. Each rectangle is exactly
     * LANE_SETTINGS.width wide, matching the spacing between lane centers,
     * so adjacent lanes tile edge-to-edge with no gaps or overlaps.
     */
    private buildSwipeLaneMarkers(): void {
        const length = Math.abs(RUNNER_EXIT_GATE_Z - RUNNER_ENTER_GATE_Z);
        const centerZ = (RUNNER_ENTER_GATE_Z + RUNNER_EXIT_GATE_Z) / 2;

        for (let i = 0; i < LANE_SETTINGS.count; i++) {
            const x = SWIPE_LANE_CENTER_X + laneOffset(i, LANE_SETTINGS.count, LANE_SETTINGS.width);
            const color = LANE_SETTINGS.colors[i % LANE_SETTINGS.colors.length];
            this.buildLaneRect(x, centerZ, length, color);
        }
    }

    /**
     * A full-lane-width colored rectangle lying flat on the floor at `x`,
     * centered on `centerZ` and running `length` world units along Z —
     * purely visual. Subdivided along its length (see FloorBuilder's own
     * doc on this exact issue) — BendService's bend is a per-VERTEX
     * displacement, so a plain 1x1 plane only bends at its 4 corners and
     * warps badly/sinks out of view over an 80-unit strip instead of
     * following the same smooth curve the floor's own 32x32-segment mesh
     * does at that point.
     */
    private buildLaneRect(x: number, centerZ: number, length: number, color: number): void {
        const lengthSegments = Math.max(8, Math.ceil(length / 5));
        const geometry = new THREE.PlaneGeometry(LANE_SETTINGS.width, length, 1, lengthSegments);
        const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45 });
        BendService.applyBend(material);
        const rect = new THREE.Mesh(geometry, material);
        rect.rotation.x = -Math.PI / 2;
        // Tiny lift above the floor (y=0) to avoid z-fighting — bent by the exact same
        // amount as the floor at any given XZ, so the gap never visibly changes along the lane.
        rect.position.set(x, 0.02, centerZ);
        this.threeScene.add(rect);
    }

    /** Spreads a ring of Money_Pile_Small pickups around the player's own spawn point (see CollectibleSettings.generateCollectibleSpawnPositions) — walking near one snaps it to the player and pays out via onCollectResource(). */
    private buildCollectibles(): void {
        for (const position of generateCollectibleSpawnPositions(PLAYER_SPAWN_POSITION)) {
            const collectible = this.world.add(new Collectible(
                MONEY_PILE_SMALL,
                this.threeScene,
                () => this.mainPlayer.getCollectTargetPosition(),
            ));
            collectible.transform.position.copy(position);
            collectible.onCollected.add((amount) => this.onCollectResource(amount, collectible.transform.position.clone()));
            void collectible.load();
            this.collectibles.push(collectible);
        }
    }

    private async preloadMoneyIconTexture(): Promise<void> {
        this.moneyIconTexture = await PIXI.Assets.load<PIXI.Texture>(resolveCollectibleIconPath(MONEY_PILE_SMALL.icon));
    }

    /** Flies the collected icon from where the pickup was consumed to GameUI's money icon (see FlyingResourceIcon.ts) — the money counter itself only increments once the icon actually lands (`onArrive`), same "mutate on landing, not on departure" convention bandit/legacy's QueueZone.flyRewardToWallet() follows. */
    private onCollectResource(amount: number, worldPosition: THREE.Vector3): void {
        spawnFlyingIconToOverlayPoint(
            this,
            this.game,
            worldPosition,
            () => this.gameUI.getMoneyIconOverlayPosition(),
            this.moneyIconTexture ?? PIXI.Texture.WHITE,
            () => {
                this.collectedMoney += amount;
                this.gameUI.setResourceCount(this.collectedMoney);
            },
        );
    }

    /** Collectible can't despawn itself mid-tick (see that file's own doc) — this runs once per frame, safely outside World's own entity iteration, to actually remove anything that flagged itself collected this tick. */
    private pruneCollectedPickups(): void {
        for (let i = this.collectibles.length - 1; i >= 0; i--) {
            const collectible = this.collectibles[i];
            if (!collectible.collected) {
                continue;
            }
            this.collectibles.splice(i, 1);
            this.world.remove(collectible);
        }
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
