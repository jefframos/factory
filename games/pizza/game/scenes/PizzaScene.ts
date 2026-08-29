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
import { ParticleSystem } from '../vfx/ParticleSystem';
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
import { getQueueConfig } from '../data/QueueTypes';
import { isMilestoneRequirementMet } from '../data/MilestoneRequirement';
import QuestGiverEntity from '../player/QuestGiverEntity';
import { getQuestGiverConfig } from '../data/QuestGiverTypes';
import ShopZone, { ShopTriggerArea } from '../shop/ShopZone';
import { getShopConfig, SHOP_CONFIG_BY_ID } from '../shop/ShopTypes';
import { ShopUpgradeStorage } from '../shop/ShopUpgradeStorage';
import CraftZone, { CraftTriggerArea } from '../crafting/CraftZone';
import { getCraftConfig } from '../crafting/CraftTypes';
import FarmZone from '../world/FarmZone';
import Trigger from '../world/Trigger';
import FarmPlotTile from '../world/FarmPlotTile';
import { computeFarmGrid, FARM_GRID_CELL_SIZE, FARM_GRID_APPEAR_STAGGER_SEC } from '../world/FarmGrid';
import { getFarmPlotConfig } from '../data/FarmTypes';
import { getTriggerConfig } from '../data/TriggerTypes';
import { TriggerStorage } from '../data/TriggerStorage';
import { FarmPlotStorage } from '../data/FarmPlotStorage';
import { TutorialProgressStorage } from '../tutorial/TutorialProgressStorage';
import { CraftStorage } from '../crafting/CraftStorage';
import { ItemStorage } from '../crafting/ItemStorage';
import { ItemType } from '../crafting/ItemTypes';
import { QueueStorage } from '../data/QueueStorage';
import { EconomyStorage } from '../data/EconomyStorage';
import { CurrencyType } from '../data/EconomyTypes';
import WorldManager from '../world/WorldManager';
import WorldObjectRegistry, { WorldObjectPlacement } from '../world/WorldObjectRegistry';
import ZoneTutorialController from '../tutorial/ZoneTutorialController';
import MovementTutorialOverlay from '../tutorial/MovementTutorialOverlay';
import WorldSpawner from '../world/WorldSpawner';
import DynamicResourceSpawner from '../world/DynamicResourceSpawner';
import ShapeResourceSpawner from '../world/ShapeResourceSpawner';
import AnimalNode from '../player/AnimalNode';
import { AnimalFollowStorage } from '../data/AnimalFollowStorage';
import UIService from '../ui/UIService';
import InGameButtonList from '../ui/InGameButtonList';
import { clearAllPlayerData } from '../data/PlayerDataReset';
import { ZONE_REVEAL_CONFIG } from '../world/FogOfWarConfig';
import { GlobalResourceStorage } from '../data/GlobalResourceStorage';
import { BackpackStorage } from '../data/BackpackStorage';
import { BuildingStorage } from '../data/BuildingStorage';
import { BUILDING_CONFIG, BuildingId } from '../data/BuildingTypes';
import { ResourceType } from '../actions/ResourceTypes';
import { PROVIDER_CONFIG } from '../actions/ProviderTypes';
import { ACTION_CONFIG } from '../actions/ActionTypes';
import { getToolIcon } from '../actions/ToolRegistry';
import { UpgradeNotificationManager } from '../ui/notifications/UpgradeNotificationManager';
import { NotificationRarity, NotificationType } from '../ui/notifications/NotificationTypes';
import { DevGuiManager } from 'core/utils/DevGuiManager';
import PlayerUIAvoidanceComponent from '../components/PlayerUIAvoidanceComponent';
import SetupThree from 'core/scene/SetupThree';
import { PERFORMANCE_CONFIG } from '../config/PerformanceConfig';
import { CameraFocusHost, CameraFocusOptions } from '../camera/CameraFocusHost';
import { WorldProgressionHost } from '../camera/WorldProgressionHost';
import { wait } from '../utils/GsapUtils';
import Gate from '../world/Gate';
import GateDropZone from '../world/GateDropZone';
import RequirementRegistry from '../world/RequirementRegistry';
import { GATE_CONFIG, GateId } from '../data/GateTypes';
import { GateStorage } from '../data/GateStorage';
import { downloadGameData } from '../debug/GameDataBaker';
import { PlayerPositionStorage } from '../data/PlayerPositionStorage';
import { isWalkable } from '../world/TileWalkability';
import { ModelSnapshotTool } from '../debug/ModelSnapshotTool';
import { getMeshPlacements } from '../world/MeshLayerSpawner';
import GlbVisualComponent from '../components/GlbVisualComponent';

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
    yawDeg: 5,
    pitchDeg: 45,
    distance: 12,
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

/** How long a zone reveal briefly freezes player movement for — see the worldManager.onZoneRevealed subscription in this scene's constructor. Long enough to read as "wait, something happened," short enough not to feel like the player lost control. */
const ZONE_UNLOCK_FREEZE_SEC = 1;

/** How often fixedUpdate() re-checks/persists the player's current position as the new "last stable tile" — see PlayerPositionStorage.ts's own doc. Every tick would be wasteful (this never needs to be more precise than "somewhere in the last couple seconds"). */
/** Vertical offset from playerPosition (feet/base) up to roughly torso height — see BendService.applyOcclusionFade's own doc for why occlusion targets this instead of the base. Tune this against the actual character model's height. */
const OCCLUSION_TARGET_HEIGHT_OFFSET = 0.9;

const PLAYER_POSITION_CHECK_INTERVAL_SEC = 2;
/** How close a NOT-YET-DEPLETED resource has to be to the player's own position to count as "on top of" it — see WorldManager.hasResourceAt(). Roughly half a tile (TileMapConfig.WORLD_UNITS_PER_TILE is 2), tight enough to only reject a position that's actually standing on the resource's own footprint, not merely near it. */
const PLAYER_STABLE_TILE_RESOURCE_RADIUS = 1;

export default class PizzaScene extends ThreeScene implements CameraFocusHost, WorldProgressionHost {
    /** Owns PhysicsWorld + every spawned Entity — the scene's job is just to spawn things into this and forward its own update()/fixedUpdate() calls here (see World.ts). */
    private readonly world = new World();

