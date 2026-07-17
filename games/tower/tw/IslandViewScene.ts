import { Game } from 'core/Game';
import Physics from 'core/phyisics/Physics';
import { ThreeScene } from 'core/scene/ThreeScene';
import * as THREE from 'three';
import { TextureBuilder } from '../game/builders/TextureBuilder';
import { createWaterMaterial } from '../game/builders/WaterMaterial';
import type { PlayerEntity } from '../game/entities/PlayerEntity';
import { CollectibleManager } from '../game/systems/CollectibleManager';
import { BoundlessChunkManager } from '../game/world/BoundlessChunkManager';
import {
    deriveWaterTones,
    getDefaultIsland,
    parseHexColor,
    resolveIslandImagePath,
} from '../game/world/IslandStorage';
import { ROOM_GEOMETRY } from '../game/world/MeshConfig';
import { DEFAULT_FACE_TOWER_CONFIG } from './FaceTowerConfig';
import { FaceTowerGameController } from './FaceTowerGameController';

const VIEW_ORIGIN = {
    position: new THREE.Vector3(0, 0, 0),
    collisionRadius: 1,
} as PlayerEntity;

const CAMERA_YAW_DEG = 0;
const CAMERA_PITCH_DEG = 28;
const CAMERA_DISTANCE = 38;
const FOCUS_POINT = new THREE.Vector3(0, 0, 0);

export default class IslandViewScene extends ThreeScene {
    private collectibles!: CollectibleManager;
    private chunkManager!: BoundlessChunkManager;

    private waterMesh!: THREE.Mesh;
    private waterMat!: THREE.Material;

    private faceTower!: FaceTowerGameController;

    public async build(): Promise<void> {
        Physics.init({
            gravity: {
                x: 0,
                y: 0.5,
            },
            enableSleep: false,
        });

        const island = getDefaultIsland();

        await TextureBuilder.loadRealIsland(
            resolveIslandImagePath(island.texture),
        );

        this.threeScene.background = new THREE.Color(
            parseHexColor(island.skyColor),
        );

        this.threeScene.add(this.threeCamera);

        this.threeScene.add(
            new THREE.AmbientLight(
                parseHexColor(island.ambientColor),
                0.9,
            ),
        );

        const key = new THREE.DirectionalLight(
            0xfff4dd,
            1.6,
        );

        key.position.set(5, 10, 7.5);
        this.threeScene.add(key);

        const fill = new THREE.DirectionalLight(
            0x99ccff,
            0.5,
        );

        fill.position.set(-8, 3, -5);
        this.threeScene.add(fill);

        this.waterMesh = this.buildWater(
            island.waterColor,
        );

        this.collectibles = new CollectibleManager();

        this.chunkManager = new BoundlessChunkManager(
            this.threeScene,
            this.collectibles,
        );

        for (let i = 0; i < 30; i++) {
            this.chunkManager.update(VIEW_ORIGIN);
        }

        this.positionCamera();

        this.faceTower = new FaceTowerGameController(
            this.game.stageContainer,
            this.game.overlayContainer,
            this.game.stageContainer,
            DEFAULT_FACE_TOWER_CONFIG,
            {
                onScoreChanged: score => {
                    console.log('Score:', score);
                },

                onCheckpointReached: checkpoint => {
                    console.log('Checkpoint:', checkpoint);
                },

                onGameOver: score => {
                    console.log(
                        'Game over. Final score:',
                        score,
                    );
                },
            },
        );

        this.faceTower.start();
        this.resizeFaceTowerInput();
    }

    private positionCamera(): void {
        const yaw =
            CAMERA_YAW_DEG * Math.PI / 180;

        const pitch =
            CAMERA_PITCH_DEG * Math.PI / 180;

        const horizontal =
            CAMERA_DISTANCE * Math.cos(pitch);

        this.threeCamera.position.set(
            FOCUS_POINT.x +
            horizontal * Math.sin(yaw),

            FOCUS_POINT.y +
            CAMERA_DISTANCE * Math.sin(pitch),

            FOCUS_POINT.z +
            horizontal * Math.cos(yaw),
        );

        this.threeCamera.lookAt(FOCUS_POINT);
    }

    private resizeFaceTowerInput(): void {
        const screen = Game.overlayScreenData;

        this.faceTower?.resizeInput(
            screen.topLeft.x,
            screen.topLeft.y,
            screen.width,
            screen.height,
        );
    }

    private buildWater(
        waterColor: string,
    ): THREE.Mesh {
        const SIZE = 400;
        const SEGMENTS = 128;

        const {
            opacity,
            elevation,
        } = ROOM_GEOMETRY.floor;

        const waterColors = deriveWaterTones(
            parseHexColor(waterColor),
        );

        this.waterMat = createWaterMaterial(
            opacity,
            elevation,
            waterColors,
        );

        const geometry = new THREE.PlaneGeometry(
            SIZE,
            SIZE,
            SEGMENTS,
            SEGMENTS,
        );

        geometry.rotateX(-Math.PI / 2);

        const mesh = new THREE.Mesh(
            geometry,
            this.waterMat,
        );

        mesh.frustumCulled = false;

        const startTime = performance.now();

        mesh.onBeforeRender = () => {
            const material =
                this.waterMat as THREE.ShaderMaterial;

            material.uniforms.time.value =
                (performance.now() - startTime) / 1000;
        };

        this.threeScene.add(mesh);

        return mesh;
    }

    public fixedUpdate(delta: number): void {
        Physics.fixedUpdate(delta);
        super.fixedUpdate(delta);
        this.faceTower?.update(delta);
    }

    public update(delta: number): void {
        super.update(delta);
    }

    public destroy(): void {
        this.faceTower?.destroy();

        this.chunkManager?.destroy();
        this.collectibles?.destroy();

        if (this.waterMesh) {
            this.threeScene.remove(this.waterMesh);
            this.waterMesh.geometry.dispose();
        }

        this.waterMat?.dispose();

        super.destroy();
    }
}