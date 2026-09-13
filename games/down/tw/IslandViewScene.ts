import { Game } from 'core/Game';
import PlatformHandler from 'core/platforms/PlatformHandler';
import Physics from 'core/phyisics/Physics';
import { ThreeScene } from 'core/scene/ThreeScene';
import SetupThree from 'core/scene/SetupThree';
import { DevGuiManager } from 'core/utils/DevGuiManager';
import { DomUiRoot } from '../game/dom-ui/DomUiRoot';
import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { PieceDevGui } from '../game/debug/PieceDevGui';
import { PieceSnapshotTool } from '../game/debug/PieceSnapshotTool';
import { PowerupDevGui } from '../game/debug/PowerupDevGui';
import { TowerHighScoreStorage } from './TowerHighScoreStorage';
import { PowerupInventoryStorage } from '../game/data/PowerupInventoryStorage';
import {
    getDefaultIsland,
    parseHexColor,
    shadeColor,
} from '../game/world/IslandStorage';
import { DEFAULT_FACE_TOWER_CONFIG } from './FaceTowerConfig';
import { FaceTowerGameController } from './FaceTowerGameController';
import { PIECES, type PieceDefinition } from './PieceStorage';
import { setPieceShapeMode } from './PieceShapeMode';
import {
    CLEAR_LOW_TIER_POWERUP_ID,
    DESTROY_PIECE_POWERUP_ID,
    POWERUPS,
    SKIP_PIECE_POWERUP_ID,
    UPGRADE_PIECE_POWERUP_ID,
    WIND_POWERUP_ID,
    getPowerup,
} from './PowerupStorage';
import { getEnabledPowerupIds } from './PowerupConfig';
import { TowerVfxUtils } from './TowerVfxUtils';
import type { PowerupContactPoint } from './PowerupSystem';
import { TowerBaseSync3D } from './TowerBaseSync3D';
import { TowerBlockSync3D } from './TowerBlockSync3D';
import { DEFAULT_TOWER_3D_CONFIG, formatHeightRounded } from './Tower3DConfig';
import { loadTowerDevMeta, saveTowerDevMeta } from './TowerDevMeta';
import { TowerGameOverSiren3D } from './TowerGameOverSiren3D';
import { TowerHeightMarkers3D } from './TowerHeightMarkers3D';
import { getSkyCycleColor, resolveIslandForZone } from './TowerIslandProgression';
import { TowerSkyController } from './TowerSkyController';
import { TowerStarfieldController } from './TowerStarfieldController';
import { TowerWallSync3D } from './TowerWallSync3D';
import { GameHud } from './ui/GameHud';
import { PieceTargetingOverlay } from './ui/PieceTargetingOverlay';
import { TowerScorePopupUtils } from './ui/TowerScorePopupUtils';
import { TowerRewardFlyUtils } from './ui/TowerRewardFlyUtils';
import { PowerupButton } from './ui/PowerupButton';
import ViewUtils from 'core/utils/ViewUtils';
import SoundManager from 'core/audio/SoundManager';
import Assets from '../Assets';

const FOCUS_POINT = new THREE.Vector3(0, 0, 0);

/** How many copies of the level-up powerup a successful rewarded video grants — see handleLevelUpWatchVideo(). Change this one constant to retune the reward. */
const REWARD_VIDEO_BONUS_AMOUNT = 3;

export default class IslandViewScene extends ThreeScene {
    // -------------------------------------------------------------------------
    // World / 3D
    // -------------------------------------------------------------------------
    /** Degenerate four-corners gradient sky, built lazily the first time a zone's island defines skyGradient — see applyZoneIsland(). Until then the plain flat scene.background set in build() is what's showing. */
    private readonly skyController = new TowerSkyController();
    /** Camera-attached star layer, built lazily the first time a zone's island defines BOTH starfieldWeightMin/Max — see applyZoneIsland(). Its visibility is driven continuously every frame from climb progress — see update(). */
    private readonly starfieldController = new TowerStarfieldController();

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

    /**
     * Which type: 'target' powerup (destroy-piece/upgrade-piece) is
     * currently waiting for the player to tap a piece — see
     * beginTargeting()/endTargeting(). Null whenever targetingOverlay isn't
     * up. Independent of activePowerupId, which is only ever for type:
     * 'drop' powerups (a held piece to swap in/out).
     */
    private targetingPowerupId: string | null = null;

