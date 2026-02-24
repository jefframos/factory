import { Game } from "@core/Game";
import { CollisionLayer } from "@core/phyisics/core/CollisionLayer";
import Physics from "@core/phyisics/Physics";
import Pool from "@core/Pool";
import { GameScene } from "@core/scene/GameScene";
import SetupThree from "@core/scene/SetupThree";
import ModelLoaderManager from "@core/three/ModelLoaderManager";
import { DevGuiManager } from "@core/utils/DevGuiManager";
import * as PIXI from 'pixi.js';
import MODELS from "../../registry/assetsRegistry/modelsRegistry";
import { InputService } from "../input/InputService";
import { LevelDataManager } from "../level/LevelDataManager";
import { LevelConfig, ModifierTrigger } from "../level/LevelTypes";
import { CameraService } from "../services/CameraService";
import { ColorPaletteService } from "../services/ColorPaletteService";
import { EntitySceneService } from "../services/EntitySceneService";
import { LevelService } from "../services/LevelService";
import { LevelViewService3D } from "../services/LevelViewService3D";
import { ThreeCameraService } from "../services/ThreeCameraService";
import { TruckMover } from "../services/TruckMover";
import { TruckView3DService } from "../services/TruckView3DService";
import { TruckViewService } from "../services/TruckViewService";
import { CarEntity, CarPart } from "../truck/CarEntity";
import { CAR_ASSET_DATA } from "../truck/CarTypes";
import { GameplayHUD } from "../ui/GameplayHUD";
import GameplayScene from "./GameplayScene";


export const LEVEL_1_DATA: LevelConfig = {
    id: "level_one",
    spawnPoint: { x: 200, y: 400 },
    objects: [
        // Ground
        { type: 'box', x: 2500, y: 550, width: 5000, height: 100, isStatic: true },
        // Ramp
        {
            type: 'polygon',
            x: 800, y: 500,
            vertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: -100 }],
            isStatic: true
        },
        // Finish Line Sensor
        {
            type: 'sensor',
            x: 4800, y: 400,
            width: 100, height: 400,
            label: 'finish_line'
        }
    ]
};


export const LEVELS = [
    {
        id: "The Gauntlet",
        spawnPoint: { x: 150, y: 400 },
        objects: [
            // --- START ZONE ---
            { type: 'box', x: 400, y: 550, width: 800, height: 100 }, // Starting platform
            { type: 'sensor', x: 150, y: 450, width: 60, height: 200, label: 'start_node' },

            // --- THE TRAMPOLINE JUMP ---
            {
                type: 'box', x: 750, y: 510, width: 120, height: 30,
                modifier: { type: 'trampoline', force: 20 } // Upward launch
            },

            // --- MID-AIR BOUNCER OBSTACLES ---
            // These will knock the player away if they hit them mid-jump
            {
                type: 'circle', x: 1100, y: 250, radius: 40,
                modifier: { type: 'bouncer', force: 20 }
            },
            {
                type: 'circle', x: 1300, y: 400, radius: 40,
                modifier: { type: 'bouncer', force: 20 }
            },

            // --- THE LANDING & BOOST STRIP ---
            //{ type: 'box', x: 200, y: 550, width: 1000, height: 100 }, // Landing platform
            {
                type: 'sensor', x: 500, y: 490, width: 300, height: 100,
                modifier: {
                    type: 'boost',
                    force: 0.5,
                    direction: { x: 1, y: 0 },
                    trigger: ModifierTrigger.ON_ACTIVE
                }
            },

            // --- FINAL HILL ---
            {
                type: 'polygon', x: 2500, y: 500,
                vertices: [
                    { x: 0, y: 0 },
                    { x: 400, y: -150 },
                    { x: 400, y: 0 }
                ]
            },

            // --- FINISH LINE ---
            { type: 'box', x: 3500, y: 550, width: 1000, height: 100 },
            { type: 'sensor', x: 3800, y: 450, width: 60, height: 200, label: 'finish_node' }
        ]
    },
    {
        id: "Sprint",
        spawnPoint: { x: 100, y: 450 },
        objects: [
            { type: 'circle', x: 600, y: 500, radius: 40, isStatic: false },
            { type: 'box', x: 2500, y: 550, width: 5000, height: 100, isStatic: true }, // Floor
            { type: 'sensor', x: 100, y: 450, width: 100, height: 200, label: 'start_node' },
            { type: 'sensor', x: 4800, y: 450, width: 100, height: 200, label: 'finish_node' }
        ]
    },
    {
        id: "Hill Climb",
        spawnPoint: { x: 100, y: 450 },
        objects: [
            { type: 'box', x: 500, y: 550, width: 1000, height: 100, isStatic: true },
            { type: 'polygon', x: 1000, y: 550, vertices: [{ x: 0, y: 0 }, { x: 400, y: -200 }, { x: 400, y: 0 }] },
            { type: 'box', x: 1650, y: 350, width: 500, height: 100 },
            { type: 'sensor', x: 100, y: 450, width: 100, height: 200, label: 'start_node' },
            { type: 'sensor', x: 1800, y: 250, width: 100, height: 200, label: 'finish_node' }
        ]
    },
    {
        id: "The Gap",
        spawnPoint: { x: 100, y: 450 },
        objects: [
            { type: 'box', x: 400, y: 550, width: 800, height: 100, isStatic: true },
            { type: 'box', x: 1600, y: 550, width: 800, height: 100 }, // The landing
            { type: 'sensor', x: 100, y: 450, width: 100, height: 200, label: 'start_node' },
            { type: 'sensor', x: 1800, y: 450, width: 100, height: 200, label: 'finish_node' }
        ]
    }
];


