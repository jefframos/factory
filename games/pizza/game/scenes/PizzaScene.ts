// PizzaScene.ts
//
// Isolated player-movement test scene — just a player moving around on a
// plain flat plane, driven by the SAME keyboard/mobile input systems
// BoundlessWorld3dScene uses. Deliberately strips everything else out:
// - Ground is one static plane, no chunking (see WorldManager.buildGround()) —
//   but resource nodes DO stream in/out by proximity to the player, and keep
//   simulating (respawn timers) even while out of range. See ../world/WorldManager.ts.
// - The floor, the character's body materials, and all head/backpack cubes are all
//   hooked to BendService.applyBend() — same shared uBendOrigin/uBendStrength
//   uniforms as the full game, kept centered on the player every frame via
//   updateOrigin() below. Everything stays wired up; BendService.setEnabled()
//   is the one place to turn the bend off/on for the whole scene at once.
// - No UI/HUD, no food/collectibles, no shop skins.
// See BoundlessWorld3dScene.ts (the full game) for where all of that lives.
//
// The player itself is MainPlayer (see game/player/MainPlayer.ts) — a
// dedicated Entity subclass that self-configures (RigidBody,
// PlayerMovementController, collision events) in its own awake(). This
// scene's job is just to build the World, add MainPlayer to it, add a
// couple of test obstacles, and forward its own update()/fixedUpdate()
// calls — see World.ts.
//
// Movement/physics/input never wait on the FBX character load: MainPlayer
// is already fully functional (collides, falls under gravity, responds to
// input) the instant it's added — loadPlayerCharacter() is a separate,
// async, purely cosmetic step (see MainPlayer.loadCharacter()'s own doc).

import { ThreeScene } from 'core/scene/ThreeScene';
import * as THREE from 'three';
import gsap from 'gsap';
// import { DEFAULT_START_VALUE } from '../ClogConstants';
// import { PlayerEntity } from '../entities/PlayerEntity';
import { BendService } from '../services/BendService';
import { Game } from 'core/Game';
import { LoadingSpinner } from '../dom-ui/LoadingSpinner';
import World from '../ecs/World';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import BoxVisualComponent from '../components/BoxVisualComponent';
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import MainPlayer from '../player/MainPlayer';
import DropZone from '../player/DropZone';
import BuildingZone, { BuildingTriggerArea } from '../player/BuildingZone';
import QueueZone from '../player/QueueZone';
import QuestGiverEntity from '../player/QuestGiverEntity';
import { getQuestGiverConfig } from '../data/QuestGiverTypes';
import ShopZone, { ShopTriggerArea } from '../shop/ShopZone';
import { getShopConfig, SHOP_CONFIG_BY_ID } from '../shop/ShopTypes';
import { ShopUpgradeStorage } from '../shop/ShopUpgradeStorage';
import CraftZone, { CraftTriggerArea } from '../crafting/CraftZone';
import { getCraftConfig } from '../crafting/CraftTypes';
import { CraftStorage } from '../crafting/CraftStorage';
import { ItemStorage } from '../crafting/ItemStorage';
import { ItemType } from '../crafting/ItemTypes';
import { QueueStorage } from '../data/QueueStorage';
import { EconomyStorage } from '../data/EconomyStorage';
import { CurrencyType } from '../data/EconomyTypes';
import WorldManager from '../world/WorldManager';
import WorldObjectRegistry from '../world/WorldObjectRegistry';
import WorldSpawner from '../world/WorldSpawner';
import DynamicResourceSpawner from '../world/DynamicResourceSpawner';
import UIService from '../ui/UIService';
import { GlobalResourceStorage } from '../data/GlobalResourceStorage';
import { BackpackStorage } from '../data/BackpackStorage';
import { BuildingStorage } from '../data/BuildingStorage';
import { BuildingId } from '../data/BuildingTypes';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import { ACTION_CONFIG } from '../actions/ActionTypes';
import { getToolIcon } from '../actions/ToolRegistry';
import { UpgradeNotificationManager } from '../ui/notifications/UpgradeNotificationManager';
import { NotificationRarity, NotificationType } from '../ui/notifications/NotificationTypes';
import { DevGuiManager } from 'core/utils/DevGuiManager';
import SetupThree from 'core/scene/SetupThree';
import { PERFORMANCE_CONFIG } from '../config/PerformanceConfig';
import { CameraFocusHost, CameraFocusOptions } from '../camera/CameraFocusHost';
import { WorldProgressionHost } from '../camera/WorldProgressionHost';
import { wait } from '../utils/GsapUtils';
import Gate from '../world/Gate';
import GateManager from '../world/GateManager';
import { GATE_CONFIG, GateId } from '../data/GateTypes';
import { GateStorage } from '../data/GateStorage';

/**
 * Camera settings data — a spherical orbit around the player instead of a
 * fixed offset vector, so each axis is independently tunable:
 *  - yawDeg: rotation around the player (0 = camera behind, looking
 *    toward -Z; positive turns it clockwise viewed from above).
 *  - pitchDeg: tilt up/down (0 = level with the player, 90 = straight
 *    overhead).
 * distance is no longer fixed — see cameraOffset(), which derives it every
 * frame from PLAY_HALF_W/H so the same play area stays framed regardless of
 * viewport aspect ratio (narrow phones vs. wide desktops).
 */
const CAMERA_SETTINGS = {
    yawDeg: 0,
    pitchDeg: 38,
    distance: 15,
    followSpeed: 10,
};

/** CAMERA_SETTINGS.pitchDeg/distance the camera eases BACK to when the top-down toggle (see UIService's camera-toggle button) is switched off — captured from CAMERA_SETTINGS' own initial values so a dev-GUI tweak to the normal follow angle before ever toggling still gets restored correctly. */
const DEFAULT_CAMERA_PITCH_DEG = CAMERA_SETTINGS.pitchDeg;
const DEFAULT_CAMERA_DISTANCE = CAMERA_SETTINGS.distance;
/** Straight overhead — see cameraUpVector()'s own doc for why 90 specifically used to make the camera spin. */
const TOP_DOWN_CAMERA_PITCH_DEG = 90;
const TOP_DOWN_CAMERA_DISTANCE = 35;
/** How long toggling the camera mode takes to ease pitch/distance to their new values — instant would read as a jump-cut; this is a smooth top-down/follow transition instead. */
const CAMERA_MODE_TRANSITION_SEC = 0.8;

