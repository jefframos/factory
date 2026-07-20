import { Game } from 'core/Game';
import Physics from 'core/phyisics/Physics';
import { ThreeScene } from 'core/scene/ThreeScene';
import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { ClusterMeshBuilder } from '../game/builders/ClusterMeshBuilder';
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
import { TowerBlockSync3D } from './TowerBlockSync3D';
import { DEFAULT_TOWER_3D_CONFIG } from './Tower3DConfig';

const VIEW_ORIGIN = {
    position: new THREE.Vector3(0, 0, 0),
    collisionRadius: 1,
} as PlayerEntity;

const FOCUS_POINT = new THREE.Vector3(0, 0, 0);

/**
 * A single connected blob of cells (not the chunk streamer) centered on the
 * origin — [col, row] pairs fed to ClusterMeshBuilder. `diameterPx` (design
 * pixels) is converted to world units via `pixelsPerUnit`, the same
 * conversion TowerBlockSync3D uses for the 2D↔3D block mirroring, so the
 * cluster's on-screen size stays in the same unit system as everything else
 * in Tower3DConfig instead of a raw cell-count guess.
 */
function generateCircularCluster(
    diameterPx: number,
    pixelsPerUnit: number,
    cellSize: number,
): [number, number][] {
    const worldRadius = diameterPx / pixelsPerUnit * 0.5;
    const cellRadius = Math.round(worldRadius / cellSize);

    const cells: [number, number][] = [];

    for (let col = -cellRadius; col <= cellRadius; col++) {
        for (let row = -cellRadius; row <= cellRadius; row++) {
            if (col * col + row * row <= cellRadius * cellRadius) {
                cells.push([col, row]);
            }
        }
    }

    return cells;
}

export default class IslandViewScene extends ThreeScene {
    private collectibles!: CollectibleManager;
    private chunkManager!: BoundlessChunkManager;

    private waterMesh!: THREE.Mesh;
    private waterMat!: THREE.Material;

    private clusterMesh!: THREE.Mesh;

    private worldContainer!: PIXI.Container;

    private scoreLabel!: PIXI.Text;
    private milestoneLabel!: PIXI.Text;
    private gameOverLabel!: PIXI.Text;
    private replayButton!: PIXI.Container;

    private faceTower!: FaceTowerGameController;
    private blockSync3D!: TowerBlockSync3D;

