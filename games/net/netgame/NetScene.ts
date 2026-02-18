import { CollisionLayer } from "@core/phyisics/core/CollisionLayer";
import { BasePhysicsEntity } from "@core/phyisics/entities/BaseEntity";
import { BoxEntity } from "@core/phyisics/entities/BoxEntity";
import { PolygonEntity } from "@core/phyisics/entities/PolygonEntity";
import Physics from "@core/phyisics/Physics";
import Pool from "@core/Pool";
import { GameScene } from "@core/scene/GameScene";
import SetupThree from "@core/scene/SetupThree";
import { DevGuiManager } from "@core/utils/DevGuiManager";
import * as PIXI from 'pixi.js';
import GameplayScene from "./GameplayScene";
import { InputService } from "./input/InputService";
import { CameraService } from "./services/CameraService";
import { LEVEL_1_CONFIG, LevelService } from "./services/LevelService";
import { ThreeCameraService } from "./services/ThreeCameraService";
import { TruckMover } from "./services/TruckMover";
import { TruckView3DService } from "./services/TruckView3DService";
import { TruckViewService } from "./services/TruckViewService";
import { TruckEntity, TruckPart } from "./truck/TruckEntity";
import { TRUCK_ASSET_DATA } from "./truck/TruckTypes";

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
        // 1. Initialize Global Physics
        Physics.init({ gravity: { x: 0, y: 0.5 }, enableSleep: true });
        this.addChild(this.worldContainer);

        this.gameplayScene = new GameplayScene(this.game)
        this.gameplayScene.build();

        // 2. Build World (Floor and Obstacles)
        this.createEnvironment();

        // 3. Setup Truck Entity
        this.myTruck = Pool.instance.getElement(TruckEntity);
        this.myTruck.build({
            layer: CollisionLayer.PLAYER
        });
        this.addEntity(this.myTruck);

        this.myTruck.teleport(0, 400)

        this.truck3D = new TruckView3DService(this.myTruck, this.gameplayScene.threeScene);
        this.truck3D.buildStandardTruck();

        // 4. Initialize Services
        //this.truckViewService = new TruckViewService(this.myTruck, this.worldContainer);
        this.setupTruckVisuals();

        this.inputService = new InputService();
        this.inputService.setMover(new TruckMover(this.myTruck));

        this.camera = new CameraService(this.worldContainer);
        this.camera.follow(this.myTruck.transform.position);

        this.levelService = new LevelService(this.myTruck, LEVEL_1_CONFIG, () => {
            this.camera.teleport(LEVEL_1_CONFIG.spawnPoint);
        });


        this.threeCameraService = new ThreeCameraService(this.gameplayScene.threeCamera, this.gameplayScene.threeScene, SetupThree.renderer);

        // Setup a classic 2.5D side-scrolling angle
        this.threeCameraService.distance = 600;
        this.threeCameraService.orbitAngle = -0.52; // Slight angle so we see the side and front
        this.threeCameraService.elevationAngle = 0.52;

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
    }

    private createEnvironment(): void {
        // Main Ground
        const floor = Pool.instance.getElement(BoxEntity) as BoxEntity;
        floor.build({ w: LEVEL_1_CONFIG.floorWidth, h: 50, layer: CollisionLayer.DEFAULT });
        floor.transform.position.y = LEVEL_1_CONFIG.floorY;
        floor.isStatic = true;
        this.addEntity(floor);

        // Example Obstacle
        const ramp = Pool.instance.getElement(PolygonEntity);
        ramp.build({
            x: 800, y: 460,
            vertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: -60 }],
            layer: CollisionLayer.DEFAULT
        });
        ramp.isStatic = true;
        this.addEntity(ramp);
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
        this.levelService?.update();
        this.camera?.update();
        this.gameplayScene?.update(delta);
        this.truckViewService?.update();

        this.truck3D.update();

        this.threeCameraService.update(this.myTruck.transform.position);

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