/** The game's own design resolution (see Game.DESIGN_WIDTH/HEIGHT) is the aspect ratio CAMERA_SETTINGS.distance was tuned against. Anything taller/narrower than that zooms out to show more; landscape/wider viewports keep the original distance untouched. */
const REFERENCE_ASPECT = Game.DESIGN_WIDTH / Game.DESIGN_HEIGHT;

/**
 * Converts CAMERA_SETTINGS' yaw/pitch/distance into a world-space offset
 * from the player. Distance stays fixed at CAMERA_SETTINGS.distance for
 * aspect ratios at or wider than the design resolution's, and only scales
 * up (zooms out) as the viewport gets taller/narrower than that — so a
 * normal resize doesn't constantly re-zoom, only a genuinely taller aspect
 * than what the game was designed for does.
 */
function cameraOffset(camera: THREE.PerspectiveCamera): THREE.Vector3 {
    const yaw = CAMERA_SETTINGS.yawDeg * (Math.PI / 180);
    const pitch = CAMERA_SETTINGS.pitchDeg * (Math.PI / 180);

    const tallerFactor = Math.max(1, REFERENCE_ASPECT / camera.aspect);
    const distance = CAMERA_SETTINGS.distance * tallerFactor;

    const horizontal = distance * Math.cos(pitch);

    return new THREE.Vector3(
        horizontal * Math.sin(yaw),
        distance * Math.sin(pitch),
        horizontal * Math.cos(yaw),
    );
}

/**
 * The up-vector camera.lookAt() needs to stay well-defined at every pitch, including
 * pitchDeg=90 (straight down) — see this function's own doc for why that specific case
 * broke before this existed.
 *
 * lookAt() derives the camera's rotation from the view direction (target - position) AND
 * camera.up; the two must never be parallel, or the cross product that builds the camera's
 * "right" axis degenerates to a near-zero vector, and which way it flips is then decided by
 * floating-point noise — invisible most of the time, but AT pitchDeg=90 the view direction
 * IS exactly parallel to THREE's default up (0,1,0) (looking straight down = looking along
 * -Y), so every frame's tiny position/lerp differences could flip that cross product's sign,
 * which is exactly what looked like the camera "rotating on its own" when pitch hit 90 —
 * lookAt() was never actually stable there in the first place, it just happened not to
 * matter visibly until the view direction became perfectly vertical.
 *
 * Fix: derive `up` the same way a spherical orbit camera should — `right` depends only on
 * yaw (always horizontal, defined for every pitch), and `up = right × forward`. This reduces
 * to the ordinary (0,1,0) at low pitch (verified: at pitch=0 the cross product below IS
 * (0,1,0), so this changes nothing about the camera's current working behavior) and turns
 * into a horizontal vector at pitch=90 that still varies continuously with yaw — never
 * parallel to `forward`, so lookAt() has a stable, unique answer at every pitch in between.
 */
function cameraUpVector(yawDeg: number, offset: THREE.Vector3): THREE.Vector3 {
    const yaw = yawDeg * (Math.PI / 180);
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const forward = offset.clone().negate().normalize();
    return right.cross(forward).normalize();
}

/** Test obstacle: a static box offset from spawn along Z only — see setupTestBox(). Walking into it should stop the player instead of passing through. */
const TEST_BOX_HALF_EXTENTS = new THREE.Vector3(0.5, 0.5, 0.5);
const TEST_BOX_OFFSET_Z = 4;

/** Where the build/deposit zone sits — see setupDropZone(). Off to the side, clear of the resource nodes and the solid test box. */
const DROP_ZONE_OFFSET = new THREE.Vector3(6, 0, -2);

/** Where the test Camp building zone sits — see setupBuildingZone(). Separate spot from the drop zone so the two nameplates never overlap. */
const BUILDING_ZONE_OFFSET = new THREE.Vector3(-6, 0, -2);

/** Default timing for a camera-focus event (see PizzaScene.focusCameraOn()) when a caller doesn't override — a beat quick enough not to drag out an upgrade, slow enough to actually read as travel rather than a cut. */
const DEFAULT_FOCUS_TRAVEL_SEC = 0.8;
const DEFAULT_FOCUS_HOLD_SEC = 1.5;

export default class PizzaScene extends ThreeScene implements CameraFocusHost, WorldProgressionHost {
    /** Owns PhysicsWorld + every spawned Entity — the scene's job is just to spawn things into this and forward its own update()/fixedUpdate() calls here (see World.ts). */
    private readonly world = new World();

    /** Shared by anything that pairs a Pixi overlay element to a 3D point (ScreenAnchorComponent) — DropZone's nameplate/deposit popups, ResourceNode's damage numbers. One instance so they all read the exact same worldToScreen/overlayContainer. */
    private readonly screenHost: ScreenAnchorHost = {
        worldToScreen: position => this.worldToScreen(position),
        overlayContainer: this.game.overlayContainer,
        getViewerPosition: () => this.mainPlayer.transform.position,
    };

    /** Owns the ground + every resource node's position/gather/respawn state, streaming ResourceNode entities in/out by proximity to the player — see WorldManager.ts. */
    private readonly worldManager = new WorldManager(this.world, this.threeScene, this.screenHost);

    /** Hand-placed building/gate/etc. spawn points read from the Tiled map's "mapSettings" objectgroup layer — see WorldObjectRegistry.ts. Built once here (same loadTiledMap()/loadTileDefs() reads WorldManager's TileMap already does — no extra cost) and read by setupBuildingZone()/setupGates() below. */
    private readonly worldObjects = new WorldObjectRegistry();

    /** Clusters every "spawnerLayer"-named tilelayer into connected, same-type groups — see WorldSpawner.ts's own doc. */
    private readonly worldSpawner = new WorldSpawner();

    /** Scatters loose, dynamically-spawned resources (currently just the test "bark") across worldSpawner's own clusters — see DynamicResourceSpawner.ts/DynamicResourceTypes.ts. */
    private readonly dynamicResourceSpawner = new DynamicResourceSpawner(this.world, this.threeScene, this.screenHost, this.worldSpawner);

