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
import { LevelSight } from '../utils/LevelSight';
import { COIN, CollectibleDefinition } from '../data/CollectibleSettings';
import { LevelCatalog } from '../data/LevelCatalog';
import { UiKit } from '../ui/UiKit';
import { WorldStyles } from '../data/WorldStyles';
import { LevelData, LevelDoor, LevelLoot, levelDoors, levelWindowPanes } from '../data/LevelData';
import { GameState } from '../data/GameState';
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

const GOAL_TRIGGER_RADIUS = 2.6;
const CHECKPOINT_STOP_RADIUS = 1.2;
const GOAL_MARKER_RADIUS = 1.25;
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
const CAMERA_PANEL_ID = 'bandit-controller.path.camera';
const BENDING_PANEL_ID = 'bandit-controller.path.bending';
const LEVELS_PANEL_ID = 'bandit-controller.path.levels';
const MODEL_BASE = './bandit-controller/models/';
const CELEBRATION_ANIMATION_URL = './bandit-controller/models/animations/Excited.glb';
const PAYOUT_STAGGER_SEC = 0.12;
const CELEBRATION_PITCH_DEG = 28;
const CELEBRATION_DISTANCE = 8;
const CELEBRATION_DANCE_SEC = 1;
const SAD_ANIMATION_URL = './bandit-controller/models/animations/Crying.glb';
const BUSTED_REACTION_SEC = 2.2;
const CAMERA_FOCUS_ALONG_SEGMENT = 0.66;
/** Wide levels are framed on this half-width only, so portrait screens stay zoomed in on the path. */
// Default fraction of the screen height the view is pushed down; while aiming at a segment start the shift is solved so the player sits at PLAYER_SCREEN_Y_FRACTION (from the top).
const SCREEN_VERTICAL_SHIFT = 0.12;
const PLAYER_SCREEN_Y_FRACTION = 0.85;
const CAMERA_MAX_HALF_WIDTH = 5.5;
/** Seconds inside a guard's cone before the player is busted, and how fast suspicion cools off once out of sight. */
const SPOT_TIME_SEC = 1.1;
const ALERT_DECAY_PER_SEC = 1.2;

type PathLevelState = 'waiting' | 'following' | 'revealing' | 'celebrating' | 'payout' | 'complete' | 'busted';
type PathDrawMode = 'exit' | 'free';

export default class PathLevelScene extends ThreeScene {
    public readonly onRestart: Signal = new Signal();

    private readonly moneyHud: MoneyHud;
    private env!: WorldEnvironment;
    private state: PathLevelState = 'waiting';
    private pathDrawMode: PathDrawMode = 'free';
    private readonly collectibles: Collectible[] = [];
    private readonly collectedPayouts: number[] = [];
    private readonly payoutFlights: ReturnType<typeof spawnFlyingIconToOverlayPoint>[] = [];
    private runMoney = 0;
    private readonly wallMeshes: THREE.Mesh[] = [];
    private readonly wallLintelClearMeshes: THREE.Mesh[] = [];
    private wallsLowered = false;
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
    private readonly segmentFocus = new THREE.Vector3();
    private readonly shiftProbe = new THREE.Vector3();
    private screenShiftFraction = SCREEN_VERTICAL_SHIFT;
    private readonly pathCameraOptions: CameraFollowOptions = {
        freezeHeightWhileAirborne: true,
        fixedYawDeg: 0,
        target: this.segmentFocus,
    };
    private cameraZoomTween?: gsap.core.Tween;
    private goalArrivalTween?: gsap.core.Tween;
    private nextWaypointIndex = 1;
    private revealedUpTo = 0;
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
    private modeSelector?: PIXI.Container;
    private readonly modeButtons = new Map<PathDrawMode, { background: PIXI.Graphics; label: PIXI.Text }>();
    private completeModal?: PIXI.Container;
    private bustedModal?: PIXI.Container;
    private guards: Guard[] = [];
    private bustGuard?: Guard;
    private bustPhase: 'chase' | 'react' = 'chase';
    private bustTimer = 0;
    private bustFocus = false;
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
        this.goalArrivalTween?.kill();
        this.goalArrivalTween = undefined;
        this.level = LevelCatalog.current();
        this.waypoints = [
            new THREE.Vector3(this.level.start.x, 0, this.level.start.z),
            ...this.level.waypoints.map((point) => new THREE.Vector3(point.x, 0, point.z)),
        ];
        this.doors = levelDoors(this.level);
        this.activeStart.copy(this.waypoints[0]);
        this.activeGoal.copy(this.waypoints[1]);
        this.nextWaypointIndex = 1;
        this.route = [];
        this.routeBlocked = false;
        this.runMoney = 0;
        this.collectibles.length = 0;
        this.collectedPayouts.length = 0;
        this.env = new WorldEnvironment(this.threeScene, BendService, FIELD_SIZE, 64, 1);
        const player = this.env.spawnPlayer(this, this.waypoints[0]);
        player.movementController.enabled = false;
        const opener = player as unknown as { opensDoors: boolean; transform: THREE.Object3D };
        opener.opensDoors = true;
        this.doorWorld = {
            forEachEntity: (visit: (entity: typeof opener) => void) => visit(opener),
        } as unknown as Parameters<StoreDoor['update']>[1];
        this.env.cameraSystem.cutTo('topdown');
        this.frameActiveSegment(true);