export default class NetScene extends GameScene {
    private worldContainer: PIXI.Container = new PIXI.Container();
    private entityService!: EntitySceneService;
    // Services
    private truckViewService!: TruckViewService;
    private levelService!: LevelService;
    private inputService!: InputService;
    private camera!: CameraService;

    private myTruck!: CarEntity;
    private truck3D!: TruckView3DService;
    private threeCameraService!: ThreeCameraService;
    private gameplayScene!: GameplayScene;
    private levelViewService3D!: LevelViewService3D;

    private hud!: GameplayHUD;

    public async build(): Promise<void> {

        const json = PIXI.Cache.get('game/worlds.json')
        await LevelDataManager.instance.init('game/worlds.json');

        if (json) {
            ColorPaletteService.init(
                json.palettes || [],
                json.activePaletteId || "Default"
            );
        }


        // 1. Initialize Global Physics
        Physics.init({ gravity: { x: 0, y: 0.5 }, enableSleep: true });
        this.addChild(this.worldContainer);

        this.entityService = new EntitySceneService(this.worldContainer);


        this.gameplayScene = new GameplayScene(this.game)
        this.gameplayScene.build();

        // 2. Build World (Floor and Obstacles)

        // 3. Setup Truck Entity
        this.myTruck = Pool.instance.getElement(CarEntity);
        this.myTruck.build({
            layer: CollisionLayer.PLAYER
        });
        // this.myTruck.updateStats(
        //     {
        //         acceleration: 0,
        //         maxSpeed: 50
        //     }
        // )
        this.entityService.addEntity(this.myTruck);




        this.truck3D = new TruckView3DService(this.myTruck, this.gameplayScene.threeScene);

        ModelLoaderManager.instance.loadModel(MODELS.PoliceKenney.fullPath, MODELS.PoliceKenney.id).then((fullModel) => {

            console.log(fullModel)
        })

        this.truck3D.buildStandardTruck(MODELS.PoliceKenney, {

            scale: 50,
            wheelScale: 50,
            visualRotationY: Math.PI / 2,

            nodes: {
                chassis: MODELS.PoliceKenney.nodes.Body,
                frontLeft: MODELS.PoliceKenney.nodes.WheelFrontLeft,
                frontRight: MODELS.PoliceKenney.nodes.WheelFrontRight,
                backLeft: MODELS.PoliceKenney.nodes.WheelBackLeft,
                backRight: MODELS.PoliceKenney.nodes.WheelBackRight,
            }
        });

        // 4. Initialize Services
        //this.truckViewService = new TruckViewService(this.myTruck, this.worldContainer);
        this.setupTruckVisuals();

        this.inputService = new InputService();
        const truckMover = new TruckMover(this.myTruck)
        this.inputService.setMover(truckMover);

        // Initialize HUD
        this.hud = new GameplayHUD();
        this.addChild(this.hud); // Add directly to scene to ignore camera scrolling

        // Register HUD Signals to TruckMover actions
        this.hud.onAccelerate.add(() => truckMover.moveForward());
        this.hud.onReverse.add(() => truckMover.moveBackward());
        this.hud.onJump.add(() => truckMover.jump());
        this.hud.onRespawn.add(() => this.levelService.respawnPlayer());

        this.camera = new CameraService(this.worldContainer);
        this.camera.follow(this.myTruck.transform.position);
        this.camera.offset.y = 300

        this.levelService = new LevelService(this.entityService, this.myTruck);
        this.levelService.onLevelEnded.add(() => {
            this.handleLevelComplete()
        })

        this.levelViewService3D = new LevelViewService3D(this.gameplayScene.threeScene, this.myTruck);

        this.levelService.onLevelBuilt.add((level) => {
            this.levelViewService3D.buildLevel(level, this.myTruck, this.levelService.spawnedEntities)
        })

        const worldIdx = 0; // "Medium" is the 3rd world (index 2)
        const levelIdx = 0; // First level in that world

        this.myTruck.teleport(0, -100)
        const config = LevelDataManager.instance.getLevel(worldIdx, levelIdx);
        const globalId = LevelDataManager.instance.getGlobalId(worldIdx, levelIdx);
        this.levelService.buildLevel(config);



        this.threeCameraService = new ThreeCameraService(this.gameplayScene.threeCamera, this.gameplayScene.threeScene, SetupThree.renderer);

        // Setup a classic 2.5D side-scrolling angle
        this.threeCameraService.distance = 300;
        this.threeCameraService.fogFar = 300000;
        this.threeCameraService.orbitAngle = -1.12; // Slight angle so we see the side and front
        this.threeCameraService.elevationAngle = 0.52;
        if (Game.debugParams.cam) {

            this.threeCameraService.distance = 800;
            this.threeCameraService.orbitAngle = 0//-1.12; // Slight angle so we see the side and front
            this.threeCameraService.elevationAngle = 0//0.52;
        }
        this.threeCameraService.renderDistance = 3000
        this.threeCameraService.renderDistance = 300000;
        const folder = "3D Camera";



        // 1. Distance & Clipping (Large Ranges)
        DevGuiManager.instance.addProperties(
            this.threeCameraService,
            ['distance'],
            [100, 2000],
            "Distance ",
            folder
        );

        DevGuiManager.instance.addProperties(
            this.threeCameraService,
            ['renderDistance'],
            [500, 10000],
            "Render Clip Far",
            folder
        );

        // 2. Angles (Radian Ranges: 0 to PI)
        DevGuiManager.instance.addProperties(
            this.threeCameraService,
            ['orbitAngle'],
            [-3.14, 3.14],
            "Orbit (Yaw)",
            folder
        );

        DevGuiManager.instance.addProperties(
            this.threeCameraService,
            ['elevationAngle'],
            [-1.57, 1.57],
            "Elevation (Pitch)",
            folder
        );

        // 3. Fog Settings
        DevGuiManager.instance.addProperties(
            this.threeCameraService,
            ['fogNear'],
            [0, 1000],
            "Fog Start",
            folder
        );

        DevGuiManager.instance.addProperties(
            this.threeCameraService,
            ['fogFar'],
            [100, 5000],
            "Fog End",
            folder
        );

        // 4. Smoothing
        DevGuiManager.instance.addProperties(
            this.threeCameraService,
            ['lerpFactor'],
            [0.01, 1],
            "Lerp Smoothness",
            folder
        );

        this.createUI()
    }

