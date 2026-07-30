import { Game } from 'core/Game';
import PlatformHandler from 'core/platforms/PlatformHandler';
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
import { PieceSnapshotTool } from '../game/debug/PieceSnapshotTool';
import { PowerupDevGui } from '../game/debug/PowerupDevGui';
import { TowerHighScoreStorage } from './TowerHighScoreStorage';
import { PowerupInventoryStorage } from '../game/data/PowerupInventoryStorage';
import type { PlayerEntity } from '../game/entities/PlayerEntity';
import { CollectibleManager } from '../game/systems/CollectibleManager';
import { BoundlessChunkManager } from '../game/world/BoundlessChunkManager';
import {
    deriveWaterTones,
    getDefaultIsland,
    type IslandConfig,
    ISLANDS,
    parseHexColor,
    resolveIslandImagePath,
    setSelectedIslandId,
} from '../game/world/IslandStorage';
import { ROOM_GEOMETRY } from '../game/world/MeshConfig';
import { DEFAULT_FACE_TOWER_CONFIG } from './FaceTowerConfig';
import { FaceTowerGameController } from './FaceTowerGameController';
import { PIECES, type PieceDefinition } from './PieceStorage';
import { POWERUPS, SKIP_PIECE_POWERUP_ID } from './PowerupStorage';
import { getEnabledPowerupIds } from './PowerupConfig';
import { TowerVfxUtils } from './TowerVfxUtils';
import type { PowerupContactPoint } from './PowerupSystem';
import { TowerBaseSync3D } from './TowerBaseSync3D';
import { TowerBlockSync3D } from './TowerBlockSync3D';
import { DEFAULT_TOWER_3D_CONFIG, formatHeightRounded } from './Tower3DConfig';
import { loadTowerDevMeta, saveTowerDevMeta } from './TowerDevMeta';
import { TowerHeightMarkers3D } from './TowerHeightMarkers3D';
import { resolveIslandForZone } from './TowerIslandProgression';
import { LEVELS } from './LevelStorage';
import { TowerSkyController } from './TowerSkyController';
import { TowerStarfieldController } from './TowerStarfieldController';
import { TowerWallSync3D } from './TowerWallSync3D';
import { GameHud } from './ui/GameHud';
import { TowerScorePopupUtils } from './ui/TowerScorePopupUtils';
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

    /** Degenerate four-corners gradient sky, built lazily the first time a zone's island defines skyGradient — see applyZoneIsland(). Until then the plain flat scene.background set in build() is what's showing. */
    private readonly skyController = new TowerSkyController();
    /** Camera-attached star layer, built lazily the first time a zone's island defines BOTH starfieldWeightMin/Max — see applyZoneIsland(). Its visibility is driven continuously every frame from climb progress — see update(). */
    private readonly starfieldController = new TowerStarfieldController();
    /** Which island's texture/water is currently applied — see applyZoneIsland(). */
    private currentIslandId = '';

    // -------------------------------------------------------------------------
    // 2D / game layer
    // -------------------------------------------------------------------------
    private worldContainer!: PIXI.Container;
    public readonly hudContainer: PIXI.Container = new PIXI.Container();

    // -------------------------------------------------------------------------
    // Game logic
    // -------------------------------------------------------------------------
    private faceTower!: FaceTowerGameController;

    /**
     * Which real powerup (lightning/bomb/shrink-ray — never skip-piece,
     * which is an instant one-shot with nothing to hold "active") is
     * currently the held piece — see useHudPowerup(). Null once its piece
     * actually gets dropped (see onBlockDropped below) or it's cancelled.
     */
    private activePowerupId: string | null = null;
    /** Snapshot of whatever piece was held right before activePowerupId's piece swapped in — restored on cancel so cancelling reads as "never happened" rather than losing/re-rolling the piece that was actually there. */
    private preActivationPiece: PieceDefinition | null = null;

    /** Which powerup the currently-shown LevelUpNotification popup already granted — see handleLevelUpWatchVideo(), which grants a second one of THIS SAME id on a successful video. Null whenever no level-up popup is up. */
    private pendingLevelUpPowerupId: string | null = null;

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

    // Camera-shake state — see triggerCameraShake()/applyCameraShake().
    private cameraShakeStrength = 0;
    private cameraShakeDuration = 0;
    private cameraShakeTimeRemaining = 0;

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
        this.currentIslandId = island.id;

        await TextureBuilder.loadRealIsland(resolveIslandImagePath(island.texture));

        /*
         * Resolved through the SAME per-zone lookup applyZoneIsland() uses
         * later, rather than island.skyColor directly — so if level 0's
         * island defines a skyGradient, the gradient sky is already what's
         * showing from frame one. That matters for the FIRST zone
         * transition specifically: transitionTo() eases from the sky's
         * CURRENT top color, so if the initial sky were still the old flat
         * THREE.Color background, that first transition would have nothing
         * built yet to ease from and would have to hard-cut straight to the
         * gradient (see the isBuilt() branch in applyZoneIsland()). An
         * island with no skyGradient at all still falls back to the plain
         * flat background exactly as before.
         */
        const initialZone = resolveIslandForZone(0, 0);

        if (initialZone.island.skyGradient && initialZone.island.skyGradient.length > 0) {
            this.skyController.build(this.threeCamera, initialZone.skyColorHex);
        } else {
            this.threeScene.background = new THREE.Color(parseHexColor(island.skyColor));
        }

        if (initialZone.island.starfieldWeightMin !== undefined && initialZone.island.starfieldWeightMax !== undefined) {
            this.starfieldController.build(this.threeCamera);
            this.starfieldController.setWeightBounds(initialZone.island.starfieldWeightMin, initialZone.island.starfieldWeightMax);
        }

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
        TowerVfxUtils.build(this.threeScene);

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
        this.skyController.resize();
        this.starfieldController.resize(this.threeCamera);
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

        this.skyController.update(delta);
        this.starfieldController.update(delta);

        if (this.faceTower && this.starfieldController.isBuilt()) {
            /*
             * Continuous, not stepped — driven straight from actual climb
             * progress through the current level rather than snapping once
             * per zone the way the sky color does, so the fade reads as
             * smooth motion tied directly to the player's own climb instead
             * of a series of little jumps.
             */
            this.starfieldController.updateProgress(this.faceTower.getLevelProgressFraction());
        }

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
        this.applyCameraShake(delta);
        TowerVfxUtils.update(delta);

        if (this.faceTower) {
            this.blockSync3D.sync(this.faceTower.getBlocks(), this.faceTower.getHeldBlock(), delta);
            this.baseSync3D.sync(this.faceTower.getBases());
            this.wallSync3D.sync(this.faceTower.getWalls(), this.faceTower.getWallHeight());

            // toWorldY() is screenY − offsetY, so screenY is worldY + offsetY.
            const screenYFor = (worldY: number) => worldY + towerOffsetY;

            // Plain climbed height (meters) — still what the 3D height
            // markers use (see below); unrelated to the km-scale figures
            // the 2D HUD shows.
            const plainMeters = (worldY: number) =>
                (DEFAULT_FACE_TOWER_CONFIG.floorY - worldY) / DEFAULT_TOWER_3D_CONFIG.pixelsPerUnit;

            const currentTopWorldY = this.faceTower.getCurrentTopWorldY();
            const targetLineWorldY = this.faceTower.getTargetLineWorldY();

            /*
             * "Current"/"goal" here are expressed in the SAME unit as the
             * level's own destination distance (km), scaled by how far
             * through the level's zones the player actually is — rather
             * than an unrelated raw climbed-meters count shown next to an
             * astronomical-scale destination distance (e.g. "225M km" next
             * to "71.0m", two disconnected numbers). Falls back to plain
             * meters only if this level doesn't define a distance at all.
             */
            const levelDistanceKm = this.faceTower.getLevelDistanceKm();
            const hasLevelDistance = !DEFAULT_TOWER_3D_CONFIG.useRawHeightValues && levelDistanceKm > 0;

            const currentMark = hasLevelDistance
                ? {
                    screenY: screenYFor(currentTopWorldY),
                    value: levelDistanceKm * this.faceTower.getLevelProgressFraction(),
                    unit: 'km' as const,
                }
                : { screenY: screenYFor(currentTopWorldY), value: plainMeters(currentTopWorldY), unit: 'm' as const };

            const targetMark = hasLevelDistance
                ? {
                    screenY: screenYFor(targetLineWorldY),
                    value: levelDistanceKm * this.faceTower.getZoneTargetProgressFraction(),
                    unit: 'km' as const,
                }
                : { screenY: screenYFor(targetLineWorldY), value: plainMeters(targetLineWorldY), unit: 'm' as const };

            // Milestones can belong to an EARLIER level with its own
            // (different) destination distance, which isn't tracked once a
            // base is placed — kept in plain meters rather than misreport
            // them against the CURRENT level's distance.
            const milestoneMarks = this.faceTower
                .getBases()
                .slice(1)
                .map((base) => ({
                    screenY: screenYFor(base.body.position.y),
                    value: plainMeters(base.body.position.y),
                    unit: 'm' as const,
                }));

            this.gameHud?.updateHeightGauge(currentMark, targetMark, milestoneMarks, delta);

            const currentLevelConfig = LEVELS[Math.min(this.faceTower.getLevelIndex(), LEVELS.length - 1)];

            this.gameHud?.updateLevelGoal(
                this.faceTower.getLevelIndex(),
                this.faceTower.isFinalLevel(),
                this.faceTower.getLevelProgressFraction(),
                currentLevelConfig?.destination,
                currentLevelConfig?.distanceFromPreviousKm,
                DEFAULT_TOWER_3D_CONFIG.useRawHeightValues,
                plainMeters(this.faceTower.getNextLevelTargetWorldY()),
                plainMeters(currentTopWorldY),
            );

            // 3D markers take raw world-Y (not screen-space) since they
            // position actual meshes in the THREE scene — the VALUES,
            // though, are the exact same currentMark/targetMark numbers the
            // 2D HUD shows (km-scale progress toward the level's own
            // destination when it has one, else plain meters), so the
            // label following the tower's climb in 3D reads as the same
            // unified measure instead of an unrelated raw meters count.
            this.heightMarkers3D?.update(
                currentTopWorldY,
                targetLineWorldY,
                currentMark.value,
                targetMark.value,
                currentMark.unit,
            );

            this.gameHud?.updateProgressBar(this.faceTower.getZoneProgress());
        }

        this.gameHud?.updatePowerupCounts(PowerupInventoryStorage.getAll());

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
        this.skyController.destroy();
        this.starfieldController.destroy();
        TowerVfxUtils.destroy();
        TowerScorePopupUtils.destroy();
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

            () => {
                this.gameHud.hideGameOver();
                const blocks = this.faceTower.continueRun();
                this.blockSync3D.freezeBlocks(blocks)

            },
            () => {
                this.gameHud.hideGameOver();
                this.baseSync3D.clear();
                this.faceTower.reset();
                TowerHighScoreStorage.markRunStart();

                /*
                 * A fresh run wipes the board a pending active powerup's
                 * piece was sitting on — refund it (it was already spent
                 * from inventory in useHudPowerup()) rather than silently
                 * losing it, since there's no piece left to cancel back to.
                 */
                if (this.activePowerupId !== null) {
                    PowerupInventoryStorage.grant(this.activePowerupId);
                    this.activePowerupId = null;
                    this.preActivationPiece = null;
                    this.gameHud.setActivePowerup(null);
                }
            },
        );

        TowerScorePopupUtils.build(this.hudContainer, () => this.gameHud.getScoreLabelScreenPosition());
        TowerScorePopupUtils.onPop = () => SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Grab);

        this.gameHud.onUsePowerup.add((powerupId: string) => this.useHudPowerup(powerupId), this);
        this.gameHud.onWatchVideoForLevelUp.add(() => void this.handleLevelUpWatchVideo(), this);
        this.gameHud.onLevelUpCollected.add(() => {
            this.pendingLevelUpPowerupId = null;
            this.faceTower.resumeAfterLevelUpNotification();
        }, this);


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
                    this.gameHud.showZoneComplete(zoneIndex);
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.GateOpen);

                    /*
                     * Fires on EVERY zone, not just full level-ups — the sky
                     * needs to step forward one zone at a time (see
                     * applyZoneIsland()), not sit static until a whole
                     * level's worth of zones finishes. By this point
                     * FaceTowerGameController has already advanced
                     * levels/getZoneIndexInLevel() to whatever this zone
                     * landed on, level-up included.
                     */
                    this.applyZoneIsland();
                },

                onLevelProgressed: (levelIndex) => {
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.GateOpen);

                    /*
                     * One random powerup (or the skip-piece pseudo-id) per
                     * level reached — a simple, even reward rather than
                     * granting all four at once, so the HUD counts climb
                     * gradually across a run instead of all jumping
                     * together every level. Granted BEFORE showing the
                     * popup — the popup just displays what already
                     * happened; watching the video (see
                     * handleLevelUpWatchVideo()) grants a second one on
                     * top rather than the popup itself deciding the base
                     * amount.
                     *
                     * Only picks from PowerupConfig's currently-enabled
                     * ids — a disabled powerup has no button to spend it
                     * on, so granting one would just be dead inventory.
                     */
                    const enabledIds = getEnabledPowerupIds();

                    if (enabledIds.length === 0) {
                        return;
                    }

                    const grantedId = enabledIds[Math.floor(Math.random() * enabledIds.length)];
                    PowerupInventoryStorage.grant(grantedId);

                    this.pendingLevelUpPowerupId = grantedId;
                    this.gameHud.showLevelUp(levelIndex, grantedId);
                },

                onGameOver: (score, topWorldY) => {
                    const heightMeters = (DEFAULT_FACE_TOWER_CONFIG.floorY - topWorldY) / DEFAULT_TOWER_3D_CONFIG.pixelsPerUnit;

                    // Checked BEFORE recording — recordX() below immediately
                    // bumps the cache to match, so isNewXHigh() (which
                    // compares against the run-START baseline) would always
                    // read false afterward.
                    const isNewScoreHigh = TowerHighScoreStorage.isNewPointsHigh(score);
                    const isNewHeightHigh = TowerHighScoreStorage.isNewHeightHigh(heightMeters);

                    TowerHighScoreStorage.recordPoints(score);
                    TowerHighScoreStorage.recordHeight(heightMeters);

                    this.gameHud.showGameOver({
                        score,
                        heightText: formatHeightRounded(heightMeters),
                        bestScoreText: String(TowerHighScoreStorage.getPoints()),
                        isNewScoreHigh,
                        bestHeightText: formatHeightRounded(TowerHighScoreStorage.getHeight()),
                        isNewHeightHigh,
                    });
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.GameOver);
                },

                onBlockDropped: (block) => {
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Drop);
                    this.blockSync3D.notifyDropped(block.id);

                    /*
                     * The active powerup's piece just got dropped for
                     * real — it's spent (already deducted from inventory
                     * back in useHudPowerup()), so there's nothing left to
                     * cancel back to. Clear the tracking WITHOUT refunding.
                     */
                    if (block.powerup && this.activePowerupId !== null) {
                        this.activePowerupId = null;
                        this.preActivationPiece = null;
                        this.gameHud.setActivePowerup(null);
                    }
                },

                onBlockFirstHit: (block, contactPoint, hitBlock) => {
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Impact);
                    this.blockSync3D.notifyFirstHit(block.id);
                    TowerVfxUtils.onFirstTouchVfx(this.contactPointToWorld(contactPoint), block, hitBlock);
                },

                onBlockFrozen: (block, greyColorHex) => {
                    this.blockSync3D.notifyFrozen(block.id, greyColorHex);
                },

                onPowerupTouch: (block, contactPoint, powerup, actionBlock) => {
                    const worldPos = this.contactPointToWorld(contactPoint);

                    if (powerup.action === 'destroy') {
                        // Bomb/super-bomb: no wiggle (the block's about to be
                        // removed anyway) — a burst + camera shake instead.
                        TowerVfxUtils.onBombVfx(worldPos, actionBlock, block);
                        this.triggerCameraShake(0.12, 0.3);
                    } else {
                        // Freeze/shrink: replay the same jiggle wobble a
                        // normal piece's first hit uses, so the touched
                        // piece visibly reacts to the powerup passing
                        // through it.
                        this.blockSync3D.notifyPowerupTouch(block.id);

                        if (powerup.action === 'freeze') {
                            TowerVfxUtils.onFreezeVfx(worldPos, actionBlock, block);
                        } else {
                            TowerVfxUtils.onShrinkVfx(worldPos, actionBlock, block);
                        }
                    }
                },

                onNextPieceChanged: (piece) => {
                    this.gameHud.showNextPiece(piece);
                },

                onZoneScorePopup: (blocks, onPointsAwarded) =>
                    TowerScorePopupUtils.playZoneComplete(
                        blocks,
                        (block) => ({
                            x: block.entity.body.position.x,
                            y: block.entity.body.position.y + (this.faceTower?.getCameraOffsetY() ?? 0),
                        }),
                        onPointsAwarded,
                    ),
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
            base => this.faceTower.getBasePieceId(base),
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
        TowerHighScoreStorage.markRunStart();
        this.resizeFaceTowerInput();
        this.setupCameraDevGui();
        this.setupVisualDevGui();
        this.setupLevelDevGui();
        this.setupPieceSnapshotDevGui();

        this.pieceDevGui = new PieceDevGui(PIECES, this.faceTower, this);
        this.pieceDevGui.setup();

        this.powerupDevGui = new PowerupDevGui(POWERUPS, this.faceTower);
        this.powerupDevGui.setup();
    }

    private setupLevelDevGui(): void {
        const gui = DevGuiManager.instance;
        const folder = 'Levels';

        gui.addButton('Skip to next zone', () => this.faceTower.devSkipZone(), folder);
        gui.addButton('Skip to next level', () => this.faceTower.devSkipLevel(), folder);
        gui.addButton('Game over', () => this.faceTower.devTriggerGameOver(), folder);

        gui.addToggle('Use raw height values', DEFAULT_TOWER_3D_CONFIG.useRawHeightValues, (value) => {
            DEFAULT_TOWER_3D_CONFIG.useRawHeightValues = value;
        }, folder);
    }

    /**
     * Renders each tower piece in isolation (its own real shape/scale/
     * color/face texture, via the exact PieceBoxBuilder path gameplay
     * uses) against a transparent background and downloads it as a PNG —
     * for lining up camera framing against hand-authored face art before/
     * after it lands in raw-assets/non-preload/skins. See PieceSnapshotTool.
     */
    private setupPieceSnapshotDevGui(): void {
        const gui = DevGuiManager.instance;
        const folder = 'Piece Snapshots';

        if (PIECES.length === 0) {
            return;
        }

        PieceSnapshotTool.settings.selectedPieceId = PIECES[0].id;

        gui.addProperties(PieceSnapshotTool.settings, ['size'], [16, 512], 'Size', folder);
        gui.addProperties(PieceSnapshotTool.settings, ['yaw', 'pitch'], [-180, 180], 'Camera', folder);
        // A multiplier on top of the auto fit-to-frame distance now (see
        // PieceSnapshotTool.frameMesh()), not a raw world-unit distance —
        // 1 is a tight fit, so the slider only needs a modest zoom-out range.
        gui.addProperties(PieceSnapshotTool.settings, ['distance'], [0.5, 3], 'Camera', folder);

        gui.addDropdown(
            PieceSnapshotTool.settings,
            'selectedPieceId',
            PIECES.map((piece) => piece.id),
            () => { /* value already written straight into settings.selectedPieceId */ },
            'Piece to Test',
            folder,
        );

        gui.addButton('Snapshot Selected Piece', () => {
            void PieceSnapshotTool.snapshotOne(PieceSnapshotTool.settings.selectedPieceId);
        }, folder);

        gui.addButton('Snapshot All Pieces', () => {
            void PieceSnapshotTool.snapshotAll();
        }, folder);

        // Powerups are a SEPARATE set of buttons — their shape lives on
        // PowerupDefinition.piece (powerups-config.json), not in PIECES, so
        // they're not covered by "Snapshot All Pieces" above.
        if (POWERUPS.length > 0) {
            PieceSnapshotTool.settings.selectedPowerupId = POWERUPS[0].id;

            gui.addDropdown(
                PieceSnapshotTool.settings,
                'selectedPowerupId',
                POWERUPS.map((powerup) => powerup.id),
                () => { /* value already written straight into settings.selectedPowerupId */ },
                'Powerup to Test',
                folder,
            );

            gui.addButton('Snapshot Selected Powerup', () => {
                void PieceSnapshotTool.snapshotOnePowerup(PieceSnapshotTool.settings.selectedPowerupId);
            }, folder);

            gui.addButton('Snapshot All Powerups', () => {
                void PieceSnapshotTool.snapshotAllPowerups();
            }, folder);
        }
    }

    /**
     * GameHud's onUsePowerup callback.
     *
     * skip-piece is an instant one-shot (no "held" state to speak of — the
     * swap is already done the moment it fires) so it just spends one and
     * triggers it directly. The three REAL powerups instead track a single
     * global "active" one:
     *  - nothing active + tap → spend one, swap it in as the held piece,
     *    remember what was held before (see preActivationPiece) so
     *    cancelling can restore it exactly.
     *  - tap the SAME active one again → cancel: refund it and restore the
     *    pre-activation piece.
     *  - tap a DIFFERENT one while one is active → also just cancels the
     *    current one (never activates the tapped one in the same tap) — the
     *    player has to tap the new one again afterward to actually activate
     *    it. See cancelActivePowerup().
     *
     * Every path is also gated on FaceTowerGameController.canUsePowerup() (a
     * piece must currently be hovering over the drop area) so a tap that
     * can't take effect right now never spends the player's inventory for
     * nothing.
     */
    private useHudPowerup(powerupId: string): void {
        if (powerupId === SKIP_PIECE_POWERUP_ID) {
            if (!this.faceTower.canUsePowerup() || !PowerupInventoryStorage.consume(powerupId)) {
                return;
            }

            this.faceTower.skipHeldPiece();
            return;
        }

        if (this.activePowerupId !== null) {
            this.cancelActivePowerup();
            return;
        }

        if (!this.faceTower.canUsePowerup() || !PowerupInventoryStorage.consume(powerupId)) {
            return;
        }

        this.preActivationPiece = this.faceTower.getHeldBlock()?.piece ?? null;
        this.activePowerupId = powerupId;
        this.gameHud.setActivePowerup(powerupId);

        this.faceTower.spawnPowerup(powerupId);
    }

    /** Refunds the active powerup and restores whatever piece was held right before it activated — see useHudPowerup(). No-op if nothing's active, or if the piece can no longer be swapped out from under the player (already dropped — canUsePowerup() false), which shouldn't normally happen since onBlockDropped clears activePowerupId the instant that piece is actually dropped. */
    private cancelActivePowerup(): void {
        if (this.activePowerupId === null || !this.faceTower.canUsePowerup()) {
            return;
        }

        PowerupInventoryStorage.grant(this.activePowerupId);

        if (this.preActivationPiece) {
            this.faceTower.replaceHeldBlockWithPiece(this.preActivationPiece);
        }

        this.activePowerupId = null;
        this.preActivationPiece = null;
        this.gameHud.setActivePowerup(null);
    }

    /**
     * GameHud's onWatchVideoForLevelUp callback — awaits the platform's
     * rewarded-video call and grants a SECOND copy of whichever powerup the
     * level-up already granted (see pendingLevelUpPowerupId) on success,
     * telling the popup to reflect it; re-enables the button on
     * failure/cancel so the player isn't stuck. No-op if there's no
     * pending level-up (shouldn't happen — the button only exists while
     * the popup is up).
     */
    private async handleLevelUpWatchVideo(): Promise<void> {
        const powerupId = this.pendingLevelUpPowerupId;

        if (!powerupId) {
            return;
        }

        this.gameHud.setLevelUpWatchBusy(true);

        let rewarded = false;

        try {
            rewarded = await PlatformHandler.instance.platform.showRewardedVideo('level-powerup-double');
        } catch (e) {
            console.error('IslandViewScene: rewarded video failed', e);
        }

        this.gameHud.setLevelUpWatchBusy(false);

        if (rewarded) {
            PowerupInventoryStorage.grant(powerupId);
            this.gameHud.notifyLevelUpDoubled();
        } else {
            this.gameHud.notifyLevelUpVideoFailed();
        }
    }

    /**
     * Called every time FaceTowerGameController fires onMilestoneReached —
     * i.e. every zone, not just full level-ups — resolves which island/sky
     * step the CURRENT (level, zone-within-level) pair now lands on (see
     * TowerIslandProgression.resolveIslandForZone()) and:
     *  - kicks off (or starts) the sky's smooth color transition, switching
     *    from the original flat scene.background to the gradient sky the
     *    very first time a skyGradient-enabled island is reached;
     *  - swaps texture/water tones outright (no transition — only the sky
     *    eases) whenever the island itself actually changes (i.e. only at
     *    an actual level boundary — every zone within one level shares the
     *    same island, so this is a no-op most of the time).
     */
    private applyZoneIsland(): void {
        const { island, skyColorHex } = resolveIslandForZone(
            this.faceTower.getLevelIndex(),
            this.faceTower.getZoneIndexInLevel(),
        );

        if (island.skyGradient && island.skyGradient.length > 0) {
            if (!this.skyController.isBuilt()) {
                this.threeScene.background = null;
                this.skyController.build(this.threeCamera, skyColorHex);
            } else {
                this.skyController.transitionTo(skyColorHex);
            }
        }

        /*
         * Bounds only — the actual visibility value is driven continuously
         * every frame from climb progress (see update()), not stepped here
         * per zone the way the sky color is. An island that doesn't define
         * both bounds gets (0, 0), which reads as "no stars" without ever
         * needing to build the starfield for it at all.
         */
        if (island.starfieldWeightMin !== undefined && island.starfieldWeightMax !== undefined) {
            if (!this.starfieldController.isBuilt()) {
                this.starfieldController.build(this.threeCamera);
            }

            this.starfieldController.setWeightBounds(island.starfieldWeightMin, island.starfieldWeightMax);
        } else {
            this.starfieldController.setWeightBounds(0, 0);
        }

        if (island.id !== this.currentIslandId) {
            this.currentIslandId = island.id;
            void this.swapIslandAssets(island);
        }
    }

    /** Swaps the ground texture and water tint for `island` — instant, no transition (unlike the sky, see applyZoneIsland()). */
    private async swapIslandAssets(island: IslandConfig): Promise<void> {
        const texture = await TextureBuilder.loadRealIsland(resolveIslandImagePath(island.texture));
        const clusterMaterial = this.clusterMesh.material as THREE.MeshStandardMaterial;

        clusterMaterial.map = texture;
        clusterMaterial.needsUpdate = true;

        const waterColors = deriveWaterTones(parseHexColor(island.waterColor));
        const waterUniforms = (this.waterMat as THREE.ShaderMaterial).uniforms;

        waterUniforms.uColorDeep.value.copy(IslandViewScene.srgbVector(waterColors.deep));
        waterUniforms.uColorMid.value.copy(IslandViewScene.srgbVector(waterColors.mid));
        waterUniforms.uColorBright.value.copy(IslandViewScene.srgbVector(waterColors.bright));
        waterUniforms.uColorFoam.value.copy(IslandViewScene.srgbVector(waterColors.foam));
    }

    /** Raw sRGB conversion (no ColorManagement linearization) — same convention as WaterMaterial.ts/FourCornersGradientBuilder's own srgb() helpers, so a hex value here matches exactly what those shaders were authored against. */
    private static srgbVector(hex: number): THREE.Vector3 {
        return new THREE.Vector3(
            ((hex >> 16) & 0xff) / 255,
            ((hex >> 8) & 0xff) / 255,
            (hex & 0xff) / 255,
        );
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

        // Half-extents of the play area the camera must show, in world units.
        // X = how wide the tower/arena is, Y = how tall the visible portion is.
        const PLAY_HALF_W = 3;   // e.g. tower is 8 units wide
        const PLAY_HALF_H = 5.8;   // e.g. visible play height is 12 units
        const FIT_PADDING = 1.05;  // 8% breathing room


        const cfg = DEFAULT_TOWER_3D_CONFIG; const yaw = (cfg.cameraYawDeg * Math.PI) / 180; const pitch = (cfg.cameraPitchDeg * Math.PI) / 180;
        const fovV = (this.threeCamera.fov * Math.PI) / 180;   // vertical FOV in radians    
        const aspect = this.threeCamera.aspect;                  // viewport W / H — keep this current in your resize handler!
        const tan = Math.tan(fovV / 2); const playW = PLAY_HALF_W * 2; const playH = PLAY_HALF_H * 2;
        const dFitH = (playH * Math.cos(pitch)) / (2 * tan); const dFitW = playW / (2 * tan * aspect);
        const distance = Math.max(dFitH, dFitW) * FIT_PADDING; const horizontal = distance * Math.cos(pitch); const focusY = FOCUS_POINT.y + liftY;
        this.threeCamera.position.set(FOCUS_POINT.x + horizontal * Math.sin(yaw), focusY + distance * Math.sin(pitch) + cfg.cameraExtraLiftY, FOCUS_POINT.z + horizontal * Math.cos(yaw),);
        this.threeCamera.lookAt(FOCUS_POINT.x, focusY, FOCUS_POINT.z);
    }

    /** Kicks off a decaying random jitter applied to the 3D camera each frame — see applyCameraShake(), called right after positionCamera() in update(). */
    private triggerCameraShake(strength: number, duration: number): void {
        this.cameraShakeStrength = strength;
        this.cameraShakeDuration = duration;
        this.cameraShakeTimeRemaining = duration;
    }

    /** Nudges the camera by a random offset that decays to zero over cameraShakeDuration — must run after positionCamera() sets the "clean" position each frame, since it adds on top of it rather than replacing it. */
    private applyCameraShake(delta: number): void {
        if (this.cameraShakeTimeRemaining <= 0) {
            return;
        }

        this.cameraShakeTimeRemaining = Math.max(0, this.cameraShakeTimeRemaining - delta);
        const t = this.cameraShakeTimeRemaining / this.cameraShakeDuration;
        const amount = this.cameraShakeStrength * t;

        this.threeCamera.position.x += (Math.random() * 2 - 1) * amount;
        this.threeCamera.position.y += (Math.random() * 2 - 1) * amount;
        this.threeCamera.position.z += (Math.random() * 2 - 1) * amount;
    }

    /** Same 2D-physics → 3D-world conversion TowerBlockSync3D.updateCube() uses — kept here since IslandViewScene already owns both config references it needs. */
    private contactPointToWorld(contactPoint: PowerupContactPoint): THREE.Vector3 {
        const cfg = DEFAULT_FACE_TOWER_CONFIG;
        const cfg3d = DEFAULT_TOWER_3D_CONFIG;

        return new THREE.Vector3(
            (contactPoint.x - cfg.floorX) / cfg3d.pixelsPerUnit + cfg3d.towerBaseOffset.x,
            (cfg.floorY - contactPoint.y) / cfg3d.pixelsPerUnit + cfg3d.towerBaseOffset.y,
            cfg3d.towerBaseOffset.z,
        );
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