    /** Which powerup the currently-shown LevelUpNotification popup already granted — see handleLevelUpWatchVideo(), which grants a second one of THIS SAME id on a successful video. Null whenever no level-up popup is up. */
    private pendingLevelUpPowerupId: string | null = null;
    /** How many copies to fly to the belt on collect — 1 normally, bumped by handleLevelUpWatchVideo() on a successful double. Purely a visual count for TowerRewardFlyUtils, not tied to the actual granted amount (which already happened silently at grant time). */
    private pendingLevelUpFlyCount = 1;
    /** True while the platform's own gameplayStart()/gameplayStop() thinks a run is "in play" — see onBlockDropped (starts it lazily on the next actual drop) and the onGameOver/onLevelProgressed handlers (stop it the instant either popup shows). Deliberately NOT restarted the instant a popup is dismissed — only the next real drop (i.e. the player actually touching the screen again) flips it back on. */
    private isGameplayActive = false;
    /** True once handleLevelUpWatchVideo() has already dispatched onLevelUpCollected for the CURRENT popup — the onLevelUpCollected listener uses this to skip the commercial break it otherwise shows for a plain (no-video) collect, since a rewarded video already played. Reset false every time a fresh level-up shows. */
    private levelUpVideoWatched = false;

    private blockSync3D!: TowerBlockSync3D;
    private baseSync3D!: TowerBaseSync3D;
    private wallSync3D!: TowerWallSync3D;
    private heightMarkers3D!: TowerHeightMarkers3D;
    private gameOverSiren3D!: TowerGameOverSiren3D;
    private pieceDevGui!: PieceDevGui;
    private powerupDevGui!: PowerupDevGui;
    private gameHud!: GameHud;
    /** "Pick a piece to destroy/upgrade" overlay — see beginTargeting()/endTargeting(). */
    private readonly targetingOverlay = new PieceTargetingOverlay();


    /**
     * Dev-only — multiplies every delta passed to physics/game-logic/animation
     * this frame. Persisted via TowerDevMeta; see setupVisualDevGui().
     */
    private speedMultiplier = 1;

    // Camera-shake state — see triggerCameraShake()/applyCameraShake().
    private cameraShakeStrength = 0;
    private cameraShakeDuration = 0;
    private cameraShakeTimeRemaining = 0;

    /** True while PlatformHandler says the platform SDK has paused the game (e.g. tab-embedded pause on some platforms) — see setupPlatformPause()/MergeScene.ts's identical convention. Gates fixedUpdate()'s physics/game-logic stepping and drives gameBlocker's interactivity below; it deliberately does NOT stop update()'s cosmetic/camera/HUD work, same split MergeScene makes. */
    private paused = false;
    /** Full-screen invisible-ish blocker sitting in the overlay (above the HUD) that only becomes interactive while paused — same shape/purpose as MergeScene's own gameBlocker: swallow pointer input so a drop/tap that lands while the platform thinks the game is paused can't reach the tower gameplay underneath. */
    private readonly gameBlocker: PIXI.Sprite = PIXI.Sprite.from(PIXI.Texture.WHITE);

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

        /*
         * The background sky is its OWN independent color cycle now (see
         * TowerIslandProgression.getSkyCycleColor()), not the current
         * level's island — built as a gradient sky from frame one (index 0
         * of that cycle) so applyZoneIsland()'s later transitionTo() calls
         * always have something already built to ease FROM instead of
         * hard-cutting on the very first zone.
         */
        const initialZone = resolveIslandForZone(0, 0);

        this.skyController.build(this.threeCamera, getSkyCycleColor(0));

        if (initialZone.island.starfieldWeightMin !== undefined && initialZone.island.starfieldWeightMax !== undefined) {
            this.starfieldController.build(this.threeCamera);
            this.starfieldController.setWeightBounds(initialZone.island.starfieldWeightMin, initialZone.island.starfieldWeightMax);
        }

        this.threeScene.add(this.threeCamera);

        // Soft sky/ground gradient instead of a flat AmbientLight — gives every
        // piece's shadowed side a gentle cool-toned falloff (the "ground" color)
        // rather than going flat black, which is what was reading as depthless.
        const ambient = parseHexColor(island.ambientColor);
        this.threeScene.add(new THREE.HemisphereLight(0xbfd9ff, shadeColor(ambient, -0.35), 0.9));

