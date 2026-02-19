import { Game } from "@core/Game";
import { CollisionLayer } from "@core/phyisics/core/CollisionLayer";
import { BasePhysicsEntity } from "@core/phyisics/entities/BaseEntity";
import Physics from "@core/phyisics/Physics";
import Pool from "@core/Pool";
import { GameScene } from "@core/scene/GameScene";
import SetupThree from "@core/scene/SetupThree";
import { DevGuiManager } from "@core/utils/DevGuiManager";
import * as PIXI from 'pixi.js';
import MODELS from "../registry/assetsRegistry/modelsRegistry";
import GameplayScene from "./GameplayScene";
import { InputService } from "./input/InputService";
import { LevelDataManager } from "./level/LevelDataManager";
import { LevelConfig, ModifierTrigger } from "./level/LevelTypes";
import { CameraService } from "./services/CameraService";
import { LevelService } from "./services/LevelService";
import { ThreeCameraService } from "./services/ThreeCameraService";
import { TruckMover } from "./services/TruckMover";
import { TruckView3DService } from "./services/TruckView3DService";
import { TruckViewService } from "./services/TruckViewService";
import { TruckEntity, TruckPart } from "./truck/TruckEntity";
import { TRUCK_ASSET_DATA } from "./truck/TruckTypes";


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
    private entities: Set<BasePhysicsEntity> = new Set();
    private worldContainer: PIXI.Container = new PIXI.Container();

    // Services
    private truckViewService!: TruckViewService;
    private levelService!: LevelService;
    private inputService!: InputService;
    private camera!: CameraService;

    private myTruck!: TruckEntity;
    private truck3D!: TruckView3DService;
    private threeCameraService!: ThreeCameraService;
    private gameplayScene!: GameplayScene;

    public async build(): Promise<void> {

        const json = PIXI.Cache.get('game/worlds.json')
        await LevelDataManager.instance.init('game/worlds.json');
        // 1. Initialize Global Physics
        Physics.init({ gravity: { x: 0, y: 0.5 }, enableSleep: true });
        this.addChild(this.worldContainer);

        this.gameplayScene = new GameplayScene(this.game)
        this.gameplayScene.build();

        // 2. Build World (Floor and Obstacles)

        // 3. Setup Truck Entity
        this.myTruck = Pool.instance.getElement(TruckEntity);
        this.myTruck.build({
            layer: CollisionLayer.PLAYER
        });
        this.addEntity(this.myTruck);

        this.myTruck.teleport(0, 400)


        this.truck3D = new TruckView3DService(this.myTruck, this.gameplayScene.threeScene);
        this.truck3D.buildStandardTruck(MODELS.Italia, {

            scale: 30,
            wheelScale: 25,
            visualRotationY: Math.PI / 2,

            nodes: {
                chassis: MODELS.Italia.nodes.Italia,
                frontLeft: MODELS.Italia.nodes.Wheels022,
                frontRight: MODELS.Italia.nodes.Wheels023,
                backLeft: MODELS.Italia.nodes.Wheels036,
                backRight: MODELS.Italia.nodes.Wheels037
            }
        });


        // this.truck3D = new TruckView3DService(this.myTruck, this.gameplayScene.threeScene);
        // this.truck3D.buildStandardTruck(MODELS.Jeep, {
        //     scale: 30,
        //     wheelScale: 25,
        //     visualRotationY: Math.PI / 2,
        //     nodes: {
        //         chassis: MODELS.Jeep.nodes.Jeep,
        //         frontLeft: MODELS.Jeep.nodes.Wheels016,
        //         frontRight: MODELS.Jeep.nodes.Wheels017,
        //         backLeft: MODELS.Jeep.nodes.Wheels042,
        //         backRight: MODELS.Jeep.nodes.Wheels043
        //     }
        // });

        // 4. Initialize Services
        //this.truckViewService = new TruckViewService(this.myTruck, this.worldContainer);
        this.setupTruckVisuals();

        this.inputService = new InputService();
        this.inputService.setMover(new TruckMover(this.myTruck));

        this.camera = new CameraService(this.worldContainer);
        this.camera.follow(this.myTruck.transform.position);
        this.camera.offset.y = 300

        this.levelService = new LevelService(this, this.myTruck);
        this.levelService.onLevelEnded.add(() => {
            this.handleLevelComplete()
        })

        const worldIdx = 2; // "Medium" is the 3rd world (index 2)
        const levelIdx = 0; // First level in that world

        const config = LevelDataManager.instance.getLevel(worldIdx, levelIdx);
        const globalId = LevelDataManager.instance.getGlobalId(worldIdx, levelIdx);

        this.levelService.buildLevel(config);

        this.threeCameraService = new ThreeCameraService(this.gameplayScene.threeCamera, this.gameplayScene.threeScene, SetupThree.renderer);

        // Setup a classic 2.5D side-scrolling angle
        this.threeCameraService.distance = 600;
        this.threeCameraService.orbitAngle = -0.52; // Slight angle so we see the side and front
        this.threeCameraService.elevationAngle = 0.52;
        this.threeCameraService.renderDistance = 3000
        const folder = "3D Camera";



        // 1. Distance & Clipping (Large Ranges)
        DevGuiManager.instance.addProperties(
            this.threeCameraService,
            ['distance'],
            [100, 2000],
            "Follow Distance",
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
        this.myTruck.reset();
        this.myTruck.teleport(LEVEL_1_DATA.spawnPoint.x, LEVEL_1_DATA.spawnPoint.y);
        this.camera.teleport(LEVEL_1_DATA.spawnPoint);
        this.threeCameraService.teleport(LEVEL_1_DATA.spawnPoint);
    }


    private setupTruckVisuals(): void {
        // Apply assets based on our Data Config
        Object.entries(TRUCK_ASSET_DATA).forEach(([part, data]) => {
            this.truckViewService?.setPartAsset(
                part as TruckPart,
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
        this.camera?.update();
        this.gameplayScene?.update(delta);
        this.truckViewService?.update();


        // Sync all entities
        for (const entity of this.entities) {
            entity.update(delta);
            entity.syncView();
        }
    }

    public fixedUpdate(delta: number): void {
        Physics.fixedUpdate(delta);
        for (const entity of this.entities) {
            entity.fixedUpdate(delta);
        }

        this.truck3D.update();
        this.threeCameraService.update(this.myTruck.transform.position);
    }

    public addEntity<T extends BasePhysicsEntity>(entity: T): T {
        this.entities.add(entity);
        entity.view.alpha = 0.2
        this.worldContainer.addChild(entity.view);
        return entity;
    }

    public destroy(): void {
        this.entities.forEach(e => e.destroy());
        this.entities.clear();
        this.truckViewService.destroy();
    }
}