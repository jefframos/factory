import { Game } from 'core/Game';
import Physics from 'core/phyisics/Physics';
import { ThreeScene } from 'core/scene/ThreeScene';
import SetupThree from 'core/scene/SetupThree';
import { DevGuiManager } from 'core/utils/DevGuiManager';
import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { ClusterMeshBuilder } from '../game/builders/ClusterMeshBuilder';
import { TextureBuilder } from '../game/builders/TextureBuilder';
import { createWaterMaterial } from '../game/builders/WaterMaterial';
import { PieceDevGui } from '../game/debug/PieceDevGui';
import { PowerupDevGui } from '../game/debug/PowerupDevGui';
import type { PlayerEntity } from '../game/entities/PlayerEntity';
import { CollectibleManager } from '../game/systems/CollectibleManager';
import { BoundlessChunkManager } from '../game/world/BoundlessChunkManager';
import {
    deriveWaterTones,
    getDefaultIsland,
    ISLANDS,
    parseHexColor,
    resolveIslandImagePath,
    setSelectedIslandId,
} from '../game/world/IslandStorage';
import { ROOM_GEOMETRY } from '../game/world/MeshConfig';
import { DEFAULT_FACE_TOWER_CONFIG } from './FaceTowerConfig';
import { FaceTowerGameController } from './FaceTowerGameController';
import { PIECES } from './PieceStorage';
import { POWERUPS } from './PowerupStorage';
import { TowerBaseSync3D } from './TowerBaseSync3D';
import { TowerBlockSync3D } from './TowerBlockSync3D';
import { DEFAULT_TOWER_3D_CONFIG } from './Tower3DConfig';
import { loadTowerDevMeta, saveTowerDevMeta } from './TowerDevMeta';
import { TowerHeightMarkers3D } from './TowerHeightMarkers3D';
import { TowerWallSync3D } from './TowerWallSync3D';
import { GameHud } from './ui/GameHud';
import SoundManager from 'core/audio/SoundManager';
import Assets from '../Assets';

const VIEW_ORIGIN = {
    position: new THREE.Vector3(0, 0, 0),
    collisionRadius: 1,
} as PlayerEntity;

const FOCUS_POINT = new THREE.Vector3(0, 0, 0);

