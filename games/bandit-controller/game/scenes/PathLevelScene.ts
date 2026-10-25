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
import { LevelSight } from '../utils/LevelSight';
import { COIN, CollectibleDefinition } from '../data/CollectibleSettings';
import { LevelCatalog } from '../data/LevelCatalog';
import { UiKit } from '../ui/UiKit';
import { TextureBuilder } from '../builders/TextureBuilder';
import { CHARACTER_VIEWS, DEFAULT_CHARACTER_VIEW, resolveSkinImagePath } from '../data/CharacterViews';
import type MainPlayer from '../player/MainPlayer';
import { WorldStyles } from '../data/WorldStyles';
import { LevelData, LevelDoor, LevelLoot, LevelSharedGoal, levelDoors, levelWindowPanes } from '../data/LevelData';
import { GameState } from '../data/GameState';
import { Progress } from '../data/Progress';
import { PLAYER_SETTINGS } from '../data/PlayerSettings';
import Entity from 'core/ecs/Entity';
import RigidBody from 'core/physics/RigidBody';
import { Layers } from 'core/physics/PhysicsConstants';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { WorldEnvironment, CameraFollowOptions } from './shared/WorldEnvironment';
import MoneyHud from '../ui/MoneyHud';
import BonusMeter from '../ui/BonusMeter';
import { spawnFlyingIconToOverlayPoint } from '../ui/FlyingResourceIcon';
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
const SHARED_SLOT_SPACING = 1.8;
const GOAL_HAND_SIZE = 76;
const DRAG_HINT_CYCLE_MS = 2600;
const FIELD_SIZE = 48;
const ROOM_ORIGIN = new THREE.Vector3();
const DOOR_ASSIST_MARGIN = 0.6;
const DOOR_CLEARANCE = 1.3;
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
const CELEBRATION_ANIMATION_URL = './bandit-controller/models/animations/Excited.glb';
/** One dance per squad member, in squad order. */
const SQUAD_DANCE_URLS = [
    './bandit-controller/models/animations/Dance_Locking.glb',
    './bandit-controller/models/animations/Dance_Wave.glb',
    './bandit-controller/models/animations/Dance_Chicken.glb',
];
const PAYOUT_STAGGER_SEC = 0.12;
const CELEBRATION_PITCH_DEG = 28;
/** World units a press must travel before it counts as a drag instead of a tap. */
const TAP_MAX_DRAG = 0.35;
const CELEBRATION_DISTANCE = 13;
const CELEBRATION_DANCE_SEC = 1;
const SAD_ANIMATION_URL = './bandit-controller/models/animations/Crying.glb';
const BUST_CHASE_TIMEOUT_SEC = 3;
const BUSTED_REACTION_SEC = 2.2;
const CAMERA_BOUNDS_PADDING = 1.5;
const CAMERA_MIN_HALF_WIDTH = 3.5;
const CAMERA_BOUNDS_HEIGHT = 1.6;
/** Fractions of the screen (in NDC units, 2 = full height) kept clear: the top holds the HUD. */
const CAMERA_SCREEN_PAD_TOP = 0.32;
const CAMERA_SCREEN_PAD_BOTTOM = 0.1;
const CAMERA_SCREEN_PAD_SIDE = 0.08;
const CAMERA_TRANSITION_SEC = 1.3;
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
type Spotter = Guard | SecurityCamera;

type PathDrawMode = 'exit' | 'free';

