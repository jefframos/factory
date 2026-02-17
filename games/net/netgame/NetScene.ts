import { Game } from "@core/Game";
import Pool from "@core/Pool";
import { GameScene } from "@core/scene/GameScene";
import * as PIXI from 'pixi.js';
import decomp from 'poly-decomp';
import { BaseEntity } from "../phyisics/BaseEntity";
import { BoxEntity } from "../phyisics/BoxEntity";
import { CollisionLayer } from "../phyisics/CollisionLayer";
import Physics from "../phyisics/Physics";
import { PolygonEntity } from "../phyisics/PolygonEntity";
import { CameraService } from "../phyisics/truck/CameraService";
import { TruckEntity } from "../phyisics/truck/TruckEntity";
import { TruckMover } from "../phyisics/truck/TruckMover";
import { InputService } from "./input/InputService";

export default class NetScene extends GameScene {
    private entities: Set<BaseEntity> = new Set();
    private myTruck!: TruckEntity;
    private inputService!: InputService;
    constructor(game: Game) {
        super(game);
        (window as any).decomp = decomp;
    }
    public async build(): Promise<void> {

        this.inputService = new InputService();
        // Example: Add an entity here
        Physics.init({
            gravity: { x: 0, y: 0.5 }, // Half gravity
            timeScale: 1.0,            // Normal speed
            positionIterations: 10,    // High precision for this scene
            enableSleep: true
        });
        // const box = Pool.instance.getElement(BoxEntity) as BoxEntity;
        // box.build({ w: 50, h: 50, layer: CollisionLayer.DEFAULT });
        // //this.addEntity(box);
        // //box.isStatic = true
        // box.transform.position.y = 300

        // const ball = Pool.instance.getElement(CircleEntity);
        // ball.build({
        //     x: 200,
        //     y: 50,
        //     radius: 30,
        //     layer: CollisionLayer.DEFAULT
        // });
        // //this.addEntity(ball);
        // ball.bounciness = 0.9

        // Spawning a Triangle Polygon
        const triangle = Pool.instance.getElement(PolygonEntity);
        triangle.build({
            x: 400,
            y: 100,
            vertices: [
                { x: 0, y: 0 },
                { x: 100, y: 50 },
                { x: -100, y: 50 }
            ],
            layer: CollisionLayer.DEFAULT
        });
        triangle.isStatic = true
        this.addEntity(triangle);
        triangle.transform.position.y = 460

        // const comp = Pool.instance.getElement(CompositeEntity);
        // comp.build({ x: 0, y: 0, layer: CollisionLayer.DEFAULT })

        // //this.addEntity(comp);
        // comp.transform.position.x = 300



        const box2 = Pool.instance.getElement(BoxEntity) as BoxEntity;
        box2.build({ w: 5000, h: 50, layer: CollisionLayer.DEFAULT });
        this.addEntity(box2);
        box2.transform.position.y = 500
        box2.isStatic = true;


        const heavyStats = {
            friction: 1.0,
            frictionStatic: 1.0       // More grip
        };


        const points = [];
        const totalWidth = 1000;  // Total level length
        const wavelength = 500;   // Distance from peak to peak
        const baseY = 500;        // Vertical center
        const amplitude = 20;     // Height of the bumps

        // We use a frequency that forces a full cycle every 'wavelength' pixels
        const frequency = (Math.PI * 2) / wavelength;

        for (let x = 0; x <= totalWidth; x += 20) { // Increment by 20 for smooth control points
            const y = baseY + Math.sin(x * frequency) * amplitude;
            points.push({ x: x, y: y });
        }

        // Build the terrain
        // this.ground = new SplineEntity();
        // this.ground.build({
        //     points: points,
        //     segmentsPerPoint: 5, // Lower segments since we have many points
        //     thickness: 200,
        //     layer: CollisionLayer.DEFAULT
        // });
        // this.ground.transform.position.y = 500
        //this.addEntity(this.ground);

        this.myTruck = Pool.instance.getElement(TruckEntity);
        this.addEntity(this.myTruck);
        this.myTruck.build({
            x: 0,
            y: 0,
            layer: CollisionLayer.PLAYER,
            stats: heavyStats
        });

        this.myTruck.teleport(0, 400);

        this.myTruck.setCollisionCategory(
            CollisionLayer.PLAYER,
            CollisionLayer.DEFAULT | CollisionLayer.CARGO
        );
        this.myTruck.updateStats({
            acceleration: 0.5,
            maxSpeed: 10
        })

        this.myTruck.cargo.setCargo([
            {
                id: "heavy_crate",
                size: { w: 2, h: 3 },
                position: { x: 0, y: 0 }
            },
            {
                id: "small_box",
                size: { w: 2, h: 2 },
                position: { x: 0, y: 0 }
            }
        ]);


        const mover = new TruckMover(this.myTruck);

        // Tell the input service to drive via the mover
        this.inputService.setMover(mover);

        this.camera = new CameraService(this.worldContainer);
        this.camera.follow(this.myTruck.transform.position);

        this.addChild(this.worldContainer)
    }

    private worldContainer: PIXI.Container = new PIXI.Container;
    private camera!: CameraService;


    public addEntity<T extends BaseEntity>(entity: T): T {
        this.entities.add(entity);
        this.worldContainer.addChild(entity.view); // Assuming GameScene is a PIXI Container
        return entity;
    }

    public removeEntity(entity: BaseEntity): void {
        this.entities.delete(entity);
        entity.destroy(); // This returns it to the pool automatically
    }

    public fixedUpdate(delta: number): void {
        // 1. Update the Physics Engine
        Physics.fixedUpdate(delta);

        // 2. Update Entity Physics Logic
        for (const entity of this.entities) {
            entity.fixedUpdate(delta);
        }
    }

    public update(delta: number): void {
        this.inputService?.update();
        this.camera?.update();
        for (const entity of this.entities) {
            entity.update(delta);
            entity.syncView(); // Keep PIXI in sync with Matter
        }
    }

    public destroy(): void {
        this.entities.forEach(e => e.destroy());
        this.entities.clear();
    }
}