        SetupThree.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        SetupThree.renderer.toneMappingExposure = 1.1;
        SetupThree.renderer.outputColorSpace = THREE.SRGBColorSpace;

        // Dialed down from 1.6 — combined with the material's clearcoat this
        // was blowing the highlight out to flat white under ACES tonemapping.
        const key = new THREE.DirectionalLight(0xfff4dd, 1.1);
        key.position.set(5, 10, 7.5);
        this.threeScene.add(key);

        const fill = new THREE.DirectionalLight(0x99ccff, 0.4);
        fill.position.set(-8, 3, -5);
        this.threeScene.add(fill);

        // Rim/back light — sits behind the pieces relative to the camera (which
        // looks toward -Z from a +Z position, see positionCamera()), catching
        // the bevel's edge highlight so each piece separates from the ones
        // behind it instead of reading as a flat silhouette. Dialed down from
        // 1.1 for the same blown-out-highlight reason as the key light.
        const rim = new THREE.DirectionalLight(0xd8ecff, 0.6);
        rim.position.set(-2, 6, -9);
        this.threeScene.add(rim);

        this.positionCamera();
        this.buildFaceTowerLayer();
        TowerVfxUtils.build(this.threeScene);

        this.game.overlayContainer.addChild(this.hudContainer);
        this.hudContainer.addChild(this.gameHud);