/** One controllable character. The scene's own path fields always hold the focused member's data; the others keep theirs here. */
interface SquadMember {
    player: MainPlayer;
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
    private level!: LevelData;
    private waypoints: THREE.Vector3[] = [];
    private doors: LevelDoor[] = [];
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
    private goalHand?: PIXI.Sprite;
    private dragHint?: PIXI.Sprite;
    private readonly dragHintWorld = new THREE.Vector3();
    private selectionNeedsFraming = false;
    private pointerDragged = false;
    private readonly pointerDownWorld = new THREE.Vector3();
    private selectionHalo?: THREE.Mesh;
    private readonly goalHandWorld = new THREE.Vector3();
    private readonly focusGoal = new THREE.Vector3();
    private goalArrivalTweens: gsap.core.Tween[] = [];
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
    private floorMesh?: THREE.Mesh;
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
    private cashPillCoin?: PIXI.Graphics;
    private completeModal?: PIXI.Container;
    private bustedModal?: PIXI.Container;
    private guards: Spotter[] = [];
    private bustGuard?: Spotter;
    private bustPhase: 'chase' | 'react' = 'chase';
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
        this.wallsLowered = false;
        this.revealedUpTo = 0;
        this.goalArrivalTweens.forEach((tween) => tween.kill());
        this.goalArrivalTweens = [];
        this.members = [];
        this.focused = undefined;
        this.inBackground = false;
        this.guardTargets.clear();
        this.level = LevelCatalog.current();
        this.doors = levelDoors(this.level);
        this.route = [];
        this.routeBlocked = false;
        this.runMoney = 0;
        this.lootCollected = 0;
        this.spotted = false;
        this.collectibles.length = 0;
        this.collectedPayouts.length = 0;
        this.env = new WorldEnvironment(this.threeScene, BendService, FIELD_SIZE, 64, 1);
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
            models: door.model ? [{
                id: door.model.split('/').pop() as string,
                path: door.model,
                fullPath: `bandit-controller/models/${door.model}.gltf`,
                format: 'gltf',
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

        const entry = this.level.entryPath;
        if (entry) {
            this.entryPath = new THREE.Mesh(
                new THREE.PlaneGeometry(entry.width, entry.depth),
                new THREE.MeshStandardMaterial({ color: WorldStyles.get('path', this.level.styles?.path).color, roughness: 0.96 }),
            );
            this.entryPath.rotation.x = -Math.PI / 2;
            this.entryPath.position.set(entry.x, 0.012, entry.z);
            BendService.applyBend(this.entryPath.material as THREE.Material);
            this.threeScene.add(this.entryPath);
        }

        const floorStyle = WorldStyles.get('floor', this.level.styles?.floor);
        this.floorMesh = CheckerFloorBuilder.build({
            x: 0,
            z: 0,
            width: this.level.floor.width,
            depth: this.level.floor.depth,
            rotationY: 0,
            tileSize: 1,
        } as StoreFloorPlacement, ROOM_ORIGIN, {
            colorA: floorStyle.colorA,
            colorB: floorStyle.colorB,
            scale: floorStyle.checkerScale,
        } as FloorCheckerConfig);
        this.threeScene.add(this.floorMesh);

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
                this.wallDoors.push(door);
                this.threeScene.add(door.object);
            }
        }