    /** Every live CraftZone, keyed by craft id — see setupCraftTables()/resetCraftingProgress()'s own doc for why this has to be tracked rather than just re-derived from the map each time. */
    private readonly craftZones = new Map<string, CraftZone>();

    /** Owns every live Gate, sequences their unlock-camera-trips off notifyBuildingLevelUp() — see GateManager.ts's own doc. */
    private readonly gateManager = new GateManager(this.world, this);

    /** The player — self-contained (RigidBody, PlayerMovementController, collision events all wired up in its own awake()). See MainPlayer.ts. */
    private readonly mainPlayer: MainPlayer;

    /** Shown while the player character loads, destroyed the instant it resolves — see loadPlayerCharacter(). Tracked as a field too so destroy() can clean it up if the scene is torn down mid-load. */
    private loadingSpinner?: LoadingSpinner;

    /** Owns every screen-anchored HUD panel (backpack, global resources, camera toggle) — see UIService.ts's own doc. Built in build() since it needs game.overlayContainer to already exist. */
    private uiService!: UIService;

    /** Which mode toggleCameraMode() last switched TO — CAMERA_SETTINGS.pitchDeg/distance are tweened, not snapped, so this (not CAMERA_SETTINGS' current mid-tween value) is the source of truth for what the button should say/do next. */
    private isTopDownCamera = false;

    /**
     * When set, fixedUpdate()'s camera follow targets THIS instead of the player — see
     * focusCameraOn(). `null` (the normal case) means "follow the player," which is why
     * fixedUpdate() falls back to playerPosition whenever this is unset rather than needing a
     * separate "focusing vs following" flag.
     */
    private cameraFocusPoint: THREE.Vector3 | null = null;

    /**
     * The point the camera is ACTUALLY aimed/positioned at — eased toward whichever point it
     * should currently be following (player or cameraFocusPoint), rather than snapping to
     * whichever one that is the instant it changes. Switching cameraFocusPoint's identity is
     * an instruction ("start heading toward the building" / "head back to the player"), not a
     * teleport: without this intermediate target, lookAt() would still reorient the camera
     * INSTANTLY toward the new point every time cameraFocusPoint changes, even though position
     * itself eases smoothly via the lerp below — that mismatch (position drifting smoothly,
     * gaze snapping) is what reads as "jumps twice." Easing this instead means both position
     * AND gaze move together, continuously, through the whole focus/return trip.
     */
    private readonly smoothedFollowTarget = new THREE.Vector3();

    public constructor(game: Game) {
        super(game);

        // World.add() adopts a purpose-built Entity subclass instance and calls its
        // awake() immediately — by the time this returns, MainPlayer already has its
        // RigidBody/PlayerMovementController and can move/collide, well before its FBX
        // character has (or even starts to) load. `this` is passed as its movement
        // input host (a Pixi container with worldToScreen()) and `this.threeScene` as
        // where its eventual character mesh gets parented.
        this.mainPlayer = this.world.add(new MainPlayer(this, this.threeScene));

        // Drops the player at the Tiled map's "playerStart" point (see
        // WorldObjectRegistry.ts's own doc) when the level designer has drawn one, instead of
        // wherever MainPlayer's own transform otherwise defaults to (world origin). No-op
        // (keeps that default) if the map has no such marker.
        const playerStart = this.worldObjects.getPlayerStart();
        if (playerStart) {
            this.mainPlayer.transform.position.set(playerStart.x, 0, playerStart.z);
        }

        // ThreeScene's constructor already set a far plane (1000, plenty of headroom by
        // default) — applying PERFORMANCE_CONFIG.cameraFar here just makes it the one place
        // that number lives, so the "Camera Far" dev slider (see setupDebugGui()) has
        // something real to move instead of fighting a hardcoded value in core/.
        this.threeCamera.far = PERFORMANCE_CONFIG.cameraFar;
        this.threeCamera.updateProjectionMatrix();
    }

    public build(): void {
        // Sky blue background + stronger ambient/directional intensities — brighter overall
        // look with zero added draw cost (same two lights, no new objects/shaders).
        this.threeScene.background = new THREE.Color(0x87ceeb);

        this.threeScene.add(new THREE.AmbientLight(0xffffff, 1.4));
        const sun = new THREE.DirectionalLight(0xffffff, 1.0);
        sun.position.set(5, 10, 5);
        this.threeScene.add(sun);

        this.worldManager.buildGround();
        //this.setupTestBox();
        //this.setupDropZone();
        this.setupBuildingZone();
        this.setupGates();
        // Built before setupQueues() — a queue's reward flies to this UI's wallet icon (see
        // setupQueues()), so the panel has to exist first.
        this.uiService = new UIService(this.game, () => this.toggleCameraMode());
        this.setupQueues();
        this.setupShops();
        this.setupCraftTables();
        this.setupDebugGui();
        this.threeScene.add(this.mainPlayer.transform);

        this.positionCamera();
        void this.loadPlayerCharacter();
    }

    /**
     * Live dat.GUI readout for renderer stats — meshCount is EVERY THREE.Mesh currently in
     * threeScene (frustum culling never removes/re-adds objects, just skips drawing them —
     * see THREE's Frustum.intersectsObject, which tests the mesh's own boundingSphere BEFORE
     * BendService's vertex-shader bend displaces anything, so a mesh sitting right at the
     * cull boundary is being culled/kept based on its UN-bent position). triangles/drawCalls
     * come straight from SetupThree.renderer.info.render, which DOES reflect the outcome of
     * that (possibly wrong, pre-bend) culling decision — only what actually got drawn this
     * frame counts toward them. Comparing meshCount against drawCalls is exactly how to spot
     * "this is being culled when it shouldn't be" vs "this is being culled correctly."
     * dat.GUI's `.listen()` (see DevGuiManager.addReadout()) re-reads these getters every
     * frame on its own — nothing here needs to be updated manually per frame.
     */
    private readonly renderStats = {
        threeScene: this.threeScene,
        get triangles(): number {
            return SetupThree.renderer.info.render.triangles;
        },
        get drawCalls(): number {
            return SetupThree.renderer.info.render.calls;
        },
        get meshCount(): number {
            let count = 0;
            this.threeScene.traverse(obj => {
                if ((obj as THREE.Mesh).isMesh) {
                    count++;
                }
            });
            return count;
        },
    };