        this.setupPlatformPause();
    }

    public resize(): void {
        this.resizeFaceTowerInput();
        this.skyController.resize();
        this.starfieldController.resize(this.threeCamera);
    }

    public fixedUpdate(delta: number): void {
        delta *= this.speedMultiplier;

        // Skips the actual simulation/game-logic step while paused — see `paused`'s own doc —
        // but still calls super.fixedUpdate() unconditionally, same "cosmetic stuff keeps
        // running, only the mediator/game-logic step freezes" split MergeScene.update() makes.
        if (!this.paused) {
            Physics.fixedUpdate(delta);
        }
        super.fixedUpdate(delta);
        if (!this.paused) {
            this.faceTower?.update(delta);
        }
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

        if (this.targetingPowerupId !== null && this.faceTower) {
            this.targetingOverlay.layout();
            this.targetingOverlay.update(
                this.faceTower.getBlocks(),
                towerOffsetY,
                DEFAULT_FACE_TOWER_CONFIG.blockWidth,
                DEFAULT_FACE_TOWER_CONFIG.blockHeight,
                this.faceTower.getHeldBlock()?.id,
            );
        }

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
            // The top game-over line is fixed on SCREEN, not world, space —
            // its world-Y equivalent shifts as the camera pans (see
            // FaceTowerGameController.getGameOverLineWorldY()), same
            // toWorldY() conversion the death-line check itself uses.
            const gameOverLineWorldY = this.faceTower.getGameOverLineWorldY();

            /*
             * "Current" is expressed in the SAME unit as the level's own
             * destination distance (km), scaled by how far through the
             * level's zones the player actually is — rather than an
             * unrelated raw climbed-meters count shown next to an
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

            // Milestones can belong to an EARLIER level with its own
            // (different) destination distance, which isn't tracked once a
            // base is placed — kept in plain meters rather than misreport
            // them against the CURRENT level's distance.
            // getBases() now holds TWO entries per floor (its left/right
            // flaps — see FaceTowerBlockController.addBase()), so the first
            // 2 entries are the CURRENT floor's own pair, not just entry 0 —
            // slice(2) is the direct update of what used to be slice(1)
            // (dropping "the current floor") back when each floor was one
            // entry.
            const milestoneMarks = this.faceTower
                .getBases()
                .slice(2)
                .map((base) => ({
                    screenY: screenYFor(base.body.position.y),
                    value: plainMeters(base.body.position.y),
                    unit: 'm' as const,
                }));

            const gameOverWarningSecondsRemaining = this.faceTower.getGameOverWarningSecondsRemaining();

            // The game-over line's own screen Y is fixed (see
            // FaceTowerConfig.gameOverLineScreenY) — no conversion needed,
            // it never depends on camera offset the way a world-Y mark does.
            this.gameHud?.updateHeightGauge(
                currentMark,
                DEFAULT_FACE_TOWER_CONFIG.gameOverLineScreenY,
                milestoneMarks,
                delta,
                gameOverWarningSecondsRemaining,
            );

            this.gameOverSiren3D?.update(
                gameOverWarningSecondsRemaining !== undefined,
                gameOverLineWorldY,
                delta,
            );

            this.gameHud?.updateLevelGoal(this.faceTower.getLevelIndex());

            this.gameHud?.updatePieceProgression(
                this.faceTower.getPieceProgression(),
                this.faceTower.getMaxTierEverUnlocked(),
            );

            // 3D markers take raw world-Y (not screen-space) since they
            // position actual meshes in the THREE scene. The second bar
            // (originally a per-zone height "goal") now marks the fixed top
            // game-over line instead — its own label stays hidden either
            // way (see TowerHeightMarkers3D), so the value passed for it is
            // unused.
            this.heightMarkers3D?.update(
                currentTopWorldY,
                gameOverLineWorldY,
                currentMark.value,
                0,
                currentMark.unit,
            );

            this.gameHud?.updateProgressBar(this.faceTower.getWeightProgress());
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

    /** Adds gameBlocker to the overlay (above the HUD) and subscribes to the platform's own pause/resume signal — see `paused`/`gameBlocker`'s own docs. Mirrors MergeScene.setupPopups()'s identical PlatformHandler wiring. */
    private setupPlatformPause(): void {
        this.game.overlayContainer.addChild(this.gameBlocker);
        this.gameBlocker.anchor.set(0.5);
        this.gameBlocker.scale.set(1000);
        this.gameBlocker.alpha = 0.1;
        this.gameBlocker.tint = 0;
        this.gameBlocker.interactive = false;
        this.gameBlocker.visible = false;

        PlatformHandler.instance.onPause.add(this._onPlatformPause);
        PlatformHandler.instance.onResume.add(this._onPlatformResume);
    }

    private readonly _onPlatformPause = (): void => {
        this.paused = true;

        // Set synchronously here rather than lazily every frame in update() — core/Game.ts
        // stops the WHOLE ticker on this same onPause signal (see its own doc), so update()
        // stops running the instant this fires; anything gating input on `paused` has to be
        // applied right here or it never actually takes effect.
        this.gameBlocker.interactive = true;
        this.gameBlocker.visible = true;
        this.faceTower?.setInputEnabled(false);
        // Mute/settings/quit (SoundToggleButton.ts etc.) are real DOM elements sitting ABOVE
        // the Pixi canvas entirely — gameBlocker can't reach them no matter how it's layered
        // inside the canvas, so they need this separate DOM-side block.
        DomUiRoot.instance.setInputBlocked(true);
    };

    private readonly _onPlatformResume = (): void => {
        this.paused = false;

        this.gameBlocker.interactive = false;
        this.gameBlocker.visible = false;
        this.faceTower?.setInputEnabled(true);
        DomUiRoot.instance.setInputBlocked(false);
    };

    public destroy(): void {
        PlatformHandler.instance.onPause.remove(this._onPlatformPause);
        PlatformHandler.instance.onResume.remove(this._onPlatformResume);
        this.gameBlocker.removeFromParent();
        // DomUiRoot is an app-wide singleton, not scene-owned — don't leave its OWN input
        // blocked past this scene's own lifetime just because this scene happened to be the
        // one paused when it was torn down.
        DomUiRoot.instance.setInputBlocked(false);

        this.skyController.destroy();
        this.starfieldController.destroy();
        TowerVfxUtils.destroy();
        TowerScorePopupUtils.destroy();
        TowerRewardFlyUtils.destroy();
        this.faceTower?.destroy();
        this.blockSync3D?.destroy();
        this.baseSync3D?.destroy();
        this.wallSync3D?.destroy();
        this.heightMarkers3D?.destroy();
        this.gameOverSiren3D?.destroy();
        this.targetingOverlay.destroy();
        this.gameHud?.destroy();

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

            () => void this.handleGameOverRespawnVideo(),
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

                // Same refund for a 'target' powerup mid-targeting — a
                // fresh run wipes the board there was going to be a target
                // on, so there's nothing left to resolve it against.
                this.endTargeting(true);

                // Player restarted outright (as opposed to watching a video
                // to respawn in place) — the natural "between sessions" spot
                // for a commercial break.
                void PlatformHandler.instance.platform.showCommercialBreak();
            },
        );

        TowerScorePopupUtils.build(this.hudContainer, () => this.gameHud.getScoreLabelScreenPosition());
        TowerScorePopupUtils.onPop = () => SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Grab);
        TowerRewardFlyUtils.build(this.hudContainer);
        TowerRewardFlyUtils.onArrive = () => SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Invincible);

        this.hudContainer.addChild(this.targetingOverlay);
        this.targetingOverlay.onTargetChosen.add((blockId: number) => this.resolveTargetingChoice(blockId), this);
        this.targetingOverlay.onCancel.add(() => this.endTargeting(true), this);

        this.gameHud.onUsePowerup.add((powerupId: string) => this.useHudPowerup(powerupId), this);
        this.gameHud.onShapeModeToggle.add((mode: 'circle' | 'cube') => this.handleShapeModeToggle(mode), this);
        this.gameHud.onWatchVideoForLevelUp.add(() => void this.handleLevelUpWatchVideo(), this);
        this.gameHud.onLevelUpCollected.add(() => {
            const powerupId = this.pendingLevelUpPowerupId;
            const flyCount = this.pendingLevelUpFlyCount;

            this.pendingLevelUpPowerupId = null;
            this.pendingLevelUpFlyCount = 1;

            /*
             * Fires after LevelUpNotification has already been told to hide
             * (see GameHud's own onCollect listener, registered before this
             * one during its own construction — same signal, so it runs
             * first) — tracks the icon's on-screen position and the belt
             * slot's position, THEN flies flyCount copies between them.
             * Purely cosmetic: the actual grant already happened silently
             * back when the level-up itself fired.
             */
            if (powerupId) {
                const from = this.gameHud.getLevelUpIconGlobalPosition();
                const to = this.gameHud.getPowerupBeltButtonPosition(powerupId);

                if (to) {
                    TowerRewardFlyUtils.fly(() => this.buildRewardFlyIcon(powerupId), from, to, flyCount);
                }
            }

            // Only when THIS collect wasn't preceded by watching the bonus
            // video — handleLevelUpWatchVideo() already showed a rewarded
            // video before dispatching this same signal, so stacking a
            // commercial break right after that would be a second ad in a
            // row for the exact same moment.
            if (!this.levelUpVideoWatched) {
                void PlatformHandler.instance.platform.showCommercialBreak();
            }

            this.faceTower.resumeAfterLevelUpNotification();
        }, this);


        this.faceTower = new FaceTowerGameController(
            this.worldContainer,
            this.game.overlayContainer,
            this,
            DEFAULT_FACE_TOWER_CONFIG,
            {
                onScoreChanged: (score) => {
                    this.gameHud.showScore(score, TowerHighScoreStorage.getPoints());
                },

                onTrapdoorOpened: (zoneIndex) => {
                    this.gameHud.showZoneComplete(zoneIndex);
                    // The requirement that was just satisfied doesn't need
                    // naming here — the celebration pop is the same regardless
                    // of which piece/top-tier-repeat it was.
                    this.gameHud.playGateUnlockCelebration();
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.GateOpen);

                    /*
                     * Fires on EVERY trapdoor, not just full level-ups — the
                     * sky needs to step forward one zone at a time (see
                     * applyZoneIsland()), not sit static until a whole
                     * level's worth of zones finishes. By this point
                     * FaceTowerGameController has already advanced
                     * levels/getZoneIndexInLevel() to whatever this zone
                     * landed on, level-up included.
                     */
                    this.applyZoneIsland();
                },

                onGateProgressRevealed: (requirement) => {
                    const piece = this.faceTower?.getPieceProgression()[requirement.tier];

                    if (piece) {
                        this.gameHud.showGateRequirement(requirement, piece);
                    }
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
                    this.pendingLevelUpFlyCount = 1;
                    this.levelUpVideoWatched = false;
                    this.gameHud.showLevelUp(levelIndex, grantedId, REWARD_VIDEO_BONUS_AMOUNT);

                    // The popup is now up — gameplay is paused until the
                    // player collects and drops the next piece (see
                    // onBlockDropped, which flips this back on lazily).
                    this.isGameplayActive = false;
                    void PlatformHandler.instance.platform.gameplayStop();
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

                    // Run is over — gameplay stays "stopped" until the
                    // player actually drops a piece again (see
                    // onBlockDropped), whether that's a fresh run (REPLAY)
                    // or respawning in place (RESPAWN video).
                    this.isGameplayActive = false;
                    void PlatformHandler.instance.platform.gameplayStop();
                },

                onBlockDropped: (block) => {
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Drop);
                    this.blockSync3D.notifyDropped(block.id);

                    // Lazily (re)starts gameplay the instant the player
                    // actually interacts — covers both the very first drop
                    // of a session and every "touch the screen again" after
                    // a game-over/level-up popup stopped it (see onGameOver/
                    // onLevelProgressed).
                    if (!this.isGameplayActive) {
                        this.isGameplayActive = true;
                        void PlatformHandler.instance.platform.gameplayStart();
                    }

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

                onPowerupTouch: (block, contactPoint, powerup, actionBlock) => {
                    // Only 'destroy' (bomb/super-bomb) is left — a burst +
                    // camera shake, no wiggle (the block's about to be
                    // removed anyway).
                    const worldPos = this.contactPointToWorld(contactPoint);

                    TowerVfxUtils.onBombVfx(worldPos, actionBlock, block);
                    this.triggerCameraShake(0.12, 0.3);
                },

                onNextPieceChanged: (piece) => {
                    this.gameHud.showNextPiece(piece);
                },

                onMerge: (resultPiece, x, y, points) => {
                    // Score is already applied by FaceTowerGameController —
                    // this is purely the visual/audio pop: a 3D particle
                    // burst at the merge's own world position, plus a
                    // flying "+N" screen-space number toward the score
                    // label (see TowerScorePopupUtils.popAt).
                    TowerVfxUtils.onScorePopVfx(x, y);

                    const screenPos = {
                        x,
                        y: y + (this.faceTower?.getCameraOffsetY() ?? 0),
                    };

                    void TowerScorePopupUtils.popAt(screenPos, points);
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
            base => this.faceTower.getBasePieceId(base),
            base => this.faceTower.getFlapSide(base),
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

        this.gameOverSiren3D = new TowerGameOverSiren3D(
            this,
            DEFAULT_FACE_TOWER_CONFIG,
            DEFAULT_TOWER_3D_CONFIG.pixelsPerUnit,
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
     * GameHud's onUsePowerup callback — branches on the tapped powerup's
     * own PowerupActivationType (see PowerupStorage):
     *  - skip-piece: instant one-shot, no "held" state — spend one, swap
     *    the held piece for the next, done. Not a real PowerupDefinition,
     *    so it's checked before even looking one up.
     *  - 'instant' (wind/clear-low-tier): spend one, apply the effect to
     *    the live board right away — see applyInstantPowerup().
     *  - 'target' (destroy-piece/upgrade-piece): spend one, enter
     *    targeting mode (see beginTargeting()) — tapping the SAME one
     *    again while already targeting cancels it instead (refunds, exits
     *    targeting) rather than doing nothing.
     *  - 'drop' (bomb/super-bomb — the original mechanic): tracks a single
     *    global "active" held-piece swap, same as before — see
     *    cancelActivePowerup()'s own doc for the full tap-again/tap-a-
     *    different-one behavior.
     *
     * Every path is also gated on FaceTowerGameController.canUsePowerup() (a
     * piece must currently be hovering over the drop area) so a tap that
     * can't take effect right now never spends the player's inventory for
     * nothing — 'instant'/'target' don't touch the held piece at all, but
     * still only make sense mid-run, not e.g. while a level-up popup has
     * play frozen.
     */
    private useHudPowerup(powerupId: string): void {
        if (powerupId === SKIP_PIECE_POWERUP_ID) {
            if (!this.faceTower.canUsePowerup() || !PowerupInventoryStorage.consume(powerupId)) {
                return;
            }

            this.faceTower.skipHeldPiece();
            return;
        }

        const powerup = getPowerup(powerupId);

        if (powerup?.type === 'instant' || powerup?.type === 'target') {
            // A 'drop'-type powerup (bomb) already mid-swap — cancel that
            // first, same as tapping a DIFFERENT drop-type one would, so
            // its held-piece swap never lingers underneath an instant
            // effect or a hidden-HUD targeting session.
            if (this.activePowerupId !== null) {
                this.cancelActivePowerup();
            }
        }

        if (powerup?.type === 'instant') {
            if (!this.faceTower.canUsePowerup() || !PowerupInventoryStorage.consume(powerupId)) {
                return;
            }

            this.applyInstantPowerup(powerupId);
            return;
        }

        if (powerup?.type === 'target') {
            if (this.targetingPowerupId === powerupId) {
                this.endTargeting(true);
                return;
            }

            if (this.targetingPowerupId !== null || !this.faceTower.canUsePowerup() || !PowerupInventoryStorage.consume(powerupId)) {
                return;
            }

            this.beginTargeting(powerupId);
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

    /** 'instant'-type powerups apply immediately, no held piece or targeting involved — see PowerupStorage.PowerupActivationType. */
    private applyInstantPowerup(powerupId: string): void {
        if (powerupId === WIND_POWERUP_ID) {
            this.faceTower.triggerWindPowerup();
        } else if (powerupId === CLEAR_LOW_TIER_POWERUP_ID) {
            this.faceTower.triggerClearLowTierPowerup();
        }
    }

    /**
     * Enters "pick a piece" mode for a 'target'-type powerup — hides the
     * whole HUD and disables normal drag/drop input (see
     * PieceTargetingOverlay's own doc for why hiding the HUD matters: the
     * player needs an unobstructed view of the board to tap the right
     * piece), and shows the targeting overlay/close button instead.
     */
    private beginTargeting(powerupId: string): void {
        this.targetingPowerupId = powerupId;
        this.gameHud.setHudVisible(false);
        this.faceTower.setInputEnabled(false);
        this.targetingOverlay.activate();
    }

    /** PieceTargetingOverlay.onTargetChosen — applies whichever effect targetingPowerupId actually is to the tapped block, then exits targeting mode (the powerup was already spent when targeting began — see beginTargeting()/useHudPowerup(), so no further inventory change here). */
    private resolveTargetingChoice(blockId: number): void {
        const powerupId = this.targetingPowerupId;

        this.endTargeting(false);

        if (powerupId === DESTROY_PIECE_POWERUP_ID) {
            this.faceTower.destroyBlock(blockId);
        } else if (powerupId === UPGRADE_PIECE_POWERUP_ID) {
            this.faceTower.upgradeBlock(blockId);
        }
    }

    /** Exits targeting mode, restoring the HUD/input — `refund` is true only for an explicit cancel (the close button, or tapping the same powerup again), never for an actual chosen-target resolution, which already spent it for real. */
    private endTargeting(refund: boolean): void {
        if (this.targetingPowerupId === null) {
            return;
        }

        if (refund) {
            PowerupInventoryStorage.grant(this.targetingPowerupId);
        }

        this.targetingPowerupId = null;
        this.targetingOverlay.deactivate();
        this.gameHud.setHudVisible(true);
        this.faceTower.setInputEnabled(true);
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
     * Swaps every catalog piece's shape (see PieceShapeMode) and starts a
     * fresh run under it — same "clear the 3D base meshes, reset the game
     * controller" sequence GameOverPopup's Replay button already uses, so
     * the board never ends up with old- and new-shaped pieces mixed
     * together. Refunds an in-flight powerup the same defensive way a
     * plain Replay does, in case one happened to be active the instant the
     * mode was switched.
     */
    private handleShapeModeToggle(mode: 'circle' | 'cube'): void {
        setPieceShapeMode(mode);

        this.baseSync3D.clear();
        this.faceTower.reset();

        if (this.activePowerupId !== null) {
            PowerupInventoryStorage.grant(this.activePowerupId);
            this.activePowerupId = null;
            this.preActivationPiece = null;
            this.gameHud.setActivePowerup(null);
        }

        this.endTargeting(true);
    }

    /**
     * GameHud's game-over "RESPAWN" callback — awaits the platform's
     * rewarded-video call and only actually respawns (hide the popup,
     * continue the run in place) if it was watched successfully; re-enables
     * the button on failure/cancel so the player isn't stuck watching
     * nothing happen.
     */
    private async handleGameOverRespawnVideo(): Promise<void> {
        this.gameHud.setGameOverContinueBusy(true);

        let rewarded = false;


        if (PlatformHandler.ENABLE_VIDEO_ADS) {

            try {
                rewarded = await PlatformHandler.instance.platform.showRewardedVideo('game-over-respawn');
            } catch (e) {
                console.error('IslandViewScene: rewarded video failed', e);
            }
        }

        this.gameHud.setGameOverContinueBusy(false);

        // if (!rewarded) {
        //     return;
        // }

        this.gameHud.hideGameOver();
        this.faceTower.continueRun();
    }

    /**
     * GameHud's onWatchVideoForLevelUp callback — awaits the platform's
     * rewarded-video call and, on success, grants REWARD_VIDEO_BONUS_AMOUNT
     * copies of whichever powerup the level-up already granted (see
     * pendingLevelUpPowerupId), then completes the popup exactly like
     * tapping COLLECT would — hides it and flies that many icons to the
     * belt — instead of leaving it up waiting for a separate collect tap
     * (same "watch video → immediately continue" pattern the game-over
     * popup's own continue button uses). Re-enables the watch button on
     * failure/cancel so the player isn't stuck. No-op if there's no pending
     * level-up (shouldn't happen — the button only exists while the popup
     * is up).
     */
    private async handleLevelUpWatchVideo(): Promise<void> {
        const powerupId = this.pendingLevelUpPowerupId;

        if (!powerupId) {
            return;
        }

        this.gameHud.setLevelUpWatchBusy(true);

        let rewarded = false;

        if (PlatformHandler.ENABLE_VIDEO_ADS) {
            try {
                rewarded = await PlatformHandler.instance.platform.showRewardedVideo('level-powerup-double');
            } catch (e) {
                console.error('IslandViewScene: rewarded video failed', e);
            }
        }


        this.gameHud.setLevelUpWatchBusy(false);

        //if (rewarded) {
        PowerupInventoryStorage.grant(powerupId, REWARD_VIDEO_BONUS_AMOUNT);
        this.pendingLevelUpFlyCount = REWARD_VIDEO_BONUS_AMOUNT;
        this.levelUpVideoWatched = true;

        // Same signal COLLECT dispatches — reuses its existing
        // hide+fly+resume handling below verbatim rather than
        // duplicating it here.
        this.gameHud.onLevelUpCollected.dispatch();
        // } else {
        //     this.gameHud.notifyLevelUpVideoFailed();
        // }
    }

    /**
     * Builds a single reward-fly icon for `powerupId` — same building
     * blocks LevelUpNotification/PowerupBelt each already use for their own
     * icons, deliberately duplicated rather than shared: TowerRewardFlyUtils
     * is meant to stay a drop-in flourish, so each call site (there's only
     * this one today) just hands over whatever icon it wants flown.
     */
    private buildRewardFlyIcon(powerupId: string): PIXI.Container {
        const size = 70;

        if (powerupId === SKIP_PIECE_POWERUP_ID) {
            return PowerupButton.buildSkipIcon(size);
        }

        const powerup = getPowerup(powerupId);

        if (!powerup) {
            return PowerupButton.buildPieceIcon('#ffffff', undefined, size);
        }

        if (powerup.icon) {
            const sprite = PIXI.Sprite.from(powerup.icon);
            sprite.anchor.set(0.5);
            sprite.scale.set(ViewUtils.elementScaler(sprite, size));
            return sprite;
        }

        return PowerupButton.buildPieceIcon(powerup.piece.color, powerup.piece.polygon, size);
    }

    /**
     * Called every time FaceTowerGameController fires onTrapdoorOpened —
     * i.e. every zone, not just full level-ups — kicks off the sky's
     * smooth color transition to whichever step of the independent
     * background cycle the run's GLOBAL zone count now lands on (see
     * TowerIslandProgression.getSkyCycleColor()), and separately resolves
     * the CURRENT level's own island (see resolveIslandForZone()) purely
     * for starfield density bounds, which still progress per level as
     * before. There's no ground/water mesh to swap any more (the tower has
     * no island backdrop).
     */
    private applyZoneIsland(): void {
        const { island } = resolveIslandForZone(
            this.faceTower.getLevelIndex(),
            this.faceTower.getZoneIndexInLevel(),
        );

        const skyColorHex = getSkyCycleColor(this.faceTower.getZoneIndex());

        if (!this.skyController.isBuilt()) {
            this.threeScene.background = null;
            this.skyController.build(this.threeCamera, skyColorHex);
        } else {
            this.skyController.transitionTo(skyColorHex);
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

}