    /**
     * Shared by anything that pairs a Pixi overlay element to a 3D point (ScreenAnchorComponent)
     * — DropZone's nameplate/deposit popups, ResourceNode's damage numbers. One instance so they
     * all read the exact same worldToScreen/overlayContainer. Points at `game.uiLayer` (the
     * bottom of the three z-ordered overlay tiers — see core/Game.ts's own doc), NOT the raw
     * `game.overlayContainer` umbrella, which now exists purely to hold uiLayer/
     * notificationLayer/popupLayer in the right order — anything added directly to it instead
     * of one of those three would draw on top of even popupLayer, for having been added last.
     */
    private readonly screenHost: ScreenAnchorHost = {
        worldToScreen: position => this.worldToScreen(position),
        overlayContainer: this.game.uiLayer,
        getViewerPosition: () => this.mainPlayer.transform.position,
        // Delegates to MainPlayer's own PlayerUIAvoidanceComponent (head position + live,
        // designer-tunable radius) — see that component's own doc. Referenced lazily (this
        // function only runs once mainPlayer actually exists) same as getViewerPosition above,
        // even though `this.mainPlayer` isn't assigned yet at the point this object literal
        // itself is constructed.
        getUIAvoidancePoint: () => this.mainPlayer.getUIAvoidancePoint(),
    };

    /** Owns the ground + every resource node's position/gather/respawn state, streaming ResourceNode entities in/out by proximity to the player — see WorldManager.ts. */
    private readonly worldManager = new WorldManager(this.world, this.threeScene, this.screenHost);

    /** Hand-placed building/gate/etc. spawn points read from the Tiled map's "mapSettings" objectgroup layer — see WorldObjectRegistry.ts. Built once here (same loadTiledMap()/loadTileDefs() reads WorldManager's TileMap already does — no extra cost) and read by setupBuildingZone()/setupGates() below. */
    private readonly worldObjects = new WorldObjectRegistry();

    /** Clusters every "spawnerLayer"-named tilelayer into connected, same-type groups — see WorldSpawner.ts's own doc. */
    private readonly worldSpawner = new WorldSpawner();

    /** Scatters loose, dynamically-spawned resources (currently just the test "bark") across worldSpawner's own clusters — see DynamicResourceSpawner.ts/DynamicResourceTypes.ts. */
    private readonly dynamicResourceSpawner = new DynamicResourceSpawner(this.world, this.threeScene, this.screenHost, this.worldSpawner, this.worldObjects, undefined, this.worldManager.getZoneVisibilityManager());

    /** Sibling to dynamicResourceSpawner — scatters loose resources inside hand-drawn "spawner" AREA objects (e.g. "animalSpawner1") instead of a painted tile cluster — see ShapeResourceSpawner.ts/ShapeResourceTypes.ts. */
    private readonly shapeResourceSpawner = new ShapeResourceSpawner(this.world, this.threeScene, this.screenHost, this.worldObjects, undefined, this.worldManager.getZoneVisibilityManager());

    /** Every live CraftZone, keyed by craft id — see setupCraftTables()/resetCraftingProgress()'s own doc for why this has to be tracked rather than just re-derived from the map each time. */
    private readonly craftZones = new Map<string, CraftZone>();

    /** Every live QueueZone, keyed by queue id — populated as each one's RequirementRegistry spawn gate fires (see registerQueueSpawnGates()). Not read for gating (the registry owns that); kept for any future lookup that needs a live queue by id. */
    private readonly queueZones = new Map<string, QueueZone>();

    /** Central "spawn once a requirement is met" / "unlock once a requirement is met" system shared by queues, shops, buildings, and gates — see RequirementRegistry.ts's own doc. */
    private readonly requirementRegistry = new RequirementRegistry();

    /** Points a screen-space arrow at whatever the player's current zone's tutorial (see ZoneTutorialTypes.ts) wants them to do next — see ZoneTutorialController.ts's own doc. Driven once per fixedUpdate(), same call-site pattern as worldManager.update(). */
    private readonly zoneTutorialController = new ZoneTutorialController(
        this.world,
        this.screenHost,
        this.worldObjects,
        this.worldManager.getZoneVisibilityManager(),
        () => this.mainPlayer.transform.position,
    );

    /** The fresh-game "move the character" hand animation, zone-0-only — see MovementTutorialOverlay.ts's own doc. Driven once per render-rate update(), same call-site pattern as uiService.update() (a screen-fixed overlay, not tied to the physics step). */
    private readonly movementTutorialOverlay = new MovementTutorialOverlay(
        this.game,
        () => this.mainPlayer.transform.position,
        this.worldManager.getZoneVisibilityManager(),
    );

    /** The player — self-contained (RigidBody, PlayerMovementController, collision events all wired up in its own awake()). See MainPlayer.ts. */
    private readonly mainPlayer: MainPlayer;

    /** Shown while the player character loads, destroyed the instant it resolves — see loadPlayerCharacter(). Tracked as a field too so destroy() can clean it up if the scene is torn down mid-load. */
    private loadingSpinner?: LoadingSpinner;

    /** Owns every screen-anchored HUD panel (backpack, global resources, camera toggle) — see UIService.ts's own doc. Built in build() since it needs game.uiLayer to already exist. */
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
    /** Scratch vector for updateOcclusionTarget() below — reused per fixedUpdate() to avoid an allocation every step. */
    private readonly occlusionTargetScratch = new THREE.Vector3();
    /** Seconds since the last stable-tile check/save — see PLAYER_POSITION_CHECK_INTERVAL_SEC's own doc and fixedUpdate(). */
    private playerPositionCheckAccumSec = 0;

