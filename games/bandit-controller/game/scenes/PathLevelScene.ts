import { DebugOverlay } from 'core/debug/DebugOverlay';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import { BendService } from 'core/services/BendService';
import gsap from 'gsap';
import { ParticleSystem as PizzaParticleSystem } from '../../../pizza/game/vfx/ParticleSystem';
import { buildBlueSkyTexture } from '../builders/SkyBuilder';
import { Signal } from 'signals';
import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { pruneCollected } from '../builders/CollectibleBuilder';
import Collectible from '../entities/Collectible';
import Guard from '../entities/Guard';
import SecurityCamera from '../entities/SecurityCamera';
import Trap from '../entities/Trap';
import Drone from '../entities/Drone';
import { LevelSight } from '../utils/LevelSight';
import { NavGrid } from '../utils/NavGrid';
import { GameAudio } from '../audio/GameAudio';
import { GameAnalytics } from '../analytics/GameAnalytics';
import { COIN, CollectibleDefinition } from '../data/CollectibleSettings';
import { LevelCatalog } from '../data/LevelCatalog';
import { UiKit } from '../ui/UiKit';
import { cornerButton } from '../ui/UiParts';
import { UiAnim, UiTween } from '../ui/UiAnim';
import { TextureBuilder } from '../builders/TextureBuilder';
import { CHARACTER_VIEWS, DEFAULT_CHARACTER_VIEW, resolveSkinImagePath } from '../data/CharacterViews';
import type MainPlayer from '../player/MainPlayer';
import { WorldStyles } from '../data/WorldStyles';
import { LevelData, LevelLoot, LevelSharedGoal, LevelVault, insideVault, levelWindowPanes, shouldShowWaypointMarker, vaultSafe } from '../data/LevelData';
import { GameState } from '../data/GameState';
import { Progress } from '../data/Progress';
import { PLAYER_SETTINGS } from '../data/PlayerSettings';
import Entity from 'core/ecs/Entity';
import RigidBody from 'core/physics/RigidBody';
import { Layers } from 'core/physics/PhysicsConstants';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { WorldEnvironment, CameraFollowOptions } from './shared/WorldEnvironment';
import MoneyHud from '../ui/MoneyHud';
import BonusMeter, { BonusOffer } from '../ui/BonusMeter';
import { spawnFlyingIconFromOverlayPoint, spawnFlyingIconToOverlayPoint } from '../ui/FlyingResourceIcon';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { CheckerFloorBuilder } from '../../../pizza/game/builders/CheckerFloorBuilder';
import { PolyWallBuilder } from '../../../pizza/game/builders/PolyWallBuilder';
import { BendService as PizzaBendService } from '../../../pizza/game/services/BendService';
import StoreDoor from '../../../pizza/game/store/StoreDoor';
import { FloorLayers } from '../../../pizza/game/world/FloorLayers';
import type { StoreFloorPlacement, StoreWallPlacement } from '../../../pizza/game/world/WorldObjectRegistry';
import type { DoorStyleConfig, FloorCheckerConfig, WallSetupConfig, WallStyleConfig } from '../../../pizza/game/store/StoreViewTypes';

/** Just past the marker's own radius (GOAL_MARKER_RADIUS), so arriving only counts once the player is actually on the disk. */
const GOAL_TRIGGER_RADIUS = 1.35;
const CHECKPOINT_STOP_RADIUS = 1.2;
const GOAL_MARKER_RADIUS = 1.25;
const GOAL_COLOR = 0x3fd67a;
const SAFE_MODEL = 'heist/vault/vault.gltf';
const VAULT_FLOOR_COLOR = 0xffd34d;
const SHARED_SLOT_SPACING = 1.8;
/** Planning clearance around walls for drawn routes (the body is 0.4 wide each side). */
const ROUTE_CLEARANCE = 0.55;
/** How close a release (or the assisted route's end) must be to the gold checkpoint. */
const GOAL_RELEASE_RADIUS = 1.8;
/** Campaign levels (by catalog order) that show the drag + tap tutorial hand. */
const HAND_HINT_LEVELS = 5;
const GOAL_HAND_SIZE = 76;
const DRAG_HINT_CYCLE_MS = 3200;
const FIELD_SIZE = 48;
const ROOM_ORIGIN = new THREE.Vector3();
const LOWERED_WALL_SCALE = 0.2;
const WALL_LOWER_DURATION_SEC = 0.45;
const CELEBRATION_CAMERA_OPTIONS: CameraFollowOptions = {
    freezeHeightWhileAirborne: true,
    fixedYawDeg: 0,
};
/** Extra world width kept around the player/guard pair in the final busted shot. */
const BUST_FRAME_MARGIN = 5.5;
const SQUAD_FRAME_MARGIN = 8;
const SQUAD_MIN_DISTANCE = 20;
const BUSTED_FACE = 'skins/face-crying-2.webp';
const CAMERA_PANEL_ID = 'bandit-controller.path.camera';
const BENDING_PANEL_ID = 'bandit-controller.path.bending';
const LEVELS_PANEL_ID = 'bandit-controller.path.levels';
const MODEL_BASE = './bandit-controller/models/';
const CELEBRATION_ANIMATION_URL = './bandit-controller/images/non-preload/models/animations/Excited.glb';
/** One dance per squad member, in squad order. */
const SQUAD_DANCE_URLS = [
    './bandit-controller/images/non-preload/models/animations/Dance_Locking.glb',
    './bandit-controller/images/non-preload/models/animations/Dance_Wave.glb',
    './bandit-controller/images/non-preload/models/animations/Dance_Chicken.glb',
];
const PAYOUT_STAGGER_SEC = 0.12;
const CELEBRATION_PITCH_DEG = 28;
/** World units a press must travel before it counts as a drag instead of a tap. */
const TAP_MAX_DRAG = 0.35;
const CELEBRATION_DISTANCE = 13;
/** Dance + "HEIST COMPLETE!" banner before the bonus round. */
const CELEBRATION_DANCE_SEC = 2.2;
const STAR_CUES = ['star1', 'star2', 'star3'] as const;
/** Floor coverings are squashed to this height so the route (y 0.08) and goal markers stay on top. */
const FLAT_PROP_HEIGHT = 0.03;
/** Gap between a bottom-pinned end panel and the screen edge. */
const BOTTOM_PANEL_MARGIN = 28;
const SAD_ANIMATION_URL = './bandit-controller/images/non-preload/models/animations/Crying.glb';
const BUST_CHASE_TIMEOUT_SEC = 6;
/** How close the chasing guard gets to each route corner before heading for the next. */
const BUST_ROUTE_CORNER_REACH = 0.3;
const BUSTED_REACTION_SEC = 2.2;
const CAMERA_BOUNDS_PADDING = 1.5;
const CAMERA_MIN_HALF_WIDTH = 3.5;
const CAMERA_MIN_HALF_DEPTH = 4.5;
/** Characters are ~3.5 units tall: frame their heads too, not just their feet. */
const CAMERA_BOUNDS_HEIGHT = 3.6;
/** Fractions of the screen (in NDC units, 2 = full height) kept clear: the top holds the HUD. */
const CAMERA_SCREEN_PAD_TOP = 0.32;
const CAMERA_SCREEN_PAD_BOTTOM = 0.1;
const CAMERA_SCREEN_PAD_SIDE = 0.08;
const CAMERA_TRANSITION_SEC = 1.3;
/** Upper bound for the framing search; well inside the camera far plane (1000). */
const CAMERA_MAX_DISTANCE = 600;
/** Bend strengths stashed while the bend is off; module-level so it survives scene restarts. */
const savedBend = new Map<unknown, number>();
interface CameraPreset { label: string; pitchDeg: number; yawDeg: number; fov: number; bend: boolean }
const CAMERA_PRESETS: CameraPreset[] = [
    { label: 'Back iso', pitchDeg: 60, yawDeg: 0, fov: 22, bend: false },
    { label: 'Bent', pitchDeg: 65, yawDeg: 0, fov: 0, bend: true },
    { label: 'Flat', pitchDeg: 65, yawDeg: 0, fov: 0, bend: false },
    { label: 'Top-down', pitchDeg: 85, yawDeg: 0, fov: 0, bend: false },
    { label: 'Iso 45°', pitchDeg: 35, yawDeg: 45, fov: 22, bend: false },
    { label: 'Low angle', pitchDeg: 40, yawDeg: 0, fov: 0, bend: true },
];
/** Wide levels are framed on this half-width only, so portrait screens stay zoomed in on the path. */
// Default fraction of the screen height the view is pushed down.
const SCREEN_VERTICAL_SHIFT = 0.12;
/** Seconds inside a guard's cone before the player is busted, and how fast suspicion cools off once out of sight. */
const SPOT_TIME_SEC = 1.1;
const ALERT_DECAY_PER_SEC = 1.2;

type PathLevelState = 'waiting' | 'following' | 'revealing' | 'celebrating' | 'payout' | 'complete' | 'busted' | 'done';
/** Anything that can spot the player: patrolling guards and fixed security cameras. */
type Spotter = Guard | SecurityCamera | Trap | Drone;

type PathDrawMode = 'exit' | 'free';

/** One controllable character. The scene's own path fields always hold the focused member's data; the others keep theirs here. */
interface SquadMember {
    player: MainPlayer;
    /** Face decal path, for the HUD portrait. */
    face?: string;
    /** Route, start and goal tint; undefined keeps the single-character look. */
    color?: number;
    waypoints: THREE.Vector3[];
    nextWaypointIndex: number;
    start: THREE.Vector3;
    goal: THREE.Vector3;
    route: THREE.Vector3[];
    routeMesh?: THREE.Mesh;
    routeBlocked: boolean;
    state: PathLevelState;
}

export default class PathLevelScene extends ThreeScene {
    public readonly onRestart: Signal = new Signal();
    /** Fired by the top-right home button; index.ts switches to the Home scene. */
    public readonly onHome: Signal = new Signal();
    private homeButton?: PIXI.Container;
    private squadBar?: PIXI.Container;
    private squadBadges: { member: SquadMember; ring: PIXI.Graphics; face: PIXI.Sprite; check: PIXI.Text; root: PIXI.Container }[] = [];
    private mapButton?: PIXI.Container;
    private mapIcon?: PIXI.Sprite;
    /** Whole-level camera, toggled from the HUD. */
    private overview = false;

    private readonly moneyHud: MoneyHud;
    private env!: WorldEnvironment;
    private state: PathLevelState = 'waiting';
    private pathDrawMode: PathDrawMode = 'free';
    private readonly collectibles: Collectible[] = [];
    private readonly collectedPayouts: number[] = [];
    private readonly payoutFlights: ReturnType<typeof spawnFlyingIconToOverlayPoint>[] = [];
    private runMoney = 0;
    private lootCollected = 0;
    private spotted = false;
    private readonly wallMeshes: THREE.Mesh[] = [];
    private readonly wallLintelClearMeshes: THREE.Mesh[] = [];
    private wallsLowered = false;
    /** Walls stay low everywhere; turn off to raise them whenever the player is outside the room. */
    public wallsAlwaysLow = true;
    private readonly wallDoors: StoreDoor[] = [];
    private readonly wallColliders: Entity[] = [];
    private readonly wallBoxes: { x: number; z: number; halfX: number; halfZ: number }[] = [];
    private readonly propColliders: Entity[] = [];
    private readonly dressingAssets: THREE.Object3D[] = [];
    private goalParticleAccumulator = 0;
    private readonly goalParticlePosition = new THREE.Vector3();
    /** Set by buildVault(); the safe gets its own constant gold fountain so the finish reads from anywhere. */
    private safePosition?: THREE.Vector3;
    private safeGlow?: THREE.Mesh;
    private safeParticleAccumulator = 0;
    private safeGlowTime = 0;
    private level!: LevelData;
    private waypoints: THREE.Vector3[] = [];
    private navGrid?: NavGrid;
    private readonly revealGroups = new Map<number, THREE.Group>();
    private readonly occlusionTarget = new THREE.Vector3();
    private readonly activeStart = new THREE.Vector3();
    private readonly activeGoal = new THREE.Vector3();
    private readonly frameBounds = new THREE.Box3();
    private readonly boundsProbe = new THREE.Vector3();
    private readonly shiftProbe = new THREE.Vector3();
    private readonly segmentFocus = new THREE.Vector3();
    private screenShiftFraction = SCREEN_VERTICAL_SHIFT;
    private readonly pathCameraOptions: CameraFollowOptions = {
        freezeHeightWhileAirborne: true,
        fixedYawDeg: 0,
        target: this.segmentFocus,
        // segmentFocus and distance are eased by one tween, so the follow smoothing must not add a second ease on top.
        snapFollowTarget: true,
    };
    private defaultFov = 50;
    private cameraBlendTween?: gsap.core.Tween;
    private readonly cameraTuning = { yawDeg: 0, fov: 0, bend: true };
    private dragHint?: PIXI.Sprite;
    private handHintLevel = false;
    private hintPath: THREE.Vector3[] = [];
    private hintLengths: number[] = [];
    private hintPathKey = '';
    private hintCycleStart = -1;
    private readonly dragHintWorld = new THREE.Vector3();
    private selectionNeedsFraming = false;
    private pointerDragged = false;
    private readonly pointerDownWorld = new THREE.Vector3();
    private selectionHalo?: THREE.Mesh;
    private readonly goalHandWorld = new THREE.Vector3();
    private readonly focusGoal = new THREE.Vector3();
    private goalArrivalTweens: gsap.core.Tween[] = [];
    /** Members walking (not tweening) into their slot inside the shared safe room. */
    private homeWalks: { member: SquadMember; slot: THREE.Vector3 }[] = [];
    /** Members whose character already got its "look into the level" start facing. */
    private readonly startFaced = new Set<SquadMember>();
    private members: SquadMember[] = [];
    private focused?: SquadMember;
    /** True while a non-focused member is being stepped, so camera and HUD side effects are skipped. */
    private inBackground = false;
    private readonly guardTargets = new Map<Spotter, SquadMember>();
    private nextWaypointIndex = 1;
    private revealedUpTo = 0;
    private sharedGoalActive = false;
    private readonly boundsRoomPoint = new THREE.Vector3();
    private groupCelebration = false;
    private floorMeshes: THREE.Mesh[] = [];
    private exteriorGround?: THREE.Mesh;
    private entryPath?: THREE.Mesh;
    private doorWorld?: Parameters<StoreDoor['update']>[1];
    private destroyed = false;
    private stopAtCheckpoints = true;
    private route: THREE.Vector3[] = [];
    private routeMesh?: THREE.Mesh;
    private routeBlocked = false;
    private pointerId: number | null = null;
    private readonly raycaster = new THREE.Raycaster();
    private readonly pointerNdc = new THREE.Vector2();
    private readonly pointerWorld = new THREE.Vector3();
    private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    private hud?: PIXI.Container;
    private instruction?: PIXI.Text;
    private runMoneyLabel?: PIXI.Text;
    private worldLabel?: PIXI.Text;
    private cashPill?: PIXI.Container;
    private cashPillBackground?: PIXI.Graphics;
    private cashPillCoin?: PIXI.Sprite;
    private completeModal?: PIXI.Container;
    private payoutPop?: PIXI.Container;
    private celebrationBanner?: PIXI.Container;
    /** How far below its origin each bottom-pinned panel reaches (see positionBottomPanel()). */
    private readonly panelExtents = new WeakMap<PIXI.Container, number>();
    /** End-of-level / busted popup animations, killed on destroy. */
    private uiTweens: UiTween[] = [];
    private bustedModal?: PIXI.Container;
    private guards: Spotter[] = [];
    private bustGuard?: Spotter;
    private bustPhase: 'chase' | 'react' = 'chase';
    /** Nav-grid corners from the catching guard to the player, so walls never leave it stuck mid-sprint. */
    private bustChaseRoute: { x: number; z: number }[] = [];
    private readonly bustChasePoint = new THREE.Vector3();
    private sadAnimationLoad?: Promise<void>;
    /** Set while an ad break between levels plays, so a second tap can't start another. */
    private adBreakRunning = false;
    private bustTimer = 0;
    private bustFocus = false;
    private readonly bustFocusPoint = new THREE.Vector3();
    private readonly bustCameraOptions: CameraFollowOptions = {
        freezeHeightWhileAirborne: true,
        fixedYawDeg: 0,
        target: this.bustFocusPoint,
    };
    private bustYawTween?: gsap.core.Tween;
    private readonly groupCameraOptions: CameraFollowOptions = {
        freezeHeightWhileAirborne: true,
        fixedYawDeg: 0,
        target: this.bustFocusPoint,
    };
    private spottedMessageShown = false;
    private messageBeforeSpotted = '';
    private bonusMeter?: BonusMeter;