        for (const member of this.members) {
            this.addMarker(member.waypoints[0], member.color ?? 0x8fb8ff);
            const isSharedGoal = this.sharedGoalActive && member.waypoints.length === 2;
            if (!isSharedGoal) {
                this.addMarker(member.waypoints[1], member.color ?? GOAL_COLOR, GOAL_MARKER_RADIUS);
            }
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
        this.goalParticleAccumulator += delta;
        while (this.goalParticleAccumulator >= 0.14) {
            this.goalParticleAccumulator -= 0.14;
            this.goalParticlePosition.set(this.activeGoal.x, FloorLayers.baseY + 0.2, this.activeGoal.z);
            PizzaParticleSystem.spawn('heistGoal', this.goalParticlePosition);
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
        const spacing = Math.min(SHARED_SLOT_SPACING, (goal.width - 1) / Math.max(1, count));
        return new THREE.Vector3(goal.x + (index - (count - 1) / 2) * spacing, 0, goal.z + goal.depth * 0.2);
    }

    private insideSharedGoal(position: THREE.Vector3): boolean {
        const goal = this.level.sharedGoal;
        return Boolean(goal) && this.sharedGoalActive
            && Math.abs(position.x - goal!.x) <= goal!.width / 2
            && Math.abs(position.z - goal!.z) <= goal!.depth / 2;
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

        // The safe sits against the far wall of the room.
        const safe = new THREE.Vector3(goal.x, FloorLayers.baseY, goal.z - halfD + 1);
        void this.placeAsset(SAFE_MODEL, safe, 2.8, 0);
        this.addPropCollider(safe, new THREE.Vector3(0.95, 1.4, 0.8));
    }

    private buildProps(): void {
        for (const prop of this.level.props) {
            const position = new THREE.Vector3(prop.x, FloorLayers.baseY, prop.z);
            const parent = prop.revealAt > 0 ? this.revealGroup(prop.revealAt) : this.threeScene;
            void this.placeAsset(prop.model, position, prop.height, prop.rotationY, parent);
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
            if (size.y > 1e-4) {
                object.scale.multiplyScalar(targetHeight / size.y);
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
    }

    private buildGoalArrow(): void {
        if (this.goalHand) {
            return;
        }
        const hand = new PIXI.Sprite(PIXI.Texture.from('handHud'));
        hand.anchor.set(0.5);
        hand.width = GOAL_HAND_SIZE;
        hand.height = GOAL_HAND_SIZE;
        // The source art points up-left; this turns the fingertip straight down.
        hand.rotation = Math.PI * 1.19;
        hand.visible = false;
        this.game.uiLayer.addChild(hand);
        this.goalHand = hand;

        const hint = new PIXI.Sprite(PIXI.Texture.from('handHud'));
        hint.anchor.set(0.2, 0.1);
        hint.width = GOAL_HAND_SIZE;
        hint.height = GOAL_HAND_SIZE;
        hint.visible = false;
        this.game.uiLayer.addChild(hint);
        this.dragHint = hint;
    }

    /** Tutorial finger: loops from the focused character to its goal while nobody is drawing. */
    private updateDragHint(): void {
        const hint = this.dragHint;
        if (!hint) {
            return;
        }
        const active = Boolean(this.level.tutorial) && this.state === 'waiting' && this.pointerId === null;
        const from = active ? this.worldToScreen(this.dragHintWorld.copy(this.env.mainPlayer.transform.position).setY(FloorLayers.baseY + 0.3)) : null;
        const to = active ? this.worldToScreen(this.goalHandWorld.set(this.activeGoal.x, FloorLayers.baseY + 0.3, this.activeGoal.z)) : null;
        hint.visible = Boolean(from && to);
        if (!from || !to) {
            return;
        }
        const cycle = (performance.now() % DRAG_HINT_CYCLE_MS) / DRAG_HINT_CYCLE_MS;
        const t = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp((cycle - 0.15) / 0.6, 0, 1), 0, 1);
        const fade = cycle < 0.15 ? cycle / 0.15 : cycle > 0.85 ? (1 - cycle) / 0.15 : 1;
        const a = this.game.uiLayer.toLocal(new PIXI.Point(from.x, from.y), this.game.app.stage);
        const b = this.game.uiLayer.toLocal(new PIXI.Point(to.x, to.y), this.game.app.stage);
        hint.position.set(THREE.MathUtils.lerp(a.x, b.x, t), THREE.MathUtils.lerp(a.y, b.y, t));
        hint.alpha = fade;
    }

    private updateGoalArrow(): void {
        const hand = this.goalHand;
        if (!hand) {
            return;
        }
        const active = this.state === 'waiting' || this.state === 'following' || this.state === 'revealing';
        let marker = this.waypoints[this.nextWaypointIndex];
        const room = this.level.sharedGoal;
        if (room && this.sharedGoalActive && this.nextWaypointIndex >= this.waypoints.length - 1) {
            marker = this.goalHandWorld.set(room.x, 0, room.z + room.depth * 0.2);
        }
        const screen = active && marker ? this.worldToScreen(this.goalHandWorld.set(marker.x, FloorLayers.baseY + 0.3, marker.z)) : null;
        hand.visible = Boolean(screen);
        if (!screen) {
            return;
        }
        const local = this.game.uiLayer.toLocal(new PIXI.Point(screen.x, screen.y), this.game.app.stage);
        const bob = Math.abs(Math.sin(performance.now() / 380)) * 18;
        hand.position.set(local.x, local.y - GOAL_HAND_SIZE * 0.55 - bob);
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
            fontSize: 34,
            fontWeight: 'bold',
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
        const coin = new PIXI.Graphics();
        coin.beginFill(0xffc83d).lineStyle(3, 0xb8860b).drawCircle(0, 0, 17).endFill();
        coin.lineStyle(0).beginFill(0xffe28a).drawCircle(-4, -4, 6).endFill();
        this.cashPillCoin = coin;
        this.cashPill.addChild(this.cashPillBackground, coin, this.runMoneyLabel);
        const found = LevelCatalog.locate(this.level);
        this.worldLabel = new PIXI.Text(found ? `WORLD ${found.world.number}  ${found.world.name.toUpperCase()}  ·  LEVEL ${found.levelNumber}/${found.world.levels.length}` : this.level.name.toUpperCase(), {
            fontFamily: UiKit.fontFamily('primary'),
            fontSize: 14,
            fill: 0xffffff,
            stroke: 0x203c35,
            strokeThickness: 4,
        });
        this.worldLabel.anchor.set(0.5);
        this.homeButton = this.buildHomeButton();
        this.hud.addChild(this.instruction, this.cashPill, this.worldLabel, this.homeButton);
        this.refreshRunMoney();
        this.game.uiLayer.addChild(this.hud);
        this.resize();
    }

    private buildHomeButton(): PIXI.Container {
        const button = new PIXI.Container();
        const back = new PIXI.Graphics();
        back.beginFill(0x000000, 0.25).drawCircle(0, 4, 30).endFill();
        back.beginFill(0xffffff).lineStyle(4, 0x2a6fb0).drawCircle(0, 0, 30).endFill();
        const icon = PIXI.Sprite.from('PictoIcon_Home_1-2');
        icon.anchor.set(0.5);
        icon.width = icon.height = 38;
        button.addChild(back, icon);
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.hitArea = new PIXI.Circle(0, 0, 34);
        button.on('pointertap', () => this.onHome.dispatch());
        return button;
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
        const start = this.pathDrawMode === 'exit'
            ? this.activeStart
            : this.env.mainPlayer.transform.position;
        this.clearRoute();
        this.pointerId = event.pointerId;
        this.pointerDownWorld.copy(this.pointerWorld);
        this.pointerDragged = false;
        this.routeBlocked = false;
        this.route = [start.clone()];
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
        const point = this.clampToCourse(this.pointerWorld);
        if (this.distanceXZ(point, this.route[this.route.length - 1]) < 0.2) {
            return;
        }
        this.appendRouteSamples(point);
        this.drawRoute();
    };

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
        const endPoint = hasFloorPoint ? this.clampToCourse(this.pointerWorld) : undefined;
        if (endPoint && this.distanceXZ(this.route[this.route.length - 1], endPoint) > 0.12) {
            this.appendRouteSamples(endPoint);
        }
        const tracedPath = this.route.map((point) => point.clone());
        const reachesGoal = endPoint && (this.distanceXZ(endPoint, this.activeGoal) <= 1.3
            || (this.nextWaypointIndex >= this.waypoints.length - 1 && this.insideSharedGoal(endPoint)));
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

        const endpoint = this.pathDrawMode === 'exit' ? this.activeGoal.clone() : endPoint;
        if (this.distanceXZ(this.route[this.route.length - 1], endpoint) > 0.12) {
            this.appendRouteSamples(endpoint);
        }
        this.drawRoute();
        const finalRoute = this.adjustRouteThroughDoors(this.route);
        console.info('[PathLevelScene] path', {
            mode: this.pathDrawMode,
            tracedPath: this.serializePath(tracedPath),
            adjustedPath: this.serializePath(finalRoute),
            blocked: this.routeBlocked,
        });
        if (this.routeBlocked) {
            this.route = [];
            this.routeBlocked = false;
            this.clearRoute();
            this.setInstruction('PATH BLOCKED; TRY AROUND THE OBSTACLE');
            if (needsFraming) {
                this.frameActiveSegment();
            }
            return;
        }

        this.route = finalRoute;
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

    private adjustRouteThroughDoors(route: readonly THREE.Vector3[]): THREE.Vector3[] {
        if (route.length < 2) {
            return route.map((point) => point.clone());
        }

        const crossedDoors = this.doors.filter((door) => route.some((point, index) => index > 0
            && this.segmentCrossesDoor(door, route[index - 1], point)));

        // Resample evenly so the curve has uniform density instead of sparse door waypoints.
        const spacing = 0.25;
        const samples = [route[0].clone()];
        let carried = 0;
        for (let index = 1; index < route.length; index++) {
            const start = route[index - 1];
            const end = route[index];
            const length = this.distanceXZ(start, end);
            let travelled = spacing - carried;
            while (travelled <= length) {
                const t = travelled / length;
                samples.push(new THREE.Vector3(
                    THREE.MathUtils.lerp(start.x, end.x, t),
                    0.08,
                    THREE.MathUtils.lerp(start.z, end.z, t),
                ));
                travelled += spacing;
            }
            carried = length - (travelled - spacing);
        }
        const last = route[route.length - 1];
        if (this.distanceXZ(samples[samples.length - 1], last) > 0.05) {
            samples.push(last.clone());
        }

        // Ease x toward the door centre over a blend zone, then hold it through the doorway.
        const blend = 2.5;
        const doorPull = (point: THREE.Vector3): { weight: number; x: number } => {
            let best = { weight: 0, x: point.x };
            for (const door of crossedDoors) {
                const distance = Math.abs(point.z - door.z) - DOOR_CLEARANCE;
                const t = THREE.MathUtils.clamp(1 - distance / blend, 0, 1);
                const weight = t * t * (3 - 2 * t);
                if (weight > best.weight) {
                    best = { weight, x: door.x };
                }
            }
            return best;
        };
        const pulls = samples.map(doorPull);
        const weights = pulls.map((pull) => pull.weight);

        for (let pass = 0; pass < 2; pass++) {
            for (let index = 1; index < samples.length - 1; index++) {
                if (weights[index] >= 1) {
                    continue;
                }
                const previous = samples[index - 1];
                const next = samples[index + 1];
                samples[index].x = (previous.x + samples[index].x * 2 + next.x) / 4;
                samples[index].z = (previous.z + samples[index].z * 2 + next.z) / 4;
            }
        }
        samples.forEach((point, index) => {
            point.x = THREE.MathUtils.lerp(point.x, pulls[index].x, weights[index]);
        });
        return samples;
    }

    private segmentCrossesDoor(door: LevelDoor, start: THREE.Vector3, end: THREE.Vector3): boolean {
        const deltaZ = end.z - start.z;
        if (Math.abs(deltaZ) < 1e-8) {
            return false;
        }
        const t = (door.z - start.z) / deltaZ;
        return t >= -1e-4 && t <= 1 + 1e-4
            && Math.abs(start.x + (end.x - start.x) * t - door.x) <= door.halfWidth + DOOR_ASSIST_MARGIN;
    }

    private crossesDoorInAssistRange(start: THREE.Vector3, end: THREE.Vector3): boolean {
        return this.doors.some((door) => this.segmentCrossesDoor(door, start, end));
    }

    private segmentHitsWall(start: THREE.Vector3, end: THREE.Vector3): boolean {
        if (this.crossesDoorInAssistRange(start, end)) {
            return false;
        }
        const radius = PLAYER_SETTINGS.colliderHalfWidth + 0.08;
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        for (const wall of this.wallBoxes) {
            let minT = 0;
            let maxT = 1;
            const clip = (origin: number, delta: number, min: number, max: number): boolean => {
                if (Math.abs(delta) < 1e-8) {
                    return origin >= min && origin <= max;
                }
                const first = (min - origin) / delta;
                const second = (max - origin) / delta;
                minT = Math.max(minT, Math.min(first, second));
                maxT = Math.min(maxT, Math.max(first, second));
                return minT <= maxT;
            };
            if (clip(start.x, dx, wall.x - wall.halfX - radius, wall.x + wall.halfX + radius)
                && clip(start.z, dz, wall.z - wall.halfZ - radius, wall.z + wall.halfZ + radius)) {
                return true;
            }
        }
        return false;
    }

    private isDebugTarget(target: EventTarget | null): boolean {
        return target instanceof Element && Boolean(target.closest('#daybreak-debug-overlay'));
    }

    private pickFloor(clientX: number, clientY: number): boolean {
        this.pointerNdc.set(clientX / window.innerWidth * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
        this.raycaster.setFromCamera(this.pointerNdc, this.threeCamera);
        return this.raycaster.ray.intersectPlane(this.floorPlane, this.pointerWorld) !== null;
    }

    private clampToCourse(point: THREE.Vector3): THREE.Vector3 {
        const halfWidth = this.level.floor.width / 2 + 2.2;
        const halfDepth = this.level.floor.depth / 2 + 2.2;
        return new THREE.Vector3(
            THREE.MathUtils.clamp(point.x, -halfWidth, halfWidth),
            0.08,
            THREE.MathUtils.clamp(point.z, -halfDepth, Math.max(halfDepth, this.activeStart.z, this.env.mainPlayer.transform.position.z)),
        );
    }

    private drawRoute(): void {
        this.clearRoute();
        if (this.route.length === 0) {
            return;
        }

        // A raw trace that hits a wall is shown as drawn; door smoothing only applies to clear traces.
        const hits = (points: readonly THREE.Vector3[]): boolean => points.some((point, index) => index > 0
            && this.segmentHitsWall(points[index - 1], point));
        this.routeBlocked = hits(this.route);
        const route = this.routeBlocked ? this.route : this.adjustRouteThroughDoors(this.route);
        this.routeBlocked ||= hits(route);

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
        if (this.runMoney <= 0) {
            this.showCompletePopup(1);
            return;
        }
        this.setInstruction('STOP THE NEEDLE FOR A BONUS!');
        const meter = new BonusMeter((multiplier) => this.applyBonus(multiplier));
        this.bonusMeter = meter;
        this.game.uiLayer.addChild(meter);
        this.positionBottomPanel(meter);
    }

    private applyBonus(multiplier: number): void {
        this.bonusMeter?.removeFromParent();
        this.bonusMeter?.destroy({ children: true });
        this.bonusMeter = undefined;

        const bonus = this.runMoney * (multiplier - 1);
        if (bonus <= 0) {
            this.showCompletePopup(multiplier);
            return;
        }
        const flight = spawnFlyingIconToOverlayPoint(
            this,
            this.game,
            this.env.mainPlayer.getCollectTargetPosition().clone(),
            () => this.moneyHud.getMoneyIconOverlayPosition(),
            this.moneyHud.getIconTexture() ?? PIXI.Texture.WHITE,
            () => {
                if (this.destroyed) {
                    return;
                }
                GameState.addMoney(bonus);
                this.moneyHud.setResourceCount(GameState.getMoney());
                this.showCompletePopup(multiplier);
            },
            0,
        );
        this.payoutFlights.push(flight);
    }

    /** Sits in the lower part of the screen so the dancing player stays visible. */
    private positionBottomPanel(panel: PIXI.Container): void {
        const screen = Game.overlayScreenData;
        panel.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.78);
    }

    private showCompletePopup(multiplier = 1): void {
        if (this.state === 'complete') {
            return;
        }
        this.state = 'complete';
        LevelCatalog.markCompleted(this.level);
        const result = Progress.complete(this.level, {
            loot: this.lootCollected >= this.level.loot.length,
            unseen: !this.spotted,
        });
        this.moneyHud.setResourceCount(GameState.getMoney());
        const modal = new PIXI.Container();
        const panel = UiKit.image('levelComplete', 'panel', 380, 290);

        const ribbon = UiKit.sprite('levelComplete', 'ribbon', 1.1);
        ribbon.position.set(0, -125);
        const title = UiKit.text('levelComplete', 'title', { level: this.levelLabel() });
        title.position.set(0, -122);

        const bonusText = multiplier > 1 ? `  (x${multiplier} BONUS)` : '';
        const total = UiKit.text('levelComplete', 'total', { money: this.runMoney * multiplier, bonus: bonusText });
        total.position.set(0, -15);

        const starRow = new PIXI.Container();
        for (let i = 0; i < 3; i++) {
            const star = PIXI.Sprite.from('ItemIcon_Star_Gold');
            star.anchor.set(0.5);
            star.height = 46;
            star.scale.x = star.scale.y;
            star.position.set((i - 1) * 56, 0);
            if (i >= result.stars) {
                star.tint = 0x202020;
                star.alpha = 0.55;
            }
            starRow.addChild(star);
        }
        starRow.position.set(0, -70);
        const notes = [!result.stars || result.stars < 2 ? 'GRAB ALL LOOT FOR 2 STARS' : '', result.stars < 3 ? 'STAY UNSEEN FOR 3 STARS' : ''].filter(Boolean);
        const bonusLines = [
            result.total > 0 ? `+$${result.total} REWARD${result.firstClear ? ' (FIRST CLEAR)' : ''}` : '',
            notes[notes.length - 1] ?? '',
        ].filter(Boolean).join('\n');
        const rewardText = new PIXI.Text(bonusLines, { fontFamily: 'Arial Black, Arial', fontSize: 15, fill: 0xffe14d, align: 'center', stroke: 0x000000, strokeThickness: 3 });
        rewardText.anchor.set(0.5);
        rewardText.position.set(0, 28);

        const button = new PIXI.Container();
        const buttonBg = UiKit.image('levelComplete', 'button', 240, 90);
        const buttonLabel = UiKit.text('levelComplete', 'buttonLabel', { buttonText: !LevelCatalog.isUnlocked(LevelCatalog.all().indexOf(this.level) + 1) && LevelCatalog.hasNext(this.level) ? 'MORE STARS!' : !LevelCatalog.hasNext(this.level) ? 'PLAY AGAIN' : LevelCatalog.isWorldFinale(this.level) ? 'NEXT WORLD' : 'NEXT LEVEL' });
        button.addChild(buttonBg, buttonLabel);
        button.scale.set(0.7);
        button.position.set(0, 82);
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointertap', () => {
            if (LevelCatalog.hasNext(this.level) && !LevelCatalog.isUnlocked(LevelCatalog.all().indexOf(this.level) + 1)) {
                this.onHome.dispatch();
                return;
            }
            LevelCatalog.advance(this.level);
            this.onRestart.dispatch();
        });

        modal.addChild(panel, ribbon, title, starRow, total, rewardText, button);
        this.positionBottomPanel(modal);
        this.game.uiLayer.addChild(modal);
        this.completeModal = modal;
    }