    /** Dev-only tools — no-ops entirely unless launched with ?dev (see Game.debugParams/DevGuiManager.initialize(), called once in index.ts's startGame()). */
    private setupDebugGui(): void {
        DevGuiManager.instance.addReadout(this.renderStats, ['triangles', 'drawCalls', 'meshCount'], 'Render', 'Render');

        // Camera far needs updateProjectionMatrix() on every change to actually take
        // effect — addObjectTrigger's callback (unlike addProperties' plain owner[key]=v)
        // is exactly the hook for that side effect.
        DevGuiManager.instance.addObjectTrigger(
            PERFORMANCE_CONFIG,
            () => {
                this.threeCamera.far = PERFORMANCE_CONFIG.cameraFar;
                this.threeCamera.updateProjectionMatrix();
            },
            ['cameraFar'],
            [100, 3000],
            'Camera',
            'Performance',
        );
        // resourceLoadRadius/UnloadRadius are read fresh every WorldManager.update() call
        // (see PerformanceConfig.ts's own doc) — no onChange side effect needed, dragging
        // these takes effect on the very next frame.
        // addProperties() always renders as "<name>.<propertyKey>" (see DevGuiManager.ts) —
        // short, DISTINCT names here on purpose, since "Resource Load Radius" and "Resource
        // Unload Radius" both start with the same word and read as identical at a glance in
        // dat.GUI's 200px-wide panel.
        DevGuiManager.instance.addProperties(PERFORMANCE_CONFIG, ['resourceLoadRadius'], [5, 150], 'Load', 'Performance');
        DevGuiManager.instance.addProperties(PERFORMANCE_CONFIG, ['resourceUnloadRadius'], [5, 160], 'Unload', 'Performance');
        DevGuiManager.instance.addProperties(PERFORMANCE_CONFIG, ['resourcePopInSec'], [0, 1.5], 'Pop In', 'Performance');
        DevGuiManager.instance.addProperties(PERFORMANCE_CONFIG, ['resourcePopOutSec'], [0, 1.5], 'Pop Out', 'Performance');

        DevGuiManager.instance.addButton(
            'Clear Global Resources',
            () => void GlobalResourceStorage.clearAll(),
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Clear Backpack',
            () => void BackpackStorage.clearAll(),
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Clear Buildings',
            () => void BuildingStorage.clearAll(),
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Clear Gates',
            () => void GateStorage.clearAll(),
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Clear Queues',
            () => void QueueStorage.clearAll(),
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Clear Money',
            () => void EconomyStorage.clearAll(),
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Clear Shop Upgrades',
            () => void ShopUpgradeStorage.clearAll(),
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Clear Crafting',
            () => void this.resetCraftingProgress(),
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Clear Dynamic Resources',
            () => void this.dynamicResourceSpawner.resetAll(),
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Add 10 Of Each Resource',
            () => {
                for (const type of Object.values(ResourceType)) {
                    BackpackStorage.add(type, 10);
                }
            },
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Add 100 Money',
            () => EconomyStorage.add(CurrencyType.Money, 100),
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Reset Everything',
            () => {
                void GlobalResourceStorage.clearAll();
                void BackpackStorage.clearAll();
                void BuildingStorage.clearAll();
                void GateStorage.clearAll();
                void QueueStorage.clearAll();
                void EconomyStorage.clearAll();
                void ShopUpgradeStorage.clearAll();
                void this.resetCraftingProgress();
                void this.dynamicResourceSpawner.resetAll();
            },
            'Resources',
        );

        // One force-upgrade button per configured shop — fully funds AND completes its next
        // level in one click (bypassing both the coin-deposit walk-up and its cooldown, unlike
        // the normal ShopZone flow), so a designer can test every upgrade tier's ActionConfig
        // change without grinding money/waiting out cooldowns. tryCompleteUpgrade() itself
        // doesn't check cooldown — only addProgress()'s cap on `cost` and isMaxLevel() gate
        // this at all. Fires the same UpgradeNotificationManager callout ShopZone's own
        // coin-drain completion does (see ShopZone.ts) — this button bypasses ShopZone
        // entirely, so without this call here the notification would never have a way to
        // be exercised outside actually standing in the shop and paying it off.
        for (const [id, config] of Object.entries(SHOP_CONFIG_BY_ID)) {
            if (!config) {
                continue;
            }
            DevGuiManager.instance.addButton(
                `Upgrade ${config.name}`,
                () => {
                    const cost = config.levels[ShopUpgradeStorage.getLevel(id)]?.cost;
                    if (cost === undefined) {
                        return;
                    }
                    ShopUpgradeStorage.addProgress(id, config, cost);
                    if (ShopUpgradeStorage.tryCompleteUpgrade(id, config)) {
                        UpgradeNotificationManager.instance.show({
                            type: NotificationType.Upgrade,
                            rarity: NotificationRarity.Common,
                            icon: getToolIcon(config.tool),
                            title: 'UPGRADE!',
                            subtitle: `${config.tool.toUpperCase()} LEVEL ${ShopUpgradeStorage.getLevel(id)}`,
                        });
                    }
                },
                'Upgrades',
            );
        }
        DevGuiManager.instance.addButton(
            'Reset Upgrades',
            () => void ShopUpgradeStorage.clearAll(),
            'Upgrades',
        );

        // One folder per tool (named after ShopConfig.tool, capitalized — 'Axe'/'Pickaxe')
        // with live readouts of the three independent knobs a shop upgrade actually moves
        // (see ActionTypes.ts's own doc): hitIntervalSec (seconds per swing), hitScale (hits
        // one swing counts as — capped by a target's remaining life), and yieldPerHit
        // (amountPerGather * resourcePerHit — the uncapped per-hit yield multiplier). .listen()
        // (see DevGuiManager.addReadout()) keeps these live as ShopUpgradeStorage upgrades
        // land, no manual refresh wiring needed. Matched to the same RESOURCE_CONFIG entry
        // whose `action` equals this shop's action, since that's what amountPerGather lives on.
        for (const config of Object.values(SHOP_CONFIG_BY_ID)) {
            if (!config) {
                continue;
            }
            const resourceConfig = Object.values(RESOURCE_CONFIG).find(r => r.action === config.action);
            if (!resourceConfig) {
                continue;
            }
            const toolStats = {
                get hitIntervalSec(): number {
                    return ACTION_CONFIG[config.action].hitIntervalSec;
                },
                get hitScale(): number {
                    return ACTION_CONFIG[config.action].hitScale;
                },
                get yieldPerHit(): number {
                    return resourceConfig.amountPerGather * ACTION_CONFIG[config.action].resourcePerHit;
                },
            };
            const folderName = config.tool.charAt(0).toUpperCase() + config.tool.slice(1);
            DevGuiManager.instance.addReadout(toolStats, ['hitIntervalSec', 'hitScale', 'yieldPerHit'], config.name, folderName);
        }

        // Live sliders bound directly to CAMERA_SETTINGS — cameraOffset()/fixedUpdate() read
        // it every frame, so dragging these updates the camera immediately, no extra wiring.
        DevGuiManager.instance.addProperties(CAMERA_SETTINGS, ['yawDeg'], [-180, 180], 'Camera', 'Camera');
        DevGuiManager.instance.addProperties(CAMERA_SETTINGS, ['pitchDeg'], [0, 89], 'Camera', 'Camera');
        DevGuiManager.instance.addProperties(CAMERA_SETTINGS, ['distance'], [2, 30], 'Camera', 'Camera');
        DevGuiManager.instance.addProperties(CAMERA_SETTINGS, ['followSpeed'], [0.5, 20], 'Camera', 'Camera');
    }