    public constructor(game: Game, moneyHud: MoneyHud) {
        super(game);
        this.moneyHud = moneyHud;
    }

    public get ready(): Promise<void> {
        return this.env.playerReady;
    }

    public build(): void {
        this.destroyed = false;
        this.state = 'waiting';
        this.pathDrawMode = 'free';
        this.safePosition = undefined;
        this.safeGlow = undefined;
        this.safeParticleAccumulator = 0;
        this.wallsLowered = false;
        this.revealedUpTo = 0;
        this.goalArrivalTweens.forEach((tween) => tween.kill());
        this.goalArrivalTweens = [];
        this.homeWalks = [];
        this.startFaced.clear();
        this.members = [];
        this.focused = undefined;
        this.inBackground = false;
        this.guardTargets.clear();
        this.level = LevelCatalog.current();
        GameAnalytics.levelStart(this.level);
        this.route = [];
        this.routeBlocked = false;
        this.runMoney = 0;
        this.lootCollected = 0;
        this.spotted = false;
        this.collectibles.length = 0;
        this.collectedPayouts.length = 0;
        this.env = new WorldEnvironment(this.threeScene, BendService, FIELD_SIZE, 64, 1, undefined, false);
        const squad = this.level.squad?.length
            ? this.level.squad
            : [{ view: '', start: this.level.start, waypoints: this.level.waypoints }];
        const squadMode = Boolean(this.level.squad?.length);
        const shared = this.level.sharedGoal;
        this.groupCelebration = false;
        this.sharedGoalActive = Boolean(shared) && shared!.enabled !== false && squad.length > 1;
        for (const [squadIndex, spec] of squad.entries()) {
            const view = CHARACTER_VIEWS[spec.view] ?? DEFAULT_CHARACTER_VIEW;
            const waypoints = [spec.start, ...spec.waypoints].map((point) => new THREE.Vector3(point.x, 0, point.z));
            if (this.sharedGoalActive && shared) {
                waypoints[waypoints.length - 1] = this.sharedGoalSlot(shared, squadIndex, squad.length);
            }
            const player = this.env.spawnPlayer(this, waypoints[0], undefined, view);
            player.movementController.enabled = false;
            (player as unknown as { opensDoors: boolean }).opensDoors = true;
            this.members.push({
                player,
                face: view.face,
                color: squadMode ? new THREE.Color(view.color).getHex() : undefined,
                waypoints,
                nextWaypointIndex: 1,
                start: waypoints[0].clone(),
                goal: waypoints[1].clone(),
                route: [],
                routeBlocked: false,
                state: 'waiting',
            });
        }
        this.doorWorld = {
            forEachEntity: (visit: (entity: unknown) => void) => this.members.forEach((member) => visit(member.player)),
        } as unknown as Parameters<StoreDoor['update']>[1];
        this.swapTo(this.members[0]);
        this.env.cameraSystem.cutTo('topdown');
        this.frameActiveSegment(true);

        this.buildCourse();
        this.buildNavGrid();
        this.buildGuards();
        this.buildCollectibles(0);
        this.buildHud();
        this.defaultFov = this.threeCamera.fov;
        this.applyCameraPreset(CAMERA_PRESETS[0]);
        this.setupCameraDebug();
        this.addInputListeners();
    }

    private wallSetup!: WallSetupConfig;
    private wallStyle!: WallStyleConfig;
    private doorStyle!: DoorStyleConfig;

    private resolveWorldStyles(): void {
        const wall = WorldStyles.get('wall', this.level.styles?.wall);
        const door = WorldStyles.get('door', this.level.styles?.door);
        const doorModel = door.model?.replace(/\.(glb|gltf)$/i, '');
        const doorFormat = door.model?.toLowerCase().endsWith('.glb') ? 'glb' : 'gltf';
        this.wallSetup = {
            height: wall.height,
            thickness: wall.thickness,
            doorHeight: 4,
            tallDoorHeight: 5.5,
            windowHeight: 1.5,
        };
        this.wallStyle = { bottomColor: wall.bottomColor, topColor: wall.topColor, bottomHeight: wall.bottomHeight };
        this.doorStyle = {
            name: door.name,
            models: doorModel ? [{
                id: doorModel.split('/').pop() as string,
                path: doorModel,
                fullPath: `${this.game.folderPath}/models/${doorModel}.${doorFormat}`,
                format: doorFormat,
                nodes: {},
            }] : [],
            color: door.color,
            opacity: door.opacity,
        };
    }

    private buildCourse(): void {
        this.resolveWorldStyles();
        this.revealGroups.clear();
        PizzaParticleSystem.init(this.threeScene, './bandit-controller/images/non-preload/');
        this.threeScene.background = buildBlueSkyTexture();
        this.threeScene.add(new THREE.HemisphereLight(0xe9f0e8, 0x4b4034, 1.8));
        const light = new THREE.DirectionalLight(0xffe4b8, 2.1);
        light.position.set(-6, 12, 7);
        this.threeScene.add(light);

        this.exteriorGround = new THREE.Mesh(
            new THREE.PlaneGeometry(this.level.floor.width + 26, this.level.floor.depth + 22, 44, 46),
            new THREE.MeshStandardMaterial({ color: WorldStyles.get('ground', this.level.styles?.ground).color, roughness: 0.98 }),
        );
        this.exteriorGround.rotation.x = -Math.PI / 2;
        this.exteriorGround.position.y = 0.005;
        BendService.applyBend(this.exteriorGround.material as THREE.Material);
        this.threeScene.add(this.exteriorGround);

        const floorStyle = WorldStyles.get('floor', this.level.styles?.floor);
        const floorRects = this.level.floor.rects?.length
            ? this.level.floor.rects
            : [{ x: 0, z: 0, width: this.level.floor.width, depth: this.level.floor.depth }];
        for (const rect of floorRects) {
            const piece = CheckerFloorBuilder.build({ ...rect, rotationY: 0, tileSize: 1 } as StoreFloorPlacement, ROOM_ORIGIN, {
                colorA: floorStyle.colorA,
                colorB: floorStyle.colorB,
                scale: floorStyle.checkerScale,
            } as FloorCheckerConfig);
            this.floorMeshes.push(piece);
            this.threeScene.add(piece);
        }

        const roomWalls: StoreWallPlacement[] = this.level.walls.map((levelWall) => ({
            closed: levelWall.closed,
            points: levelWall.points.map((point) => ({ x: point.x, z: point.z })),
            openings: levelWall.openings.map((opening) => ({
                kind: opening.kind,
                rect: { minX: opening.minX, maxX: opening.maxX, minZ: opening.minZ, maxZ: opening.maxZ },
            })),
        }));
        for (let wallIndex = 0; wallIndex < roomWalls.length; wallIndex++) {
            const wall = roomWalls[wallIndex];
            const mesh = PolyWallBuilder.build(wall, ROOM_ORIGIN, this.wallSetup, this.wallStyle);
            const lintelClearWall: StoreWallPlacement = {
                ...wall,
                openings: wall.openings?.map((opening) => opening.kind === 'door'
                    ? { ...opening, fitToCeiling: true }
                    : opening),
            };
            const lintelClearMesh = PolyWallBuilder.build(lintelClearWall, ROOM_ORIGIN, this.wallSetup, this.wallStyle);
            if (wallIndex === 0) {
                this.addWindowPanes(mesh);
                this.addWindowPanes(lintelClearMesh);
            }
            lintelClearMesh.visible = false;
            this.wallMeshes.push(mesh);
            this.wallLintelClearMeshes.push(lintelClearMesh);
            this.threeScene.add(mesh);
            this.threeScene.add(lintelClearMesh);

            for (const collider of PolyWallBuilder.colliderBoxes(wall, this.wallSetup)) {
                this.wallBoxes.push(collider);
                const entity = this.env.world.spawn();
                entity.transform.position.set(collider.x, FloorLayers.baseY, collider.z);
                this.threeScene.add(entity.transform);
                entity.addComponent(new RigidBody({
                    halfExtents: new THREE.Vector3(collider.halfX, this.wallSetup.height / 2, collider.halfZ),
                    centerOffset: new THREE.Vector3(0, this.wallSetup.height / 2, 0),
                    isStatic: true,
                    blocksVertical: false,
                    layer: Layers.Environment,
                    bendService: BendService,
                }));
                this.wallColliders.push(entity);
            }

            for (const frame of PolyWallBuilder.doorFrames(wall, this.wallSetup)) {
                const door = new StoreDoor(frame, ROOM_ORIGIN, FloorLayers.baseY, this.doorStyle);
                door.object.visible = false;
                this.wallDoors.push(door);
                this.threeScene.add(door.object);
            }
        }

        for (const member of this.members) {
            this.addMarker(member.waypoints[0], member.color ?? 0x8fb8ff);
            if (shouldShowWaypointMarker(this.level, 1, member.waypoints.length)) {
                this.addMarker(member.waypoints[1], member.color ?? GOAL_COLOR, GOAL_MARKER_RADIUS);
            }
        }
        if (this.level.vault) {
            this.buildVault(this.level.vault);
        }
        if (this.sharedGoalActive && this.level.sharedGoal) {
            this.buildSharedGoalRoom(this.level.sharedGoal);
        }
        this.buildGoalArrow();
        this.buildProps();
    }

    private addWindowPanes(parent: THREE.Mesh): void {
        const windowStyle = WorldStyles.get('window', this.level.styles?.window);
        for (const window of levelWindowPanes(this.level)) {
            const material = new THREE.MeshPhysicalMaterial({
                color: windowStyle.color,
                transparent: true,
                opacity: windowStyle.opacity,
                roughness: 0.16,
                metalness: 0.04,
                depthWrite: false,
                side: THREE.DoubleSide,
            });
            BendService.applyBend(material);
            const pane = new THREE.Mesh(
                new THREE.PlaneGeometry(window.width, this.wallSetup.windowHeight, 3, 2),
                material,
            );
            pane.position.set(window.x - ROOM_ORIGIN.x, FloorLayers.baseY - ROOM_ORIGIN.y + this.wallSetup.height / 2, window.z - ROOM_ORIGIN.z);
            pane.rotation.y = window.rotationY;
            parent.add(pane);
        }
    }

    private updateGoalParticles(delta: number): void {
        if (this.state === 'celebrating' || this.state === 'payout' || this.state === 'complete') {
            return;
        }
        this.updateSafeSparkle(delta);
        // The vault's safe fountain already marks the finish, so only checkpoints get goal sparkles.
        if (this.safePosition && this.nextWaypointIndex >= this.waypoints.length - 1) {
            return;
        }
        this.goalParticleAccumulator += delta;
        while (this.goalParticleAccumulator >= 0.14) {
            this.goalParticleAccumulator -= 0.14;
            this.goalParticlePosition.set(this.activeGoal.x, FloorLayers.baseY + 0.2, this.activeGoal.z);
            PizzaParticleSystem.spawn('heistGoal', this.goalParticlePosition);
        }
    }

    private updateSafeSparkle(delta: number): void {
        if (!this.safePosition) {
            return;
        }
        this.safeGlowTime += delta;
        if (this.safeGlow) {
            const pulse = 0.5 + 0.5 * Math.sin(this.safeGlowTime * 4);
            this.safeGlow.scale.setScalar(1 + pulse * 0.18);
            (this.safeGlow.material as THREE.MeshBasicMaterial).opacity = 0.45 + pulse * 0.35;
        }
        this.safeParticleAccumulator += delta;
        while (this.safeParticleAccumulator >= 0.05) {
            this.safeParticleAccumulator -= 0.05;
            PizzaParticleSystem.spawn('heistSafe', this.safePosition);
        }
    }

    private revealGroup(index: number): THREE.Group {
        let group = this.revealGroups.get(index);
        if (!group) {
            group = new THREE.Group();
            group.visible = index <= this.revealedUpTo;
            this.threeScene.add(group);
            this.revealGroups.set(index, group);
        }
        return group;
    }

    /** Evenly spaced spots on one row across the room, so the squad lines up side by side facing the camera. */
    private sharedGoalSlot(goal: LevelSharedGoal, index: number, count: number): THREE.Vector3 {
        const vault = this.level.vault;
        if (vault) {
            // A row across the vault, between the entrance and the safe.
            const alongX = vault.side.endsWith('z');
            const sign = vault.side.startsWith('+') ? 1 : -1;
            const across = alongX ? goal.width : goal.depth;
            const spacing = Math.min(SHARED_SLOT_SPACING, (across - 1) / Math.max(1, count));
            const offset = (index - (count - 1) / 2) * spacing;
            return alongX
                ? new THREE.Vector3(vault.x + offset, 0, vault.z - sign * 0.4)
                : new THREE.Vector3(vault.x - sign * 0.4, 0, vault.z + offset);
        }
        const spacing = Math.min(SHARED_SLOT_SPACING, (goal.width - 1) / Math.max(1, count));
        return new THREE.Vector3(goal.x + (index - (count - 1) / 2) * spacing, 0, goal.z + goal.depth * 0.2);
    }

    private insideSharedGoal(position: THREE.Vector3): boolean {
        const goal = this.level.sharedGoal;
        return Boolean(goal) && this.sharedGoalActive
            && Math.abs(position.x - goal!.x) <= goal!.width / 2
            && Math.abs(position.z - goal!.z) <= goal!.depth / 2;
    }

    /** The vault room (or shared finish area) counts as the final goal as a whole. */
    private insideFinishArea(position: THREE.Vector3): boolean {
        return this.insideSharedGoal(position) || insideVault(this.level, position.x, position.z);
    }

    private buildSharedGoalRoom(goal: LevelSharedGoal): void {
        const material = new THREE.MeshBasicMaterial({ color: GOAL_COLOR, transparent: true, opacity: 0.35, depthWrite: false });
        BendService.applyBend(material);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(goal.width, goal.depth), material);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(goal.x, FloorLayers.baseY + 0.06, goal.z);
        this.threeScene.add(floor);