    /** "2-3" = world 2, level 3; falls back to the flat campaign number for levels outside every world. */
    private levelLabel(): string {
        const found = LevelCatalog.locate(this.level);
        return found ? `${found.world.number}-${found.levelNumber}` : String(LevelCatalog.all().indexOf(this.level) + 1);
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
                        if (nextGoal) {
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
        if (this.state === 'following' && this.sharedGoalActive && this.nextWaypointIndex >= lastIndex
            && this.insideSharedGoal(this.env.mainPlayer.transform.position)) {
            this.activeGoal.copy(this.waypoints[lastIndex]);
            this.beginGoalArrival();
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
        this.updateGoalArrow();
        this.updateDragHint();
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
            // Safety net: never let a chase run forever.
            if (guard.chase(player, delta) || this.bustTimer > BUST_CHASE_TIMEOUT_SEC) {
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
        character.animator.playExclusive('sad', 0.3, true);
    }

    private updateSpottedMessage(highestAlert: number): void {
        if (!this.instruction) {
            return;
        }
        const playing = this.state === 'following' || this.state === 'waiting';
        if (highestAlert > 0.15 && playing && !this.spottedMessageShown) {
            this.spottedMessageShown = true;
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
        for (const other of this.members) {
            if (other !== this.focused && other.state === 'following') {
                other.player.movementController.enabled = false;
                other.player.movementController.exitPathMode();
            }
        }
        this.bustGuard = spotter;
        this.bustPhase = 'chase';
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
        void this.env.mainPlayer.character?.registerAnimation('sad', SAD_ANIMATION_URL)
            .catch((error) => console.warn('[PathLevelScene] Could not load sad animation', error));
    }

    private showBustedPopup(): void {
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
        }

        const button = new PIXI.Container();
        const buttonBg = UiKit.image('busted', 'button', 240, 90);
        const buttonLabel = UiKit.text('busted', 'buttonLabel');
        button.addChild(buttonBg, buttonLabel);
        button.scale.set(0.7);
        button.position.set(0, 50);
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointertap', () => this.onRestart.dispatch());

        modal.addChild(panel, ribbon, title, message, button);
        this.positionBottomPanel(modal);
        this.game.uiLayer.addChild(modal);
        this.bustedModal = modal;
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
        if (this.state !== 'following' || this.cameraBlendTween || this.frameBounds.isEmpty()) {
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
            this.worldLabel.position.set(Game.overlayScreenData.center.x, Game.overlayScreenData.topLeft.y + 148);
        }
        if (this.homeButton) {
            this.homeButton.position.set(Game.overlayScreenData.topRight.x - 44, Game.overlayScreenData.topLeft.y + 44);
        }
        if (this.cashPill) {
            this.cashPill.position.set(Game.overlayScreenData.center.x, Game.overlayScreenData.topLeft.y + 96);
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
        const floorHalfX = this.level.floor.width / 2;
        bounds.min.x = Math.max(bounds.min.x, -floorHalfX - 2);
        bounds.max.x = Math.min(bounds.max.x, floorHalfX + 2);
        // A section is never framed narrower than this, so a straight path doesn't zoom in to a sliver.
        const minHalfWidth = Math.min(floorHalfX, CAMERA_MIN_HALF_WIDTH);
        const centerX = (bounds.min.x + bounds.max.x) / 2;
        bounds.min.x = Math.min(bounds.min.x, centerX - minHalfWidth);
        bounds.max.x = Math.max(bounds.max.x, centerX + minHalfWidth);
        bounds.expandByVector(this.boundsProbe.set(CAMERA_BOUNDS_PADDING, 0, CAMERA_BOUNDS_PADDING));

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
        let high = 120;
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
        this.goalHand?.destroy();
        this.goalHand = undefined;
        this.dragHint?.destroy();
        this.dragHint = undefined;
        this.payoutFlights.forEach((flight) => flight.kill());
        this.payoutFlights.length = 0;
        this.removeInputListeners();
        this.clearRoute();
        this.bonusMeter?.removeFromParent();
        this.bonusMeter?.destroy({ children: true });
        this.bonusMeter = undefined;
        this.completeModal?.removeFromParent();
        this.completeModal?.destroy({ children: true });
        this.completeModal = undefined;
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
        if (this.floorMesh) {
            this.floorMesh.geometry.dispose();
            (this.floorMesh.material as THREE.Material).dispose();
            this.floorMesh = undefined;
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