    /** The task's own collision test: a static box offset from spawn along Z only — walking the player into it should stop them instead of clipping through. */
    private setupTestBox(): void {
        const box = this.world.spawn();
        box.transform.position.set(0, 0, TEST_BOX_OFFSET_Z);

        box.addComponent(new RigidBody({
            halfExtents: TEST_BOX_HALF_EXTENTS,
            isStatic: true,
            layer: Layers.Environment,
            centerOffset: new THREE.Vector3(0, TEST_BOX_HALF_EXTENTS.y, 0),
        }));
        box.addComponent(new BoxVisualComponent(
            TEST_BOX_HALF_EXTENTS.clone().multiplyScalar(2),
            0xff8800,
            new THREE.Vector3(0, TEST_BOX_HALF_EXTENTS.y, 0),
        ));

        this.threeScene.add(box.transform);
    }

    /** The "drop zone" — deposits whatever's in the player's backpack on entry, and carries a permanent "Drop Zone" nameplate (see DropZone.ts) — both via this.screenHost. */
    private setupDropZone(): void {
        const dropZone = this.world.add(new DropZone(DROP_ZONE_OFFSET, this.screenHost));
        this.threeScene.add(dropZone.transform);
    }

    /**
     * Every building's zone — funds its own upgrade ladder (see BuildingZone.ts/
     * BuildingTypes.ts) independently of the drop zone's base-stockpile deposits. `this` is
     * passed as BOTH CameraFocusHost and WorldProgressionHost — see BuildingZone's own doc
     * for why the level-up-then-gate-check chain has to go through the latter rather than a
     * second independent signal listener.
     *
     * Each building's deposit TRIGGER prefers a Tiled "dropper" object targeting it (see
     * WorldObjectRegistry.ts's own doc) over the building's own footprint, when the level
     * designer has placed one — e.g. a building drawn somewhere unreachable, with its real
     * walk-up-to-deposit spot placed elsewhere on the map. After resolving every building,
     * this warns ONCE with the full list of buildings that have no dropper at all (they still
     * work — see BuildingZone's `triggerArea` param doc — this is purely a "did you forget
     * one" nudge for whoever is placing them in Tiled).
     */
    private setupBuildingZone(): void {
        const buildingsWithoutDropper: BuildingId[] = [];

        for (const buildingId of Object.values(BuildingId)) {
            // Fallback width/depth match BuildingTypes.ts's own baseMesh footprint (1x1) —
            // only used if this building isn't found on the Tiled map's "mapSettings" layer
            // at all (see WorldObjectRegistry.require()'s warning).
            const placement = this.worldObjects.require('building', buildingId, { x: BUILDING_ZONE_OFFSET.x, z: BUILDING_ZONE_OFFSET.z, width: 1, depth: 1 });
            const position = new THREE.Vector3(placement.x, BUILDING_ZONE_OFFSET.y, placement.z);

            const dropperPlacement = this.worldObjects.getDropperFor(buildingId);
            const triggerArea: BuildingTriggerArea | undefined = dropperPlacement
                ? {
                    position: new THREE.Vector3(dropperPlacement.x, BUILDING_ZONE_OFFSET.y, dropperPlacement.z),
                    footprint: { width: dropperPlacement.width, depth: dropperPlacement.depth },
                }
                : undefined;
            if (!triggerArea) {
                buildingsWithoutDropper.push(buildingId);
            }

            const buildingZone = this.world.add(new BuildingZone(
                position, this.screenHost, buildingId, this, this,
                { width: placement.width, depth: placement.depth },
                triggerArea,
            ));
            this.threeScene.add(buildingZone.transform);
        }

        if (buildingsWithoutDropper.length > 0) {
            console.warn(`[PizzaScene] no dropper found for building(s): ${buildingsWithoutDropper.join(', ')} — each is using its own footprint as its deposit trigger instead`);
        }
    }

    /**
     * Spawns every gate not already unlocked from a previous session (see GateStorage.ts) and
     * registers it with gateManager. Also catches up any gate whose requirement is ALREADY met
     * the moment it spawns (e.g. the building it depends on was leveled up in a session before
     * this gate existed, or before the player ever walked near it) — that case unlocks
     * silently, with no camera trip, since there's no live "event" to dramatize; it's just
     * this session's world catching up to state that was already true.
     */
    private setupGates(): void {
        for (const id of Object.values(GateId)) {
            if (GateStorage.isUnlocked(id)) {
                continue;
            }

            const config = GATE_CONFIG[id];
            // Fallback width/depth = this gate's own configured mesh size — only used if `id`
            // isn't found on the Tiled map's "mapSettings" layer at all (see
            // WorldObjectRegistry.require()'s warning).
            const placement = this.worldObjects.require('gate', id, {
                x: config.position[0], z: config.position[2],
                width: config.mesh.size[0], depth: config.mesh.size[2],
            });
            const gate = this.world.add(new Gate(this.screenHost, id, {
                ...config,
                position: [placement.x, config.position[1], placement.z],
                mesh: { ...config.mesh, size: [placement.width, config.mesh.size[1], placement.depth] },
            }));
            this.threeScene.add(gate.transform);

            if (gate.isRequirementMet()) {
                GateStorage.unlock(id);
                this.world.remove(gate);
                continue;
            }

            this.gateManager.register(gate);
        }
    }