    public async build(): Promise<void> {
        Physics.init({
            gravity: {
                x: DEFAULT_FACE_TOWER_CONFIG.gravityX,
                y: DEFAULT_FACE_TOWER_CONFIG.gravityY,
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

        this.clusterMesh = this.buildIslandCluster();

        this.collectibles = new CollectibleManager();

        this.chunkManager = new BoundlessChunkManager(
            this.threeScene,
            this.collectibles,
        );

        for (let i = 0; i < 30; i++) {
            this.chunkManager.update(VIEW_ORIGIN);
        }

        this.positionCamera();

        this.buildFaceTowerLayer();
    }

    private buildFaceTowerLayer(): void {
        this.worldContainer = new PIXI.Container();
        this.addChild(this.worldContainer);

        this.scoreLabel = new PIXI.Text('0', {
            fill: 0xffffff,
            fontSize: 48,
            fontWeight: 'bold',
            stroke: 0x000000,
            strokeThickness: 4,
        });

        this.scoreLabel.anchor.set(0.5, 0);
        this.scoreLabel.position.set(
            Game.DESIGN_WIDTH * 0.5,
            40,
        );

        this.addChild(this.scoreLabel);

        this.milestoneLabel = new PIXI.Text('', {
            fill: 0xffe066,
            fontSize: 28,
            fontWeight: 'bold',
            stroke: 0x000000,
            strokeThickness: 4,
        });

        this.milestoneLabel.anchor.set(0.5, 0);
        this.milestoneLabel.alpha = 0;
        this.milestoneLabel.position.set(
            Game.DESIGN_WIDTH * 0.5,
            100,
        );

        this.addChild(this.milestoneLabel);

        this.gameOverLabel = new PIXI.Text('', {
            fill: 0xff4444,
            fontSize: 40,
            fontWeight: 'bold',
            align: 'center',
            stroke: 0x000000,
            strokeThickness: 5,
        });

        this.gameOverLabel.anchor.set(0.5);
        this.gameOverLabel.alpha = 0;
        this.gameOverLabel.position.set(
            Game.DESIGN_WIDTH * 0.5,
            Game.DESIGN_HEIGHT * 0.5,
        );

        this.addChild(this.gameOverLabel);

        this.faceTower = new FaceTowerGameController(
            this.worldContainer,
            this.game.overlayContainer,
            this,
            DEFAULT_FACE_TOWER_CONFIG,
            {
                onScoreChanged: score => {
                    this.scoreLabel.text = String(score);
                },

                onMilestoneReached: zoneIndex => {
                    this.milestoneLabel.text =
                        `Zone ${zoneIndex} complete!`;

                    this.flashMilestone();
                },

                onGameOver: score => {
                    this.gameOverLabel.text =
                        `Tower collapsed!\nScore: ${score}`;

                    this.gameOverLabel.alpha = 1;
                    this.replayButton.visible = true;
                },
            },
        );

        this.blockSync3D = new TowerBlockSync3D(
            this.threeScene,
            DEFAULT_FACE_TOWER_CONFIG,
            DEFAULT_TOWER_3D_CONFIG.pixelsPerUnit,
            DEFAULT_TOWER_3D_CONFIG.towerBaseOffset,
        );

        this.faceTower.start();
        this.resizeFaceTowerInput();

        /*
         * Added after (and thus on top of) the tower's full-screen input
         * layer, which also lives in overlayContainer — otherwise that
         * layer would swallow every click before it reached this button.
         */
        this.replayButton = this.buildReplayButton();
        this.game.overlayContainer.addChild(this.replayButton);
    }

    private buildReplayButton(): PIXI.Container {
        const button = new PIXI.Container();

        const background = new PIXI.Graphics();

        background
            .beginFill(0x2f6fed)
            .lineStyle(3, 0xffffff, 0.9)
            .drawRoundedRect(-90, -28, 180, 56, 12)
            .endFill();

        button.addChild(background);

        const label = new PIXI.Text('Replay', {
            fill: 0xffffff,
            fontSize: 26,
            fontWeight: 'bold',
        });

        label.anchor.set(0.5);
        button.addChild(label);

        button.position.set(
            Game.DESIGN_WIDTH * 0.5,
            Game.DESIGN_HEIGHT * 0.5 + 90,
        );

        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.visible = false;

        button.on('pointertap', () => {
            this.gameOverLabel.alpha = 0;
            this.replayButton.visible = false;
            this.faceTower.reset();
        });

        return button;
    }

    private flashMilestone(): void {
        this.milestoneLabel.alpha = 1;

        setTimeout(() => {
            this.milestoneLabel.alpha = 0;
        }, 1200);
    }

    private buildIslandCluster(): THREE.Mesh {
        const cfg = DEFAULT_TOWER_3D_CONFIG;
        const cellSize = cfg.clusterCellSize;
        const origin = -cellSize * 0.5;

        const cells = generateCircularCluster(
            cfg.clusterDiameter,
            cfg.pixelsPerUnit,
            cellSize,
        );

        const geometry = ClusterMeshBuilder.roundEdges(
            cells,
            cellSize,
            cfg.clusterHeight,
            cfg.clusterDepthBelow,
            origin,
            origin,
            cfg.clusterBevelRadius,
        );

        const material = new THREE.MeshStandardMaterial({
            map: TextureBuilder.island(),
            roughness: 0.9,
        });

        const mesh = new THREE.Mesh(geometry, material);
        this.threeScene.add(mesh);

        return mesh;
    }

    /**
     * `liftY` raises both the camera and its look-at target by the same
     * amount, keeping yaw/pitch/distance fixed — used to pair the 3D camera
     * to the 2D tower camera's scroll (see update()).
     */
    private positionCamera(liftY: number = 0): void {
        const cfg = DEFAULT_TOWER_3D_CONFIG;

        const yaw = cfg.cameraYawDeg * Math.PI / 180;
        const pitch = cfg.cameraPitchDeg * Math.PI / 180;
        const horizontal = cfg.cameraDistance * Math.cos(pitch);
        const focusY = FOCUS_POINT.y + liftY;

        this.threeCamera.position.set(
            FOCUS_POINT.x +
            horizontal * Math.sin(yaw),

            focusY +
            cfg.cameraDistance * Math.sin(pitch),

            FOCUS_POINT.z +
            horizontal * Math.cos(yaw),
        );

        this.threeCamera.lookAt(FOCUS_POINT.x, focusY, FOCUS_POINT.z);
    }

    public resize(): void {
        this.resizeFaceTowerInput();
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
        const towerOffsetY = this.faceTower?.getCameraOffsetY() ?? 0;

        this.positionCamera(
            DEFAULT_TOWER_3D_CONFIG.cameraMasterOffsetY +
            towerOffsetY * DEFAULT_TOWER_3D_CONFIG.towerFollowScale,
        );

        if (this.faceTower) {
            this.blockSync3D.sync(this.faceTower.getBlocks());
        }

        super.update(delta);
    }

    public destroy(): void {
        this.faceTower?.destroy();
        this.blockSync3D?.destroy();

        this.replayButton?.removeFromParent();
        this.replayButton?.destroy({ children: true });

        this.chunkManager?.destroy();
        this.collectibles?.destroy();

        if (this.waterMesh) {
            this.threeScene.remove(this.waterMesh);
            this.waterMesh.geometry.dispose();
        }

        this.waterMat?.dispose();

        if (this.clusterMesh) {
            this.threeScene.remove(this.clusterMesh);
            this.clusterMesh.geometry.dispose();
            (this.clusterMesh.material as THREE.Material).dispose();
        }

        super.destroy();
    }
}
