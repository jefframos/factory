// RaceScene.ts
//
// Placeholder for the race: the player's car on the start line of a road with the character next to
// it, and a BACK button (onBack) to the garage. The actual race (opponents, upgrades affecting speed,
// trophies) is the next step.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import { BendService } from 'core/services/BendService';
import { WorldEnvironment, CameraFollowOptions } from './shared/WorldEnvironment';
import { DEFAULT_CAMERA_MODE } from '../data/GameSettings';
import { GARAGE } from '../data/GarageData';
import { placeProp } from '../builders/PropBuilder';
import { bigButton } from '../ui/BigButton';
import { UiKit } from '../ui/UiKit';

const CAR_LENGTH = 6.2;
const ROAD_WIDTH = 14;
const ROAD_LENGTH = 200;
const CAMERA_FOLLOW: CameraFollowOptions = { freezeHeightWhileAirborne: true };

export default class RaceScene extends ThreeScene {
    /** BACK pressed — index.ts returns to the garage. */
    public readonly onBack: Signal = new Signal();

    private env!: WorldEnvironment;
    private readonly hud = new PIXI.Container();
    private backButton?: PIXI.Container;
    private title?: PIXI.Text;
    private subtitle?: PIXI.Text;

    public get ready(): Promise<void> {
        return this.env.playerReady;
    }

    public build(): void {
        this.env = new WorldEnvironment(this.threeScene, BendService, 300, 32, 1, undefined, false);
        const grass = new THREE.Mesh(new THREE.BoxGeometry(300, 0.1, 300), this.material(0x78b85a));
        grass.position.y = -0.1;
        const road = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH, 0.08, ROAD_LENGTH), this.material(0x3c4048));
        road.position.set(0, -0.02, -ROAD_LENGTH / 2 + 10);
        const startLine = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH, 0.1, 0.6), this.material(0xffffff));
        startLine.position.set(0, 0.02, -2);
        this.threeScene.add(grass, road, startLine);
        void placeProp(this.threeScene, BendService, GARAGE.playerCar.model, { x: 2.5, z: -5, rotationY: 180, length: CAR_LENGTH })
            .catch((e) => console.warn('[RaceScene] car', e));

        this.env.spawnPlayer(this, new THREE.Vector3(-2.5, 0, 0));
        this.env.cameraSystem.cutTo(DEFAULT_CAMERA_MODE);
        this.env.updateCamera(this.threeCamera, 0, CAMERA_FOLLOW);

        const race = GARAGE.races[0];
        this.title = UiKit.text('garage', 'title', { text: race?.name.toUpperCase() ?? 'RACE' });
        this.subtitle = UiKit.text('garage', 'subtitle', { text: 'RACING COMES NEXT' });
        this.backButton = bigButton('backButton', 'backLabel', 'BACK', 220, () => this.onBack.dispatch());
        this.hud.addChild(this.title, this.subtitle, this.backButton);
        this.game.uiLayer.addChild(this.hud);
        this.resize();
    }

    private material(color: number): THREE.MeshStandardMaterial {
        const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
        BendService.applyBend(material);
        return material;
    }

    public update(delta: number): void {
        this.env.update(delta);
        super.update(delta);
    }

    public fixedUpdate(delta: number): void {
        this.env.fixedUpdate(delta);
        this.env.updateCamera(this.threeCamera, delta, CAMERA_FOLLOW);
    }

    public resize(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        this.title?.position.set(screen.center.x, screen.topLeft.y + 44);
        this.subtitle?.position.set(screen.center.x, screen.topLeft.y + 84);
        this.backButton?.position.set(screen.center.x, screen.bottomLeft.y - 90);
    }

    public destroy(): void {
        this.hud.destroy({ children: true });
        this.env.destroy();
        super.destroy();
    }
}