    /**
     * Spawns one QueueZone per "queue" object found on the Tiled map's "mapSettings" layer —
     * see WorldObjectRegistry.getAllOfType()'s own doc for why this is auto-discovery rather
     * than a fixed id list like setupBuildingZone()/setupGates() use: a queue's id comes
     * straight from whatever's drawn on the map, so a level designer can add "queue7" and have
     * it fully work with zero code changes here.
     */
    private setupQueues(): void {
        for (const [id, placement] of this.worldObjects.getAllOfType('queue')) {
            const position = new THREE.Vector3(placement.x, 0, placement.z);

            // A quest giver needs BOTH its own config AND at least two waypoints (a path needs
            // a start and an end) — see QuestGiverEntity.ts's own doc. When both are present,
            // this queue's pacing is handed over entirely to the giver's own walk cycle
            // (QueueZone's `autoRollTasks = false` — see that field's own doc).
            const questGiverConfig = getQuestGiverConfig(id);
            const waypoints = this.worldObjects.getWaypoints(id);
            const hasGiverPath = questGiverConfig !== undefined && waypoints.length >= 2;

            const queueZone = this.world.add(new QueueZone(
                position, this.screenHost, id,
                () => this.uiService.economyUi.getIconAnchorPosition(),
                { width: placement.width, depth: placement.depth },
                undefined,
                !hasGiverPath,
            ));
            this.threeScene.add(queueZone.transform);

            if (hasGiverPath) {
                const questGiver = this.world.add(new QuestGiverEntity(id, waypoints, questGiverConfig!));
                this.threeScene.add(questGiver.transform);
            }
        }
    }

    /**
     * Spawns one ShopZone per "shop" object found on the Tiled map's "mapSettings" layer whose
     * id has a matching ShopConfig (see ShopTypes.SHOP_CONFIG_BY_ID) — auto-discovery like
     * setupQueues(), since a shop's id is likewise whatever's drawn on the map, EXCEPT a shop
     * with no config entry is skipped (with a warning) rather than falling back to some default,
     * since a shop has no sensible default (see ShopTypes.ts's own doc — it has to know which
     * tool it upgrades).
     *
     * Same dropper-or-own-footprint trigger resolution as setupBuildingZone(): a Tiled
     * "dropper" object targeting this shop's id (see WorldObjectRegistry.ts) stands in for the
     * shop's own footprint as the deposit trigger when the level designer has placed one — e.g.
     * a shop stall drawn against a wall the player can't walk into, with its real drop-off spot
     * placed elsewhere. Falls back to the shop's own footprint when no dropper exists.
     */
    private setupShops(): void {
        for (const [id, placement] of this.worldObjects.getAllOfType('shop')) {
            if (!getShopConfig(id)) {
                console.warn(`[PizzaScene] shop "${id}" found on the Tiled map but has no ShopConfig entry — skipping`);
                continue;
            }

            const position = new THREE.Vector3(placement.x, 0, placement.z);
            const dropperPlacement = this.worldObjects.getDropperFor(id);
            const triggerArea: ShopTriggerArea | undefined = dropperPlacement
                ? {
                    position: new THREE.Vector3(dropperPlacement.x, 0, dropperPlacement.z),
                    footprint: { width: dropperPlacement.width, depth: dropperPlacement.depth },
                }
                : undefined;

            const shopZone = this.world.add(new ShopZone(
                position, this.screenHost, id,
                () => this.uiService.economyUi.getIconAnchorPosition(),
                { width: placement.width, depth: placement.depth },
                triggerArea,
            ));
            this.threeScene.add(shopZone.transform);
        }
    }

    /**
     * Spawns one CraftZone per "craft" object found on the Tiled map's "mapSettings" layer
     * whose id has a matching CraftTableConfig (see CraftTypes.CRAFT_CONFIG_BY_ID) —
     * auto-discovery like setupShops(), since a craft table's id is likewise whatever's drawn
     * on the map, EXCEPT a craft id with no config entry is skipped (with a warning) rather
     * than falling back to some default — a craft table has no sensible default, same
     * reasoning as ShopTypes.ts's own doc (it has to know what it can actually craft).
     *
     * Same dropper-or-own-footprint trigger resolution as setupShops()/setupBuildingZone(): a
     * Tiled "dropper" object targeting this craft table's id (e.g. "dropperCraft" -> "craft1")
     * stands in for the table's own footprint as the walk-up trigger when the level designer
     * has placed one, falling back to the table's own footprint otherwise.
     *
     * Tracks every spawned zone in `this.craftZones` (keyed by craft id) — a `destroyOnComplete`
     * table removes ITSELF from the world once fully crafted (see CraftZone.ts), so
     * resetCraftingProgress() needs a way to find and re-spawn one that's no longer live after
     * a "Clear Data"/"Reset Everything" wipes CraftStorage back to nothing crafted. Skips an id
     * that's already tracked (see resetCraftingProgress()'s own doc) so calling this again
     * after a reset never ends up with two CraftZones for the same table.
     *
     * Also skips a `destroyOnComplete` table whose CraftStorage state ALREADY says every
     * recipe's crafted — e.g. a scene rebuilt (not just a page reload) after that table
     * already spent itself this session. Without this, setupCraftTables() would build a brand
     * new CraftZone for an id that's genuinely done — inert (tryDeposit() already refuses once
     * CraftStorage.isFullyCrafted() is true, so this was never a way to re-farm a "spent"
     * table's recipes), but still very much VISIBLE (mesh + trigger both built unconditionally
     * in CraftZone.awake(), regardless of what refreshLabel() ends up showing) — a table that's
     * supposed to have vanished for good re-appearing, doing nothing, is exactly the "must not
     * even be built" bug this check exists to prevent.
     */
    private setupCraftTables(): void {
        for (const [id, placement] of this.worldObjects.getAllOfType('craft')) {
            if (this.craftZones.has(id)) {
                continue;
            }
            const config = getCraftConfig(id);
            if (!config) {
                console.warn(`[PizzaScene] craft table "${id}" found on the Tiled map but has no CraftTableConfig entry — skipping`);
                continue;
            }
            if (config.destroyOnComplete && CraftStorage.isFullyCrafted(id, config)) {
                continue;
            }

            const position = new THREE.Vector3(placement.x, 0, placement.z);
            const dropperPlacement = this.worldObjects.getDropperFor(id);
            const triggerArea: CraftTriggerArea | undefined = dropperPlacement
                ? {
                    position: new THREE.Vector3(dropperPlacement.x, 0, dropperPlacement.z),
                    footprint: { width: dropperPlacement.width, depth: dropperPlacement.depth },
                }
                : undefined;

            const craftZone = this.world.add(new CraftZone(
                position, this.screenHost, id,
                { width: placement.width, depth: placement.depth },
                triggerArea,
                this,
            ));
            this.threeScene.add(craftZone.transform);
            this.craftZones.set(id, craftZone);
        }
    }