        this.buildCourse();
        this.buildGuards();
        this.buildCollectibles(0);
        this.buildHud();
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

        this.addMarker(this.waypoints[0], 0x52dda0);
        this.addMarker(this.waypoints[1], this.waypoints.length === 2 ? 0xff725e : 0xffd889, GOAL_MARKER_RADIUS);
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
                this.collectedPayouts.push(amount);
                this.runMoney += amount;
                this.refreshRunMoney();
            });
            this.collectibles.push(collectible);
            void collectible.load();
        }
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
            fontSize: 18,
            fontWeight: 'normal',
            fill: 0xffd36b,
            stroke: 0x443320,
            strokeThickness: 4,
        });
        this.runMoneyLabel.anchor.set(0.5);
        this.modeSelector = new PIXI.Container();
        this.modeButtons.clear();
        this.modeSelector.addChild(
            this.makeModeButton('EXIT RUN', 'exit'),
            this.makeModeButton('FREE DRAW', 'free'),
        );
        this.hud.addChild(this.instruction, this.modeSelector, this.runMoneyLabel);
        this.refreshRunMoney();
        this.refreshModeButtons();
        this.game.uiLayer.addChild(this.hud);
        this.resize();
    }

    private makeModeButton(label: string, mode: PathDrawMode): PIXI.Container {
        const button = new PIXI.Container();
        const background = new PIXI.Graphics();
        const text = new PIXI.Text(label, {
            fontFamily: UiKit.fontFamily('primary'),
            fontSize: 15,
            fontWeight: 'normal',
            fill: 0xffffff,
        });
        text.anchor.set(0.5);
        text.position.set(76, 21);
        button.addChild(background, text);
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.hitArea = new PIXI.Rectangle(0, 0, 152, 42);
        button.on('pointertap', () => this.selectPathMode(mode));
        this.modeButtons.set(mode, { background, label: text });
        return button;
    }

    private selectPathMode(mode: PathDrawMode): void {
        if (this.state !== 'waiting' || this.pointerId !== null) {
            return;
        }
        this.pathDrawMode = mode;
        this.route = [];
        this.routeBlocked = false;
        this.clearRoute();
        this.refreshModeButtons();
            this.setInstruction(mode === 'exit'
            ? 'TRACE TO THE GOLD CHECKPOINT'
            : 'TRACE FROM THE PLAYER; RELEASE ANYWHERE');
    }

    private refreshModeButtons(): void {
        this.modeButtons.forEach(({ background }, mode) => {
            background.clear();
            background.beginFill(mode === this.pathDrawMode ? 0x187f77 : 0x315e58, 0.96);
            background.lineStyle(2, mode === this.pathDrawMode ? 0xffd889 : 0xffffff, 0.9);
            background.drawRoundedRect(0, 0, 152, 42, 11);
            background.endFill();
        });
    }

    private setupCameraDebug(): void {
        const panel = DebugOverlay.instance.panel('Path Camera', { id: CAMERA_PANEL_ID });
        const camera = this.env.cameraSystem.current;
        panel.slider(camera, 'pitchDeg', 55, 89, 1, 'Pitch');
        panel.slider(camera, 'distance', 6, 32, 0.5, 'Distance');
        panel.slider(camera, 'followSpeed', 0.5, 20, 0.5, 'Follow Speed');

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
        if (this.state !== 'waiting' || this.isDebugTarget(event.target)) {
            return;
        }
        const start = this.pathDrawMode === 'exit'
            ? this.activeStart
            : this.env.mainPlayer.transform.position;
        if (!this.pickFloor(event.clientX, event.clientY)
            || this.distanceXZ(this.pointerWorld, start) > 1.3) {
            return;
        }
        this.clearRoute();
        this.pointerId = event.pointerId;
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
        const hasFloorPoint = this.pickFloor(event.clientX, event.clientY);
        const endPoint = hasFloorPoint ? this.clampToCourse(this.pointerWorld) : undefined;
        if (endPoint && this.distanceXZ(this.route[this.route.length - 1], endPoint) > 0.12) {
            this.appendRouteSamples(endPoint);
        }
        const tracedPath = this.route.map((point) => point.clone());
        const reachesGoal = endPoint && this.distanceXZ(endPoint, this.activeGoal) <= 1.3;
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
            return;
        }

        this.route = finalRoute;
        this.state = 'following';
        if (this.pathDrawMode === 'free') {
            this.activeStart.copy(this.route[0]);
            this.activeGoal.copy(endpoint);
            this.frameActiveSegment();
        }
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

        const routeColor = this.routeBlocked ? 0xf04455 : 0x2bd2bd;
        if (route.length > 1) {
            const curve = new THREE.CatmullRomCurve3(route, false, 'centripetal');
            const routeMaterial = new THREE.MeshStandardMaterial({
                color: routeColor,
                emissive: this.routeBlocked ? 0x650817 : 0x074d44,
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

    private setInstruction(text: string): void {
        if (this.instruction) {
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
        const modal = new PIXI.Container();
        const panel = UiKit.image('levelComplete', 'panel', 380, 250);

        const ribbon = UiKit.sprite('levelComplete', 'ribbon', 1.1);
        ribbon.position.set(0, -125);
        const title = UiKit.text('levelComplete', 'title', { level: LevelCatalog.all().indexOf(this.level) + 1 });
        title.position.set(0, -122);

        const bonusText = multiplier > 1 ? `  (x${multiplier} BONUS)` : '';
        const total = UiKit.text('levelComplete', 'total', { money: this.runMoney * multiplier, bonus: bonusText });
        total.position.set(0, -35);

        const button = new PIXI.Container();
        const buttonBg = UiKit.image('levelComplete', 'button', 240, 90);
        const buttonLabel = UiKit.text('levelComplete', 'buttonLabel', { buttonText: LevelCatalog.hasNext(this.level) ? 'NEXT LEVEL' : 'PLAY AGAIN' });
        button.addChild(buttonBg, buttonLabel);
        button.scale.set(0.7);
        button.position.set(0, 60);
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointertap', () => {
            LevelCatalog.advance(this.level);
            this.onRestart.dispatch();
        });

        modal.addChild(panel, ribbon, title, total, button);
        this.positionBottomPanel(modal);
        this.game.uiLayer.addChild(modal);
        this.completeModal = modal;
    }

    private refreshRunMoney(): void {
        if (this.runMoneyLabel) {
            this.runMoneyLabel.text = `CASH AT HAND  $${this.runMoney}`;
        }
    }

    /** Low, close camera used for both the win dance and the busted reaction. */
    private focusCameraOnPlayer(): void {
        const currentCamera = this.env.cameraSystem.current;
        this.env.cameraSystem.register('celebration', {
            ...currentCamera,
            pitchDeg: Math.min(currentCamera.pitchDeg, CELEBRATION_PITCH_DEG),
            distance: Math.min(currentCamera.distance, CELEBRATION_DISTANCE),
            followSpeed: 5,
            offset: { ...currentCamera.offset, y: 1 },
        });
        this.env.cameraSystem.blendTo('celebration', 0.8);
    }

    private async beginCelebration(): Promise<void> {
        if (this.state === 'celebrating' || this.state === 'payout' || this.state === 'complete') {
            return;
        }
        this.state = 'celebrating';
        this.env.mainPlayer.movementController.enabled = false;

        this.focusCameraOnPlayer();
        this.setInstruction('THE GETAWAY!');
        // Started now so animation loading doesn't delay the meter.
        const danceDone = new Promise<void>((resolve) => setTimeout(resolve, CELEBRATION_DANCE_SEC * 1000));

        const playerPosition = this.env.mainPlayer.transform.position;
        const towardCamera = this.threeCamera.position.clone().sub(playerPosition);
        this.env.mainPlayer.character?.faceDirection(towardCamera.x, towardCamera.z);

        try {
            await this.env.playerReady;
            if (this.destroyed) {
                return;
            }
            const character = this.env.mainPlayer.character;
            if (character) {
                await character.registerAnimation('celebration', CELEBRATION_ANIMATION_URL);
                character.animator.playExclusive('celebration', 0.25, false);
            }
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
        const nextGoal = this.waypoints[index + 1];
        if (nextGoal) {
            const isExit = index + 1 === this.waypoints.length - 1;
            this.addMarker(nextGoal, isExit ? 0xff725e : 0xffd889, GOAL_MARKER_RADIUS);
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

        const playerPosition = this.env.mainPlayer.transform.position;
        this.goalArrivalTween?.kill();
        this.goalArrivalTween = gsap.to(playerPosition, {
            x: this.activeGoal.x,
            z: this.activeGoal.z,
            duration: 0.28,
            ease: 'power2.out',
            onComplete: () => {
                this.goalArrivalTween = undefined;
                if (this.destroyed || this.state !== 'revealing') {
                    return;
                }
                this.route = [];
                this.routeBlocked = false;
                this.clearRoute();
                if (this.nextWaypointIndex < this.waypoints.length - 1) {
                    this.revealArea(this.nextWaypointIndex);
                    this.advanceWaypoint();
                } else {
                    void this.beginCelebration();
                }
            },
        });
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
        PizzaParticleSystem.update(delta);
        this.updateWallHeight();
        PizzaBendService.updateTime(delta);
        for (const door of this.wallDoors) {
            door.update(delta, this.doorWorld);
        }
        pruneCollected(this.env.world, this.collectibles);
        this.updateGuards(delta);
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
        super.update(delta);
    }

    private buildGuards(): void {
        this.destroyGuards();
        this.spottedMessageShown = false;
        this.bustGuard = undefined;
        this.bustFocus = false;
        const sight = new LevelSight(this.level);
        for (const data of this.level.guards ?? []) {
            if (data.path.length === 0) {
                continue;
            }
            const guard = new Guard(this.threeScene, data, sight, BendService);
            guard.load().catch((error) => console.warn('[PathLevelScene] Could not load guard', error));
            this.guards.push(guard);
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
        const player = this.env.mainPlayer.transform.position;
        let highestAlert = 0;
        let spotter: Guard | undefined;
        for (const guard of this.guards) {
            if (!walking) {
                guard.hold();
            } else {
                const tooClose = guard.isTooClose(player);
                const seen = tooClose || guard.sees(player);
                if (seen) {
                    guard.focusOn(player);
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
        this.updateSpottedMessage(highestAlert);
        if ((this.state === 'following' || this.state === 'waiting') && highestAlert >= 1 && spotter) {
            this.beginBusted(spotter);
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
            if (guard.chase(player, delta)) {
                this.bustPhase = 'react';
                this.bustTimer = 0;
                guard.faceToward(player);
                guard.playAngry();
                this.playPlayerSad(guard);
                this.bustFocus = true;
                this.focusCameraOnPlayer();
            }
        } else {
            this.bustTimer += delta;
            if (this.bustTimer >= BUSTED_REACTION_SEC && !this.bustedModal) {
                this.showBustedPopup();
            }
        }
        guard.render(delta);
    }

    private playPlayerSad(guard: Guard): void {
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

    private beginBusted(spotter: Guard): void {
        if (this.state !== 'following' && this.state !== 'waiting') {
            return;
        }
        this.state = 'busted';
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
        const insideRoom = Math.abs(position.x) < this.level.floor.width / 2 - 0.2
            && Math.abs(position.z) < this.level.floor.depth / 2 - 0.2;
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
            ? CELEBRATION_CAMERA_OPTIONS
            : this.pathCameraOptions;
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

    private applyScreenShift(delta = 0): void {
        const width = window.innerWidth;
        const height = Math.max(1, window.innerHeight);
        const camera = this.threeCamera;
        const aiming = this.state === 'waiting' || this.state === 'revealing';
        let wantedShift = this.screenShiftFraction;
        if (aiming) {
            camera.clearViewOffset();
            camera.updateMatrixWorld();
            const player = this.env.mainPlayer.transform.position;
            const ndcY = this.shiftProbe.set(player.x, player.y + 0.8, player.z).project(camera).y;
            wantedShift = PLAYER_SCREEN_Y_FRACTION - (1 - ndcY) / 2;
        } else if (this.state !== 'following') {
            wantedShift = SCREEN_VERTICAL_SHIFT;
        }
        this.screenShiftFraction = delta > 0 && Number.isFinite(wantedShift)
            ? THREE.MathUtils.lerp(this.screenShiftFraction, wantedShift, 1 - Math.exp(-delta * 8))
            : Number.isFinite(wantedShift) ? wantedShift : this.screenShiftFraction;
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
        if (this.runMoneyLabel) {
            this.runMoneyLabel.position.set(Game.overlayScreenData.center.x, Game.overlayScreenData.topLeft.y + 124);
        }
        if (this.modeSelector) {
            this.modeSelector.position.set(Game.overlayScreenData.center.x - 156, Game.overlayScreenData.topLeft.y + 66);
            const buttons = this.modeSelector.children;
            buttons[0].position.set(0, 0);
            buttons[1].position.set(160, 0);
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

    private frameActiveSegment(instant = false): void {
        if (!this.env?.mainPlayer) {
            return;
        }
        const cameraSettings = this.env.cameraSystem.current;
        const pitch = THREE.MathUtils.degToRad(cameraSettings.pitchDeg);
        const halfFovTangent = Math.tan(THREE.MathUtils.degToRad(this.threeCamera.fov / 2));
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        const halfWidth = Math.min(this.level.floor.width / 2, CAMERA_MAX_HALF_WIDTH) + 0.3;
        const segmentDepth = Math.abs(this.activeGoal.z - this.activeStart.z);
        const depthToStart = segmentDepth * CAMERA_FOCUS_ALONG_SEGMENT + 2;
        const depthToGoal = segmentDepth * (1 - CAMERA_FOCUS_ALONG_SEGMENT) + 2;
        const halfDepth = Math.max(depthToStart, depthToGoal);
        const nearEdgeDepth = halfDepth * Math.cos(pitch);
        const verticalFit = nearEdgeDepth + (halfDepth * Math.sin(pitch)) / halfFovTangent;
        const horizontalFit = nearEdgeDepth + halfWidth / (halfFovTangent * aspect);

        this.segmentFocus.set(
            (this.activeStart.x + this.activeGoal.x) / 2,
            0,
            THREE.MathUtils.lerp(this.activeStart.z, this.activeGoal.z, CAMERA_FOCUS_ALONG_SEGMENT),
        );
        const targetDistance = Math.max(verticalFit, horizontalFit) + 0.5;
        this.cameraZoomTween?.kill();
        if (instant) {
            cameraSettings.distance = targetDistance;
        } else {
            this.cameraZoomTween = gsap.to(cameraSettings, {
                distance: targetDistance,
                duration: 0.55,
                ease: 'power2.inOut',
            });
        }
        this.threeCamera.updateProjectionMatrix();
        if (instant) {
            this.env.updateCamera(this.threeCamera, 0, this.pathCameraOptions);
        }
    }

    public destroy(): void {
        this.destroyed = true;
        this.goalArrivalTween?.kill();
        this.goalArrivalTween = undefined;
        this.cameraZoomTween?.kill();
        this.cameraZoomTween = undefined;
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