        const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
        BendService.applyBend(edgeMaterial);
        const halfW = goal.width / 2;
        const halfD = goal.depth / 2;
        const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(goal.x - halfW, FloorLayers.baseY + 0.08, goal.z - halfD),
            new THREE.Vector3(goal.x + halfW, FloorLayers.baseY + 0.08, goal.z - halfD),
            new THREE.Vector3(goal.x + halfW, FloorLayers.baseY + 0.08, goal.z + halfD),
            new THREE.Vector3(goal.x - halfW, FloorLayers.baseY + 0.08, goal.z + halfD),
        ]), edgeMaterial);
        this.threeScene.add(outline);

        // Older layouts without a vault room keep the safe against the room's far wall.
        if (!this.level.vault) {
            const safe = new THREE.Vector3(goal.x, FloorLayers.baseY, goal.z - halfD + 1);
            void this.placeAsset(SAFE_MODEL, safe, 2.8, 0);
            this.addPropCollider(safe, new THREE.Vector3(0.95, 1.4, 0.8));
        }
    }

    /** The finish room: a warm floor tint and the safe against the wall opposite the entrance. */
    private buildVault(vault: LevelVault): void {
        if (!this.sharedGoalActive) {
            const material = new THREE.MeshBasicMaterial({ color: VAULT_FLOOR_COLOR, transparent: true, opacity: 0.28, depthWrite: false });
            BendService.applyBend(material);
            const floor = new THREE.Mesh(new THREE.PlaneGeometry(vault.width - 0.3, vault.depth - 0.3), material);
            floor.rotation.x = -Math.PI / 2;
            floor.position.set(vault.x, FloorLayers.baseY + 0.05, vault.z);
            this.threeScene.add(floor);
        }
        const safe = vaultSafe(vault);
        const position = new THREE.Vector3(safe.x, FloorLayers.baseY, safe.z);
        void this.placeAsset(SAFE_MODEL, position, 2.8, safe.yaw);
        this.addPropCollider(position, new THREE.Vector3(safe.halfX, 1.4, safe.halfZ));

        this.safePosition = position.clone().setY(FloorLayers.baseY + 0.2);
        const glowMaterial = new THREE.MeshBasicMaterial({
            map: this.safeGlowTexture(),
            color: 0xffc61a,
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        BendService.applyBend(glowMaterial);
        this.safeGlow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), glowMaterial);
        this.safeGlow.rotation.x = -Math.PI / 2;
        this.safeGlow.position.set(position.x, FloorLayers.baseY + 0.07, position.z);
        this.safeGlow.renderOrder = 2;
        this.threeScene.add(this.safeGlow);
    }

    /** Soft radial gradient for the pulsing gold pool under the safe. */
    private static safeGlowMap?: THREE.CanvasTexture;

    private safeGlowTexture(): THREE.CanvasTexture {
        if (PathLevelScene.safeGlowMap) {
            return PathLevelScene.safeGlowMap;
        }
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 128;
        const context = canvas.getContext('2d')!;
        const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.45, 'rgba(255,255,255,0.55)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 128, 128);
        PathLevelScene.safeGlowMap = new THREE.CanvasTexture(canvas);
        return PathLevelScene.safeGlowMap;
    }

    private buildProps(): void {
        for (const prop of this.level.props) {
            const position = new THREE.Vector3(prop.x, FloorLayers.baseY, prop.z);
            const parent = prop.revealAt > 0 ? this.revealGroup(prop.revealAt) : this.threeScene;
            void this.placeAsset(prop.model, position.clone().setY(position.y + (prop.elevation ?? 0)), prop.height, prop.rotationY, parent, prop.width, prop.flat);
            if (prop.collider) {
                this.addPropCollider(
                    position,
                    new THREE.Vector3(prop.collider.halfX, prop.collider.halfY, prop.collider.halfZ),
                );
            }
        }
    }

    private async placeAsset(
        relativePath: string,
        position: THREE.Vector3,
        targetHeight: number,
        yaw = 0,
        parent: THREE.Object3D = this.threeScene,
        targetWidth?: number,
        flat = false,
    ): Promise<void> {
        try {
            const object = await ModelLoaderManager.instance.loadModel(`${MODEL_BASE}${relativePath}`);
            object.traverse((child) => {
                if (!(child instanceof THREE.Mesh)) {
                    return;
                }
                child.material = Array.isArray(child.material)
                    ? child.material.map((material) => material.clone())
                    : child.material.clone();
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach((material) => BendService.applyBend(material));
            });
            object.updateMatrixWorld(true);
            const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
            const footprint = Math.max(size.x, size.z);
            if (targetWidth && footprint > 1e-4) {
                object.scale.multiplyScalar(targetWidth / footprint);
            } else if (size.y > 1e-4) {
                object.scale.multiplyScalar(targetHeight / size.y);
            }
            if (flat) {
                // Rugs and pads sit under route lines and goal markers (drawn a few cm above the floor).
                const thickness = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()).y;
                if (thickness > FLAT_PROP_HEIGHT) {
                    object.scale.y *= FLAT_PROP_HEIGHT / thickness;
                }
            }
            object.rotation.y = yaw;
            object.updateMatrixWorld(true);
            const bounds = new THREE.Box3().setFromObject(object);
            object.position.set(position.x, position.y - bounds.min.y, position.z);
            if (this.destroyed) {
                this.disposeDressingAsset(object);
                return;
            }
            this.dressingAssets.push(object);
            parent.add(object);
        } catch (error) {
            console.warn(`[PathLevelScene] Could not load dressing asset ${relativePath}`, error);
        }
    }

    private addPropCollider(position: THREE.Vector3, halfExtents: THREE.Vector3): void {
        this.wallBoxes.push({
            x: position.x,
            z: position.z,
            halfX: halfExtents.x,
            halfZ: halfExtents.z,
        });
        const entity = this.env.world.spawn();
        entity.transform.position.copy(position);
        this.threeScene.add(entity.transform);
        entity.addComponent(new RigidBody({
            halfExtents,
            centerOffset: new THREE.Vector3(0, halfExtents.y, 0),
            isStatic: true,
            blocksVertical: false,
            layer: Layers.Environment,
            bendService: BendService,
        }));
        this.propColliders.push(entity);
    }

    private disposeDressingAsset(object: THREE.Object3D): void {
        object.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) {
                return;
            }
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => material.dispose());
        });
        object.removeFromParent();
    }

    /** Ring under the member the player is currently controlling (squad levels only). */
    private updateSelectionHalo(): void {
        if (this.members.length < 2 || !this.focused) {
            return;
        }
        if (!this.selectionHalo) {
            const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
            BendService.applyBend(material);
            this.selectionHalo = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 40), material);
            this.selectionHalo.rotation.x = -Math.PI / 2;
            this.selectionHalo.renderOrder = 2;
            this.threeScene.add(this.selectionHalo);
        }
        const halo = this.selectionHalo;
        const position = this.env.mainPlayer.transform.position;
        halo.position.set(position.x, 0.13, position.z);
        halo.visible = !this.isEnded() && this.state !== 'done'
            && this.state !== 'celebrating' && this.state !== 'payout' && this.state !== 'complete';
        // Fresnel rim on the selected member only; it pulses gently so it reads as "this one".
        const rim = halo.visible ? 0.9 + 0.35 * Math.sin(performance.now() / 220) : 0;
        for (const member of this.members) {
            member.player.character?.setRim(member === this.focused ? rim : 0);
        }
    }

    private buildGoalArrow(): void {
        if (this.dragHint) {
            return;
        }
        const index = LevelCatalog.all().indexOf(this.level);
        this.handHintLevel = index >= 0 && index < HAND_HINT_LEVELS;
        const hint = new PIXI.Sprite(PIXI.Texture.from('handHud'));
        // The source art points up-left: anchor on the fingertip.
        hint.anchor.set(0.2, 0.1);
        hint.width = GOAL_HAND_SIZE;
        hint.height = GOAL_HAND_SIZE;
        hint.visible = false;
        this.game.uiLayer.addChild(hint);
        this.dragHint = hint;
    }

    /** Where the focused member is heading next: its checkpoint, or the vault/shared room at the end. */
    private hintTarget(): THREE.Vector3 | undefined {
        const marker = this.waypoints[this.nextWaypointIndex];
        const room = this.level.sharedGoal;
        const finalLeg = this.nextWaypointIndex >= this.waypoints.length - 1;
        if (finalLeg && this.level.vault) {
            return this.goalHandWorld.set(this.level.vault.x, 0, this.level.vault.z);
        }
        if (room && this.sharedGoalActive && finalLeg) {
            return this.goalHandWorld.set(room.x, 0, room.z + room.depth * 0.2);
        }
        return marker ? this.goalHandWorld.copy(marker) : undefined;
    }

    /**
     * Tutorial finger (first campaign levels only): presses on the character, then drags along a
     * walkable path to the next checkpoint, so players learn to trace from the player rather than tap the goal.
     */
    private updateDragHint(): void {
        const hint = this.dragHint;
        if (!hint) {
            return;
        }
        const target = this.handHintLevel && this.state === 'waiting' && this.pointerId === null && !this.isEnded()
            ? this.hintTarget()
            : undefined;
        if (!target || !this.navGrid) {
            hint.visible = false;
            this.hintCycleStart = -1;
            return;
        }
        const from = this.env.mainPlayer.transform.position;
        const key = `${from.x.toFixed(1)},${from.z.toFixed(1)}>${target.x.toFixed(1)},${target.z.toFixed(1)}`;
        if (key !== this.hintPathKey) {
            this.hintPathKey = key;
            const path = this.navGrid.findPath(from, target) ?? [{ x: from.x, z: from.z }, { x: target.x, z: target.z }];
            this.hintPath = path.map((point) => new THREE.Vector3(point.x, FloorLayers.baseY + 0.3, point.z));
            this.hintPath[0].set(from.x, FloorLayers.baseY + 0.3, from.z);
            this.hintLengths = [0];
            for (let i = 1; i < this.hintPath.length; i++) {
                this.hintLengths.push(this.hintLengths[i - 1] + this.hintPath[i].distanceTo(this.hintPath[i - 1]));
            }
        }
        const now = performance.now();
        if (this.hintCycleStart < 0) {
            this.hintCycleStart = now;
        }
        const cycle = ((now - this.hintCycleStart) % DRAG_HINT_CYCLE_MS) / DRAG_HINT_CYCLE_MS;
        // Press on the player, drag along the path, hold on the goal, fade out.
        const travel = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp((cycle - 0.18) / 0.55, 0, 1), 0, 1);
        const total = this.hintLengths[this.hintLengths.length - 1];
        const distance = travel * total;
        let segment = 1;
        while (segment < this.hintPath.length - 1 && this.hintLengths[segment] < distance) {
            segment++;
        }
        const span = this.hintLengths[segment] - this.hintLengths[segment - 1];
        const t = span > 0 ? (distance - this.hintLengths[segment - 1]) / span : 1;
        const world = this.dragHintWorld.copy(this.hintPath[segment - 1]).lerp(this.hintPath[Math.min(segment, this.hintPath.length - 1)], t);
        const screen = this.worldToScreen(world);
        hint.visible = Boolean(screen);
        if (!screen) {
            return;
        }
        const local = this.game.uiLayer.toLocal(new PIXI.Point(screen.x, screen.y), this.game.app.stage);
        const press = cycle < 0.18 ? Math.sin(cycle / 0.18 * Math.PI) : 0;
        hint.position.set(local.x, local.y);
        hint.alpha = cycle < 0.08 ? cycle / 0.08 : cycle > 0.88 ? Math.max(0, (1 - cycle) / 0.12) : 1;
        hint.width = GOAL_HAND_SIZE * (1 - press * 0.15);
        hint.height = GOAL_HAND_SIZE * (1 - press * 0.15);
    }

    private addMarker(position: THREE.Vector3, color: number, radius = 0.78): void {
        const marker = new THREE.Group();
        marker.position.copy(position);
        const baseMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.36, metalness: 0.08 });
        BendService.applyBend(baseMaterial);
        const base = new THREE.Mesh(
            new THREE.CylinderGeometry(radius, radius, 0.12, 28),
            baseMaterial,
        );
        base.position.y = 0.04;
        marker.add(base);
        const ringMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
        BendService.applyBend(ringMaterial);
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(radius * 0.72, 0.07, 8, 28),
            ringMaterial,
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.12;
        marker.add(ring);
        this.threeScene.add(marker);
    }

    private lootDefinition(loot: LevelLoot): CollectibleDefinition {
        const withoutExtension = loot.model.replace(/\.(gltf|glb)$/i, '');
        return {
            ...COIN,
            model: {
                id: withoutExtension.split('/').pop() ?? withoutExtension,
                path: withoutExtension,
                fullPath: `bandit-controller/models/${loot.model}`,
                format: loot.model.toLowerCase().endsWith('.glb') ? 'glb' : 'gltf',
                nodes: {},
            } as CollectibleDefinition['model'],
            resourceAmount: loot.amount,
            modelScale: loot.scale,
        };
    }

    private buildCollectibles(revealAt: number): void {
        const pickups = this.level.loot
            .filter((loot) => loot.revealAt === revealAt)
            .map((loot) => ({
                position: new THREE.Vector3(loot.x, 1.2, loot.z),
                definition: this.lootDefinition(loot),
            }));
        for (const pickup of pickups) {
            const collectible = this.env.world.add(new Collectible(
                pickup.definition,
                this.threeScene,
                () => this.env.mainPlayer.getCollectTargetPosition(),
                BendService,
            ));
            collectible.transform.position.copy(pickup.position);
            collectible.onCollected.add((amount) => {
                this.showCollectPop(this.env.mainPlayer.getCollectTargetPosition().clone(), amount);
                this.collectedPayouts.push(amount);
                this.runMoney += amount;
                this.lootCollected++;
                this.refreshRunMoney();
            });
            this.collectibles.push(collectible);
            void collectible.load();
        }
    }

    private showCollectPop(world: THREE.Vector3, amount: number): void {
        const screen = this.worldToScreen(world);
        if (!screen) {
            return;
        }
        const at = this.game.uiLayer.toLocal(new PIXI.Point(screen.x, screen.y), this.game.app.stage);
        const text = new PIXI.Text(`+$${amount}`, new PIXI.TextStyle({
            fontFamily: UiKit.fontFamily('primary'),
            fontSize: 34,
            fill: 0x6dff8a,
            stroke: 0x0b3d1a,
            strokeThickness: 6,
        }));
        text.anchor.set(0.5);
        text.position.set(at.x, at.y);
        text.scale.set(0.2);
        this.game.uiLayer.addChild(text);
        gsap.timeline({ onComplete: () => text.destroy() })
            .to(text.scale, { x: 1.2, y: 1.2, duration: 0.18, ease: 'back.out(3)' })
            .to(text.scale, { x: 1, y: 1, duration: 0.1 })
            .to(text.position, { y: at.y - 60, duration: 0.7, ease: 'power1.out' }, 0.1)
            .to(text, { alpha: 0, duration: 0.3 }, 0.6);
    }

    private buildHud(): void {
        this.hud = new PIXI.Container();
        this.instruction = new PIXI.Text('TRACE FROM THE GREEN START TO THE GOLD CHECKPOINT', {
            fontFamily: UiKit.fontFamily('primary'),
            fontSize: 20,
            fontWeight: 'normal',
            fill: 0xffffff,
            stroke: 0x203c35,
            strokeThickness: 5,
            align: 'center',
        });
        this.instruction.anchor.set(0.5);
        this.instruction.visible = false;
        this.runMoneyLabel = new PIXI.Text('', {
            fontFamily: UiKit.fontFamily('primary'),
            fontSize: 30,
            fill: 0xffffff,
            stroke: 0x1d5a2a,
            strokeThickness: 6,
        });
        this.runMoneyLabel.anchor.set(0.5);
        this.cashPill = new PIXI.Container();
        this.cashPillBackground = new PIXI.Graphics();
        const coin = PIXI.Sprite.from('ItemIcon_Money_Bill');
        coin.anchor.set(0.5);
        coin.width = coin.height = 46;
        this.cashPillCoin = coin;
        this.cashPill.addChild(this.cashPillBackground, coin, this.runMoneyLabel);
        const found = LevelCatalog.locate(this.level);
        this.worldLabel = new PIXI.Text(found ? `${found.world.label}-${found.levelNumber}` : '', {
            fontFamily: UiKit.fontFamily('primary'),
            fontSize: 21,
            fill: 0xffffff,
            stroke: 0x203c35,
            strokeThickness: 5,
        });
        this.worldLabel.anchor.set(0.5);
        this.homeButton = this.buildHomeButton();
        this.hud.addChild(this.instruction, this.cashPill, this.worldLabel, this.homeButton);
        this.buildSquadHud();
        this.refreshRunMoney();
        this.game.uiLayer.addChild(this.hud);
        this.resize();
    }

    private buildSquadHud(): void {
        const hud = this.hud;
        if (!hud) {
            return;
        }
        this.squadBadges = [];
        this.squadBar = undefined;
        if (this.members.length > 1) {
            const bar = new PIXI.Container();
            const spacing = 78;
            this.members.forEach((member, index) => {
                const root = new PIXI.Container();
                root.position.x = (index - (this.members.length - 1) / 2) * spacing;
                const color = member.color ?? 0xffffff;
                const ring = new PIXI.Graphics();
                const face = new PIXI.Sprite();
                face.anchor.set(0.5);
                face.width = face.height = 46;
                if (member.face) {
                    void PIXI.Assets.load<PIXI.Texture>(resolveSkinImagePath(member.face)).then((texture) => {
                        if (!face.destroyed && texture) {
                            face.texture = texture;
                            face.width = face.height = 46;
                        }
                    }).catch(() => undefined);
                }
                const faceMask = new PIXI.Graphics().beginFill(0xffffff).drawCircle(0, 0, 25).endFill();
                face.mask = faceMask;
                const back = new PIXI.Graphics().beginFill(color).drawCircle(0, 0, 27).endFill();
                const check = new PIXI.Text('✓', { fontFamily: UiKit.fontFamily('primary'), fontSize: 34, fill: 0xffffff, stroke: 0x1d5a2a, strokeThickness: 6 });
                check.anchor.set(0.5);
                check.visible = false;
                root.addChild(back, face, faceMask, ring, check);
                root.eventMode = 'static';
                root.cursor = 'pointer';
                root.hitArea = new PIXI.Circle(0, 0, 36);
                root.on('pointertap', () => this.selectMemberFromHud(member));
                bar.addChild(root);
                this.squadBadges.push({ member, ring, face, check, root });
            });
            this.squadBar = bar;
            hud.addChild(bar);
        }
        const { button: map, icon: mapIcon } = cornerButton('PictoIcon_Map_1', 40, () => this.toggleOverview());
        this.mapIcon = mapIcon;
        const label = new PIXI.Text('MAP', { fontFamily: UiKit.fontFamily('primary'), fontSize: 15, fill: 0xffffff, stroke: 0x203c35, strokeThickness: 4 });
        label.anchor.set(0.5);
        // Gap between the round button and its caption.
        label.y = 46;
        map.addChild(label);
        this.mapButton = map;
        hud.addChild(map);
        this.refreshSquadHud();
    }

    private refreshSquadHud(): void {
        const hidden = this.isEnded();
        if (this.squadBar) {
            this.squadBar.visible = !hidden;
        }
        if (this.mapButton) {
            this.mapButton.visible = !hidden;
        }
        for (const badge of this.squadBadges) {
            const done = this.memberState(badge.member) === 'done';
            const current = badge.member === this.focused;
            const scale = current ? 1.18 : 0.9;
            badge.root.scale.set(scale);
            badge.root.alpha = done ? 0.55 : 1;
            badge.check.visible = done;
            badge.face.alpha = done ? 0.35 : 1;
            badge.ring.clear().lineStyle(current ? 5 : 3, current ? 0xffffff : 0x203c35).drawCircle(0, 0, 27);
        }
        if (this.mapIcon) {
            this.mapIcon.tint = this.overview ? 0x6dffe6 : 0xffffff;
        }
    }

    private selectMemberFromHud(member: SquadMember): void {
        if (this.isEnded() || member === this.focused || this.memberState(member) !== 'waiting') {
            return;
        }
        this.focusMember(member);
        this.refreshSquadHud();
    }

    private toggleOverview(): void {
        this.overview = !this.overview;
        this.frameActiveSegment();
        this.refreshSquadHud();
    }

    private buildHomeButton(): PIXI.Container {
        return cornerButton('PictoIcon_Home_1', 40, () => this.onHome.dispatch()).button;
    }

    private applyCameraPreset(preset: CameraPreset): void {
        const camera = this.env.cameraSystem.current;
        camera.pitchDeg = preset.pitchDeg;
        this.cameraTuning.yawDeg = preset.yawDeg;
        this.cameraTuning.fov = preset.fov || this.defaultFov;
        this.cameraTuning.bend = preset.bend;
        this.syncCameraTuning();
        this.frameActiveSegment(true);
    }

    /** Pushes the debug-tunable yaw/FOV/bend into the live camera and materials; cheap, so it runs every frame. */
    private syncCameraTuning(): void {
        const tuning = this.cameraTuning;
        this.pathCameraOptions.fixedYawDeg = tuning.yawDeg;
        if (this.threeCamera.fov !== tuning.fov) {
            this.threeCamera.fov = tuning.fov;
            this.threeCamera.updateProjectionMatrix();
        }
        for (const service of [BendService, PizzaBendService]) {
            const uniform = service.uniforms.uBendStrength;
            if (tuning.bend) {
                if (savedBend.has(service)) {
                    uniform.value = savedBend.get(service) as number;
                    savedBend.delete(service);
                }
            } else if (!savedBend.has(service)) {
                savedBend.set(service, uniform.value);
                uniform.value = 0;
            }
        }
    }

    private setupCameraDebug(): void {
        const panel = DebugOverlay.instance.panel('Path Camera', { id: CAMERA_PANEL_ID });
        const camera = this.env.cameraSystem.current;
        const tuning = this.cameraTuning;
        panel.buttons(CAMERA_PRESETS.map((preset) => ({
            label: preset.label,
            action: () => this.applyCameraPreset(preset),
        })));
        panel.slider(tuning, 'yawDeg', -90, 90, 1, 'Yaw');
        panel.slider(tuning, 'fov', 15, 70, 1, 'FOV');
        panel.toggle(tuning, 'bend', { label: 'World bend' });
        panel.slider(camera, 'pitchDeg', 25, 89, 1, 'Pitch');
        panel.slider(camera, 'distance', 6, 32, 0.5, 'Distance');
        panel.slider(camera, 'followSpeed', 0.5, 20, 0.5, 'Follow Speed');

        panel.toggle(this, 'wallsAlwaysLow', { label: 'Walls always low' });
        panel.toggle(this, 'stopAtCheckpoints', { label: 'Stop at checkpoints' });

        const levelsPanel = DebugOverlay.instance.panel('Levels', { id: LEVELS_PANEL_ID });
        levelsPanel.buttons(LevelCatalog.all().map((entry, index) => ({
            label: `${index + 1}. ${entry.name}${entry.id === this.level.id ? ' ●' : ''}`,
            variant: entry.id === this.level.id ? 'accent' as const : 'default' as const,
            action: () => {
                LevelCatalog.select(index);
                this.onRestart.dispatch();
            },
        })));

        const bending = DebugOverlay.instance.panel('Path Bending', { id: BENDING_PANEL_ID });
        bending.slider(BendService.uniforms.uBendStrength, 'value', 0, 0.006, 0.0001, 'Player / floor');
        bending.slider(PizzaBendService.uniforms.uBendStrength, 'value', 0, 0.006, 0.0001, 'Walls');
    }

    private addInputListeners(): void {
        window.addEventListener('pointerdown', this.onPointerDown);
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
        window.addEventListener('pointercancel', this.onPointerUp);
    }

    private removeInputListeners(): void {
        window.removeEventListener('pointerdown', this.onPointerDown);
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointercancel', this.onPointerUp);
    }

    private readonly onPointerDown = (event: PointerEvent): void => {
        if (this.isEnded() || this.isDebugTarget(event.target) || !this.pickFloor(event.clientX, event.clientY)) {
            return;
        }
        // Touching the level to move is gameplay; it only stops for ads and the main menu.
        this.startGameplay();
        // Pick the closest idle member. The camera only follows on release so it never moves mid-draw.
        let member: SquadMember | undefined;
        let best = 1.3;
        for (const candidate of this.members) {
            const distance = this.distanceXZ(this.pointerWorld, this.memberStartPoint(candidate));
            if (this.memberState(candidate) === 'waiting' && distance <= best) {
                best = distance;
                member = candidate;
            }
        }
        if (!member) {
            return;
        }
        if (member !== this.focused) {
            this.swapTo(member);
            this.selectionNeedsFraming = true;
        }
        if (this.overview) {
            this.overview = false;
            this.selectionNeedsFraming = true;
        }
        const start = this.pathDrawMode === 'exit'
            ? this.activeStart
            : this.env.mainPlayer.transform.position;
        this.clearRoute();
        this.pointerId = event.pointerId;
        this.pointerDownWorld.copy(this.pointerWorld);
        this.pointerDragged = false;
        this.routeBlocked = false;
        this.route = this.routeStart(start);
        this.setInstruction(this.pathDrawMode === 'exit'
            ? 'DRAW A PATH TO THE GOLD CHECKPOINT'
            : 'RELEASE ANYWHERE TO FOLLOW THE PATH');
    };

    private readonly onPointerMove = (event: PointerEvent): void => {
        if (this.pointerId !== event.pointerId || this.state !== 'waiting') {
            return;
        }
        if (!this.pickFloor(event.clientX, event.clientY)) {
            return;
        }
        if (this.distanceXZ(this.pointerWorld, this.pointerDownWorld) >= TAP_MAX_DRAG) {
            this.pointerDragged = true;
        }
        if (!this.pointerDragged) {
            return;
        }
        if (this.distanceXZ(this.pointerWorld, this.route[this.route.length - 1]) < 0.2) {
            return;
        }
        if (this.extendRoute(this.pointerWorld)) {
            this.drawRoute();
        }
    };

    /**
     * Grows the drawn route toward `target`: the trace slides off walls and stays on the floor, and
     * a stretch that would cut through a wall detours through the nearest door (A*), so brushing a
     * wall never throws the whole path away. False when the target can't be reached at all.
     */
    private extendRoute(target: THREE.Vector3): boolean {
        const last = this.route[this.route.length - 1];
        const added = this.navGrid?.extend(last, target);
        if (!added) {
            return false;
        }
        for (const point of added) {
            if (this.distanceXZ(point as THREE.Vector3, this.route[this.route.length - 1]) > 0.05) {
                this.appendRouteSamples(new THREE.Vector3(point.x, 0.08, point.z));
            }
        }
        return true;
    }

    private buildNavGrid(): void {
        const floor = this.level.floor;
        const regions = [
            ...(floor.rects?.length ? floor.rects : [{ x: 0, z: 0, width: floor.width, depth: floor.depth }]),
            ...(this.level.entryPath ? [this.level.entryPath] : []),
        ];
        this.navGrid = new NavGrid(regions, this.wallBoxes, ROUTE_CLEARANCE);
    }

    /** Route start: the player's spot, plus a step out to free floor when it stands hugging a wall. */
    private routeStart(start: THREE.Vector3): THREE.Vector3[] {
        const points = [new THREE.Vector3(start.x, 0.08, start.z)];
        const grid = this.navGrid;
        if (grid && !grid.isFree(start.x, start.z)) {
            const free = grid.nearestFree(start);
            if (free) {
                points.push(new THREE.Vector3(free.x, 0.08, free.z));
            }
        }
        return points;
    }

    private appendRouteSamples(target: THREE.Vector3): void {
        const start = this.route[this.route.length - 1];
        const distance = this.distanceXZ(start, target);
        const steps = Math.max(1, Math.ceil(distance / 0.3));
        let previous = start;
        for (let step = 1; step <= steps; step++) {
            const t = step / steps;
            const point = new THREE.Vector3(
                THREE.MathUtils.lerp(start.x, target.x, t),
                0.08,
                THREE.MathUtils.lerp(start.z, target.z, t),
            );
            this.route.push(point);
            previous = point;
        }
    }

    private readonly onPointerUp = (event: PointerEvent): void => {
        if (this.pointerId !== event.pointerId || this.state !== 'waiting') {
            return;
        }
        this.pointerId = null;
        const needsFraming = this.selectionNeedsFraming;
        this.selectionNeedsFraming = false;
        const hasFloorPoint = this.pickFloor(event.clientX, event.clientY);
        if (!this.pointerDragged) {
            // A tap only selects; it never starts a walk.
            this.route = [];
            this.routeBlocked = false;
            this.clearRoute();
            this.setInstruction(this.pathDrawMode === 'exit'
                ? 'TRACE TO THE GOLD CHECKPOINT'
                : 'TRACE FROM THE PLAYER; RELEASE ANYWHERE');
            if (needsFraming) {
                this.frameActiveSegment();
            }
            return;
        }
        const endPoint = hasFloorPoint ? this.pointerWorld.clone().setY(0.08) : undefined;
        if (endPoint && this.distanceXZ(this.route[this.route.length - 1], endPoint) > 0.12) {
            this.extendRoute(endPoint);
        }
        const tracedPath = this.route.map((point) => point.clone());
        const routeEnd = this.route[this.route.length - 1];
        const nearGoal = (point: THREE.Vector3) => this.distanceXZ(point, this.activeGoal) <= GOAL_RELEASE_RADIUS
            || (this.nextWaypointIndex >= this.waypoints.length - 1 && this.insideFinishArea(point));
        const reachesGoal = endPoint && (nearGoal(endPoint) || nearGoal(routeEnd));
        const accepted = endPoint
            && this.route.length > 1
            && (this.pathDrawMode === 'free' || reachesGoal);
        if (!accepted) {
            console.info('[PathLevelScene] rejected path', {
                mode: this.pathDrawMode,
                tracedPath: this.serializePath(tracedPath),
                reason: !hasFloorPoint ? 'release outside floor' : 'release did not reach active goal',
            });
            this.route = [];
            this.routeBlocked = false;
            this.clearRoute();
            this.setInstruction(this.pathDrawMode === 'exit'
                ? 'TRACE TO THE GOLD CHECKPOINT'
                : 'TRACE FROM THE PLAYER; RELEASE ANYWHERE');
            if (needsFraming) {
                this.frameActiveSegment();
            }
            return;
        }

        const endpoint = this.pathDrawMode === 'exit' ? this.activeGoal.clone().setY(0.08) : routeEnd.clone();
        this.routeBlocked = this.distanceXZ(this.route[this.route.length - 1], endpoint) > 0.12 && !this.extendRoute(endpoint);
        this.drawRoute();
        console.info('[PathLevelScene] path', {
            mode: this.pathDrawMode,
            tracedPath: this.serializePath(tracedPath),
            blocked: this.routeBlocked,
        });
        if (this.routeBlocked) {
            GameAudio.play('blocked');
            this.route = [];
            this.routeBlocked = false;
            this.clearRoute();
            this.setInstruction('PATH BLOCKED; TRY AROUND THE OBSTACLE');
            if (needsFraming) {
                this.frameActiveSegment();
            }
            return;
        }

        this.startFollowing(endpoint);
    };

    private startFollowing(endpoint: THREE.Vector3): void {
        GameAudio.play('start');
        this.state = 'following';
        if (this.pathDrawMode === 'free') {
            this.activeStart.copy(this.route[0]);
            this.activeGoal.copy(endpoint);
        }
        this.frameActiveSegment();
        this.env.mainPlayer.movementController.enabled = true;
        this.env.mainPlayer.movementController.enterPathMode(this.route);
        this.setInstruction('FOLLOWING YOUR PATH');
    };

    private serializePath(points: readonly THREE.Vector3[]): { x: number; z: number }[] {
        return points.map(({ x, z }) => ({ x: Number(x.toFixed(2)), z: Number(z.toFixed(2)) }));
    }

    private isDebugTarget(target: EventTarget | null): boolean {
        return target instanceof Element && Boolean(target.closest('#daybreak-debug-overlay'));
    }

    private pickFloor(clientX: number, clientY: number): boolean {
        this.pointerNdc.set(clientX / window.innerWidth * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
        this.raycaster.setFromCamera(this.pointerNdc, this.threeCamera);
        return this.raycaster.ray.intersectPlane(this.floorPlane, this.pointerWorld) !== null;
    }

    private drawRoute(): void {
        this.clearRoute();
        if (this.route.length === 0) {
            return;
        }

        // The route is already wall-free (see extendRoute); it only turns red when unreachable.
        const route = this.route;

        const routeColor = this.routeBlocked ? 0xf04455 : (this.focused?.color ?? 0x2bd2bd);
        if (route.length > 1) {
            const curve = new THREE.CatmullRomCurve3(route, false, 'centripetal');
            const routeMaterial = new THREE.MeshStandardMaterial({
                color: routeColor,
                emissive: this.routeBlocked
                    ? 0x650817
                    : this.focused?.color !== undefined
                    ? new THREE.Color(routeColor).multiplyScalar(0.3)
                    : 0x074d44,
                roughness: 0.28,
            });
            BendService.applyBend(routeMaterial);
            this.routeMesh = new THREE.Mesh(
                new THREE.TubeGeometry(curve, Math.max(20, route.length * 5), 0.07, 8, false),
                routeMaterial,
            );
            this.threeScene.add(this.routeMesh);
        }
    }

    private clearRoute(): void {
        if (this.routeMesh) {
            this.routeMesh.geometry.dispose();
            (this.routeMesh.material as THREE.Material).dispose();
            this.routeMesh.removeFromParent();
            this.routeMesh = undefined;
        }
    }

    private distanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
        return Math.hypot(a.x - b.x, a.z - b.z);
    }

    private isEnded(): boolean {
        return this.state === 'celebrating' || this.state === 'payout' || this.state === 'complete' || this.state === 'busted';
    }

    private memberState(member: SquadMember): PathLevelState {
        return member === this.focused ? this.state : member.state;
    }

    private memberStartPoint(member: SquadMember): THREE.Vector3 {
        if (this.pathDrawMode === 'exit') {
            return member === this.focused ? this.activeStart : member.start;
        }
        return member.player.transform.position;
    }

    /** Makes `member` the one the scene fields (path, goal, route, state) and the camera refer to. */
    private swapTo(member: SquadMember): void {
        const previous = this.focused;
        if (previous === member) {
            return;
        }
        if (previous) {
            previous.waypoints = this.waypoints;
            previous.nextWaypointIndex = this.nextWaypointIndex;
            previous.start.copy(this.activeStart);
            previous.goal.copy(this.activeGoal);
            previous.route = this.route;
            previous.routeMesh = this.routeMesh;
            previous.routeBlocked = this.routeBlocked;
            previous.state = this.state;
        }
        this.focused = member;
        this.waypoints = member.waypoints;
        this.nextWaypointIndex = member.nextWaypointIndex;
        this.activeStart.copy(member.start);
        this.activeGoal.copy(member.goal);
        this.route = member.route;
        this.routeMesh = member.routeMesh;
        this.routeBlocked = member.routeBlocked;
        this.state = member.state;
        this.env.mainPlayer = member.player;
    }

    /** Runs `step` against another member without moving the camera or touching the HUD. */
    private runAsMember(member: SquadMember, step: () => void): void {
        const previous = this.focused;
        if (!previous || member === previous) {
            step();
            return;
        }
        this.inBackground = true;
        this.swapTo(member);
        step();
        this.inBackground = false;
        // Finishing the last member keeps it focused for the celebration.
        if (this.state !== 'celebrating') {
            this.swapTo(previous);
        }
    }

    private focusMember(member: SquadMember): void {
        if (this.pointerId !== null) {
            this.pointerId = null;
            this.route = [];
            this.clearRoute();
        }
        this.swapTo(member);
        this.frameActiveSegment();
        this.setInstruction('TRACE FROM THE PLAYER; RELEASE ANYWHERE');
    }

    private completeMember(): void {
        const member = this.focused;
        if (!member) {
            return;
        }
        this.state = 'done';
        GameAudio.play('checkpoint');
        const next = this.members.find((other) => other !== member && this.memberState(other) !== 'done');
        if (!next) {
            void this.beginCelebration();
        } else if (!this.inBackground) {
            this.focusMember(next);
        }
    }

    private setInstruction(text: string): void {
        if (this.instruction && !this.inBackground) {
            this.instruction.text = text;
        }
    }

    private showBonusMeter(): void {
        this.hideCelebrationBanner();
        if (this.runMoney <= 0) {
            this.showCompletePopup();
            return;
        }
        GameAudio.play('panel');
        this.setInstruction('STOP THE NEEDLE FOR A BONUS!');
        const meter = new BonusMeter(
            this.runMoney,
            (offer) => void this.claimBonus(offer),
            () => this.closeBonusMeter(() => this.showCompletePopup()),
            this.isTutorialLevel(),
        );
        this.bonusMeter = meter;
        this.panelExtents.set(meter, BonusMeter.bottomExtent);
        this.game.uiLayer.addChild(meter);
        this.positionBottomPanel(meter);
        this.uiTweens.push(...UiAnim.popIn(meter));
    }

    /** Tutorial levels hand out the end bonus for free; rewarded videos start once the player graduates. */
    /** Platform gameplay event (Poki etc.): runs from the player's first touch until an ad or the main menu. The platform ignores repeats. */
    private startGameplay(): void {
        void PlatformHandler.instance.platform?.gameplayStart()
            .catch((error) => console.warn('[PathLevelScene] gameplayStart failed', error));
    }

    /** Between levels (next level, retry): gameplay stops, the platform's ad break plays, then `next` runs. */
    private async adBreakThen(next: () => void): Promise<void> {
        if (this.adBreakRunning) {
            return;
        }
        this.adBreakRunning = true;
        try {
            await PlatformHandler.instance.platform?.gameplayStop();
            await PlatformHandler.instance.platform?.showCommercialBreak();
        } catch (error) {
            console.warn('[PathLevelScene] Ad break failed', error);
        }
        if (!this.destroyed) {
            next();
        }
    }

    private isTutorialLevel(): boolean {
        return Boolean(LevelCatalog.locate(this.level)?.world.tutorial);
    }

    private closeBonusMeter(onClosed: () => void): void {
        const meter = this.bonusMeter;
        if (!meter) {
            onClosed();
            return;
        }
        this.bonusMeter = undefined;
        this.uiTweens.push(...UiAnim.popOut(meter, undefined, () => {
            meter.removeFromParent();
            meter.destroy({ children: true });
            if (!this.destroyed) {
                onClosed();
            }
        }));
    }

    /** Outside the tutorial the bonus is only paid after a rewarded video; a failed/closed ad leaves the offer up so the player can retry or skip. */
    private async claimBonus(offer: BonusOffer): Promise<void> {
        this.bonusMeter?.setBusy(true);
        GameAnalytics.bonusClaimPressed(offer.multiplier);
        let watched = true;
        if (PlatformHandler.ENABLE_VIDEO_ADS && !this.isTutorialLevel()) {
            try {
                // Ads are never gameplay; the player's next touch in a level starts it again.
                await PlatformHandler.instance.platform?.gameplayStop();
                watched = (await PlatformHandler.instance.platform.showRewardedVideo()) !== false;
            } catch (error) {
                console.warn('[PathLevelScene] Rewarded video failed', error);
                watched = false;
            }
        }
        if (this.destroyed) {
            return;
        }
        if (!watched) {
            this.bonusMeter?.setBusy(false);
            return;
        }
        GameState.addMoney(offer.bonus);
        GameAnalytics.bonusPaid(offer.multiplier);
        this.closeBonusMeter(() => this.playBonusPayout(offer.bonus, () => this.showCompletePopup(offer)));
    }

    /** Cash pile + amount pop in the middle of the screen, then a stream of bills flies into the HUD while both counters roll. */
    private playBonusPayout(bonus: number, onDone: () => void): void {
        GameAudio.play('bonus');
        const screen = Game.overlayScreenData;
        const pop = new PIXI.Container();
        pop.position.set(screen.center.x, screen.center.y - 40);
        pop.eventMode = 'none';

        // Back bundles first, the bigger hero bundle last so it sits on top.
        const pile = new PIXI.Container();
        const bundles = [
            { x: -62, y: 22, size: 110, rotation: -0.35 },
            { x: 62, y: 22, size: 110, rotation: 0.3 },
            { x: -30, y: -30, size: 104, rotation: -0.15 },
            { x: 34, y: -28, size: 104, rotation: 0.2 },
            { x: 0, y: 16, size: 165, rotation: -0.05 },
        ].map((spec) => {
            const bundle = PIXI.Sprite.from('ItemIcon_Money_Bill');
            bundle.anchor.set(0.5);
            bundle.width = bundle.height = spec.size;
            bundle.position.set(spec.x, spec.y);
            bundle.rotation = spec.rotation;
            pile.addChild(bundle);
            return bundle;
        });
        const amount = UiKit.text('bonusMeter', 'amount', { money: bonus }, { fontSize: 64, strokeThickness: 9 });
        amount.position.set(0, 122);
        pop.addChild(pile, amount);
        const glow = UiAnim.rays(pop, 220, 0xffd84a, 0.75, 5);
        this.game.uiLayer.addChild(pop);
        this.payoutPop = pop;

        this.uiTweens.push(
            ...glow.tweens,
            gsap.fromTo(glow.rays.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.5, ease: 'back.out(1.6)' }),
            ...UiAnim.staggerPop(bundles, 0, 0.07, 'elastic.out(1.1, 0.5)'),
            gsap.fromTo(pile, { rotation: -0.3 }, { rotation: 0, duration: 0.5, ease: 'back.out(2)' }),
            ...UiAnim.staggerRise([amount], 0.25, 0, 30),
            ...UiAnim.sparkBurst(pop, 0, 0, 0xffe066, 150),
            ...UiAnim.confetti(pop, 0, -40, 50, 1.1),
        );

        const coinCount = Math.min(14, Math.max(6, Math.round(bonus / 25)));
        const stagger = 0.06;
        const holdSec = 0.85;
        const hudCountSec = coinCount * stagger + 0.5;
        const total = GameState.getMoney();
        const texture = this.moneyHud.getIconTexture() ?? PIXI.Texture.WHITE;
        let landed = 0;

        this.uiTweens.push(gsap.delayedCall(holdSec, () => {
            if (this.destroyed || pop.destroyed) {
                return;
            }
            // The pile "spends" itself while the stream leaves, and the centre amount drains as the HUD fills.
            this.uiTweens.push(
                gsap.to(pile.scale, { x: 0.6, y: 0.6, duration: hudCountSec, ease: 'power1.in' }),
                ...UiAnim.countUp(amount, bonus, 0, (value) => `+$${value}`, hudCountSec, 0),
            );
            for (let i = 0; i < coinCount; i++) {
                const from = new PIXI.Point(pop.x + (Math.random() - 0.5) * 70, pop.y + (Math.random() - 0.5) * 70);
                this.payoutFlights.push(spawnFlyingIconFromOverlayPoint(
                    this.game,
                    from,
                    () => this.moneyHud.getMoneyIconOverlayPosition(),
                    texture,
                    () => {
                        if (this.destroyed) {
                            return;
                        }
                        landed++;
                        if (landed === 1) {
                            this.moneyHud.countTo(total, hudCountSec);
                        }
                        this.moneyHud.punchIcon();
                        GameAudio.play('cashFly');
                        if (landed === coinCount) {
                            this.uiTweens.push(gsap.to(pop, {
                                alpha: 0,
                                duration: 0.3,
                                delay: 0.2,
                                onComplete: () => {
                                    if (this.destroyed) {
                                        return;
                                    }
                                    this.destroyPayoutPop();
                                    onDone();
                                },
                            }));
                        }
                    },
                    i * stagger,
                    52,
                ));
            }
        }));
    }

    /** "HEIST COMPLETE!" ribbon that slams in over the dancing crew, with confetti from both sides. */
    private showCelebrationBanner(): void {
        this.hideCelebrationBanner();
        const screen = Game.overlayScreenData;
        const banner = new PIXI.Container();
        banner.eventMode = 'none';
        banner.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.15);
        const ribbon = UiKit.sprite('levelComplete', 'ribbon', 0.75);
        const title = UiKit.text('levelComplete', 'title', { level: this.levelLabel() }, { fontSize: 34 });
        title.text = 'HEIST COMPLETE!';
        title.y = -8;
        banner.addChild(ribbon, title);
        const glow = UiAnim.rays(banner, 260, 0xffe066, 0.55, 8);
        this.game.uiLayer.addChild(banner);
        this.celebrationBanner = banner;
        this.uiTweens.push(
            ...glow.tweens,
            gsap.fromTo(banner.scale, { x: 2.2, y: 2.2 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(1.6)' }),
            gsap.fromTo(banner, { alpha: 0 }, { alpha: 1, duration: 0.15 }),
            ...UiAnim.confetti(banner, -170, 0, 50, 1),
            ...UiAnim.confetti(banner, 170, 0, 50, 1),
            ...UiAnim.sparkBurst(banner, 0, 0, 0xffe066, 180),
            gsap.delayedCall(0.35, () => {
                if (!this.destroyed && !banner.destroyed) {
                    this.uiTweens.push(...UiAnim.punch(banner, 0.08), ...UiAnim.pulse(banner, 0.04, 0.5));
                }
            }),
        );
    }

    private hideCelebrationBanner(): void {
        const banner = this.celebrationBanner;
        if (!banner) {
            return;
        }
        this.celebrationBanner = undefined;
        this.uiTweens.push(...UiAnim.popOut(banner, undefined, () => {
            banner.removeFromParent();
            banner.destroy({ children: true });
        }));
    }

    private destroyPayoutPop(): void {
        if (this.payoutPop) {
            UiAnim.kill(this.payoutPop);
            this.payoutPop.removeFromParent();
            this.payoutPop.destroy({ children: true });
            this.payoutPop = undefined;
        }
    }

    /** Pinned to the bottom edge (using each panel's own extent) so the dancing crew stays visible above it. */
    private positionBottomPanel(panel: PIXI.Container): void {
        const screen = Game.overlayScreenData;
        const extent = this.panelExtents.get(panel) ?? 160;
        panel.position.set(screen.center.x, screen.bottomLeft.y - BOTTOM_PANEL_MARGIN - extent);
    }

    private showCompletePopup(offer?: BonusOffer): void {
        if (this.state === 'complete') {
            return;
        }
        this.state = 'complete';
        this.hideCelebrationBanner();
        GameAudio.play('complete');
        this.setInstruction('');
        LevelCatalog.markCompleted(this.level);
        const result = Progress.complete(this.level, {
            loot: this.lootCollected >= this.level.loot.length,
            unseen: !this.spotted,
        });
        GameAnalytics.levelComplete(this.level, result.stars);
        this.moneyHud.setResourceCount(GameState.getMoney());
        const modal = new PIXI.Container();
        const panelHeight = 380;
        const panel = UiKit.image('levelComplete', 'panel', 420, panelHeight);

        const ribbon = UiKit.sprite('levelComplete', 'ribbon', 0.6);
        ribbon.position.set(0, -panelHeight / 2);
        const title = UiKit.text('levelComplete', 'title', { level: this.levelLabel() });
        // The ribbon's front piece sits a little above the image centre.
        title.position.set(0, -panelHeight / 2 - 7);

        // Classic three-star podium: the middle one sits higher and bigger.
        const starRow = new PIXI.Container();
        const earnedStars: PIXI.Sprite[] = [];
        for (let i = 0; i < 3; i++) {
            const middle = i === 1;
            const star = PIXI.Sprite.from('ItemIcon_Star_Gold');
            star.anchor.set(0.5);
            star.height = middle ? 76 : 60;
            star.scale.x = star.scale.y;
            star.position.set((i - 1) * 78, middle ? -10 : 4);
            star.rotation = (i - 1) * 0.18;
            const slot = PIXI.Sprite.from('ItemIcon_Star_Gold');
            slot.anchor.set(0.5);
            slot.scale.copyFrom(star.scale);
            slot.position.copyFrom(star.position);
            slot.rotation = star.rotation;
            slot.tint = 0x5a6178;
            slot.alpha = 0.55;
            starRow.addChild(slot);
            if (i < result.stars) {
                earnedStars.push(star);
                starRow.addChild(star);
            }
        }
        starRow.position.set(0, -90);

        const bonus = offer?.bonus ?? 0;
        // Headline is everything this level paid; the line under it breaks it down.
        const securedMoney = this.runMoney + bonus + result.total;
        const totalRow = new PIXI.Container();
        const total = UiKit.text('levelComplete', 'total', { money: securedMoney });
        const totalText = total.text;
        const coin = PIXI.Sprite.from('ItemIcon_Money_Bill');
        coin.anchor.set(0.5);
        coin.height = 58;
        coin.scale.x = coin.scale.y;
        // Centre coin + digits as one unit, measured at the final amount so the count-up doesn't jitter the layout.
        const rowWidth = coin.width + 8 + total.width;
        coin.x = -rowWidth / 2 + coin.width / 2;
        total.x = coin.x + coin.width / 2 + 8 + total.width / 2;
        totalRow.addChild(coin, total);
        totalRow.position.set(0, -10);
        const caption = UiKit.text('levelComplete', 'totalCaption');
        caption.position.set(0, 26);

        // Breakdown as fixed-width columns (amount over label) so it never outgrows the panel.
        const items = [
            { value: this.runMoney, label: 'LOOT' },
            ...(offer ? [{ value: bonus, label: `x${offer.multiplier} BONUS` }] : []),
            ...(result.total > 0 ? [{ value: result.total, label: result.firstClear ? 'FIRST CLEAR' : 'STARS' }] : []),
        ];
        const breakdown = new PIXI.Container();
        const columnWidth = 124;
        items.forEach((item, index) => {
            const x = (index - (items.length - 1) / 2) * columnWidth;
            const value = UiKit.text('levelComplete', 'breakdownValue', { money: item.value });
            value.position.set(x, 0);
            const label = UiKit.text('levelComplete', 'breakdownLabel', { text: item.label });
            label.position.set(x, 22);
            breakdown.addChild(value, label);
            if (index > 0) {
                const divider = new PIXI.Graphics();
                divider.beginFill(0xffffff, 0.15).drawRect(-1, -12, 2, 44).endFill();
                divider.x = x - columnWidth / 2;
                breakdown.addChild(divider);
            }
        });
        breakdown.position.set(0, 62);
        const notes = [result.stars < 2 ? 'GRAB ALL LOOT FOR 2 STARS' : '', result.stars < 3 ? 'STAY UNSEEN FOR 3 STARS' : ''].filter(Boolean);
        const hint = UiKit.text('levelComplete', 'hint', { text: notes[0] ?? '' });
        hint.position.set(0, 116);

        const button = new PIXI.Container();
        const buttonBg = UiKit.image('levelComplete', 'button', 260, 90);
        const nextIndex = LevelCatalog.all().indexOf(this.level) + 1;
        const needsStars = LevelCatalog.hasNext(this.level) && !LevelCatalog.isUnlocked(nextIndex);
        const buttonLabel = UiKit.text('levelComplete', 'buttonLabel', {
            buttonText: needsStars ? 'MORE STARS!' : !LevelCatalog.hasNext(this.level) ? 'PLAY AGAIN' : LevelCatalog.isWorldFinale(this.level) ? 'NEXT WORLD' : 'NEXT LEVEL',
        });
        buttonLabel.y = -4;
        button.addChild(buttonBg, buttonLabel);
        button.scale.set(0.72);
        button.position.set(0, panelHeight / 2 - 18);
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointertap', () => {
            GameAudio.play('tap');
            if (needsStars) {
                this.onHome.dispatch();
                return;
            }
            LevelCatalog.advance(this.level);
            void this.adBreakThen(() => this.onRestart.dispatch());
        });

        modal.addChild(panel, ribbon, title, starRow, totalRow, caption, breakdown, hint, button);
        this.panelExtents.set(modal, panelHeight / 2 + 20);
        this.positionBottomPanel(modal);
        this.game.uiLayer.addChild(modal);
        this.completeModal = modal;
        this.animateCompletePopup(modal, { ribbon, title, earnedStars, starRow, total, totalRow, totalText, securedMoney, details: [caption, breakdown, hint], button });
    }

    /** Banner drop, stars landing one by one, money count-up, confetti, then the pulsing NEXT button. */
    private animateCompletePopup(modal: PIXI.Container, parts: {
        ribbon: PIXI.Container; title: PIXI.Container; earnedStars: PIXI.Sprite[]; starRow: PIXI.Container;
        total: PIXI.Text; totalRow: PIXI.Container; totalText: string; securedMoney: number; details: PIXI.Container[]; button: PIXI.Container;
    }): void {
        const track = (tweens: UiTween[]): void => {
            this.uiTweens.push(...tweens);
        };
        const glow = UiAnim.rays(modal, 360);
        glow.rays.alpha = 0;
        glow.rays.y = -90;
        track(glow.tweens);
        track([gsap.to(glow.rays, { alpha: 1, duration: 0.6, delay: 0.3 })]);
        track(UiAnim.popIn(modal));
        track(UiAnim.dropIn(parts.ribbon, 90, 0.12));
        track(UiAnim.dropIn(parts.title, 90, 0.12));
        track(UiAnim.confetti(modal, -160, -150, 45, 0.8));
        track(UiAnim.confetti(modal, 160, -150, 45, 0.8));

        const starStart = 0.45;
        const starStep = 0.32;
        parts.earnedStars.forEach((star, index) => {
            const scale = star.scale.x;
            const rotation = star.rotation;
            star.scale.set(0);
            star.rotation = rotation - 0.6;
            const delay = starStart + index * starStep;
            track([
                gsap.to(star.scale, { x: scale, y: scale, duration: 0.5, delay, ease: 'elastic.out(1.2, 0.45)' }),
                gsap.to(star, { rotation, duration: 0.4, delay, ease: 'back.out(2)' }),
                gsap.delayedCall(delay, () => {
                    if (this.destroyed || star.destroyed) {
                        return;
                    }
                    GameAudio.play(STAR_CUES[Math.min(index, STAR_CUES.length - 1)]);
                    track(UiAnim.sparkBurst(parts.starRow, star.x, star.y, 0xffe066, 64));
                    track(UiAnim.punch(modal, 0.03));
                }),
            ]);
        });
        const afterStars = starStart + Math.max(1, parts.earnedStars.length) * starStep;
        const moneyLabel = `$${parts.securedMoney}`;
        if (parts.totalText.includes(moneyLabel)) {
            track(UiAnim.countUp(parts.total, 0, parts.securedMoney, (value) => parts.totalText.replace(moneyLabel, `$${value}`), 0.7, afterStars - 0.2));
        }
        track(UiAnim.staggerRise([parts.totalRow, ...parts.details], afterStars - 0.25, 0.1, 24));
        parts.button.eventMode = 'none';
        const buttonScale = parts.button.scale.x;
        parts.button.scale.set(0);
        track([gsap.to(parts.button.scale, {
            x: buttonScale,
            y: buttonScale,
            duration: 0.45,
            delay: afterStars + 0.35,
            ease: 'back.out(2.4)',
            onComplete: () => {
                if (this.destroyed || parts.button.destroyed) {
                    return;
                }
                parts.button.eventMode = 'static';
                track(UiAnim.pulse(parts.button, 0.06, 0.6));
            },
        })]);
    }

    /** "2-3" = world 2, level 3 ("T-2" in the tutorial); falls back to the flat campaign number for levels outside every world. */
    private levelLabel(): string {
        const found = LevelCatalog.locate(this.level);
        return found ? `${found.world.label}-${found.levelNumber}` : String(LevelCatalog.all().indexOf(this.level) + 1);
    }

    private refreshRunMoney(): void {
        if (this.runMoneyLabel && this.cashPill && this.cashPillBackground && this.cashPillCoin) {
            this.runMoneyLabel.text = `$${this.runMoney}`;
            const textWidth = this.runMoneyLabel.width;
            const width = textWidth + 84;
            this.cashPillBackground.clear()
                .beginFill(0x103a1c, 0.82).lineStyle(3, 0x6dff8a, 0.9)
                .drawRoundedRect(-width / 2, -26, width, 52, 26).endFill();
            this.cashPillCoin.position.set(-width / 2 + 30, 0);
            this.runMoneyLabel.position.set(-width / 2 + 54 + textWidth / 2, 0);
            gsap.killTweensOf(this.cashPill.scale);
            this.cashPill.scale.set(1.18);
            gsap.to(this.cashPill.scale, { x: 1, y: 1, duration: 0.3, ease: 'back.out(3)' });
        }
    }

    /** Low, close camera used for both the win dance and the busted reaction. */
    private focusCameraOnPlayer(): void {
        const currentCamera = this.env.cameraSystem.current;
        this.env.cameraSystem.register('celebration', {
            ...currentCamera,
            pitchDeg: Math.min(currentCamera.pitchDeg, CELEBRATION_PITCH_DEG),
            distance: CELEBRATION_DISTANCE,
            followSpeed: 5,
            offset: { ...currentCamera.offset, y: 1 },
        });
        this.env.cameraSystem.blendTo('celebration', 0.8);
    }

    /** Frames player and guard side by side: the camera looks at their midpoint from the direction perpendicular to the line between them. */
    private focusCameraOnBustPair(guard: Spotter): void {
        const player = this.env.mainPlayer.transform.position;
        const dx = guard.position.x - player.x;
        const dz = guard.position.z - player.z;
        const separation = Math.hypot(dx, dz);
        this.bustFocusPoint.set((player.x + guard.position.x) / 2, 0, (player.z + guard.position.z) / 2);

        let sideX = dz;
        let sideZ = -dx;
        if (separation < 0.001) {
            sideX = 0;
            sideZ = 1;
        } else if (sideZ < 0) {
            sideX = -sideX;
            sideZ = -sideZ;
        }
        const targetYaw = THREE.MathUtils.radToDeg(Math.atan2(sideX, sideZ));
        const fromYaw = this.pathCameraOptions.fixedYawDeg ?? 0;
        this.bustCameraOptions.fixedYawDeg = fromYaw;
        // Shortest way round, so the camera never swings the long way.
        const wrapped = fromYaw + THREE.MathUtils.euclideanModulo(targetYaw - fromYaw + 180, 360) - 180;

        const settings = this.env.cameraSystem.current;
        const halfFovTangent = Math.tan(THREE.MathUtils.degToRad(this.threeCamera.fov / 2));
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        const fitDistance = (separation + BUST_FRAME_MARGIN) / (2 * halfFovTangent * aspect);
        this.env.cameraSystem.register('celebration', {
            ...settings,
            pitchDeg: Math.min(settings.pitchDeg, CELEBRATION_PITCH_DEG),
            distance: Math.max(CELEBRATION_DISTANCE, fitDistance),
            followSpeed: 5,
            offset: { ...settings.offset, y: 1 },
        });
        this.env.cameraSystem.blendTo('celebration', 0.8);

        this.bustYawTween?.kill();
        this.bustYawTween = gsap.to(this.bustCameraOptions, { fixedYawDeg: wrapped, duration: 0.8, ease: 'sine.inOut' });
    }

    /** Frames the whole lined-up squad from the front so everyone is in the final shot. */
    private focusCameraOnSquad(): void {
        const box = new THREE.Box3().makeEmpty();
        for (const member of this.members) {
            box.expandByPoint(member.player.transform.position);
        }
        const center = box.getCenter(new THREE.Vector3());
        this.bustFocusPoint.set(center.x, 0, center.z);
        this.groupCelebration = true;
        const width = box.max.x - box.min.x;
        const settings = this.env.cameraSystem.current;
        const halfFovTangent = Math.tan(THREE.MathUtils.degToRad(this.threeCamera.fov / 2));
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        const fitDistance = (width + SQUAD_FRAME_MARGIN) / (2 * halfFovTangent * aspect);
        this.env.cameraSystem.register('celebration', {
            ...settings,
            pitchDeg: Math.min(settings.pitchDeg, CELEBRATION_PITCH_DEG),
            distance: Math.max(SQUAD_MIN_DISTANCE, fitDistance),
            followSpeed: 5,
            offset: { ...settings.offset, y: 1 },
        });
        this.env.cameraSystem.blendTo('celebration', 0.8);
    }

    private async beginCelebration(): Promise<void> {
        if (this.state === 'celebrating' || this.state === 'payout' || this.state === 'complete') {
            return;
        }
        this.state = 'celebrating';
        GameAudio.play('victory');
        GameAudio.play('cheer');
        GameAudio.play('applause');
        this.showCelebrationBanner();
        // A still-running path framing tween would otherwise keep fighting the finale camera.
        this.cameraBlendTween?.kill();
        this.cameraBlendTween = undefined;
        this.env.mainPlayer.movementController.enabled = false;

        const squad = this.members.length > 1;
        if (squad) {
            this.focusCameraOnSquad();
        } else {
            this.focusCameraOnPlayer();
        }
        this.setInstruction('THE GETAWAY!');
        // Started now so animation loading doesn't delay the meter.
        const danceDone = new Promise<void>((resolve) => setTimeout(resolve, CELEBRATION_DANCE_SEC * 1000));

        const dancers = squad ? this.members.map((member) => member.player) : [this.env.mainPlayer];
        for (const dancer of dancers) {
            dancer.movementController.enabled = false;
            const towardCamera = this.threeCamera.position.clone().sub(dancer.transform.position);
            dancer.character?.faceDirection(towardCamera.x, towardCamera.z);
        }

        try {
            await this.env.playerReady;
            if (this.destroyed) {
                return;
            }
            await Promise.all(dancers.map(async (dancer, index) => {
                const character = dancer.character;
                if (character) {
                    const url = squad ? SQUAD_DANCE_URLS[index % SQUAD_DANCE_URLS.length] : CELEBRATION_ANIMATION_URL;
                    await character.registerAnimation('celebration', url);
                    character.animator.playExclusive('celebration', 0.25, true);
                }
            }));
        } catch (error) {
            console.warn('[PathLevelScene] Could not load celebration animation', error);
        }

        if (!this.destroyed) {
            this.payOutCollectedMoney(danceDone);
        }
    }

    private payOutCollectedMoney(danceDone: Promise<void>): void {
        const showPopupAfterDance = (): void => {
            void danceDone.then(() => {
                if (!this.destroyed) {
                    this.showBonusMeter();
                }
            });
        };
        this.state = 'payout';
        const payouts = this.collectedPayouts.splice(0);
        if (payouts.length === 0) {
            showPopupAfterDance();
            return;
        }

        let remaining = payouts.length;
        const fromWorld = this.env.mainPlayer.getCollectTargetPosition().clone();
        const texture = this.moneyHud.getIconTexture() ?? PIXI.Texture.WHITE;
        payouts.forEach((amount, index) => {
            const flight = spawnFlyingIconToOverlayPoint(
                this,
                this.game,
                fromWorld,
                () => this.moneyHud.getMoneyIconOverlayPosition(),
                texture,
                () => {
                    if (this.destroyed) {
                        return;
                    }
                    GameState.addMoney(amount);
                    this.moneyHud.setResourceCount(GameState.getMoney());
                    remaining--;
                    if (remaining === 0) {
                        showPopupAfterDance();
                    }
                },
                index * PAYOUT_STAGGER_SEC,
            );
            this.payoutFlights.push(flight);
        });
    }

    private finishFreePath(): void {
        const movement = this.env.mainPlayer.movementController;
        movement.enabled = false;
        movement.exitPathMode();
        this.state = 'waiting';
        this.route = [];
        this.routeBlocked = false;
        this.clearRoute();
        this.setInstruction('TRACE FROM THE PLAYER; RELEASE ANYWHERE');
    }

    private advanceWaypoint(): void {
        GameAudio.play('checkpoint');
        const movement = this.env.mainPlayer.movementController;
        movement.enabled = false;
        movement.exitPathMode();
        this.activeStart.copy(this.activeGoal);
        this.nextWaypointIndex++;
        this.activeGoal.copy(this.waypoints[this.nextWaypointIndex]);
        this.state = 'waiting';
        this.route = [];
        this.routeBlocked = false;
        this.clearRoute();
        this.frameActiveSegment();
        this.setInstruction(this.pathDrawMode === 'free'
            ? 'TRACE FROM THE PLAYER; RELEASE ANYWHERE'
            : 'CHECKPOINT REACHED; TRACE TO THE VAULT EXIT');
    }

    private revealArea(index: number): void {
        if (index <= this.revealedUpTo) {
            return;
        }
        this.revealedUpTo = index;
        for (const [groupIndex, group] of this.revealGroups) {
            group.visible = groupIndex <= index;
        }
        this.buildCollectibles(index);
    }

    /** Characters start looking into the level: along the dominant axis from their start toward the floor centre. */
    private faceStartDirections(): void {
        for (const member of this.members) {
            if (this.startFaced.has(member) || !member.player.character) {
                continue;
            }
            const dx = -member.start.x;
            const dz = -member.start.z;
            if (Math.abs(dx) > Math.abs(dz)) {
                member.player.character.faceDirection(Math.sign(dx), 0, true);
            } else {
                member.player.character.faceDirection(0, Math.sign(dz) || -1, true);
            }
            this.startFaced.add(member);
        }
    }

    /** Inside the safe room: keep walking to the member's own slot, then turn to face the camera. */
    private beginHomeWalk(): void {
        if (this.state !== 'following') {
            return;
        }
        this.state = 'revealing';
        const member = this.focused!;
        const movement = member.player.movementController;
        const slot = this.activeGoal.clone();
        movement.enabled = true;
        movement.enterPathMode([member.player.transform.position.clone(), slot]);
        this.homeWalks.push({ member, slot });
    }

    private updateHomeWalks(): void {
        if (this.homeWalks.length === 0) {
            return;
        }
        for (const walk of [...this.homeWalks]) {
            const player = walk.member.player;
            const arrived = player.movementController.isPathComplete
                || this.distanceXZ(player.transform.position, walk.slot) <= 0.12;
            if (!arrived || this.isEnded()) {
                continue;
            }
            this.homeWalks = this.homeWalks.filter((entry) => entry !== walk);
            player.movementController.exitPathMode();
            player.movementController.enabled = false;
            const towardCamera = this.threeCamera.position.clone().sub(player.transform.position);
            player.character?.faceDirection(towardCamera.x, towardCamera.z);
            this.runAsMember(walk.member, () => {
                if (this.state !== 'revealing') {
                    return;
                }
                this.route = [];
                this.routeBlocked = false;
                this.clearRoute();
                this.completeMember();
            });
        }
    }

    private beginGoalArrival(): void {
        if (this.state !== 'following') {
            return;
        }
        this.state = 'revealing';
        const movement = this.env.mainPlayer.movementController;
        movement.enabled = false;
        movement.exitPathMode();

        const member = this.focused!;
        const playerPosition = member.player.transform.position;
        const tween = gsap.to(playerPosition, {
            x: this.activeGoal.x,
            z: this.activeGoal.z,
            duration: 0.28,
            ease: 'power2.out',
            onComplete: () => {
                this.goalArrivalTweens = this.goalArrivalTweens.filter((entry) => entry !== tween);
                if (this.destroyed || this.isEnded()) {
                    return;
                }
                this.runAsMember(member, () => {
                    if (this.state !== 'revealing') {
                        return;
                    }
                    this.route = [];
                    this.routeBlocked = false;
                    this.clearRoute();
                    if (this.nextWaypointIndex < this.waypoints.length - 1) {
                        this.revealArea(this.nextWaypointIndex);
                        // Each member shows its own next goal, even if another member already revealed this area.
                        const nextGoal = this.waypoints[this.nextWaypointIndex + 1];
                        if (nextGoal && shouldShowWaypointMarker(this.level, this.nextWaypointIndex + 1, this.waypoints.length)) {
                            this.addMarker(nextGoal, this.focused?.color ?? GOAL_COLOR, GOAL_MARKER_RADIUS);
                        }
                        this.advanceWaypoint();
                    } else {
                        this.completeMember();
                    }
                });
            },
        });
        this.goalArrivalTweens.push(tween);
    }

    /** Checkpoint and goal arrival for the member currently held in the scene fields. */
    private updateMemberProgress(): void {
        const lastIndex = this.waypoints.length - 1;
        if (this.state === 'following' && this.nextWaypointIndex >= lastIndex
            && this.insideFinishArea(this.env.mainPlayer.transform.position)) {
            this.activeGoal.copy(this.waypoints[lastIndex]);
            this.beginHomeWalk();
            return;
        }
        if (this.state === 'following' && this.stopAtCheckpoints) {
            const checkpoint = this.waypoints[this.nextWaypointIndex];
            if (checkpoint && this.distanceXZ(this.env.mainPlayer.transform.position, checkpoint) <= CHECKPOINT_STOP_RADIUS) {
                this.activeGoal.copy(checkpoint);
                this.beginGoalArrival();
            }
        }
        if (this.state === 'following') {
            const movementComplete = this.env.mainPlayer.movementController.isPathComplete;
            if (this.pathDrawMode === 'free') {
                if (movementComplete) {
                    const waypoint = this.waypoints[this.nextWaypointIndex];
                    if (waypoint && this.distanceXZ(this.env.mainPlayer.transform.position, waypoint) <= GOAL_TRIGGER_RADIUS) {
                        this.activeGoal.copy(waypoint);
                        this.beginGoalArrival();
                    } else {
                        this.finishFreePath();
                    }
                }
            } else {
                const distanceToGoal = this.distanceXZ(this.env.mainPlayer.transform.position, this.activeGoal);
                const finalGoal = this.nextWaypointIndex >= this.waypoints.length - 1;
                if (finalGoal) {
                    if (movementComplete && distanceToGoal <= 0.75) {
                        this.beginGoalArrival();
                    } else if (movementComplete) {
                        this.finishFreePath();
                    }
                } else if (distanceToGoal <= GOAL_TRIGGER_RADIUS) {
                    this.beginGoalArrival();
                }
            }
        }
    }

    public update(delta: number): void {
        if (this.state === 'waiting') {
            const movement = this.env.mainPlayer.movementController;
            if (movement.enabled !== PLAYER_SETTINGS.clickToMoveEnabled) {
                movement.enabled = PLAYER_SETTINGS.clickToMoveEnabled;
            }
        }
        this.env.update(delta);
        this.updateGoalParticles(delta);
        this.updateDragHint();
        this.faceStartDirections();
        this.updateHomeWalks();
        this.updateSelectionHalo();
        PizzaParticleSystem.update(delta);
        this.updateWallHeight();
        PizzaBendService.updateTime(delta);
        for (const door of this.wallDoors) {
            door.update(delta, this.doorWorld);
        }
        pruneCollected(this.env.world, this.collectibles);
        this.updateGuards(delta);
        this.updateMemberProgress();
        this.refreshSquadHud();
        for (const member of this.members) {
            if (member !== this.focused && member.state === 'following' && !this.isEnded()) {
                this.runAsMember(member, () => this.updateMemberProgress());
            }
        }
        super.update(delta);
    }

    private buildGuards(): void {
        this.destroyGuards();
        this.spottedMessageShown = false;
        this.bustGuard = undefined;
        this.bustFocus = false;
        this.bustYawTween?.kill();
        const sight = new LevelSight(this.level);
        for (const data of this.level.guards ?? []) {
            if (data.path.length === 0) {
                continue;
            }
            const guard = new Guard(this.threeScene, data, sight, BendService);
            guard.load().catch((error) => console.warn('[PathLevelScene] Could not load guard', error));
            this.guards.push(guard);
        }
        for (const data of this.level.cameras ?? []) {
            this.guards.push(new SecurityCamera(this.threeScene, data, sight, BendService));
        }
        for (const data of this.level.drones ?? []) {
            if (data.path.length > 1) {
                this.guards.push(new Drone(this.threeScene, data, sight, BendService));
            }
        }
        for (const data of this.level.traps ?? []) {
            this.guards.push(new Trap(this.threeScene, data, BendService));
        }
    }

    private destroyGuards(): void {
        for (const guard of this.guards) {
            guard.destroy();
        }
        this.guards = [];
    }

    /** Patrols only run while the player is walking their path, so a level is a timing puzzle the player can study while planning. */
    private updateGuards(delta: number): void {
        if (this.guards.length === 0) {
            return;
        }
        if (this.state === 'busted') {
            this.updateBustedSequence(delta);
            return;
        }
        const walking = this.state === 'following' || this.state === 'waiting' || this.state === 'revealing';
        // Every member still in play can be spotted, focused or not.
        const targets = this.members.filter((member) => {
            const state = this.memberState(member);
            return state === 'waiting' || state === 'following';
        });
        let highestAlert = 0;
        let spotter: Spotter | undefined;
        for (const guard of this.guards) {
            if (!walking) {
                guard.hold();
            } else {
                let target: SquadMember | undefined;
                let tooClose = false;
                for (const member of targets) {
                    const position = member.player.transform.position;
                    if (guard.isTooClose(position)) {
                        target = member;
                        tooClose = true;
                        break;
                    }
                    if (!target && guard.sees(position)) {
                        target = member;
                    }
                }
                const seen = Boolean(target);
                if (target) {
                    guard.focusOn(target.player.transform.position);
                    this.guardTargets.set(guard, target);
                }
                guard.advance(delta);
                guard.alert = tooClose
                    ? 1
                    : seen
                    ? Math.min(1, guard.alert + delta / SPOT_TIME_SEC)
                    : Math.max(0, guard.alert - delta * ALERT_DECAY_PER_SEC);
            }
            guard.render(delta);
            if (guard.alert >= highestAlert) {
                highestAlert = guard.alert;
                spotter = guard;
            }
        }
        if (walking && highestAlert > 0) {
            this.spotted = true;
        }
        this.updateSpottedMessage(highestAlert);
        if (walking && highestAlert >= 1 && spotter) {
            const caught = this.guardTargets.get(spotter) ?? this.focused;
            if (caught && targets.includes(caught)) {
                this.swapTo(caught);
                this.beginBusted(spotter);
            }
        }
    }

    private updateBustedSequence(delta: number): void {
        const guard = this.bustGuard;
        const player = this.env.mainPlayer.transform.position;
        for (const other of this.guards) {
            if (other === guard) {
                continue;
            }
            other.hold();
            other.render(delta);
        }
        if (!guard) {
            return;
        }
        if (this.bustPhase === 'chase') {
            this.bustTimer += delta;
            // Walls are in the way more often than not: run the nav-grid route, then close in on the player.
            let arrived = false;
            const corner = this.bustChaseRoute[0];
            if (corner && this.bustChaseRoute.length > 1) {
                if (guard.chase(this.bustChasePoint.set(corner.x, 0, corner.z), delta, BUST_ROUTE_CORNER_REACH)) {
                    this.bustChaseRoute.shift();
                }
            } else {
                arrived = guard.chase(player, delta);
            }
            // Safety net: never let a chase run forever.
            if (arrived || this.bustTimer > BUST_CHASE_TIMEOUT_SEC) {
                this.bustPhase = 'react';
                this.bustTimer = 0;
                guard.faceToward(player);
                guard.playAngry();
                this.playPlayerSad(guard);
                this.bustFocus = true;
                this.focusCameraOnBustPair(guard);
            }
        } else {
            this.bustTimer += delta;
            if (this.bustTimer >= BUSTED_REACTION_SEC && !this.bustedModal) {
                this.showBustedPopup();
            }
        }
        guard.render(delta);
    }

    private playPlayerSad(guard: Spotter): void {
        const character = this.env.mainPlayer.character;
        if (!character) {
            return;
        }
        character.faceDirection(guard.position.x - this.env.mainPlayer.transform.position.x, guard.position.z - this.env.mainPlayer.transform.position.z);
        void (this.sadAnimationLoad ?? Promise.resolve()).then(() => {
            if (!this.destroyed && this.state === 'busted') {
                character.animator.playExclusive('sad', 0.3, true);
            }
        });
    }

    private updateSpottedMessage(highestAlert: number): void {
        if (!this.instruction) {
            return;
        }
        const playing = this.state === 'following' || this.state === 'waiting';
        if (highestAlert > 0.15 && playing && !this.spottedMessageShown) {
            this.spottedMessageShown = true;
            GameAudio.play('spotted');
            this.messageBeforeSpotted = this.instruction.text;
            this.setInstruction('SPOTTED! GET OUT OF SIGHT!');
        } else if (this.spottedMessageShown && (highestAlert <= 0.01 || !playing)) {
            this.spottedMessageShown = false;
            if (playing) {
                this.setInstruction(this.messageBeforeSpotted);
            }
        }
    }

    private beginBusted(spotter: Spotter): void {
        if (this.state !== 'following' && this.state !== 'waiting') {
            return;
        }
        this.state = 'busted';
        GameAnalytics.levelFail(this.level, spotter instanceof SecurityCamera ? 'camera' : spotter instanceof Drone ? 'drone' : spotter instanceof Trap ? 'trap' : 'guard');
        GameAudio.play('busted');
        for (const other of this.members) {
            if (other !== this.focused && other.state === 'following') {
                other.player.movementController.enabled = false;
                other.player.movementController.exitPathMode();
            }
        }
        this.bustGuard = spotter;
        this.bustPhase = 'chase';
        const playerPosition = this.env.mainPlayer.transform.position;
        this.bustChaseRoute = (this.navGrid?.findPath(spotter.position, playerPosition) ?? []).slice(1);
        this.bustTimer = 0;
        const movement = this.env.mainPlayer.movementController;
        movement.enabled = false;
        movement.exitPathMode();
        this.route = [];
        this.clearRoute();
        this.setInstruction('BUSTED!');
        for (const guard of this.guards) {
            guard.setConeVisible(false);
        }
        spotter.alert = 1;
        void TextureBuilder.load(resolveSkinImagePath(BUSTED_FACE))
            .then((texture) => this.env.mainPlayer.character?.setFaceTexture(texture))
            .catch((error) => console.warn('[PathLevelScene] Could not load busted face', error));
        // Loaded now; a quick catch (guard already beside you, camera, trap) reacts before it finishes, so playPlayerSad waits on it.
        this.sadAnimationLoad = this.env.mainPlayer.character?.registerAnimation('sad', SAD_ANIMATION_URL)
            .catch((error) => console.warn('[PathLevelScene] Could not load sad animation', error));
    }

    private showBustedPopup(): void {
        GameAudio.play('lose');
        const modal = new PIXI.Container();
        const panel = UiKit.image('busted', 'panel', 380, 230);

        const ribbon = UiKit.sprite('busted', 'ribbon', 1.1);
        ribbon.position.set(0, -115);
        const title = UiKit.text('busted', 'title');
        title.position.set(0, -112);

        const message = UiKit.text('busted', 'message');
        message.position.set(0, -35);
        if (this.bustGuard instanceof SecurityCamera) {
            message.text = 'A security camera spotted you.\nWatch its sweep and time it.';
        } else if (this.bustGuard instanceof Trap) {
            message.text = 'You stepped on the spikes!\nCross while they are down.';
        } else if (this.bustGuard instanceof Drone) {
            message.text = 'A drone lit you up.\nSlip past when it flies away.';
        }

        const button = new PIXI.Container();
        const buttonBg = UiKit.image('busted', 'button', 240, 90);
        const buttonLabel = UiKit.text('busted', 'buttonLabel');
        button.addChild(buttonBg, buttonLabel);
        button.scale.set(0.7);
        button.position.set(0, 50);
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointertap', () => void this.adBreakThen(() => this.onRestart.dispatch()));

        modal.addChild(panel, ribbon, title, message, button);
        this.panelExtents.set(modal, 135);
        this.positionBottomPanel(modal);
        this.game.uiLayer.addChild(modal);
        this.bustedModal = modal;
        // Slams in, rattles, then the retry button springs up and breathes.
        modal.alpha = 0;
        this.uiTweens.push(
            gsap.fromTo(modal.scale, { x: 1.6, y: 1.6 }, { x: 1, y: 1, duration: 0.3, ease: 'power3.in' }),
            gsap.to(modal, { alpha: 1, duration: 0.15 }),
            gsap.delayedCall(0.3, () => {
                if (!this.destroyed && !modal.destroyed) {
                    this.uiTweens.push(...UiAnim.shake(modal, 14, 0.4));
                }
            }),
            ...UiAnim.dropIn(ribbon, 70, 0.3),
            ...UiAnim.dropIn(title, 70, 0.3),
            ...UiAnim.staggerRise([message], 0.45, 0, 20),
        );
        const buttonScale = button.scale.x;
        button.scale.set(0);
        this.uiTweens.push(gsap.to(button.scale, {
            x: buttonScale,
            y: buttonScale,
            duration: 0.4,
            delay: 0.65,
            ease: 'back.out(2.4)',
            onComplete: () => {
                if (!this.destroyed && !button.destroyed) {
                    this.uiTweens.push(...UiAnim.pulse(button, 0.06, 0.6));
                }
            },
        }));
    }

    private updateWallHeight(): void {
        const position = this.env.mainPlayer.transform.position;
        const insideRoom = this.wallsAlwaysLow || (Math.abs(position.x) < this.level.floor.width / 2 - 0.2
            && Math.abs(position.z) < this.level.floor.depth / 2 - 0.2);
        if (insideRoom === this.wallsLowered) {
            return;
        }
        this.wallsLowered = insideRoom;
        for (let index = 0; index < this.wallMeshes.length; index++) {
            const normalWall = this.wallMeshes[index];
            const clearLintelWall = this.wallLintelClearMeshes[index];
            gsap.killTweensOf(normalWall.scale);
            gsap.killTweensOf(clearLintelWall.scale);

            if (insideRoom) {
                normalWall.visible = true;
                clearLintelWall.visible = false;
                gsap.to(normalWall.scale, {
                    y: LOWERED_WALL_SCALE,
                    duration: WALL_LOWER_DURATION_SEC,
                    ease: 'power2.inOut',
                    onComplete: () => {
                        if (this.destroyed || !this.wallsLowered) {
                            return;
                        }
                        normalWall.visible = false;
                        clearLintelWall.scale.y = LOWERED_WALL_SCALE;
                        clearLintelWall.visible = true;
                    },
                });
            } else if (clearLintelWall.visible) {
                normalWall.visible = false;
                clearLintelWall.visible = true;
                gsap.to(clearLintelWall.scale, {
                    y: 1,
                    duration: WALL_LOWER_DURATION_SEC,
                    ease: 'power2.inOut',
                    onComplete: () => {
                        if (this.destroyed || this.wallsLowered) {
                            return;
                        }
                        clearLintelWall.visible = false;
                        normalWall.scale.y = 1;
                        normalWall.visible = true;
                    },
                });
            } else {
                normalWall.visible = true;
                clearLintelWall.visible = false;
                gsap.to(normalWall.scale, {
                    y: 1,
                    duration: WALL_LOWER_DURATION_SEC,
                    ease: 'power2.inOut',
                });
            }
        }
    }

    public fixedUpdate(delta: number): void {
        this.env.fixedUpdate(delta);
        const cameraOptions = this.state === 'celebrating' || this.state === 'payout' || this.state === 'complete' || this.bustFocus
            ? (this.bustFocus ? this.bustCameraOptions : this.groupCelebration ? this.groupCameraOptions : CELEBRATION_CAMERA_OPTIONS)
            : this.pathCameraOptions;
        this.syncCameraTuning();
        this.reframeIfPlayerLeavesBounds();
        this.env.updateCamera(this.threeCamera, delta, cameraOptions);
        this.applyScreenShift(delta);
        const playerPosition = this.env.mainPlayer.transform.position;
        PizzaBendService.updateOrigin(playerPosition);
        PizzaBendService.updateOcclusionTarget(this.occlusionTarget.set(
            playerPosition.x,
            playerPosition.y + PLAYER_SETTINGS.collectTargetHeight,
            playerPosition.z,
        ));
        PizzaBendService.updateCameraPosition(this.threeCamera.position);
    }

    /** The shot is fixed for the whole step; it only widens when the player actually walks out of the framed area. */
    private reframeIfPlayerLeavesBounds(): void {
        if (this.overview || this.state !== 'following' || this.cameraBlendTween || this.frameBounds.isEmpty()) {
            return;
        }
        const player = this.env.mainPlayer.transform.position;
        const margin = CAMERA_BOUNDS_PADDING * 0.5;
        const bounds = this.frameBounds;
        if (player.x < bounds.min.x + margin || player.x > bounds.max.x - margin
            || player.z < bounds.min.z + margin || player.z > bounds.max.z - margin) {
            this.frameActiveSegment();
        }
    }

    private applyScreenShift(delta = 0): void {
        const width = window.innerWidth;
        const height = Math.max(1, window.innerHeight);
        const camera = this.threeCamera;
        const aiming = this.state === 'waiting' || this.state === 'revealing';
        if (!this.cameraBlendTween && this.state !== 'following' && !aiming) {
            this.screenShiftFraction = delta > 0
                ? THREE.MathUtils.lerp(this.screenShiftFraction, SCREEN_VERTICAL_SHIFT, 1 - Math.exp(-delta * 3))
                : SCREEN_VERTICAL_SHIFT;
        }
        const offsetY = -this.screenShiftFraction * height;
        const view = camera.view;
        if (view?.enabled && view.fullWidth === width && view.fullHeight === height && view.offsetY === offsetY) {
            return;
        }
        camera.setViewOffset(width, height, 0, offsetY, width, height);
    }

    public resize(): void {
        this.applyScreenShift();
        if (this.state === 'waiting' || this.state === 'following') {
            this.frameActiveSegment(true);
        }
        if (this.instruction) {
            this.instruction.position.set(Game.overlayScreenData.center.x, Game.overlayScreenData.topLeft.y + 42);
        }
        if (this.worldLabel) {
            // Level number sits bottom-right, under the MAP button and its caption.
            this.worldLabel.position.set(Game.overlayScreenData.topRight.x - 52, Game.overlayScreenData.topLeft.y + Game.overlayScreenData.height - 28);
        }
        if (this.homeButton) {
            this.homeButton.position.set(Game.overlayScreenData.topRight.x - 118, Game.overlayScreenData.topLeft.y + 44);
        }
        if (this.squadBar) {
            this.squadBar.position.set(Game.overlayScreenData.center.x, Game.overlayScreenData.topLeft.y + Game.overlayScreenData.height - 70);
        }
        if (this.mapButton) {
            this.mapButton.position.set(Game.overlayScreenData.topRight.x - 52, Game.overlayScreenData.topLeft.y + Game.overlayScreenData.height - 104);
        }
        if (this.cashPill) {
            this.cashPill.position.set(Game.overlayScreenData.center.x, Game.overlayScreenData.topLeft.y + 66);
        }
        if (this.completeModal) {
            this.positionBottomPanel(this.completeModal);
        }
        if (this.bonusMeter) {
            this.positionBottomPanel(this.bonusMeter);
        }
        if (this.bustedModal) {
            this.positionBottomPanel(this.bustedModal);
        }
    }

    /**
     * Frames the section as one fixed shot: the bounds of the segment start, goal, the drawn route and the
     * player, plus padding. The camera only moves when those bounds change (new segment / new path), so
     * walking inside the section never zooms or pans.
     */
    private frameActiveSegment(instant = false): void {
        if (!this.env?.mainPlayer || this.inBackground) {
            return;
        }
        const cameraSettings = this.env.cameraSystem.current;
        const bounds = new THREE.Box3().makeEmpty();
        if (this.overview) {
            this.frameOverview(bounds);
            this.applyFrame(bounds, instant, cameraSettings);
            return;
        }
        const extend = (point: THREE.Vector3) => bounds.expandByPoint(this.boundsProbe.set(point.x, 0, point.z));
        extend(this.activeStart);
        extend(this.activeGoal);
        // activeGoal is the end of a free-drawn path, so the real checkpoint must be framed explicitly.
        const checkpoint = this.waypoints[this.nextWaypointIndex];
        if (checkpoint) {
            extend(checkpoint);
        }
        extend(this.env.mainPlayer.transform.position);
        const room = this.level.sharedGoal;
        if (room && this.sharedGoalActive && this.nextWaypointIndex >= this.waypoints.length - 1) {
            extend(this.boundsRoomPoint.set(room.x - room.width / 2, 0, room.z - room.depth / 2));
            extend(this.boundsRoomPoint.set(room.x + room.width / 2, 0, room.z + room.depth / 2));
        }
        // Heading for the vault: the whole room (safe included) is the goal, so it is always fully in shot.
        const vault = this.level.vault;
        if (vault && this.nextWaypointIndex >= this.waypoints.length - 1) {
            extend(this.boundsRoomPoint.set(vault.x - vault.width / 2, 0, vault.z - vault.depth / 2));
            extend(this.boundsRoomPoint.set(vault.x + vault.width / 2, 0, vault.z + vault.depth / 2));
        }
        for (const point of this.route) {
            extend(point);
        }
        // Squad: keep every idle member and its goal in the shot so nobody is off screen.
        for (const other of this.members) {
            if (other !== this.focused && this.memberState(other) !== 'done') {
                extend(other.player.transform.position);
                extend(other.waypoints[other.nextWaypointIndex] ?? other.goal);
            }
        }
        // Clamp to the level's real extent: side vaults sit outside floor.width and must not be cut off.
        const levelMinX = Math.min(-this.level.floor.width / 2, ...(vault ? [vault.x - vault.width / 2] : []));
        const levelMaxX = Math.max(this.level.floor.width / 2, ...(vault ? [vault.x + vault.width / 2] : []));
        bounds.min.x = Math.max(bounds.min.x, levelMinX - 2);
        bounds.max.x = Math.min(bounds.max.x, levelMaxX + 2);
        const floorHalfX = (levelMaxX - levelMinX) / 2;
        // A section is never framed narrower than this, so a straight path doesn't zoom in to a sliver.
        const minHalfWidth = Math.min(floorHalfX, CAMERA_MIN_HALF_WIDTH);
        const centerX = (bounds.min.x + bounds.max.x) / 2;
        bounds.min.x = Math.min(bounds.min.x, centerX - minHalfWidth);
        bounds.max.x = Math.max(bounds.max.x, centerX + minHalfWidth);
        // Same for depth: a sideways step (start and goal on one line) would otherwise be framed as a thin strip.
        const centerZ = (bounds.min.z + bounds.max.z) / 2;
        bounds.min.z = Math.min(bounds.min.z, centerZ - CAMERA_MIN_HALF_DEPTH);
        bounds.max.z = Math.max(bounds.max.z, centerZ + CAMERA_MIN_HALF_DEPTH);
        bounds.expandByVector(this.boundsProbe.set(CAMERA_BOUNDS_PADDING, 0, CAMERA_BOUNDS_PADDING));

        this.applyFrame(bounds, instant, cameraSettings);
    }

    private applyFrame(bounds: THREE.Box3, instant: boolean, cameraSettings: { distance: number }): void {
        this.frameBounds.copy(bounds);
        bounds.getCenter(this.focusGoal);
        const fit = this.fitBounds(bounds, this.focusGoal);

        this.cameraBlendTween?.kill();
        this.cameraBlendTween = undefined;
        if (instant) {
            cameraSettings.distance = fit.distance;
            this.segmentFocus.copy(this.focusGoal);
            this.screenShiftFraction = fit.shift;
        } else {
            // Position, zoom and screen shift all ride ONE progress value, so they start, peak and stop together.
            const fromFocus = this.segmentFocus.clone();
            const fromDistance = cameraSettings.distance;
            const fromShift = this.screenShiftFraction;
            const progress = { t: 0 };
            this.cameraBlendTween = gsap.to(progress, {
                t: 1,
                duration: CAMERA_TRANSITION_SEC,
                ease: 'sine.inOut',
                onUpdate: () => {
                    this.segmentFocus.lerpVectors(fromFocus, this.focusGoal, progress.t);
                    cameraSettings.distance = THREE.MathUtils.lerp(fromDistance, fit.distance, progress.t);
                    this.screenShiftFraction = THREE.MathUtils.lerp(fromShift, fit.shift, progress.t);
                },
                onComplete: () => {
                    this.cameraBlendTween = undefined;
                },
            });
        }
        this.threeCamera.updateProjectionMatrix();
        if (instant) {
            this.env.updateCamera(this.threeCamera, 0, this.pathCameraOptions);
        }
    }

    /** Whole-level shot: every floor piece, the entry path and everyone in play. */
    private frameOverview(bounds: THREE.Box3): void {
        const floor = this.level.floor;
        const rects = floor.rects?.length ? floor.rects : [{ x: 0, z: 0, width: floor.width, depth: floor.depth }];
        for (const rect of rects) {
            bounds.expandByPoint(this.boundsProbe.set(rect.x - rect.width / 2, 0, rect.z - rect.depth / 2));
            bounds.expandByPoint(this.boundsProbe.set(rect.x + rect.width / 2, 0, rect.z + rect.depth / 2));
        }
        for (const member of this.members) {
            bounds.expandByPoint(this.boundsProbe.set(member.player.transform.position.x, 0, member.player.transform.position.z));
        }
        bounds.expandByVector(this.boundsProbe.set(CAMERA_BOUNDS_PADDING, 0, CAMERA_BOUNDS_PADDING));
    }

    /** Smallest camera distance that keeps `bounds` (ground rectangle, player-height tall) inside the usable screen area, plus the screen shift that centres it there. */
    private fitBounds(bounds: THREE.Box3, focus: THREE.Vector3): { distance: number; shift: number } {
        const settings = this.env.cameraSystem.current;
        const yaw = THREE.MathUtils.degToRad(this.pathCameraOptions.fixedYawDeg ?? settings.yawDeg);
        const pitch = THREE.MathUtils.degToRad(settings.pitchDeg);
        const probe = this.threeCamera.clone();
        probe.clearViewOffset();
        probe.aspect = window.innerWidth / Math.max(1, window.innerHeight);
        probe.updateProjectionMatrix();
        const lookAt = new THREE.Vector3(focus.x + settings.offset.x, focus.y + settings.offset.y, focus.z + settings.offset.z);
        const corners: THREE.Vector3[] = [];
        for (const x of [bounds.min.x, bounds.max.x]) {
            for (const z of [bounds.min.z, bounds.max.z]) {
                for (const y of [0, CAMERA_BOUNDS_HEIGHT]) {
                    corners.push(new THREE.Vector3(x, y, z));
                }
            }
        }
        const usableHalfHeight = (2 - CAMERA_SCREEN_PAD_TOP - CAMERA_SCREEN_PAD_BOTTOM) / 2;
        const usableCenter = (CAMERA_SCREEN_PAD_BOTTOM - CAMERA_SCREEN_PAD_TOP) / 2;
        const measure = (distance: number) => {
            probe.position.set(
                lookAt.x + distance * Math.cos(pitch) * Math.sin(yaw),
                lookAt.y + distance * Math.sin(pitch),
                lookAt.z + distance * Math.cos(pitch) * Math.cos(yaw),
            );
            probe.lookAt(lookAt);
            probe.updateMatrixWorld(true);
            let minY = Infinity;
            let maxY = -Infinity;
            let maxAbsX = 0;
            for (const corner of corners) {
                const ndc = this.shiftProbe.copy(corner).project(probe);
                minY = Math.min(minY, ndc.y);
                maxY = Math.max(maxY, ndc.y);
                maxAbsX = Math.max(maxAbsX, Math.abs(ndc.x));
            }
            const fits = (maxY - minY) / 2 <= usableHalfHeight && maxAbsX <= 1 - CAMERA_SCREEN_PAD_SIDE;
            return { fits, centerY: (minY + maxY) / 2 };
        };
        let low = 3;
        // The 22° lens needs ~120 just to frame 24 units across a portrait screen; a spread-out squad on a
        // wide level needs far more, and capping lower leaves members off screen (softlock).
        let high = CAMERA_MAX_DISTANCE;
        for (let i = 0; i < 24; i++) {
            const mid = (low + high) / 2;
            if (measure(mid).fits) {
                high = mid;
            } else {
                low = mid;
            }
        }
        const shift = (measure(high).centerY - usableCenter) / 2;
        return { distance: high, shift: Number.isFinite(shift) ? shift : SCREEN_VERTICAL_SHIFT };
    }

    public destroy(): void {
        this.destroyed = true;
        this.goalArrivalTweens.forEach((tween) => tween.kill());
        this.goalArrivalTweens = [];
        this.cameraBlendTween?.kill();
        this.hintPathKey = '';
        this.dragHint?.destroy();
        this.dragHint = undefined;
        this.payoutFlights.forEach((flight) => flight.kill());
        this.payoutFlights.length = 0;
        this.removeInputListeners();
        this.clearRoute();
        this.uiTweens.forEach((tween) => tween.kill());
        this.uiTweens = [];
        this.bonusMeter?.removeFromParent();
        this.bonusMeter?.destroy({ children: true });
        this.bonusMeter = undefined;
        this.completeModal?.removeFromParent();
        this.completeModal?.destroy({ children: true });
        this.completeModal = undefined;
        this.destroyPayoutPop();
        if (this.celebrationBanner) {
            UiAnim.kill(this.celebrationBanner);
            this.celebrationBanner.destroy({ children: true });
            this.celebrationBanner = undefined;
        }
        this.bustedModal?.removeFromParent();
        this.bustedModal?.destroy({ children: true });
        this.bustedModal = undefined;
        this.destroyGuards();
        this.hud?.destroy({ children: true });
        this.hud = undefined;
        DebugOverlay.instance.removePanel(CAMERA_PANEL_ID);
        DebugOverlay.instance.removePanel(BENDING_PANEL_ID);
        DebugOverlay.instance.removePanel(LEVELS_PANEL_ID);
        for (const door of this.wallDoors) {
            door.dispose();
        }
        this.wallDoors.length = 0;
        for (const mesh of this.wallMeshes) {
            mesh.geometry.dispose();
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((material) => material.dispose());
            mesh.children.forEach((child) => {
                const glassMesh = child as THREE.Mesh;
                if (glassMesh.material) {
                    const glassMaterials = Array.isArray(glassMesh.material) ? glassMesh.material : [glassMesh.material];
                    glassMaterials.forEach((material) => material.dispose());
                }
            });
        }
        this.wallMeshes.length = 0;
        for (const mesh of this.wallLintelClearMeshes) {
            gsap.killTweensOf(mesh.scale);
            mesh.geometry.dispose();
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((material) => material.dispose());
            mesh.children.forEach((child) => {
                const childMesh = child as THREE.Mesh;
                if (childMesh.material) {
                    const childMaterials = Array.isArray(childMesh.material) ? childMesh.material : [childMesh.material];
                    childMaterials.forEach((material) => material.dispose());
                }
            });
        }
        this.wallLintelClearMeshes.length = 0;
        if (this.floorMeshes.length) {
            for (const piece of this.floorMeshes) {
                piece.geometry.dispose();
                (piece.material as THREE.Material).dispose();
            }
            this.floorMeshes = [];
        }
        for (const ground of [this.exteriorGround, this.entryPath]) {
            if (!ground) {
                continue;
            }
            ground.geometry.dispose();
            (ground.material as THREE.Material).dispose();
            ground.removeFromParent();
        }
        this.exteriorGround = undefined;
        this.entryPath = undefined;
        for (const entity of [...this.wallColliders, ...this.propColliders]) {
            this.env.world.remove(entity);
        }
        this.wallColliders.length = 0;
        this.wallBoxes.length = 0;
        this.navGrid = undefined;
        this.propColliders.length = 0;
        for (const asset of this.dressingAssets) {
            this.disposeDressingAsset(asset);
        }
        this.dressingAssets.length = 0;
        for (const collectible of this.collectibles) {
            this.env.world.remove(collectible);
        }
        this.collectibles.length = 0;
        this.env.destroy();
        super.destroy();
    }
}