    /**
     * "Clear Data"'s actual crafting reset — wired into the "Reset Everything"/"Clear Crafting"
     * dev-GUI buttons (see setupDebugGui()). Plain CraftStorage.clearAll() alone (what those
     * buttons used to call) left two things broken:
     *   1. ItemStorage never got touched at all, so a previously-crafted pickaxe just stayed
     *      in the player's inventory forever — "clear data" ought to put the player back at
     *      "one axe, nothing else" (see ItemStorage.resetToDefaults()), not leave every tool
     *      ever earned sitting there.
     *   2. A `destroyOnComplete` table that had already been fully crafted had REMOVED ITSELF
     *      from the world (see CraftZone.ts) — clearing CraftStorage's data alone doesn't bring
     *      a deleted entity back, so the table would stay gone even though CraftStorage now
     *      says nothing's been crafted. Removing every tracked CraftZone and re-running
     *      setupCraftTables() re-spawns exactly the ones that are missing (see that method's
     *      own `this.craftZones.has(id)` skip).
     */
    private async resetCraftingProgress(): Promise<void> {
        await CraftStorage.clearAll();
        await ItemStorage.resetToDefaults();

        for (const zone of this.craftZones.values()) {
            this.world.remove(zone);
        }
        this.craftZones.clear();
        this.setupCraftTables();
    }

    /**
     * Eases CAMERA_SETTINGS.pitchDeg/distance toward the top-down values (or back to
     * DEFAULT_CAMERA_PITCH_DEG/DISTANCE) over CAMERA_MODE_TRANSITION_SEC — fixedUpdate()'s
     * existing follow logic reads CAMERA_SETTINGS fresh every step, so tweening the settings
     * object itself is all this needs to do; there's no separate "camera mode" state for the
     * follow logic to branch on.
     */
    private toggleCameraMode(): void {
        this.isTopDownCamera = !this.isTopDownCamera;
        this.uiService.setCameraToggleLabel(this.isTopDownCamera ? 'Follow View' : 'Top-Down View');

        gsap.killTweensOf(CAMERA_SETTINGS);
        gsap.to(CAMERA_SETTINGS, {
            pitchDeg: this.isTopDownCamera ? TOP_DOWN_CAMERA_PITCH_DEG : DEFAULT_CAMERA_PITCH_DEG,
            distance: this.isTopDownCamera ? TOP_DOWN_CAMERA_DISTANCE : DEFAULT_CAMERA_DISTANCE,
            duration: CAMERA_MODE_TRANSITION_SEC,
            ease: 'power2.inOut',
        });
    }

    /**
     * Shows a spinner while MainPlayer.loadCharacter() does its thing (FBX mesh +
     * animation clips) — purely cosmetic UI orchestration; the player itself never
     * waits on this (see this file's own doc, and MainPlayer.loadCharacter()'s).
     */
    private async loadPlayerCharacter(): Promise<void> {
        const spinner = this.loadingSpinner = new LoadingSpinner();
        await this.mainPlayer.loadCharacter();
        spinner.destroy();
        this.loadingSpinner = undefined;
    }

    private positionCamera(): void {
        const playerPosition = this.mainPlayer.transform.position;
        // Snapped, not eased — this only runs once, before the first frame, so there's nothing
        // to ease FROM yet. Every later change to what the camera's looking at goes through
        // fixedUpdate()'s smoothedFollowTarget lerp instead.
        this.smoothedFollowTarget.copy(playerPosition);
        const offset = cameraOffset(this.threeCamera);
        this.threeCamera.up.copy(cameraUpVector(CAMERA_SETTINGS.yawDeg, offset));
        this.threeCamera.position.copy(playerPosition).add(offset);
        this.threeCamera.lookAt(playerPosition);
    }

