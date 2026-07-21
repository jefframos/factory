import { Game } from 'core/Game';
import Physics from 'core/phyisics/Physics';
import { ThreeScene } from 'core/scene/ThreeScene';
import { DevGuiManager } from 'core/utils/DevGuiManager';
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
import { PIECES } from './PieceStorage';
import { TowerBaseSync3D } from './TowerBaseSync3D';
import { TowerBlockSync3D } from './TowerBlockSync3D';
import { DEFAULT_TOWER_3D_CONFIG } from './Tower3DConfig';
import { TowerWallSync3D } from './TowerWallSync3D';

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
    private baseSync3D!: TowerBaseSync3D;
    private wallSync3D!: TowerWallSync3D;

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
        this.worldContainer.visible = DEFAULT_FACE_TOWER_CONFIG.render2D;
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

        this.baseSync3D = new TowerBaseSync3D(
            this.threeScene,
            DEFAULT_FACE_TOWER_CONFIG,
            DEFAULT_TOWER_3D_CONFIG.pixelsPerUnit,
            DEFAULT_TOWER_3D_CONFIG,
            DEFAULT_TOWER_3D_CONFIG.towerBaseOffset,
        );

        this.wallSync3D = new TowerWallSync3D(
            this.threeScene,
            DEFAULT_FACE_TOWER_CONFIG,
            DEFAULT_TOWER_3D_CONFIG.pixelsPerUnit,
            DEFAULT_TOWER_3D_CONFIG,
            DEFAULT_TOWER_3D_CONFIG.towerBaseOffset,
        );

        this.faceTower.start();
        this.resizeFaceTowerInput();
        this.setupCameraDevGui();
        this.setupVisualDevGui();
        this.setupPieceDevGui();

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

    private setupCameraDevGui(): void {
        const gui = DevGuiManager.instance;
        const cfg = DEFAULT_TOWER_3D_CONFIG;
        const folder = 'Tower3D Camera';

        gui.addProperties(cfg, ['cameraYawDeg', 'cameraPitchDeg'], [-90, 90], 'Camera', folder);
        gui.addProperties(cfg, ['cameraDistance'], [1, 60], 'Camera', folder);
        gui.addProperties(cfg, ['cameraMasterOffsetY'], [-30, 30], 'Camera', folder);
    }

    private setupVisualDevGui(): void {
        const gui = DevGuiManager.instance;
        const cfg = DEFAULT_FACE_TOWER_CONFIG;
        const folder = 'Tower2D Visuals';

        gui.addToggle('render2D', cfg.render2D, value => {
            cfg.render2D = value;
            this.worldContainer.visible = value;
        }, folder);

        // Only affects blocks spawned after the toggle flips — existing
        // block/face sprites already on screen aren't retroactively touched.
        gui.addToggle('render2DFaces', cfg.render2DFaces, value => {
            cfg.render2DFaces = value;
        }, folder);

        gui.addProperties(cfg, ['blockFillAlpha'], [0, 1], 'Fill Alpha', folder);

        // Bevel/stroke are baked into the shared body texture at draw time
        // (see BlockBodyTextureCache), so changing them needs to invalidate
        // the cache — addProperties has no change hook, so this uses
        // addObjectTrigger instead. Only new blocks pick up the rebuilt texture.
        gui.addObjectTrigger(
            cfg as unknown as Record<string, number>,
            () => this.faceTower.invalidateBlockTexture(),
            ['blockBevelRadius', 'blockStrokeWidth'],
            [0, 35],
            'Bevel',
            folder,
        );
    }

    /**
     * Dev-only piece picker — a dropdown listing every piece in PIECES
     * (see PieceStorage); selecting one replaces whatever's currently
     * hovering over the drop area (see FaceTowerGameController.replaceHeldBlockWithPiece),
     * so any piece can be tried out on demand instead of waiting for
     * PieceManager's level-gated random pool to hand it out.
     */
    private setupPieceDevGui(): void {
        const gui = DevGuiManager.instance;
        const folder = 'Tower Pieces';

        if (PIECES.length === 0) {
            return;
        }

        const selection = { piece: PIECES[0].id };

        gui.addDropdown(
            selection,
            'piece',
            PIECES.map(piece => piece.id),
            id => {
                const piece = PIECES.find(p => p.id === id);
                if (piece) {
                    this.faceTower.replaceHeldBlockWithPiece(piece);
                }
            },
            'Piece',
            folder,
        );
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

        /*
         * Same conversion TowerBlockSync3D/TowerBaseSync3D use to place the
         * mirrored cubes/panels — this is what keeps the camera's focus
         * height exactly matching the current base's 3D position, instead
         * of drifting away from it a little more every zone.
         */
        this.positionCamera(
            DEFAULT_TOWER_3D_CONFIG.cameraMasterOffsetY +
            towerOffsetY / DEFAULT_TOWER_3D_CONFIG.pixelsPerUnit,
        );

        if (this.faceTower) {
            this.blockSync3D.sync(this.faceTower.getBlocks());
            this.baseSync3D.sync(this.faceTower.getBases());
            this.wallSync3D.sync(this.faceTower.getWalls());
        }

        super.update(delta);
    }

    public destroy(): void {
        this.faceTower?.destroy();
        this.blockSync3D?.destroy();
        this.baseSync3D?.destroy();
        this.wallSync3D?.destroy();

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