/**
 * A single connected blob of cells (not the chunk streamer) centred on the
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
    const worldRadius = (diameterPx / pixelsPerUnit) * 0.5;
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
    // -------------------------------------------------------------------------
    // World / 3D
    // -------------------------------------------------------------------------
    private collectibles!: CollectibleManager;
    private chunkManager!: BoundlessChunkManager;
    private waterMesh!: THREE.Mesh;
    private waterMat!: THREE.Material;
    private clusterMesh!: THREE.Mesh;

    // -------------------------------------------------------------------------
    // 2D / game layer
    // -------------------------------------------------------------------------
    private worldContainer!: PIXI.Container;
    public readonly hudContainer: PIXI.Container = new PIXI.Container();

    // -------------------------------------------------------------------------
    // Game logic
    // -------------------------------------------------------------------------
    private faceTower!: FaceTowerGameController;
    private blockSync3D!: TowerBlockSync3D;
    private baseSync3D!: TowerBaseSync3D;
    private wallSync3D!: TowerWallSync3D;
    private heightMarkers3D!: TowerHeightMarkers3D;
    private pieceDevGui!: PieceDevGui;
    private powerupDevGui!: PowerupDevGui;
    private gameHud!: GameHud;

    /**
     * Dev-only — multiplies every delta passed to physics/game-logic/animation
     * this frame. Persisted via TowerDevMeta; see setupVisualDevGui().
     */
    private speedMultiplier = 1;

    // =========================================================================
    // Lifecycle
    // =========================================================================

    public async build(): Promise<void> {
        /*
         * Dev-only settings restored before anything else reads them —
         * buildFaceTowerLayer() sets worldContainer.visible straight from
         * DEFAULT_FACE_TOWER_CONFIG.render2D, so render2D/render3D must
         * already reflect the saved values by the time that runs.
         */
        SoundManager.instance.setLayerVolume(
            Assets.AmbientSound.Music.layer,
            Assets.AmbientSound.Music.masterVolume,
        );
        void SoundManager.instance.playBackgroundSound(
            Assets.AmbientSound.Music.soundId,
            0,
            Assets.AmbientSound.Music.layer,
        );

        if (Game.debugParams.dev) {
            const savedMeta = loadTowerDevMeta();

            if (savedMeta?.render2D !== undefined) {
                DEFAULT_FACE_TOWER_CONFIG.render2D = savedMeta.render2D;
            }

            if (savedMeta?.render3D !== undefined) {
                DEFAULT_FACE_TOWER_CONFIG.render3D = savedMeta.render3D;
                SetupThree.container.style.display = savedMeta.render3D ? '' : 'none';
            }

            if (savedMeta?.speedup) {
                this.speedMultiplier = 2;
            }
        }

        Physics.init({
            gravity: {
                x: DEFAULT_FACE_TOWER_CONFIG.gravityX,
                y: DEFAULT_FACE_TOWER_CONFIG.gravityY,
            },
            enableSleep: false,
            positionIterations: 10,
            velocityIterations: 8,
        });

        const island = getDefaultIsland();

        await TextureBuilder.loadRealIsland(resolveIslandImagePath(island.texture));

        this.threeScene.background = new THREE.Color(parseHexColor(island.skyColor));
        this.threeScene.add(this.threeCamera);
        this.threeScene.add(new THREE.AmbientLight(parseHexColor(island.ambientColor), 1));

        SetupThree.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        SetupThree.renderer.toneMappingExposure = 1.1;
        SetupThree.renderer.outputColorSpace = THREE.SRGBColorSpace;

        const key = new THREE.DirectionalLight(0xfff4dd, 1.6);
        key.position.set(5, 10, 7.5);
        this.threeScene.add(key);

        const fill = new THREE.DirectionalLight(0x99ccff, 0.5);
        fill.position.set(-8, 3, -5);
        this.threeScene.add(fill);

        this.waterMesh = this.buildWater(island.waterColor);
        this.clusterMesh = this.buildIslandCluster();

        this.collectibles = new CollectibleManager();
        this.chunkManager = new BoundlessChunkManager(this.threeScene, this.collectibles);

        for (let i = 0; i < 30; i++) {
            this.chunkManager.update(VIEW_ORIGIN);
        }

        this.positionCamera();
        this.buildFaceTowerLayer();

        this.game.overlayContainer.addChild(this.hudContainer);
        this.hudContainer.addChild(this.gameHud);

        if (ISLANDS.length > 0) {
            const levelSettings = { islandId: getDefaultIsland().id };
            DevGuiManager.instance.addDropdown(
                levelSettings,
                'islandId',
                ISLANDS.map((island) => island.id),
                (id) => {
                    setSelectedIslandId(id);
                    // void this.spawnFreshWorld();
                },
                'Level',
                'Levels',
            );
        }
    }

    public resize(): void {
        this.resizeFaceTowerInput();
    }

    public fixedUpdate(delta: number): void {
        delta *= this.speedMultiplier;
        Physics.fixedUpdate(delta);
        super.fixedUpdate(delta);
        this.faceTower?.update(delta);
    }

    public update(delta: number): void {
        /*
         * Scale the same way as fixedUpdate — otherwise a 2× speedup would
         * show physics/drops running fast while the 3D animation layer
         * (shoot/jiggle/shrink) played at normal speed.
         */
        delta *= this.speedMultiplier;

        const towerOffsetY = this.faceTower?.getCameraOffsetY() ?? 0;

        this.gameHud?.layout();

        /*
         * Same conversion TowerBlockSync3D/TowerBaseSync3D use to place the
         * mirrored cubes/panels — keeps the camera's focus height exactly
         * matching the current base's 3D position.
         */
        this.positionCamera(
            DEFAULT_TOWER_3D_CONFIG.cameraMasterOffsetY +
            towerOffsetY / DEFAULT_TOWER_3D_CONFIG.pixelsPerUnit,
        );

        if (this.faceTower) {
            this.blockSync3D.sync(this.faceTower.getBlocks(), this.faceTower.getHeldBlock(), delta);
            this.baseSync3D.sync(this.faceTower.getBases());
            this.wallSync3D.sync(this.faceTower.getWalls(), this.faceTower.getLevel());

            // toWorldY() is screenY − offsetY, so screenY is worldY + offsetY.
            const worldYToHeightMark = (worldY: number) => ({
                screenY: worldY + towerOffsetY,
                heightMeters:
                    (DEFAULT_FACE_TOWER_CONFIG.floorY - worldY) /
                    DEFAULT_TOWER_3D_CONFIG.pixelsPerUnit,
            });

            const currentTopWorldY = this.faceTower.getCurrentTopWorldY();
            const targetLineWorldY = this.faceTower.getTargetLineWorldY();
            const currentMark = worldYToHeightMark(currentTopWorldY);
            const targetMark = worldYToHeightMark(targetLineWorldY);

            // getBases()[0] is the starting floor (height 0, not a milestone) —
            // every base after that marks a completed zone.
            const milestoneMarks = this.faceTower
                .getBases()
                .slice(1)
                .map((base) => worldYToHeightMark(base.body.position.y));

            this.gameHud?.updateHeightGauge(currentMark, targetMark, milestoneMarks, delta);

            // 3D markers take raw world-Y (not screen-space) since they
            // position actual meshes in the THREE scene.
            this.heightMarkers3D?.update(
                currentTopWorldY,
                targetLineWorldY,
                currentMark.heightMeters,
                targetMark.heightMeters,
            );

            this.gameHud?.updateProgressBar(this.faceTower.getZoneProgress());
        }

        /*
         * super.update() calls SetupThree.renderer.render() — skip entirely
         * when render3D is off so we also save the GPU work, not just the
         * draw call.
         */
        if (DEFAULT_FACE_TOWER_CONFIG.render3D) {
            super.update(delta);
        }
    }

    public destroy(): void {
        this.faceTower?.destroy();
        this.blockSync3D?.destroy();
        this.baseSync3D?.destroy();
        this.wallSync3D?.destroy();
        this.heightMarkers3D?.destroy();
        this.gameHud?.destroy();
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

    // =========================================================================
    // Private — build helpers
    // =========================================================================

    private buildFaceTowerLayer(): void {
        this.worldContainer = new PIXI.Container();
        this.worldContainer.visible = DEFAULT_FACE_TOWER_CONFIG.render2D;
        this.addChild(this.worldContainer);

        /*
         * GameHud owns ALL UI. Callbacks passed here are the only bridge back
         * into scene-level concerns (clearing 3D base meshes, continuing a
         * run) that the HUD itself cannot know about.
         */
        this.gameHud = new GameHud(

            () => { this.gameHud.hideGameOver(); this.faceTower.continueRun(); },
            () => { this.gameHud.hideGameOver(); this.baseSync3D.clear(); this.faceTower.reset(); },


        );


        this.faceTower = new FaceTowerGameController(
            this.worldContainer,
            this.game.overlayContainer,
            this,
            DEFAULT_FACE_TOWER_CONFIG,
            {
                onScoreChanged: (score) => {
                    this.gameHud.showScore(score);
                },

                onMilestoneReached: (zoneIndex) => {
                    this.gameHud.showMilestone(zoneIndex);
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.GateOpen);
                },

                onGameOver: (score) => {
                    this.gameHud.showGameOver(score);
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.GameOver);
                },

                onBlockDropped: (block) => {
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Drop);
                    this.blockSync3D.notifyDropped(block.id);
                },

                onBlockFirstHit: (block) => {
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Impact);
                    this.blockSync3D.notifyFirstHit(block.id);
                },

                onBlockFrozen: (block, greyColorHex) => {
                    this.blockSync3D.notifyFrozen(block.id, greyColorHex);
                },

                onNextPieceChanged: (piece) => {
                    this.gameHud.showNextPiece(piece);
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

        this.heightMarkers3D = new TowerHeightMarkers3D(
            this,
            this.game,
            this,
            DEFAULT_FACE_TOWER_CONFIG,
            DEFAULT_TOWER_3D_CONFIG.pixelsPerUnit,
            DEFAULT_TOWER_3D_CONFIG,
            DEFAULT_TOWER_3D_CONFIG.towerBaseOffset,
        );

        this.faceTower.start();
        this.resizeFaceTowerInput();
        this.setupCameraDevGui();
        this.setupVisualDevGui();

        this.pieceDevGui = new PieceDevGui(PIECES, this.faceTower, this);
        this.pieceDevGui.setup();

        this.powerupDevGui = new PowerupDevGui(POWERUPS, this.faceTower);
        this.powerupDevGui.setup();
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

        gui.addToggle('render2D', cfg.render2D, (value) => {
            cfg.render2D = value;
            this.worldContainer.visible = value;
            saveTowerDevMeta({ render2D: value });
        }, folder);

        /*
         * Also hides the THREE canvas outright — without this, turning render3D
         * off freezes the last rendered frame rather than clearing it.
         */
        gui.addToggle('render3D', cfg.render3D, (value) => {
            cfg.render3D = value;
            SetupThree.container.style.display = value ? '' : 'none';
            saveTowerDevMeta({ render3D: value });
        }, folder);

        gui.addToggle('speedup (2x)', this.speedMultiplier > 1, (value) => {
            this.speedMultiplier = value ? 2 : 1;
            saveTowerDevMeta({ speedup: value });
        }, folder);

        gui.addToggle('render2DFaces', cfg.render2DFaces, (value) => {
            cfg.render2DFaces = value;
        }, folder);

        gui.addProperties(cfg, ['blockFillAlpha'], [0, 1], 'Fill Alpha', folder);

        gui.addObjectTrigger(
            cfg as unknown as Record<string, number>,
            () => this.faceTower.invalidateBlockTexture(),
            ['blockBevelRadius', 'blockStrokeWidth'],
            [0, 35],
            'Bevel',
            folder,
        );
    }

    // -------------------------------------------------------------------------
    // Camera
    // -------------------------------------------------------------------------

    /**
     * `liftY` raises both the camera and its look-at target by the same
     * amount, keeping yaw/pitch/distance fixed — pairs the 3D camera to the
     * 2D tower camera's scroll (see update()).
     */
    private positionCamera(liftY: number = 0): void {
        const cfg = DEFAULT_TOWER_3D_CONFIG;
        const yaw = (cfg.cameraYawDeg * Math.PI) / 180;
        const pitch = (cfg.cameraPitchDeg * Math.PI) / 180;

        const scl = Math.min(1, Game.scale)

        const d = Math.min(cfg.cameraDistance + (cfg.cameraDistanceMax - cfg.cameraDistance) * (1 - scl), cfg.cameraDistanceMax)
        const horizontal = d * Math.cos(pitch);
        const focusY = FOCUS_POINT.y + liftY;

        this.threeCamera.position.set(
            FOCUS_POINT.x + horizontal * Math.sin(yaw),
            focusY + d * Math.sin(pitch),
            FOCUS_POINT.z + horizontal * Math.cos(yaw),
        );

        this.threeCamera.lookAt(FOCUS_POINT.x, focusY, FOCUS_POINT.z);
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

    // -------------------------------------------------------------------------
    // World mesh builders
    // -------------------------------------------------------------------------

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

    private buildWater(waterColor: string): THREE.Mesh {
        const SIZE = 400;
        const SEGMENTS = 128;
        const { opacity, elevation } = ROOM_GEOMETRY.floor;

        const waterColors = deriveWaterTones(parseHexColor(waterColor));
        this.waterMat = createWaterMaterial(opacity, elevation, waterColors);

        const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
        geometry.rotateX(-Math.PI / 2);

        const mesh = new THREE.Mesh(geometry, this.waterMat);
        mesh.frustumCulled = false;

        const startTime = performance.now();
        mesh.onBeforeRender = () => {
            (this.waterMat as THREE.ShaderMaterial).uniforms.time.value =
                (performance.now() - startTime) / 1000;
        };

        this.threeScene.add(mesh);
        return mesh;
    }
}
