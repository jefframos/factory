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
    parseHexColor,
    resolveIslandImagePath,
} from '../game/world/IslandStorage';
import { ROOM_GEOMETRY } from '../game/world/MeshConfig';
import { DEFAULT_FACE_TOWER_CONFIG } from './FaceTowerConfig';
import { FaceTowerGameController } from './FaceTowerGameController';
import { NextPiecePreview } from './NextPiecePreview';
import { PIECES } from './PieceStorage';
import { POWERUPS } from './PowerupStorage';
import { TowerBaseSync3D } from './TowerBaseSync3D';
import { TowerBlockSync3D } from './TowerBlockSync3D';
import { DEFAULT_TOWER_3D_CONFIG } from './Tower3DConfig';
import { loadTowerDevMeta, saveTowerDevMeta } from './TowerDevMeta';
import { TowerHeightGauge } from './TowerHeightGauge';
import { TowerHeightMarkers3D } from './TowerHeightMarkers3D';
import { TowerProgressBar2D } from './TowerProgressBar2D';
import { TowerWallSync3D } from './TowerWallSync3D';
import { GameHud } from './GameHud';
import SoundManager from 'core/audio/SoundManager';
import Assets from '../Assets';

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
    public readonly hudContainer: PIXI.Container = new PIXI.Container();


    private scoreLabel!: PIXI.Text;
    private milestoneLabel!: PIXI.Text;
    private gameOverLabel!: PIXI.Text;
    private replayButton!: PIXI.Container;
    private continueButton!: PIXI.Container;
    private nextPiecePreview!: NextPiecePreview;
    private heightGauge!: TowerHeightGauge;
    private progressBar2D!: TowerProgressBar2D;

    private faceTower!: FaceTowerGameController;
    private blockSync3D!: TowerBlockSync3D;
    private baseSync3D!: TowerBaseSync3D;
    private wallSync3D!: TowerWallSync3D;
    private heightMarkers3D!: TowerHeightMarkers3D;
    private pieceDevGui!: PieceDevGui;
    private powerupDevGui!: PowerupDevGui;
    private gameHud!: GameHud;
    /** Dev-only — multiplies every delta passed to physics/game-logic/animation this frame. Persisted via TowerDevMeta; see setupVisualDevGui()'s "speedup" toggle. */
    private speedMultiplier = 1;

    public async build(): Promise<void> {
        /*
         * Dev-only settings restored before anything else reads them —
         * buildFaceTowerLayer() (below) sets worldContainer.visible straight
         * from DEFAULT_FACE_TOWER_CONFIG.render2D, so render2D/render3D must
         * already reflect the saved values by the time that runs. Only
         * applies in dev builds — DevGuiManager itself is the same gate (see
         * index.ts's DevGuiManager.instance.initialize(Game.debugParams.dev)),
         * so a real player never has a leftover dev session's settings
         * silently applied.
         */

        SoundManager.instance.setLayerVolume(Assets.AmbientSound.Music.layer, Assets.AmbientSound.Music.masterVolume);
        void SoundManager.instance.playBackgroundSound(Assets.AmbientSound.Music.soundId, 0, Assets.AmbientSound.Music.layer);

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
            // More solver passes per step to resolve stacked/overlapping
            // contacts before they show up as visible jitter (defaults are 6/4).
            positionIterations: 10,
            velocityIterations: 8,
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
                1,
            ),
        );
        SetupThree.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        SetupThree.renderer.toneMappingExposure = 1.1; // try 1.1 - 1.5
        SetupThree.renderer.outputColorSpace = THREE.SRGBColorSpace;
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

        this.gameHud = new GameHud();
        this.buildFaceTowerLayer();


        this.game.overlayContainer.addChild(this.hudContainer);

        this.hudContainer.addChild(this.gameHud);
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

        //this.nextPiecePreview = new NextPiecePreview(this);
        this.heightGauge = new TowerHeightGauge(this);
        //this.progressBar2D = new TowerProgressBar2D(this);

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
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.GateOpen)
                },

                onGameOver: score => {
                    this.gameOverLabel.text =
                        `Tower collapsed!\nScore: ${score}`;

                    this.gameOverLabel.alpha = 1;
                    this.replayButton.visible = true;
                    this.continueButton.visible = true;

                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.GameOver)

                },

                onBlockDropped: block => {
                    //SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Wee)
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Drop)
                    this.blockSync3D.notifyDropped(block.id);
                },

                onBlockFirstHit: block => {
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Impact)
                    this.blockSync3D.notifyFirstHit(block.id);
                },

                onBlockFrozen: (block, greyColorHex) => {
                    this.blockSync3D.notifyFrozen(block.id, greyColorHex);
                },

                onNextPieceChanged: piece => {
                    //this.nextPiecePreview.show(piece);
                    this.gameHud?.showNextPiece(piece)
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

        /*
         * Added after (and thus on top of) the tower's full-screen input
         * layer, which also lives in overlayContainer — otherwise that
         * layer would swallow every click before it reached these buttons.
         */
        this.replayButton = this.buildActionButton('Replay', -100, 0x2f6fed, () => {
            this.hideGameOverUI();

            /*
             * FaceTowerGameController.reset() rebuilds the 2D base list from
             * scratch (back down to a single starting floor), but
             * TowerBaseSync3D's own sync() only ever ADDS panel meshes — it
             * has no stale-removal branch like TowerBlockSync3D/TowerWallSync3D
             * do, since bases normally only ever grow within a single run.
             * Left uncleared, every base/milestone panel mesh from the run
             * that just ended stays in the THREE scene forever, and the
             * fresh run's panels get added on top of them at the same floor
             * position — exactly the "duplicated environment-looking mesh"
             * symptom, since these flat panels sit right at island/water
             * height. Clearing here (rather than teaching sync() to diff)
             * keeps that "only ever grows" assumption intact for the common
             * case and only pays the cleanup cost on an actual reset.
             */
            this.baseSync3D.clear();

            this.faceTower.reset();
        });
        this.game.overlayContainer.addChild(this.replayButton);

        this.continueButton = this.buildActionButton('Continue', 100, 0x2ecc71, () => {
            this.hideGameOverUI();

            // TODO: gate this behind a rewarded ad before calling
            // continueRun() — see FaceTowerGameController.continueRun()'s
            // own TODO.
            this.faceTower.continueRun();
        });
        this.game.overlayContainer.addChild(this.continueButton);
    }

    private hideGameOverUI(): void {
        this.gameOverLabel.alpha = 0;
        this.replayButton.visible = false;
        this.continueButton.visible = false;
    }

    private buildActionButton(label: string, xOffset: number, color: number, onTap: () => void): PIXI.Container {
        const button = new PIXI.Container();

        const background = new PIXI.Graphics();

        background
            .beginFill(color)
            .lineStyle(3, 0xffffff, 0.9)
            .drawRoundedRect(-90, -28, 180, 56, 12)
            .endFill();

        button.addChild(background);

        const text = new PIXI.Text(label, {
            fill: 0xffffff,
            fontSize: 26,
            fontWeight: 'bold',
        });

        text.anchor.set(0.5);
        button.addChild(text);

        button.position.set(
            Game.DESIGN_WIDTH * 0.5 + xOffset,
            Game.DESIGN_HEIGHT * 0.5 + 90,
        );

        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.visible = false;

        button.on('pointertap', onTap);

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
            saveTowerDevMeta({ render2D: value });
        }, folder);

        // Also hides the THREE canvas outright — without this, turning
        // render3D off just freezes the last rendered frame on screen
        // instead of actually clearing it, since update() skips the render
        // call but never touches what's already been drawn to the canvas.
        gui.addToggle('render3D', cfg.render3D, value => {
            cfg.render3D = value;
            SetupThree.container.style.display = value ? '' : 'none';
            saveTowerDevMeta({ render3D: value });
        }, folder);

        // Scales every delta passed to physics/game-logic/animation this
        // frame (see fixedUpdate()/update()) — an easy way to plow through
        // drops/settling/camera pans faster while testing, without actually
        // touching gravity/speed constants that'd change real gameplay feel.
        gui.addToggle('speedup (2x)', this.speedMultiplier > 1, value => {
            this.speedMultiplier = value ? 2 : 1;
            saveTowerDevMeta({ speedup: value });
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
        delta *= this.speedMultiplier;

        Physics.fixedUpdate(delta);
        super.fixedUpdate(delta);
        this.faceTower?.update(delta);
    }

    public update(delta: number): void {
        // Scaled the same way as fixedUpdate()'s delta, or a 2x speedup
        // would show physics/drops running fast while the 3D animation
        // layer (shoot/jiggle/shrink — see TowerBlockSync3D) kept playing
        // at normal speed, an obvious mismatch.
        delta *= this.speedMultiplier;

        const towerOffsetY = this.faceTower?.getCameraOffsetY() ?? 0;

        this.gameHud?.layout()
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
            this.blockSync3D.sync(this.faceTower.getBlocks(), this.faceTower.getHeldBlock(), delta);
            this.baseSync3D.sync(this.faceTower.getBases());
            this.wallSync3D.sync(this.faceTower.getWalls());

            //this.nextPiecePreview.pinTopLeft();

            // toWorldY() is screenY - offsetY, so screenY is the inverse: worldY + offsetY.
            const worldYToHeightMark = (worldY: number) => ({
                screenY: worldY + towerOffsetY,
                heightMeters: (DEFAULT_FACE_TOWER_CONFIG.floorY - worldY) / DEFAULT_TOWER_3D_CONFIG.pixelsPerUnit,
            });

            const currentTopWorldY = this.faceTower.getCurrentTopWorldY();
            const targetLineWorldY = this.faceTower.getTargetLineWorldY();

            const currentMark = worldYToHeightMark(currentTopWorldY);
            const targetMark = worldYToHeightMark(targetLineWorldY);

            // getBases()[0] is the starting floor (height 0, not a milestone
            // reached) — every base after that marks a completed zone.
            const milestoneMarks = this.faceTower.getBases()
                .slice(1)
                .map(base => worldYToHeightMark(base.body.position.y));

            this.heightGauge?.update(currentMark, targetMark, milestoneMarks, delta);

            // 3D parity for the same two marks — takes the raw world Y
            // directly (not the screen-space conversion above), since it
            // positions actual meshes in the 3D scene rather than PIXI HUD
            // elements.
            this.heightMarkers3D?.update(
                currentTopWorldY,
                targetLineWorldY,
                currentMark.heightMeters,
                targetMark.heightMeters,
            );

            this.progressBar2D?.update(this.faceTower.getZoneProgress());
        }

        // super.update() is what actually calls SetupThree.renderer.render()
        // (see ThreeScene.update()) — skipped entirely when render3D is off,
        // rather than just leaving 3D pieces/camera logic running but
        // discarding the draw, so it also saves the GPU work.
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
        this.nextPiecePreview?.destroy();
        this.heightGauge?.destroy();
        this.progressBar2D?.destroy();

        this.replayButton?.removeFromParent();
        this.replayButton?.destroy({ children: true });

        this.continueButton?.removeFromParent();
        this.continueButton?.destroy({ children: true });

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