    private createUI(): void {
        const uiContainer = new PIXI.Container();
        this.addChild(uiContainer); // Add to scene, not worldContainer (so it stays fixed)

        LEVELS.forEach((levelData, index) => {
            const button = new PIXI.Container();
            button.x = 20 + (index * 130);
            button.y = 20;
            button.eventMode = 'static';
            button.cursor = 'pointer';

            // Button Background
            const bg = new PIXI.Graphics()
                .beginFill(0x333333)
                .drawRoundedRect(0, 0, 120, 40, 8)
                .endFill();

            // Button Text
            const text = new PIXI.Text(levelData.id, {
                fill: 0xffffff,
                fontSize: 16,
                fontWeight: 'bold'
            });
            text.anchor.set(0.5);
            text.position.set(60, 20);

            button.addChild(bg, text);

            // Click Event
            button.on('pointerdown', () => {
                console.log(`Loading Level: ${levelData.id}`);
                this.levelService.buildLevel(levelData);
                this.camera.teleport(levelData.spawnPoint);
            });

            uiContainer.addChild(button);
        });

        // Timer Display
        const timerText = new PIXI.Text('Time: 0.00', { fill: 0xffffff, fontSize: 20 });
        timerText.position.set(Game.DESIGN_WIDTH - 150, 25);
        uiContainer.addChild(timerText);

        // Update timer text in your main loop
        //this.timerDisplay = timerText; 
    }

    private handleLevelComplete() {
        console.log("Goal Reached!");

        const targetRespawn = this.levelService.respawnPlayer()
        this.levelService.startLevel()
        // this.myTruck.reset();
        // this.myTruck.teleport(LEVEL_1_DATA.spawnPoint.x, LEVEL_1_DATA.spawnPoint.y);
        // this.camera.teleport(LEVEL_1_DATA.spawnPoint);
        this.threeCameraService.teleport(targetRespawn);
    }


    private setupTruckVisuals(): void {
        // Apply assets based on our Data Config
        Object.entries(CAR_ASSET_DATA).forEach(([part, data]) => {
            this.truckViewService?.setPartAsset(
                part as CarPart,
                PIXI.Texture.from(data.asset),
                (data as any).anchor,
                (data as any).size
            );
        });
    }

    public update(delta: number): void {
        // Update Services
        this.inputService?.update();
        // this.levelService?.update();


        this.hud?.update();
        this.gameplayScene?.update(delta);
        this.levelViewService3D?.update(delta);
        this.truckViewService?.update();
        this.entityService?.update(delta);


    }

    public fixedUpdate(delta: number): void {
        Physics.fixedUpdate(delta);

        this.entityService?.fixedUpdate(delta);

        this.camera?.update();
        this.threeCameraService?.update(this.myTruck.transform.position);
        this.truck3D?.update();
    }


    public destroy(): void {
        this.truckViewService.destroy();
    }
}