    public constructor(game: Game) {
        super(game);

        // World.add() adopts a purpose-built Entity subclass instance and calls its
        // awake() immediately — by the time this returns, MainPlayer already has its
        // RigidBody/PlayerMovementController and can move/collide, well before its FBX
        // character has (or even starts to) load. `this` is passed as its movement
        // input host (a Pixi container with worldToScreen()) and `this.threeScene` as
        // where its eventual character mesh gets parented.
        this.mainPlayer = this.world.add(new MainPlayer(this, this.threeScene, this.screenHost));

        // Wired here (not as a field initializer, alongside worldManager's own construction
        // above) because it needs this.mainPlayer, which doesn't exist yet at that point — see
        // freezePlayerMovementBriefly()'s own doc for why a zone reveal gets a short freeze
        // instead of the full focusCameraOn() camera trip a gate's own unlock uses.
        this.worldManager.onZoneRevealed.add(() => void this.freezePlayerMovementBriefly(ZONE_UNLOCK_FREEZE_SEC));

        // Prefer the last STABLE tile the player was confirmed standing on (see
        // PlayerPositionStorage.ts's own doc — walkable, no resource on top, saved
        // periodically by fixedUpdate()) over the Tiled map's "playerStart" point (see
        // WorldObjectRegistry.ts's own doc), which in turn beats wherever MainPlayer's own
        // transform otherwise defaults to (world origin). No-op (keeps whichever fallback
        // applies) if neither exists yet — e.g. a brand-new save with no persisted position.
        const savedPosition = PlayerPositionStorage.getPosition();
        const playerStart = this.worldObjects.getPlayerStart();
        if (savedPosition) {
            this.mainPlayer.transform.position.set(savedPosition.x, 0, savedPosition.z);
        } else if (playerStart) {
            this.mainPlayer.transform.position.set(playerStart.x, 0, playerStart.z);
        }

        this.setupAnimalFollowers();

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

        ParticleSystem.init(this.threeScene);

        this.worldManager.buildGround();
        //this.setupTestBox();
        //this.setupDropZone();
        this.setupBuildingZone();
        this.setupGates();
        this.setupMeshLayer();
        // Built before registerQueueSpawnGates() — a queue's reward flies to this UI's wallet
        // icon (see registerQueueSpawnGates()), so the panel has to exist first.
        this.uiService = new UIService(this.game, () => this.toggleCameraMode());
        this.setupDebugButtons();
        this.registerQueueSpawnGates();
        this.registerShopSpawnGates();
        this.setupFarms();
        this.setupTriggers();
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

        // Live-tune the "keep UI off the player" region every 'simple' zone popup dodges (see
        // PlayerUIAvoidanceComponent.ts) and preview exactly what it protects with a translucent
        // circle at the player's own head — turn the toggle on, drag the radius, and every
        // 'simple' popup on screen reacts on its very next frame (both are read live, not
        // snapshotted — see that component's own doc).
        const uiAvoidance = this.mainPlayer.getComponent(PlayerUIAvoidanceComponent);
        if (uiAvoidance) {
            DevGuiManager.instance.addProperties(uiAvoidance, ['radius'], [0, 200], 'Radius', 'UI Avoidance');
            DevGuiManager.instance.addToggle(
                'Show Preview',
                uiAvoidance.showDebugPreview,
                value => { uiAvoidance.showDebugPreview = value; },
                'UI Avoidance',
            );
        }

        // Dumps every hand-authored design config (resources, tools, actions, items,
        // crafting, shops, queues, buildings, gates, dynamic resource placements, asset
        // library) into one JSON file and downloads it — see GameDataBaker.ts's own doc.
        // For design review, not player-facing.
        DevGuiManager.instance.addButton(
            'Bake Game Data',
            () => downloadGameData(),
            'Data',
        );

        this.setupModelSnapshotDevGui();

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
            'Clear Shape Resources',
            () => void this.shapeResourceSpawner.resetAll(),
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Clear Animal Followers',
            () => void AnimalFollowStorage.clearAll(),
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Clear Player Position',
            () => void PlayerPositionStorage.clearAll(),
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Clear Farms',
            () => void FarmPlotStorage.clearAll(),
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Clear Tutorial Progress',
            () => void TutorialProgressStorage.clearAll(),
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Clear Triggers',
            () => void TriggerStorage.clearAll(),
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Add 10 Of Each Resource',
            () => {
                // Skips Pig — see setupDebugButtons()'s own doc on why an animal-caught
                // resource isn't something a plain "add 10" credit should ever hand out.
                for (const type of Object.values(ResourceType)) {
                    if (type === ResourceType.Pig) {
                        continue;
                    }
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
                void this.shapeResourceSpawner.resetAll();
                void AnimalFollowStorage.clearAll();
                void PlayerPositionStorage.clearAll();
                void FarmPlotStorage.clearAll();
                void TutorialProgressStorage.clearAll();
                void TriggerStorage.clearAll();
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
        // land, no manual refresh wiring needed. Matched to the PROVIDER_CONFIG entry whose
        // `action` equals this shop's action, since that's what amountPerGather lives on now
        // (see ProviderTypes.ts — moved off ResourceConfig when providers split out).
        for (const config of Object.values(SHOP_CONFIG_BY_ID)) {
            if (!config) {
                continue;
            }
            const providerConfig = Object.values(PROVIDER_CONFIG).find(p => p.action === config.action);
            if (!providerConfig) {
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
                    return providerConfig.amountPerGather * ACTION_CONFIG[config.action].resourcePerHit;
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

    /**
     * Renders any MODELS registry entry from directly overhead and downloads it as a
     * name-encoded PNG (see ModelSnapshotTool.ts's own doc) — the level-design workflow this
     * exists for: drop the PNG as a placeholder object on a Tiled object layer, position/rotate
     * it there by eye, and a future lazy loader reads that layer back, decodes the filename to
     * a model ref, and spawns the real 3D model in its place. "Snapshot Random Model" is the
     * quick way to pull a handful of real test images without generating the whole registry.
     */
    private setupModelSnapshotDevGui(): void {
        const modelRefs = ModelSnapshotTool.listModelRefs();
        if (modelRefs.length > 0) {
            ModelSnapshotTool.settings.selectedModelRef = modelRefs[0];
        }
        const groups = ModelSnapshotTool.listGroups();
        if (groups.length > 0) {
            ModelSnapshotTool.settings.selectedGroup = groups[0];
        }

        DevGuiManager.instance.addProperties(ModelSnapshotTool.settings, ['pixelsPerWorldUnit'], [1, 64], 'Pixels Per World Unit', 'Model Snapshots');

        // Off (default) -> every snapshot renders exactly the same straight-down shot this tool
        // always took. On -> portraitDistance/portraitPitchDeg/portraitYawDeg below frame an
        // angled shot instead — same distance/pitch/yaw convention the live gameplay camera
        // (CAMERA_SETTINGS above) uses, just orbiting the model's own center.
        DevGuiManager.instance.addToggle('portraitMode', ModelSnapshotTool.settings.portraitMode, (value) => {
            ModelSnapshotTool.settings.portraitMode = value;
        }, 'Model Snapshots');
        DevGuiManager.instance.addProperties(ModelSnapshotTool.settings, ['portraitDistance'], [1, 30], 'Portrait Distance', 'Model Snapshots');
        DevGuiManager.instance.addProperties(ModelSnapshotTool.settings, ['portraitPitchDeg'], [-89, 89], 'Portrait Pitch', 'Model Snapshots');
        DevGuiManager.instance.addProperties(ModelSnapshotTool.settings, ['portraitYawDeg'], [-180, 180], 'Portrait Yaw', 'Model Snapshots');

        DevGuiManager.instance.addDropdown(
            ModelSnapshotTool.settings,
            'selectedModelRef',
            modelRefs,
            () => { /* value already written straight into settings.selectedModelRef */ },
            'Model To Test',
            'Model Snapshots',
        );

        DevGuiManager.instance.addButton('Snapshot Selected Model', () => {
            void ModelSnapshotTool.snapshotOne(ModelSnapshotTool.settings.selectedModelRef);
        }, 'Model Snapshots');

        DevGuiManager.instance.addButton('Snapshot Random Model', () => {
            void ModelSnapshotTool.snapshotRandom();
        }, 'Model Snapshots');

        DevGuiManager.instance.addButton('Snapshot All Models', () => {
            void ModelSnapshotTool.snapshotAll();
        }, 'Model Snapshots');

        DevGuiManager.instance.addDropdown(
            ModelSnapshotTool.settings,
            'selectedGroup',
            groups,
            () => { /* value already written straight into settings.selectedGroup */ },
            'Group To Snapshot',
            'Model Snapshots',
        );

        DevGuiManager.instance.addButton('Snapshot Group', () => {
            void ModelSnapshotTool.snapshotGroup(ModelSnapshotTool.settings.selectedGroup);
        }, 'Model Snapshots');
    }

    /**
     * Reconstructs whatever the player already owns from a PREVIOUS session —
     * AnimalFollowStorage only ever persists WHICH AnimalTypes are following (see that file's
     * own doc), never a live entity, so on every fresh scene build this is what turns that
     * plain list back into real, moving AnimalNode instances already in follow mode (skips
     * the wild/catchable phase entirely — see AnimalNode's own `wild` constructor param doc).
     * Called from the constructor, right after mainPlayer's own position is settled, so
     * followers spawn already near wherever the player actually starts.
     */
    private setupAnimalFollowers(): void {
        AnimalFollowStorage.getFollowers().forEach(animalType => {
            const node = new AnimalNode(animalType, this.mainPlayer.transform.position.clone(), this.screenHost);
            this.world.add(node);
            this.threeScene.add(node.transform);
            node.startFollowing(() => this.mainPlayer.transform.position);
        });
    }

    /**
     * "Clear Data", "Open Next Zone", "Add 100 Money", "Add 10 Of Each Resource" — quick,
     * always-visible in-game buttons (see InGameButtonList.ts's own doc) for testing without
     * opening the Settings popup or the dev GUI overlay every time. "Clear Data" is the exact
     * same reset + reload as the Settings popup's own button (see PlayerDataReset.ts). "Open
     * Next Zone" calls WorldManager.revealNextZone() — a debug-only sequential unlock, one zone
     * per click, independent of any real requirement/trigger system. The last two mirror the
     * dev GUI's own "Add 100 Money"/"Add 10 Of Each Resource" buttons (see setupDebugGui()) —
     * EXCEPT this one skips ResourceType.Pig, unlike that dev-GUI version: Pig is what catching
     * an animal via AnimalCatchController banks (see ResourceTypes.ts's own doc), not something
     * a plain BackpackStorage credit should ever hand out for free — an animal isn't "a simple
     * resource" the way Wood/Stone/Berries/Bark/Pebble/GrassFiber/Crystal/Iron/Rope are.
     */
    private setupDebugButtons(): void {
        InGameButtonList.registerButton('Clear Data', () => clearAllPlayerData());
        InGameButtonList.registerButton('Open Next Zone', () => this.worldManager.revealNextZone());
        InGameButtonList.registerButton('Add 100 Money', () => EconomyStorage.add(CurrencyType.Money, 100));
        InGameButtonList.registerButton('Add 10 Resources', () => {
            for (const type of Object.values(ResourceType)) {
                if (type === ResourceType.Pig) {
                    continue;
                }
                BackpackStorage.add(type, 10);
            }
        });
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
        this.registerZoneVisibility(dropZone.transform, DROP_ZONE_OFFSET.x, DROP_ZONE_OFFSET.z, 1, 1);
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
     *
     * Each building is registered with requirementRegistry as a SPAWN gate (see that file's
     * own doc) keyed off BuildingConfig.appearRequirement — undefined for every building today
     * (Camp is the very first one, nothing gates it), which registerSpawnGate treats as
     * "spawn immediately," so this reads identically to before that field existed.
     */
    private setupBuildingZone(): void {
        const buildingsWithoutDropper: BuildingId[] = [];

        for (const buildingId of Object.values(BuildingId)) {
            // Fallback width/depth match BuildingTypes.ts's own baseMesh footprint (1x1) —
            // only used if this building isn't found on the Tiled map's "mapSettings" layer
            // at all (see WorldObjectRegistry.require()'s warning).
            const placement = this.worldObjects.require('building', buildingId, { x: BUILDING_ZONE_OFFSET.x, z: BUILDING_ZONE_OFFSET.z, width: 1, depth: 1, rotationDeg: 0 });
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

            this.requirementRegistry.registerSpawnGate(buildingId, BUILDING_CONFIG[buildingId].appearRequirement, () => {
                const buildingZone = this.world.add(new BuildingZone(
                    position, this.screenHost, buildingId, this, this,
                    { width: placement.width, depth: placement.depth },
                    triggerArea,
                ));
                this.threeScene.add(buildingZone.transform);
                this.registerZoneVisibility(buildingZone.transform, position.x, position.z, placement.width, placement.depth);
            });
        }

        if (buildingsWithoutDropper.length > 0) {
            console.warn(`[PizzaScene] no dropper found for building(s): ${buildingsWithoutDropper.join(', ')} — each is using its own footprint as its deposit trigger instead`);
        }
    }

    /**
     * Spawns every gate not already unlocked from a previous session (see GateStorage.ts) and
     * registers it with requirementRegistry as an UNLOCK gate (see that file's own doc). Also
     * catches up any gate whose requirement is ALREADY met the moment it spawns (e.g. the
     * building it depends on was leveled up in a session before this gate existed, or before
     * the player ever walked near it) — that case unlocks silently, with no camera trip, since
     * there's no live "event" to dramatize; it's just this session's world catching up to
     * state that was already true. Only a gate that DIDN'T catch up gets registered — see
     * RequirementRegistry.registerUnlockGate()'s own doc for why it relies on that.
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
                rotationDeg: 0,
            });
            // The marker object's OWN rotation (drawn in Tiled — e.g. rotating a placed gate
            // marker 90° to fit a different opening) — same clockwise-degrees-to-THREE-degrees
            // sign flip MeshLayerSpawner.ts's own rotationY doc explains, added on TOP of
            // whatever manual viewRotationOffsetDeg is already set (see GateConfig's own doc),
            // rather than replacing it: the marker's own facing and a hand-tuned correction for
            // the shared view's own "forward" are two independent reasons to rotate, and both
            // should apply together.
            //
            // The COLLIDER can't actually rotate along with the visual — this physics module
            // is AABB-only, "no rotation" at all (see PhysicsConstants.ts's own doc) — so
            // instead of leaving it at the marker's un-rotated width/depth (visibly wrong the
            // moment the marker isn't a multiple of 180°, and swapped for 90°/270°), size it as
            // the smallest AXIS-ALIGNED box that still fully CONTAINS the rotated footprint —
            // the standard "rotated rect -> AABB" formula. Exact for a 0°/90°/180°/270° marker
            // (matches the true rotated footprint exactly); conservatively larger than the true
            // footprint at any other angle, which is the safe direction to be wrong in for a
            // solid obstacle (a slightly bigger box blocks a bit more space, never lets the
            // player clip through a corner the visual actually covers).
            const gateRotationRad = (placement.rotationDeg * Math.PI) / 180;
            const absCos = Math.abs(Math.cos(gateRotationRad));
            const absSin = Math.abs(Math.sin(gateRotationRad));
            const colliderWidth = placement.width * absCos + placement.depth * absSin;
            const colliderDepth = placement.width * absSin + placement.depth * absCos;

            const gate = this.world.add(new Gate(this.screenHost, id, {
                ...config,
                position: [placement.x, config.position[1], placement.z],
                mesh: { ...config.mesh, size: [colliderWidth, config.mesh.size[1], colliderDepth] },
                viewRotationOffsetDeg: (config.viewRotationOffsetDeg ?? 0) - placement.rotationDeg,
            }));
            this.threeScene.add(gate.transform);
            this.registerZoneVisibility(gate.transform, placement.x, placement.z, colliderWidth, colliderDepth);

            if (gate.isRequirementMet()) {
                GateStorage.unlock(id);
                this.world.remove(gate);
                continue;
            }

            // A 'resource' requirement is NOT a passive "already holding enough" check (see
            // Gate.isRequirementMet()'s own doc) — it needs an actual GateDropZone the player
            // walks up to and feeds, so it's deliberately kept OUT of RequirementRegistry's
            // usual recheck-on-milestone flow (which would otherwise "unlock" it the instant
            // the player happens to be carrying enough, exactly the passive behavior this is
            // meant to avoid). The drop zone calls the SAME unlock sequence itself, once its
            // own target amount is actually reached.
            if (config.requirement.type === 'resource') {
                const dropperPlacement = this.worldObjects.getDropperFor(id) ?? placement;
                const dropZone = this.world.add(new GateDropZone(
                    id,
                    config.requirement.resourceType,
                    config.requirement.amount,
                    new THREE.Vector3(dropperPlacement.x, 0, dropperPlacement.z),
                    this.screenHost,
                    { width: dropperPlacement.width, depth: dropperPlacement.depth },
                    gate.transform.position.clone().add(new THREE.Vector3(0, config.mesh.size[1] / 2, 0)),
                    () => {
                        void gate.playUnlockSequence(this).then(() => {
                            this.world.remove(gate);
                        });
                        this.world.remove(dropZone);
                    },
                ));
                this.threeScene.add(dropZone.transform);
                this.registerZoneVisibility(dropZone.transform, dropperPlacement.x, dropperPlacement.z, dropperPlacement.width, dropperPlacement.depth);
                continue;
            }

            this.requirementRegistry.registerUnlockGate(id, config.requirement, async () => {
                await gate.playUnlockSequence(this);
                this.world.remove(gate);
            });
        }
    }

    /**
     * Every placeholder drawn on the Tiled map's "meshes" object layer (see
     * MeshLayerSpawner.ts's own doc) — a level designer drags a ModelSnapshotTool PNG there,
     * this spawns the REAL 3D model at that decoded position/rotation instead, RESCALED
     * per-axis to match the placed object's own CURRENT width/depth rather than assuming
     * native scale — see MeshPlacement.worldWidth/worldDepth's own doc for why a resize done in
     * Tiled has to actually reach the model, not just its own placeholder image. Deliberately
     * NOT a single uniform scalar (averaging X/Z into one number, the first version of this
     * method did): if a designer stretched the placeholder non-uniformly (wider than it is
     * deep, say), the model needs to actually stretch the same way, not just grow/shrink
     * proportionally while keeping its original aspect ratio.
     *
     * Passes rotationY=0 into GlbVisualComponent and applies the real rotation manually AFTER
     * measuring the loaded mesh's bounding box — measuring it pre-rotation is what keeps
     * size.x/size.z reading the model's own un-rotated width/depth, matching the axes Tiled's
     * width/height are drawn in; measuring AFTER rotation would give a rotated (skewed)
     * footprint for anything not rotated by a multiple of 90°.
     *
     * `placement.solid` (the object's own "solid" custom property — see MeshLayerSpawner.ts's
     * own doc) adds a static, non-trigger RigidBody sized to the object's SCALED footprint
     * (worldWidth/worldDepth in X/Z, the model's own measured height in Y) once the model
     * finishes loading — a purely decorative mesh (the default, `solid` unchecked) gets no
     * collider at all, same as before this property existed.
     *
     * `placement.offsetX/Y/Z` (the model's own "offsetX"/"offsetY"/"offsetZ" custom
     * properties — see MeshLayerSpawner.ts's own doc) nudge the mesh's LOCAL position, e.g. a
     * bridge model needing `offsetY: 1` to actually rest on the ground instead of half-buried
     * in it. Applied to the solid RigidBody's own centerOffset too, so the collider follows
     * wherever the visual actually ends up rather than staying at the entity's un-offset origin.
     */
    private setupMeshLayer(): void {
        for (const placement of getMeshPlacements()) {
            const modelDef = ModelSnapshotTool.resolveModelDef(placement.modelRef);
            if (!modelDef) {
                // Already warned by getMeshPlacements() itself if this ever happens — this
                // check is just to satisfy TypeScript, not a second failure mode.
                continue;
            }

            const entity = this.world.spawn();
            entity.transform.position.set(placement.x, 0, placement.z);

            const meshOffset = new THREE.Vector3(placement.offsetX, placement.offsetY, placement.offsetZ);
            const visual: GlbVisualComponent = new GlbVisualComponent(modelDef, meshOffset, 1, 0, () => {
                const mesh = visual.mesh;
                const nativeSize = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
                const scaleX = nativeSize.x > 1e-4 ? placement.worldWidth / nativeSize.x : 1;
                const scaleZ = nativeSize.z > 1e-4 ? placement.worldDepth / nativeSize.z : 1;
                // No Tiled-side signal for vertical scale (a top-down placement has no height
                // to resize) — splitting the difference between the two horizontal axes is the
                // least-arbitrary stand-in, same as this method's own averaging used to do for
                // every axis before this fix.
                const scaleY = (scaleX + scaleZ) / 2;
                mesh.scale.set(scaleX, scaleY, scaleZ);
                mesh.rotation.y = placement.rotationY;

                if (placement.solid) {
                    const halfExtents = new THREE.Vector3(
                        placement.worldWidth / 2,
                        Math.max(nativeSize.y * scaleY, 0.1) / 2,
                        placement.worldDepth / 2,
                    );
                    entity.addComponent(new RigidBody({
                        halfExtents,
                        isStatic: true,
                        layer: Layers.Environment,
                        // Follows the SAME offsetX/Y/Z the visual mesh got (see meshOffset
                        // above) — a collider that stayed at the entity's own origin while the
                        // mesh moved (e.g. a bridge's offsetY raising it up) would leave the
                        // collider floating at the wrong height relative to what's drawn.
                        centerOffset: new THREE.Vector3(placement.offsetX, placement.offsetY + halfExtents.y, placement.offsetZ),
                    }));
                }
            });
            entity.addComponent(visual);
            this.threeScene.add(entity.transform);
            this.registerZoneVisibility(entity.transform, placement.x, placement.z, placement.worldWidth, placement.worldDepth);
        }
    }

    /**
     * Registers one SPAWN gate (see RequirementRegistry.ts's own doc) per "queue" object found
     * on the Tiled map's "mapSettings" layer, keyed off QueueConfig.appearRequirement (see
     * QueueTypes.ts's own doc) — see WorldObjectRegistry.getAllOfType()'s own doc for why this
     * is auto-discovery rather than a fixed id list like setupBuildingZone()/setupGates() use:
     * a queue's id comes straight from whatever's drawn on the map, so a level designer can add
     * "queue7" and have it fully work with zero code changes here. Called once — a queue with
     * no appearRequirement spawns immediately (registerSpawnGate's own behavior for an
     * undefined requirement); one WITH a requirement spawns whenever requirementRegistry next
     * rechecks it (see PizzaScene.notifyBuildingLevelUp()/notifyItemCrafted()).
     */
    private registerQueueSpawnGates(): void {
        for (const [id, placement] of this.worldObjects.getAllOfType('queue')) {
            const config = getQueueConfig(id);

            this.requirementRegistry.registerSpawnGate(id, config.appearRequirement, () => {
                const position = new THREE.Vector3(placement.x, 0, placement.z);

                // A quest giver needs BOTH its own config AND at least two waypoints (a path
                // needs a start and an end) — see QuestGiverEntity.ts's own doc. When both are
                // present, this queue's pacing is handed over entirely to the giver's own walk
                // cycle (QueueZone's `autoRollTasks = false` — see that field's own doc).
                const questGiverConfig = getQuestGiverConfig(id);
                const waypoints = this.worldObjects.getWaypoints(id);
                const hasGiverPath = questGiverConfig !== undefined && waypoints.length >= 2;

                const queueZone = this.world.add(new QueueZone(
                    position, this.screenHost, id,
                    () => this.uiService.economyUi.getIconAnchorPosition(CurrencyType.Money),
                    { width: placement.width, depth: placement.depth },
                    config,
                    !hasGiverPath,
                ));
                this.threeScene.add(queueZone.transform);
                this.queueZones.set(id, queueZone);
                this.registerZoneVisibility(queueZone.transform, position.x, position.z, placement.width, placement.depth);

                if (hasGiverPath) {
                    const questGiver = this.world.add(new QuestGiverEntity(id, waypoints, questGiverConfig!));
                    this.threeScene.add(questGiver.transform);
                    this.registerZoneVisibility(questGiver.transform, position.x, position.z, placement.width, placement.depth);
                }
            });
        }
    }

    /**
     * Registers one SPAWN gate (see RequirementRegistry.ts's own doc) per "farm" object found on
     * the Tiled map's "mapSettings" layer, keyed off FarmPlotConfig.appearRequirement — same
     * auto-discovery-plus-spawn-gate shape as registerQueueSpawnGates(), since a plot's id
     * likewise comes straight from whatever's drawn on the map. Unlike shops/crafting, an id
     * with no FARM_PLOT_CONFIG_BY_ID override is never skipped — getFarmPlotConfig() already
     * falls back to DEFAULT_FARM_PLOT_CONFIG (see FarmTypes.ts's own doc), same "always has a
     * sensible default" reasoning queues use.
     *
     * A plot already owned (FarmPlotStorage.isOwned(), from a previous session) skips FarmZone
     * entirely and spawns straight into its real per-tile FarmPlotTile grid via
     * spawnFarmGrid() — see that method's own doc. Everything else spawns the "for sale"
     * FarmZone (whole-area trigger + price popup — see that file's own doc), which itself calls
     * spawnFarmGrid() the instant it's bought.
     */
    private setupFarms(): void {
        for (const [id, placement] of this.worldObjects.getAllOfType('farm')) {
            const config = getFarmPlotConfig(id);

            this.requirementRegistry.registerSpawnGate(id, config.appearRequirement, () => {
                if (FarmPlotStorage.isOwned(id)) {
                    this.spawnFarmGrid(id, placement);
                    return;
                }

                const position = new THREE.Vector3(placement.x, 0, placement.z);
                const farmZone = this.world.add(new FarmZone(
                    position, this.screenHost, id,
                    () => this.uiService.economyUi.getIconAnchorPosition(config.price.currency),
                    { width: placement.width, depth: placement.depth },
                    config,
                    () => this.spawnFarmGrid(id, placement),
                ));
                this.threeScene.add(farmZone.transform);
                this.registerZoneVisibility(farmZone.transform, position.x, position.z, placement.width, placement.depth);
            });
        }
    }

    /**
     * One Trigger entity per placed "trigger" mapSettings object (see TriggerTypes.ts's own
     * doc) — a config-less placement (no getTriggerConfig(id) entry yet, e.g. a level designer
     * drew the volume on the map before opening the Triggers tab) just defaults to
     * destroyOnTrigger: false rather than being skipped; a trigger has nothing to misconfigure
     * beyond that one flag now that it carries no effect of its own.
     *
     * onActivated is exactly TriggerStorage.activate() (see that file's own doc for why a
     * Trigger entity never touches any storage or effect itself) plus a requirementRegistry
     * recheck — the same "storage changed, now recheck every gate" pairing
     * notifyBuildingLevelUp()/notifyItemCrafted() below already use for their own milestone
     * kinds, needed here so a Gate whose requirement is `{type: 'trigger', ...}` actually
     * unlocks the instant this fires rather than waiting for some unrelated event to trigger a
     * recheck. A zone's own 'trigger' requirement needs no such nudge — WorldManager already
     * polls ZONE_CONFIG every frame regardless.
     */
    private setupTriggers(): void {
        for (const [id, placement] of this.worldObjects.getAllOfType('trigger')) {
            const destroyOnTrigger = getTriggerConfig(id)?.destroyOnTrigger ?? false;

            const position = new THREE.Vector3(placement.x, 0, placement.z);
            const trigger = this.world.add(new Trigger(
                position,
                { width: placement.width, depth: placement.depth },
                destroyOnTrigger,
                () => {
                    TriggerStorage.activate(id);
                    void this.requirementRegistry.recheckAll();
                },
            ));
            this.threeScene.add(trigger.transform);
            this.registerZoneVisibility(trigger.transform, position.x, position.z, placement.width, placement.depth);
        }
    }

    /**
     * Spawns one FarmPlotTile per FarmGrid.computeFarmGrid() cell within `placement`'s own
     * footprint — the OWNED state of a farm plot (see FarmGrid.ts's own doc for why this is a
     * grid of individually-collidered cells, not one giant patch). Called either straight from
     * setupFarms() for a plot already owned at boot, or from a FarmZone's own onPurchased
     * callback the instant it's bought — either way this is the ONLY place FarmPlotTile gets
     * spawned, so the two paths can never disagree on layout.
     */
    private spawnFarmGrid(id: string, placement: WorldObjectPlacement): void {
        const cells = computeFarmGrid(placement.width, placement.depth);
        cells.forEach((cell, index) => {
            const position = new THREE.Vector3(placement.x + cell.localX, 0, placement.z + cell.localZ);
            // Staggered by grid index (row-major, see FarmGrid.computeFarmGrid()) — each cell's
            // own pop-in tween (see FarmPlotTile.ts's own doc) starts a beat after the last, so
            // buying a plot ripples its whole grid into existence instead of every tile
            // snapping in on the same frame.
            const tile = this.world.add(new FarmPlotTile(position, id, cell.col, cell.row, index * FARM_GRID_APPEAR_STAGGER_SEC));
            this.threeScene.add(tile.transform);
            this.registerZoneVisibility(tile.transform, position.x, position.z, FARM_GRID_CELL_SIZE, FARM_GRID_CELL_SIZE);
        });
    }

    /**
     * Registers one SPAWN gate per "shop" object found on the Tiled map's "mapSettings" layer
     * whose id has a matching ShopConfig (see ShopTypes.SHOP_CONFIG_BY_ID) — auto-discovery
     * like registerQueueSpawnGates(), since a shop's id is likewise whatever's drawn on the
     * map, EXCEPT a shop with no config entry is skipped (with a warning) rather than falling
     * back to some default, since a shop has no sensible default (see ShopTypes.ts's own doc —
     * it has to know which tool it upgrades). Keyed off ShopConfig.appearRequirement, same
     * "spawns immediately if unset" behavior as every other spawn gate.
     *
     * Same dropper-or-own-footprint trigger resolution as setupBuildingZone(): a Tiled
     * "dropper" object targeting this shop's id (see WorldObjectRegistry.ts) stands in for the
     * shop's own footprint as the deposit trigger when the level designer has placed one — e.g.
     * a shop stall drawn against a wall the player can't walk into, with its real drop-off spot
     * placed elsewhere. Falls back to the shop's own footprint when no dropper exists.
     */
    private registerShopSpawnGates(): void {
        for (const [id, placement] of this.worldObjects.getAllOfType('shop')) {
            const config = getShopConfig(id);
            if (!config) {
                console.warn(`[PizzaScene] shop "${id}" found on the Tiled map but has no ShopConfig entry — skipping`);
                continue;
            }

            this.requirementRegistry.registerSpawnGate(id, config.appearRequirement, () => {
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
                    () => this.uiService.economyUi.getIconAnchorPosition(CurrencyType.Money),
                    { width: placement.width, depth: placement.depth },
                    triggerArea,
                ));
                this.threeScene.add(shopZone.transform);
                this.registerZoneVisibility(shopZone.transform, position.x, position.z, placement.width, placement.depth);
            });
        }
    }

    /**
     * Spawns one CraftZone per "craft" object found on the Tiled map's "mapSettings" layer
     * whose id has a matching CraftTableConfig (see CraftTypes.CRAFT_CONFIG_BY_ID) —
     * auto-discovery like registerShopSpawnGates(), since a craft table's id is likewise whatever's drawn
     * on the map, EXCEPT a craft id with no config entry is skipped (with a warning) rather
     * than falling back to some default — a craft table has no sensible default, same
     * reasoning as ShopTypes.ts's own doc (it has to know what it can actually craft).
     *
     * Same dropper-or-own-footprint trigger resolution as registerShopSpawnGates()/setupBuildingZone(): a
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
            // Checked inline, not via RequirementRegistry — see CraftTableConfig.
            // appearRequirement's own doc for why a craft table's destroy-and-respawn
            // lifecycle doesn't fit that registry's "fires once, forever" spawn-gate role.
            if (config.appearRequirement && !isMilestoneRequirementMet(config.appearRequirement)) {
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
            this.registerZoneVisibility(craftZone.transform, position.x, position.z, placement.width, placement.depth);
        }
    }

    /**
     * Registers `transform` with WorldManager's ZoneVisibilityManager (solution 2 — see
     * FogOfWarConfig.ts) so its visibility tracks whichever zone(s) its footprint overlaps —
     * a one-line no-op under FogOfWarStyle.BoxCloud (getZoneVisibilityManager() returns
     * undefined there; solution 1's opaque boxes handle hiding instead). Every building/gate/
     * drop-zone/queue/quest-giver/shop/craft-table spawn site calls this right after adding
     * its own transform to threeScene, mirroring how WorldManager registers its own ground
     * meshes/resource nodes.
     */
    private registerZoneVisibility(transform: THREE.Object3D, worldX: number, worldZ: number, width: number, depth: number): void {
        // `props` category delay — see ZONE_REVEAL_CONFIG.categoryDelaySec's own doc — so a
        // building/gate/queue/shop/craft-table/mesh-prop rises AFTER the terrain it sits on
        // when echoing a fresh zone reveal (see ZoneVisibilityManager.addRegistrant()'s own
        // doc), same tier every other non-terrain, non-creature object uses.
        this.worldManager.getZoneVisibilityManager().register(
            transform, worldX, worldZ, width, depth, ZONE_REVEAL_CONFIG.categoryDelaySec.props,
        );
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

        // Occlusion targets roughly torso height, not the feet uBendOrigin above tracks —
        // see OCCLUSION_TARGET_HEIGHT_OFFSET's own doc.
        BendService.updateOcclusionTarget(
            this.occlusionTargetScratch.copy(playerPosition).setY(playerPosition.y + OCCLUSION_TARGET_HEIGHT_OFFSET),
        );

        // Streams resource nodes in/out around the player and keeps off-screen respawn
        // timers ticking — see WorldManager.update()'s own doc.
        this.worldManager.update(playerPosition, delta);
        // Independent of the above — see DynamicResourceSpawner.ts's own doc.
        this.dynamicResourceSpawner.update(playerPosition, delta);
        this.shapeResourceSpawner.update(playerPosition, delta);
        // Independent of the above too — see ZoneTutorialController.ts's own doc.
        this.zoneTutorialController.update();

        this.updateStablePlayerPosition(delta, playerPosition);

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

        // Feeds BendService.applyOcclusionFade()'s camera->player cutout — same clock as the
        // camera move itself above, so there's no lag between where the camera actually is
        // and what the occlusion shader thinks it is.
        BendService.updateCameraPosition(this.threeCamera.position);
    }

    /**
     * Every PLAYER_POSITION_CHECK_INTERVAL_SEC, if the player's CURRENT position is a stable
     * tile — walkable (TileWalkability.isWalkable()), no not-yet-depleted resource sitting on
     * top of it (WorldManager.hasResourceAt()), AND the player isn't currently overlapping any
     * OTHER collider at all — solid or trigger (PhysicsWorld.isOverlappingAny()): a gate/wall
     * would leave the player stuck, and a queue/shop/building/craft zone's own trigger would
     * just re-fire that zone's enter logic the instant they respawn — persists it as the
     * new respawn point (see PlayerPositionStorage.ts's own doc). A position that fails any of
     * these checks this tick is simply skipped (not an error) — the LAST successfully-saved
     * position just keeps standing until the player is next confirmed somewhere stable, which
     * is exactly what makes this safe to check on a plain timer rather than only at some more
     * "meaningful" moment.
     */
    private updateStablePlayerPosition(delta: number, playerPosition: THREE.Vector3): void {
        this.playerPositionCheckAccumSec += delta;
        if (this.playerPositionCheckAccumSec < PLAYER_POSITION_CHECK_INTERVAL_SEC) {
            return;
        }
        this.playerPositionCheckAccumSec = 0;

        if (!isWalkable(playerPosition.x, playerPosition.z)) {
            return;
        }
        if (this.worldManager.hasResourceAt(playerPosition.x, playerPosition.z, PLAYER_STABLE_TILE_RESOURCE_RADIUS)) {
            return;
        }
        if (this.world.physics.isOverlappingAny(this.mainPlayer.rigidBody)) {
            return;
        }

        PlayerPositionStorage.save(playerPosition.x, playerPosition.z);
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

        // Movement is disabled BEFORE the pre-delay (not just before the travel) — see
        // CameraFocusOptions.preDelaySec's own doc: the whole point is a beat where the
        // player can already tell something happened (they can't move) but the camera hasn't
        // cut away yet, not just a delayed camera cut while they're still free to walk off.
        this.freezePlayerMovement();

        if (options.preDelaySec) {
            await wait(options.preDelaySec);
        }

        this.cameraFocusPoint = target.clone();
        await wait(travelSec);
        await wait(holdSec);
        // Clearing this is the ENTIRE "return" instruction — fixedUpdate() falls back to
        // playerPosition next step and the same lerp eases back toward wherever the player
        // actually is by then, not wherever they were when the event started.
        this.cameraFocusPoint = null;
        await wait(returnSec);

        this.unfreezePlayerMovement();
    }

    /**
     * Reference-counted (not a plain boolean) since a gate's own focusCameraOn() trip and a
     * zone-reveal freeze (see the worldManager.onZoneRevealed subscription in this scene's
     * constructor) can legitimately overlap — an unlock gate's requirement being met is exactly
     * what a zone reveal is often gated on (MilestoneRequirement.ts's own 'gate' kind), so both
     * can fire back-to-back. A plain boolean would let whichever one's timer finishes FIRST
     * re-enable movement out from under the other still-in-progress freeze; counting how many
     * freezes are currently active only lets go once the LAST one clears.
     */
    private movementFreezeCount = 0;

    private freezePlayerMovement(): void {
        this.movementFreezeCount++;
        this.mainPlayer.movementController.enabled = false;
    }

    private unfreezePlayerMovement(): void {
        this.movementFreezeCount = Math.max(0, this.movementFreezeCount - 1);
        if (this.movementFreezeCount === 0) {
            this.mainPlayer.movementController.enabled = true;
        }
    }

    /** ZONE_UNLOCK_FREEZE_SEC's own timed freeze — see the worldManager.onZoneRevealed subscription in this scene's constructor for why a zone reveal gets this instead of a full focusCameraOn() trip (no camera move, just a beat to let the shockwave/rise animation read before the player can walk off mid-reveal). */
    private async freezePlayerMovementBriefly(durationSec: number): Promise<void> {
        this.freezePlayerMovement();
        await wait(durationSec);
        this.unfreezePlayerMovement();
    }

    /**
     * WorldProgressionHost implementation — see that file's own doc for why this is the one
     * place that rechecks every requirement-gated entity (queues, shops, buildings, gates —
     * see RequirementRegistry.ts's own doc), rather than each one listening to
     * BuildingStorage.onLevelUp directly. `buildingId`/`level` themselves aren't even read —
     * recheckAll() doesn't filter by which milestone fired, it just re-tries everything still
     * pending; cheap enough that not filtering is simpler than trying to.
     */
    public async notifyBuildingLevelUp(_buildingId: BuildingId, _level: number): Promise<void> {
        await this.requirementRegistry.recheckAll();
        this.setupCraftTables();
    }

    /** WorldProgressionHost implementation — see that file's own doc. Same reasoning as notifyBuildingLevelUp(), just triggered by a crafted item (see CraftZone.ts) instead of a building level-up. */
    public async notifyItemCrafted(_item: ItemType): Promise<void> {
        await this.requirementRegistry.recheckAll();
        this.setupCraftTables();
    }

    public override update(delta: number): void {
        // Runs every entity's update() — for the player, that's PlayerMovementController's own
        // pointer-follow tracking plus CharacterVisualComponent syncing position/animation from
        // whatever fixedUpdate's physics step last resolved (once the FBX character has loaded
        // and that component exists at all — harmless no-op until then).
        this.world.update(delta);
        this.uiService.update();
        this.movementTutorialOverlay.update(delta);
        ParticleSystem.update(delta);

        super.update(delta);
    }

    public override destroy(): void {
        // Tears down every component on mainPlayer, including PlayerMovementController's own
        // input listeners and (if it ever loaded) the FBX character itself — see MainPlayer.destroy().
        this.world.remove(this.mainPlayer);
        this.worldManager.destroy();
        this.dynamicResourceSpawner.destroy();
        this.shapeResourceSpawner.destroy();
        this.zoneTutorialController.destroy();
        this.movementTutorialOverlay.destroy();
        this.loadingSpinner?.destroy();
        this.uiService.destroy();
        super.destroy();
    }
}
