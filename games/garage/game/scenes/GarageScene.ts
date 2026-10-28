// GarageScene.ts
//
// The player's garage: a concrete workshop floor with painted service bays (from ui/garage.json), a
// customer car parked in each bay, the player's own car by the door, some workshop clutter, and the
// character free to walk around. The RACE button dispatches onRace; index.ts switches scenes.
//
// First pass only: cars just sit in their bays. Arrivals, repairs, hiring and upgrades come next.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import { BendService } from 'core/services/BendService';
import { WorldEnvironment, CameraFollowOptions } from './shared/WorldEnvironment';
import { DEFAULT_CAMERA_MODE } from '../data/GameSettings';
import { GARAGE } from '../data/GarageData';
import { placeProp, addStaticCollider } from '../builders/PropBuilder';
import { bigButton } from '../ui/BigButton';
import { UiKit } from '../ui/UiKit';
import MoneyHud from '../ui/MoneyHud';

const FLOOR_WIDTH = 30;
const FLOOR_DEPTH = 24;
const WALL_HEIGHT = 3;
const WALL_THICKNESS = 0.6;
/** Customer cars are scaled to this length (characters are ~3.5 units tall). */
const CAR_LENGTH = 6.2;
const BAY_WIDTH = 5;
const BAY_DEPTH = 8;
const PLAYER_SPAWN = new THREE.Vector3(0, 0, 3);
const CAMERA_FOLLOW: CameraFollowOptions = { freezeHeightWhileAirborne: true };

export default class GarageScene extends ThreeScene {
    /** RACE pressed — index.ts switches to the race scene. */
    public readonly onRace: Signal = new Signal();

    private env!: WorldEnvironment;
    private readonly hud = new PIXI.Container();
    private raceButton?: PIXI.Container;
    private title?: PIXI.Text;

    public constructor(game: Game, private readonly moneyHud: MoneyHud) {
        super(game);
    }

    public get ready(): Promise<void> {
        return this.env.playerReady;
    }

    public build(): void {
        this.env = new WorldEnvironment(this.threeScene, BendService, 120, 32, 1, undefined, false);
        this.buildWorkshop();
        this.buildBays();
        this.buildCars();
        this.env.spawnPlayer(this, PLAYER_SPAWN);
        this.env.cameraSystem.cutTo(DEFAULT_CAMERA_MODE);
        this.env.updateCamera(this.threeCamera, 0, CAMERA_FOLLOW);
        this.buildHud();
        this.moneyHud.reposition();
    }

    public update(delta: number): void {
        this.env.update(delta);
        super.update(delta);
    }

    public fixedUpdate(delta: number): void {
        this.env.fixedUpdate(delta);
        this.env.updateCamera(this.threeCamera, delta, CAMERA_FOLLOW);
    }

    private material(color: number): THREE.MeshStandardMaterial {
        const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
        BendService.applyBend(material);
        return material;
    }

    /** Concrete floor, an asphalt apron in front, and three low walls (the front stays open). */
    private buildWorkshop(): void {
        const floor = new THREE.Mesh(new THREE.BoxGeometry(FLOOR_WIDTH, 0.1, FLOOR_DEPTH), this.material(0xb9bec4));
        floor.position.set(0, -0.05, -2);
        const apron = new THREE.Mesh(new THREE.BoxGeometry(80, 0.08, 80), this.material(0x4a5059));
        apron.position.set(0, -0.1, 0);
        this.threeScene.add(apron, floor);

        const wallColor = 0xe8d9b5;
        const back = -2 - FLOOR_DEPTH / 2;
        const walls: [number, number, number, number][] = [
            [0, back, FLOOR_WIDTH / 2, WALL_THICKNESS / 2],
            [-FLOOR_WIDTH / 2, -2, WALL_THICKNESS / 2, FLOOR_DEPTH / 2],
            [FLOOR_WIDTH / 2, -2, WALL_THICKNESS / 2, FLOOR_DEPTH / 2],
        ];
        for (const [x, z, halfX, halfZ] of walls) {
            const wall = new THREE.Mesh(new THREE.BoxGeometry(halfX * 2, WALL_HEIGHT, halfZ * 2), this.material(wallColor));
            wall.position.set(x, WALL_HEIGHT / 2, z);
            this.threeScene.add(wall);
            addStaticCollider(this.env.world, this.threeScene, BendService, x, z, halfX, WALL_HEIGHT / 2, halfZ);
        }

        // Workshop clutter along the back wall.
        const clutter: [string, number, number, number][] = [
            ['cars/debris-tire.glb', -13, -12, 0.8],
            ['cars/debris-tire.glb', -11.8, -12.2, 0.8],
            ['cars/box.glb', 12.5, -12, 1.4],
            ['cars/box.glb', 11, -12.2, 1.1],
            ['cars/cone.glb', 13.5, 8, 1.2],
            ['cars/cone.glb', -13.5, 8, 1.2],
        ];
        for (const [model, x, z, height] of clutter) {
            void placeProp(this.threeScene, BendService, model, { x, z, height }).catch((e) => console.warn('[GarageScene] prop', e));
        }
    }

    /** Darker pad with yellow edge lines for every bay. */
    private buildBays(): void {
        const pad = this.material(0x8e959d);
        const line = this.material(0xffd23f);
        for (const bay of GARAGE.bays) {
            const group = new THREE.Group();
            group.position.set(bay.x, 0, bay.z);
            group.rotation.y = THREE.MathUtils.degToRad(bay.rotationY);
            const base = new THREE.Mesh(new THREE.BoxGeometry(BAY_WIDTH, 0.04, BAY_DEPTH), pad);
            base.position.y = 0.02;
            group.add(base);
            for (const side of [-1, 1]) {
                const edge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, BAY_DEPTH), line);
                edge.position.set(side * BAY_WIDTH / 2, 0.03, 0);
                group.add(edge);
            }
            this.threeScene.add(group);
        }
    }

    /** One customer car per bay (cycling through the customer list), plus the player's car by the door. */
    private buildCars(): void {
        GARAGE.bays.forEach((bay, index) => {
            const car = GARAGE.customerCars[index % GARAGE.customerCars.length];
            if (!car) return;
            void placeProp(this.threeScene, BendService, car.model, { x: bay.x, z: bay.z, rotationY: bay.rotationY, length: CAR_LENGTH })
                .catch((e) => console.warn('[GarageScene] car', e));
            addStaticCollider(this.env.world, this.threeScene, BendService, bay.x, bay.z, 1.4, 1, CAR_LENGTH / 2 - 0.3);
        });
        const own = GARAGE.playerCar;
        void placeProp(this.threeScene, BendService, own.model, { x: own.x, z: own.z, rotationY: own.rotationY, length: CAR_LENGTH })
            .catch((e) => console.warn('[GarageScene] player car', e));
        addStaticCollider(this.env.world, this.threeScene, BendService, own.x, own.z, 1.4, 1, CAR_LENGTH / 2 - 0.3);
    }

    private buildHud(): void {
        this.title = UiKit.text('garage', 'title', { text: 'MY GARAGE' });
        this.raceButton = bigButton('raceButton', 'raceLabel', 'RACE!', 260, () => this.onRace.dispatch());
        this.hud.addChild(this.title, this.raceButton);
        this.game.uiLayer.addChild(this.hud);
        this.resize();
    }

    public resize(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        this.title?.position.set(screen.center.x, screen.topLeft.y + 44);
        this.raceButton?.position.set(screen.center.x, screen.bottomLeft.y - 90);
    }

    public destroy(): void {
        this.hud.destroy({ children: true });
        this.env.destroy();
        super.destroy();
    }
}