    /**
     * Physics runs here, not in update(). Game.loop() (core/Game.ts) drives this at a
     * fixed, constant step (Game._fixedDeltaTime/1000, ~1/60s) via an accumulator — if a
     * frame stalls (e.g. the FBX character/animation loads in
     * MainPlayer.loadCharacter() blocking the main thread for a moment), the accumulator
     * just runs several small fixed steps back-to-back to catch up, instead of handing
     * PhysicsWorld one enormous variable delta. That's what was launching the player
     * across the map a few seconds in: update()'s delta comes straight from a raw
     * performance.now() diff with no clamping, so the first frame after any real stall
     * reported multiple real seconds of elapsed time, and gravity/position integration
     * (delta multiplied twice) turned that into an instant multi-unit teleport — easily
     * enough to tunnel clean through the thin ground slab and get flung out from a bad
     * collision resolution on the way through. MAX_PHYSICS_DELTA (PhysicsConstants.ts)
     * stays on as a second line of defense, but the fixed step is the real fix.
     *
     * Runs unconditionally from the very first frame — MainPlayer's RigidBody and
     * PlayerMovementController exist from its own awake(), independent of whether its
     * FBX character has loaded (see this file's own doc).
     *
     * Camera follow, the bend origin, and WorldManager's proximity check all read
     * mainPlayer.transform.position — which itself only changes here, in fixedUpdate().
     * Doing all of that here too (rather than in update(), which runs at render rate) keeps
     * everything that depends on the player's position moving on the SAME clock as the
     * character mesh itself (see CharacterVisualComponent, which reads the RigidBody
     * directly) — no relative jitter between camera and character from render/physics
     * timing drift, since neither one moves except when this runs.
     */
    public override fixedUpdate(delta: number): void {
        this.world.fixedUpdate(delta);

        const playerPosition = this.mainPlayer.transform.position;

        /*
         * CubeBuilder.buildPlayer() (used for the head cube) unconditionally
         * bends its material via BendService — the shader drops a vertex's
         * rendered Y by (dx²+dz²) * uBendStrength, where dx/dz are distance
         * from the shared uBendOrigin uniform. Left at its default (0,0,0),
         * the head cube sinks further "down" the farther the character walks
         * from spawn. Re-centering the origin on the player every step keeps
         * that distance at ~0, so it never sinks.
         */
        BendService.updateOrigin(playerPosition);

        // Streams resource nodes in/out around the player and keeps off-screen respawn
        // timers ticking — see WorldManager.update()'s own doc.
        this.worldManager.update(playerPosition, delta);
        // Independent of the above — see DynamicResourceSpawner.ts's own doc.
        this.dynamicResourceSpawner.update(playerPosition, delta);

        // Whatever the camera SHOULD end up following — the player, normally, or a
        // focusCameraOn() target while a camera event is in progress. This is an instruction,
        // not where the camera looks THIS frame — see smoothedFollowTarget's own doc for why
        // that distinction matters (jumping straight to this would snap the camera's gaze
        // instantly even though position still eased smoothly).
        const desiredTarget = this.cameraFocusPoint ?? playerPosition;
        const followT = 1 - Math.exp(-CAMERA_SETTINGS.followSpeed * delta);
        this.smoothedFollowTarget.lerp(desiredTarget, followT);

        // Position is set DIRECTLY from smoothedFollowTarget (rigidly offset, not a second
        // independent lerp toward it) — see smoothedFollowTarget's own doc for the ONE lag
        // stage this is meant to be. A second lerp here used to make position chase an
        // already-lagging target: two decoupled first-order lags never perfectly track each
        // other frame-to-frame, so the vector from camera.position to the lookAt target
        // (this.smoothedFollowTarget) drifted slightly off `offset` during any transient
        // (walking, stopping, turning) — a constant tiny rotation of the view direction even
        // though yawDeg/pitchDeg never changed, which reads as motion sickness. Deriving
        // position straight from the same smoothed point keeps camera.position and the lookAt
        // target ALWAYS exactly `offset` apart, so the rig translates with lag but never
        // rotates relative to the player on its own.
        const offset = cameraOffset(this.threeCamera);
        this.threeCamera.up.copy(cameraUpVector(CAMERA_SETTINGS.yawDeg, offset));
        this.threeCamera.position.copy(this.smoothedFollowTarget).add(offset);
        this.threeCamera.lookAt(this.smoothedFollowTarget);
    }

    /**
     * Redirects the camera's own follow-lerp (see fixedUpdate()) from the player onto `target`
     * for a beat, then hands it back — the general "camera visits an event" mechanism
     * BuildingZone's level-up sequence is the first caller of (see CameraFocusHost.ts's own
     * doc). Implemented as three plain waits rather than driving anything itself: setting
     * cameraFocusPoint is the entire "travel" instruction, since fixedUpdate()'s existing lerp
     * eases toward whatever this points at every step; the waits just give that lerp time to
     * actually get there (and back) before this resolves, using the same time-based-not-
     * distance-based convention the rest of this game's UI timing already uses (e.g.
     * BuildingZone's LEVEL_UP_REVEAL_DELAY_SEC) rather than polling for "close enough."
     *
     * Also disables mainPlayer.movementController for the whole trip: the player has no
     * camera to steer by once it's looking at the event instead of them, so moving would be
     * blind at best (and visually wrong — the character drifting off while the camera holds
     * on the building). Re-enabled right before this resolves, once the camera has actually
     * finished easing back — see MainPlayer.movementController's own doc for what disabling
     * it does/doesn't do (input keeps recording in the background, only the resulting
     * movement stops).
     */
    public async focusCameraOn(target: THREE.Vector3, options: CameraFocusOptions = {}): Promise<void> {
        const travelSec = options.travelSec ?? DEFAULT_FOCUS_TRAVEL_SEC;
        const holdSec = options.holdSec ?? DEFAULT_FOCUS_HOLD_SEC;
        const returnSec = options.returnSec ?? travelSec;

        this.mainPlayer.movementController.enabled = false;

        this.cameraFocusPoint = target.clone();
        await wait(travelSec);
        await wait(holdSec);
        // Clearing this is the ENTIRE "return" instruction — fixedUpdate() falls back to
        // playerPosition next step and the same lerp eases back toward wherever the player
        // actually is by then, not wherever they were when the event started.
        this.cameraFocusPoint = null;
        await wait(returnSec);

        this.mainPlayer.movementController.enabled = true;
    }

    /** WorldProgressionHost implementation — see that file's own doc for why this is the one place that checks for gate unlocks, rather than GateManager listening to BuildingStorage.onLevelUp directly. */
    public async notifyBuildingLevelUp(buildingId: BuildingId, level: number): Promise<void> {
        await this.gateManager.processBuildingLevelUp(buildingId, level);
    }

    /** WorldProgressionHost implementation — see that file's own doc. Same reasoning as notifyBuildingLevelUp(), just for a crafted item (see CraftZone.ts) instead of a building level-up. */
    public async notifyItemCrafted(item: ItemType): Promise<void> {
        await this.gateManager.processItemCrafted(item);
    }

    public override update(delta: number): void {
        // Runs every entity's update() — for the player, that's PlayerMovementController's own
        // pointer-follow tracking plus CharacterVisualComponent syncing position/animation from
        // whatever fixedUpdate's physics step last resolved (once the FBX character has loaded
        // and that component exists at all — harmless no-op until then).
        this.world.update(delta);
        this.uiService.update();

        super.update(delta);
    }

    public override destroy(): void {
        // Tears down every component on mainPlayer, including PlayerMovementController's own
        // input listeners and (if it ever loaded) the FBX character itself — see MainPlayer.destroy().
        this.world.remove(this.mainPlayer);
        this.worldManager.destroy();
        this.dynamicResourceSpawner.destroy();
        this.loadingSpinner?.destroy();
        this.uiService.destroy();
        super.destroy();
    }
}
