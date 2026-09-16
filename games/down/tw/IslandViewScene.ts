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
import { TowerPieceUnlockStorage } from './TowerPieceUnlockStorage';
import { TowerThemeStorage } from './TowerThemeStorage';
import { GemStorage } from './GemStorage';
import { HighScoreStorage } from '../game/data/HighScoreStorage';
import { PowerupInventoryStorage } from '../game/data/PowerupInventoryStorage';
import { ShopStorage } from '../game/data/ShopStorage';
import {
    formatHexColor,
    getDefaultIsland
} from '../game/world/IslandStorage';
import { DEFAULT_FACE_TOWER_CONFIG } from './FaceTowerConfig';
import { FaceTowerGameController } from './FaceTowerGameController';
import { loadPieces, PIECES, type PieceDefinition } from './PieceStorage';
import { setPieceShapeMode } from './PieceShapeMode';
import { setStaticPieceColor } from './StaticPieceStorage';
import {
    CLEAR_LOW_TIER_POWERUP_ID,
    DESTROY_PIECE_POWERUP_ID,
    POWERUPS,
    SKIP_PIECE_POWERUP_ID,
    TRAPDOOR_POWERUP_ID,
    UPGRADE_PIECE_POWERUP_ID,
    getPowerup,
    getPowerupGemCost,
} from './PowerupStorage';
import { TowerVfxUtils } from './TowerVfxUtils';
import type { PowerupContactPoint } from './PowerupSystem';
import { TowerBaseSync3D } from './TowerBaseSync3D';
import { TowerBlockSync3D } from './TowerBlockSync3D';
import { DEFAULT_TOWER_3D_CONFIG } from './Tower3DConfig';
import { loadTowerDevMeta, saveTowerDevMeta } from './TowerDevMeta';
import { TowerGameOverSiren3D } from './TowerGameOverSiren3D';
import { TowerGameOverHeartbeat } from './TowerGameOverHeartbeat';
import { TowerHeightMarkers3D } from './TowerHeightMarkers3D';
import { TowerSkyController } from './TowerSkyController';
import { TowerCloudBackdropController } from './TowerCloudBackdropController';
import { TowerStarSparkleController } from './TowerStarSparkleController';
import { TowerWallSync3D } from './TowerWallSync3D';
import { GameHud } from './ui/GameHud';
import { PieceTargetingOverlay } from './ui/PieceTargetingOverlay';
import { TowerScorePopupUtils } from './ui/TowerScorePopupUtils';
import { TowerRewardFlyUtils } from './ui/TowerRewardFlyUtils';
import SoundManager from 'core/audio/SoundManager';
import Assets from '../Assets';
import { getGameTheme, isGameThemeId, type GameThemeId, type GameThemeSounds } from './GameThemeStorage';

const FOCUS_POINT = new THREE.Vector3(0, 0, 0);

/** Gems awarded per 100 points of a run's final score — see onGameOver. */
const GEMS_PER_100_SCORE = 10;

/** Gems awarded per level reached, scaled by the level number — level 1 gives GEMS_PER_LEVEL, level 2 gives 2x that, and so on — see onLevelProgressed. */
const GEMS_PER_LEVEL = 10;

/** Max rewarded-video respawns (see handleGameOverRespawnVideo()) allowed per run — see `respawnsUsedThisRun`. Past this, GameOverPopup drops RESPAWN entirely, leaving just CONTINUE. */
const MAX_RESPAWNS_PER_RUN = 2;

export default class IslandViewScene extends ThreeScene {
    // -------------------------------------------------------------------------
    // World / 3D
    // -------------------------------------------------------------------------
    /** Four-corners gradient sky, rotating continuously through SKY_CYCLE_COLORS — built once in build(), never changes color per zone/level. */
    private readonly skyController = new TowerSkyController();
    /** Camera-attached vertical stack of low-alpha cloud sprites, built once in build() alongside the sky. */
    private readonly cloudBackdropController = new TowerCloudBackdropController();
    /** Sparse field of upward-drifting star sprites sitting just in front of the cloud backdrop — built once in build(), driven every frame in update(). */
    private readonly starSparkleController = new TowerStarSparkleController();
    /**
     * Which of GAME_THEMES ('cats'/'dogs' — see HomePopup's level list) is
     * currently active — see handleThemeToggle(). Starts as 'cats' here,
     * the real default for every player; build()'s own initialThemeId
     * resolution at its end applies whatever dev mode last saved instead,
     * when there is one.
     */
    private currentThemeId: GameThemeId = 'cats';

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

    /** True if `activePowerupId`'s activation used a rewarded video instead of spending gems — see useHudPowerup()'s skipCost param. Checked by cancelActivePowerup()/the reset/theme-toggle refund paths so cancelling a video-granted use never hands back gems that were never spent. */
    private activePowerupSkippedCost = false;
    /** Same as activePowerupSkippedCost, for `targetingPowerupId` — see endTargeting(). */
    private targetingPowerupSkippedCost = false;

    /** True while the platform's own gameplayStart()/gameplayStop() thinks a run is "in play" — see onBlockDropped (starts it lazily on the next actual drop) and the onGameOver/onLevelProgressed handlers (stop it the instant either popup shows). Deliberately NOT restarted the instant a popup is dismissed — only the next real drop (i.e. the player actually touching the screen again) flips it back on. */
    private isGameplayActive = false;

    private blockSync3D!: TowerBlockSync3D;
    private baseSync3D!: TowerBaseSync3D;
    private wallSync3D!: TowerWallSync3D;
    private heightMarkers3D!: TowerHeightMarkers3D;
    private gameOverSiren3D!: TowerGameOverSiren3D;
    /** Audio counterpart to gameOverSiren3D — see its own doc. */
    private readonly gameOverHeartbeat = new TowerGameOverHeartbeat();
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

    /**
     * True while the "Use this powerup?" confirm popup is up — see
     * beginPowerupConfirm()/confirmPendingPowerup()/cancelPendingPowerup().
     * Deliberately a SEPARATE flag from `paused`, not a reuse of it: `paused`
     * is specifically "the platform SDK told us to pause" and carries its
     * own side effects (gameBlocker, DomUiRoot.setInputBlocked) plus its own
     * onResume path (_onPlatformResume), which could blindly flip it back to
     * false out from under an open confirm popup if the platform paused/
     * resumed while one was showing. This flag only ever gates
     * fixedUpdate()'s physics/game-logic step (see gameTimeFrozen there) —
     * input is blocked separately, by the popup's own dimmer/interactive
     * card plus faceTower.setInputEnabled(false), same lightweight approach
     * beginTargeting() already uses for its own in-scene modal moment.
     */
    private powerupConfirmOpen = false;
    /** The powerup id awaiting the player's USE/CANCEL choice — see beginPowerupConfirm(). Null whenever powerupConfirmOpen is false. */
    private pendingConfirmPowerupId: string | null = null;

    /** True while HomePopup is up — see openHomePopup()/closeHomePopup(). Same "own flag OR'd into gameTimeFrozen, input blocked via faceTower.setInputEnabled(false)" shape powerupConfirmOpen already uses, for the same reason (can open mid-run, not just at game-over, so it needs its own freeze independent of `paused`). */
    private homePopupOpen = false;

    /** True once the current run has actually ended (see FaceTowerGameEvents.onGameOver) — cleared back to false the moment a fresh run actually starts (restartRun()/handleThemeToggle()). Tells openHomePopup() whether to offer HomePopup's RESTART button — restarting a run that's already over reads as redundant/confusing next to picking a level, which already starts a fresh one. */
    private isGameOver = false;

    /** How many rewarded-video respawns (see handleGameOverRespawnVideo()) the player has already used THIS run — reset back to 0 only when a fresh run actually starts (restartRun()/handleThemeToggle()), never by respawning itself (that continues the same run). Capped at MAX_RESPAWNS_PER_RUN; onGameOver reads this to tell GameOverPopup how many (if any) are left. */
    private respawnsUsedThisRun = 0;

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

        // The background sky is a fixed four-color rotating gradient now
        // (see TowerSkyController/TowerIslandProgression.SKY_CYCLE_COLORS),
        // not driven by level/zone progression — built once, here.
        this.threeScene.background = null;
        this.skyController.build(this.threeCamera);
        await this.cloudBackdropController.build(this.threeCamera);
        await this.starSparkleController.build(this.threeCamera);

        this.threeScene.add(this.threeCamera);

        // Soft sky/ground gradient instead of a flat AmbientLight — gives every
        // piece's shadowed side a gentle cool-toned falloff (the "ground" color)
        // rather than going flat black, which is what was reading as depthless.
        //const ambient = parseHexColor(island.ambientColor);
        //this.threeScene.add(new THREE.HemisphereLight(0xbfd9ff, shadeColor(ambient, -0.35), 1.15));



        const ambientLight = new THREE.HemisphereLight(
            0xffffff,
            0xffffff,
            2.0
        );
        this.threeScene.add(ambientLight)
        SetupThree.renderer.toneMapping = THREE.NoToneMapping;
        //SetupThree.renderer.toneMappingExposure = 1;
        SetupThree.renderer.outputColorSpace = THREE.SRGBColorSpace;



        // Dialed down from 1.6 — combined with the material's clearcoat this
        // was blowing the highlight out to flat white under ACES tonemapping.
        // const key = new THREE.DirectionalLight(0xfff4dd, 1.3);
        // key.position.set(5, 10, 7.5);
        // this.threeScene.add(key);


        const keyLight = new THREE.DirectionalLight(
            0xffffff,
            2.0
        );

        keyLight.position.set(3, 6, 5);

        this.threeScene.add(keyLight);

        const fill = new THREE.DirectionalLight(0x99ccff, 0.55);
        fill.position.set(-8, 3, -5);
        this.threeScene.add(fill);

        // Rim/back light — sits behind the pieces relative to the camera (which
        // looks toward -Z from a +Z position, see positionCamera()), catching
        // the bevel's edge highlight so each piece separates from the ones
        // behind it instead of reading as a flat silhouette. Dialed down from
        // 1.1 for the same blown-out-highlight reason as the key light.
        const rim = new THREE.DirectionalLight(0xcc00aa, 0.6);
        rim.position.set(-2, 6, -9);
        //this.threeScene.add(rim);

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
    }

    public fixedUpdate(delta: number): void {
        delta *= this.speedMultiplier;

        // Skips the actual simulation/game-logic step while paused, while
        // the powerup confirm popup OR the home popup is open, OR while the
        // player is picking a target for a 'target'-type powerup
        // (destroy-piece/upgrade-piece — see beginTargeting()/endTargeting())
        // — otherwise the game-over grace timer (driven inside
        // faceTower.update()) keeps counting down the whole time the
        // HUD/input are hidden/disabled, which could end the run while the
        // player is just looking at a menu, with no way to react. See
        // `paused`'s/`powerupConfirmOpen`'s/`homePopupOpen`'s own docs for
        // why those stay separate flags — but still calls
        // super.fixedUpdate() unconditionally, same "cosmetic stuff keeps
        // running, only the mediator/game-logic step freezes" split
        // MergeScene.update() makes.
        const gameTimeFrozen = this.paused || this.powerupConfirmOpen || this.targetingPowerupId !== null || this.homePopupOpen;

        if (!gameTimeFrozen) {
            Physics.fixedUpdate(delta);
        }
        super.fixedUpdate(delta);
        if (!gameTimeFrozen) {
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
        this.starSparkleController.update(delta);

        const towerOffsetY = this.faceTower?.getCameraOffsetY() ?? 0;

        this.gameHud?.layout();

        if (this.targetingPowerupId !== null && this.faceTower) {
            this.targetingOverlay.layout();
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

        if (this.targetingPowerupId !== null && this.faceTower) {
            // Real 3D projection now that the camera's fully settled for
            // this frame (positionCamera()/applyCameraShake() already ran
            // above) — see PieceTargetingOverlay's own doc for why the old
            // flat "physics x,y + pan offset" shortcut isn't accurate enough
            // for this (it drifted further from the actual rendered piece
            // the closer a piece sat to the edge of the play column).
            this.targetingOverlay.update(
                this.faceTower.getBlocks(),
                DEFAULT_FACE_TOWER_CONFIG.blockWidth,
                DEFAULT_FACE_TOWER_CONFIG.blockHeight,
                this.faceTower.getHeldBlock()?.id,
                (block) => {
                    const worldPos = TowerVfxUtils.blockToWorld(block);
                    const screen = this.worldToScreen(worldPos);

                    if (!screen) {
                        return null;
                    }

                    // Raw CSS-pixel -> the overlay's own local space — same
                    // conversion EntityIndicatorManager.toOverlayLocal() uses
                    // for its name tags/boost bars, just resolved directly
                    // against targetingOverlay (nested a couple containers
                    // deeper than game.overlayContainer) instead of that.
                    const local = this.targetingOverlay.toLocal(
                        new PIXI.Point(screen.x, screen.y),
                        this.game.app.stage,
                    );

                    return { x: local.x, y: local.y };
                },
                (block) => this.targetingPowerupId !== UPGRADE_PIECE_POWERUP_ID || this.faceTower.canUpgradeBlock(block),
            );
        }

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

            this.gameOverHeartbeat.update(
                gameOverWarningSecondsRemaining,
                DEFAULT_FACE_TOWER_CONFIG.gameOverGraceDuration,
                delta,
            );

            this.gameHud?.updateGameOverCountdown(gameOverWarningSecondsRemaining);

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

        // Each slot shows its own gem cost against the current balance now
        // (see PowerupStorage.getPowerupGemCost()/PowerupButton.updateCost())
        // rather than an owned inventory count.
        const gemBalance = GemStorage.get();
        this.gameHud?.updatePowerupCosts(gemBalance);
        this.gameHud?.updateGems(gemBalance);

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
        // Don't blindly re-enable input if the powerup confirm popup is
        // still up — it disabled input deliberately (see
        // beginPowerupConfirm()) and owns re-enabling it on its own
        // USE/CANCEL choice (see closePowerupConfirm()); a platform
        // pause/resume firing in between shouldn't short-circuit that.
        if (!this.powerupConfirmOpen) {
            this.faceTower?.setInputEnabled(true);
        }
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
        this.cloudBackdropController.destroy();
        this.starSparkleController.destroy();
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
                // GameOverPopup's own button (on-screen label "Continue" —
                // see its own doc for why it's still internally named
                // onReplay) no longer restarts directly — it opens the home
                // menu instead, same place a mid-run tap on HomeButton
                // lands, so RESTART/a level pick both go through one place.
                this.gameHud.hideGameOver();
                this.openHomePopup();
            },
        );

        TowerScorePopupUtils.build(this.hudContainer, () => this.gameHud.getScoreLabelScreenPosition());
        TowerScorePopupUtils.onPop = () => SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Grab);
        TowerRewardFlyUtils.build(this.hudContainer);
        TowerRewardFlyUtils.onArrive = () => SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Invincible);

        this.hudContainer.addChild(this.targetingOverlay);
        this.targetingOverlay.onTargetChosen.add((blockId: number) => this.resolveTargetingChoice(blockId), this);
        this.targetingOverlay.onCancel.add(() => this.endTargeting(true), this);

        this.gameHud.onUsePowerup.add((powerupId: string) => this.beginPowerupConfirm(powerupId), this);
        this.gameHud.onConfirmPowerup.add(() => this.confirmPendingPowerup(), this);
        this.gameHud.onCancelPowerup.add(() => this.cancelPendingPowerup(), this);
        this.gameHud.onWatchVideoForPowerup.add(() => void this.handlePowerupWatchVideo(), this);
        this.gameHud.onShapeModeToggle.add((themeId: GameThemeId) => this.handleThemeToggle(themeId), this);
        this.gameHud.onLevelUpCollected.add(() => {
            void PlatformHandler.instance.platform.showCommercialBreak();
            this.faceTower.resumeAfterLevelUpNotification();
        }, this);

        this.gameHud.onHomeTapped.add(() => this.openHomePopup(), this);
        this.gameHud.onHomeClose.add(() => this.closeHomePopup(), this);
        this.gameHud.onHomeRestart.add(() => {
            this.closeHomePopup();
            this.restartRun();
        }, this);
        this.gameHud.onHomeSelectLevel.add((themeId: GameThemeId) => {
            this.closeHomePopup();
            this.gameHud.setThemeId(themeId);
            this.handleThemeToggle(themeId);
            void PlatformHandler.instance.platform.showCommercialBreak();
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
                    // Same physical floor-drop sound the trapdoor POWERUP
                    // plays (see applyInstantPowerup()) — a real gate
                    // opening for a new level is the exact same floor
                    // mechanic, so it gets the same sound, layered under
                    // GateOpen's own celebratory sting rather than replacing it.
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.PowerupTrapdoor);
                },

                onGateProgressRevealed: (requirement) => {
                    const piece = this.faceTower?.getPieceProgression()[requirement.tier];

                    if (piece) {
                        this.gameHud.showGateRequirement(requirement, piece);
                    }
                },

                onLevelProgressed: (levelIndex) => {
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.GateOpen);

                    // Plain milestone celebration now — no powerup grant
                    // (powerups are gem-purchased, see useHudPowerup()).
                    // Gems scale with the level reached: level 1 → 10,
                    // level 2 → 20, and so on (levelIndex is 0-based).
                    const gemsEarned = (levelIndex + 1) * GEMS_PER_LEVEL;
                    GemStorage.add(gemsEarned);
                    this.gameHud.showLevelUp(levelIndex, gemsEarned);

                    // The popup is now up — gameplay is paused until the
                    // player collects and drops the next piece (see
                    // onBlockDropped, which flips this back on lazily).
                    this.isGameplayActive = false;
                    void PlatformHandler.instance.platform.gameplayStop();
                },

                onGameOver: (score, topWorldY) => {
                    this.isGameOver = true;

                    // Height itself is no longer shown on the game-over
                    // screen (see GameOverPopup — score/best-score only
                    // now), but the record is still tracked here in case
                    // something else (a future leaderboard column, etc.)
                    // ever wants it.
                    const heightMeters = (DEFAULT_FACE_TOWER_CONFIG.floorY - topWorldY) / DEFAULT_TOWER_3D_CONFIG.pixelsPerUnit;
                    TowerHighScoreStorage.recordHeight(heightMeters);

                    // Checked BEFORE recording — recordPoints() below
                    // immediately bumps the cache to match, so
                    // isNewPointsHigh() (which compares against the
                    // run-START baseline) would always read false afterward.
                    const isNewScoreHigh = TowerHighScoreStorage.isNewPointsHigh(score);
                    TowerHighScoreStorage.recordPoints(score);

                    // Gems fully replace the old "end game grants a
                    // powerup" reward — a flat rate off the run's final
                    // score instead of a random inventory grant.
                    const gemsEarned = Math.floor(score / 100) * GEMS_PER_100_SCORE;
                    if (gemsEarned > 0) {
                        GemStorage.add(gemsEarned);
                    }

                    this.gameHud.showGameOver({
                        score,
                        bestScoreText: String(TowerHighScoreStorage.getPoints()),
                        isNewScoreHigh,
                        gemsEarned,
                        respawnsRemaining: Math.max(0, MAX_RESPAWNS_PER_RUN - this.respawnsUsedThisRun),
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
                     * real — its cost is spent for good (already deducted
                     * back in useHudPowerup()), so there's nothing left to
                     * cancel back to. Clear the tracking WITHOUT refunding.
                     */
                    if (block.powerup && this.activePowerupId !== null) {
                        this.activePowerupId = null;
                        this.preActivationPiece = null;
                        this.activePowerupSkippedCost = false;
                        this.gameHud.setActivePowerup(null);
                    }
                },

                onBlockFirstHit: (block, contactPoint, hitBlock) => {
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Impact);
                    this.playThemeSound('hit');
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
                    this.playThemeSound('merge');

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

                // One beat per piece the 'clear-low-tier' powerup actually
                // removes — see FaceTowerGameController.triggerClearLowTierPowerup()'s
                // own doc for the staggered (not all-at-once) timing this
                // fires on.
                onLowTierPieceRemoved: (x, y) => {
                    TowerVfxUtils.onDiscardLowTierVfx(x, y);
                    SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.PowerupDiscard);
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
        this.setupDataDevGui();

        this.pieceDevGui = new PieceDevGui(PIECES, this.faceTower, this);
        this.pieceDevGui.setup();

        this.powerupDevGui = new PowerupDevGui(POWERUPS, this.faceTower);
        this.powerupDevGui.setup();

        // Everything handleThemeToggle() needs (gameHud/faceTower/
        // baseSync3D) is finally up by this point. Priority: (1) dev mode's
        // own last-picked theme (see handleThemeToggle's saveTowerDevMeta
        // call) — a dev testing a specific level shouldn't get bounced back
        // to whatever a real player last saved; (2) TowerThemeStorage — the
        // real player's own last-played level, persisted across sessions
        // (see handleThemeToggle's TowerThemeStorage.save call); (3) 'cats',
        // the fresh-install default.
        const devSavedThemeId = Game.debugParams.dev ? loadTowerDevMeta()?.themeId : undefined;
        const initialThemeId: GameThemeId = isGameThemeId(devSavedThemeId)
            ? devSavedThemeId
            : TowerThemeStorage.get() ?? 'cats';

        this.gameHud.setThemeId(initialThemeId);
        this.handleThemeToggle(initialThemeId);
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

    private setupDataDevGui(): void {
        const gui = DevGuiManager.instance;

        gui.addButton('Clear Data', () => void this.clearAllData(), 'Data');
    }

    /**
     * Wipes every persisted storage (both down's base mode and tower's own)
     * back to a fresh install and reloads — dev-only, see
     * setupDataDevGui(). GemStorage.load() re-grants its fresh-install gem
     * bonus once TOWER_GEMS comes back empty on the reload, same as a
     * genuinely first-ever boot.
     */
    private async clearAllData(): Promise<void> {
        await Promise.all([
            ShopStorage.clearAll(),
            HighScoreStorage.clearAll(),
            TowerHighScoreStorage.clearAll(),
            TowerPieceUnlockStorage.clearAll(),
            PowerupInventoryStorage.clearAll(),
            GemStorage.clearAll(),
            TowerThemeStorage.clearAll(),
        ]);

        window.location.reload();
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
     * GameHud's onUsePowerup callback (tapping a powerup button) — opens the
     * "Use this powerup?" confirm popup instead of applying the effect right
     * away; see confirmPendingPowerup()/cancelPendingPowerup()/
     * handlePowerupWatchVideo() for what happens on the player's actual
     * choice, and useHudPowerup()'s own doc for what each choice actually
     * DOES once it runs. Freezes game time for as long as the popup is up —
     * see powerupConfirmOpen's own doc / fixedUpdate().
     *
     * Tapping the SAME powerup that's already active/mid-targeting is a
     * CANCEL gesture, not a new use (this is exactly what useHudPowerup()
     * itself already detects and handles via cancelActivePowerup()/
     * endTargeting()) — that must stay instant, with no confirmation, so
     * it's special-cased here before ever opening the popup.
     *
     * Fires on every tap regardless of any past inventory — `canAfford`
     * picks which popup mode shows: USE when the player can afford this
     * powerup's own gem cost (see PowerupStorage.getPowerupGemCost()),
     * WATCH VIDEO otherwise (see PowerupConfirmPopup's own doc).
     */
    private beginPowerupConfirm(powerupId: string): void {
        if (this.powerupConfirmOpen) {
            return;
        }

        if (powerupId === this.activePowerupId || powerupId === this.targetingPowerupId) {
            this.useHudPowerup(powerupId);
            return;
        }

        // Same guard useHudPowerup() itself enforces on every path — skip
        // opening a popup that would just silently no-op on confirm anyway
        // (matches today's "nothing happens" outcome for a stale tap).
        if (!this.faceTower.canUsePowerup()) {
            return;
        }

        // Board-state precondition — separate from canUsePowerup() above
        // (which only checks WHEN a powerup can be spent, not whether this
        // ONE would actually do anything) — see canUsePowerupRightNow()'s
        // own doc. Shown even for a zero-count tap: watching a video to
        // grant one would be pointless too if there's nothing for it to act
        // on.
        if (!this.canUsePowerupRightNow(powerupId)) {
            this.gameHud.showPowerupUnavailable("Can't use this powerup right now");
            return;
        }

        this.pendingConfirmPowerupId = powerupId;
        this.powerupConfirmOpen = true;
        this.faceTower.setInputEnabled(false);

        const cost = getPowerupGemCost(powerupId);
        this.gameHud.showPowerupConfirm(powerupId, GemStorage.get() >= cost, cost);
    }

    /**
     * True unless `powerupId` would have nothing to actually act on right
     * now — checked BEFORE opening the confirm popup (see
     * beginPowerupConfirm()), so the player gets a clear "can't use this"
     * toast instead of a popup that would just silently no-op (or, worse,
     * spend a WATCH VIDEO grant on a powerup with no effect) once confirmed:
     *  - trapdoor: needs at least one piece actually on the board — see
     *    FaceTowerGameController.hasAnyBlocks(). Dropping the floor under
     *    nothing does nothing.
     *  - clear-low-tier: needs at least one tier-0/1/2 piece to clear — see
     *    hasLowTierBlocks().
     *  - destroy-piece/upgrade-piece: needs at least one targetable piece —
     *    same hasAnyBlocks() check as trapdoor, since targeting mode would
     *    otherwise open with nothing to tap.
     *  - anything else (skip-piece): no board-state precondition.
     */
    private canUsePowerupRightNow(powerupId: string): boolean {
        if (powerupId === TRAPDOOR_POWERUP_ID) {
            return this.faceTower.hasAnyBlocks();
        }

        if (powerupId === CLEAR_LOW_TIER_POWERUP_ID) {
            return this.faceTower.hasLowTierBlocks();
        }

        if (powerupId === DESTROY_PIECE_POWERUP_ID || powerupId === UPGRADE_PIECE_POWERUP_ID) {
            return this.faceTower.hasAnyBlocks();
        }

        return true;
    }

    /** Popup's USE button — closes the popup FIRST (so useHudPowerup()'s own input-enabling, e.g. beginTargeting()'s setInputEnabled(false), is what actually sticks), then runs the real effect through the unchanged useHudPowerup() path — canUsePowerup()/inventory are re-checked there at confirm-time, not tap-time, in case anything changed while the popup was open. */
    private confirmPendingPowerup(): void {
        const powerupId = this.pendingConfirmPowerupId;
        this.closePowerupConfirm();

        if (powerupId === null) {
            return;
        }

        this.useHudPowerup(powerupId);

        // See suppressGameOverBriefly()'s own doc — a bomb/trapdoor/discard
        // just used may have disturbed the pile; give it a moment to settle
        // before the game-over grace timer can start counting again.
        this.faceTower.suppressGameOverBriefly(1);
    }

    /** Popup's CANCEL button — nothing was ever spent (useHudPowerup() never ran), so this just closes the popup. */
    private cancelPendingPowerup(): void {
        this.pendingConfirmPowerupId = null;
        this.closePowerupConfirm();
    }

    /**
     * Popup's WATCH VIDEO button (shown instead of USE when the player
     * can't afford this powerup's gem cost — see beginPowerupConfirm()) — awaits
     * the platform's rewarded-video call, then closes the popup and runs
     * the SAME useHudPowerup() path USE would have, but with `skipCost`
     * true so the watched video stands in for the gem payment instead of
     * spending it too. Bails out if the popup was cancelled (or reopened
     * for a different powerup) while the video request was in flight —
     * nothing to use in that case.
     */
    private async handlePowerupWatchVideo(): Promise<void> {
        const powerupId = this.pendingConfirmPowerupId;

        if (powerupId === null) {
            return;
        }

        this.gameHud.setPowerupConfirmVideoBusy(true);

        let rewarded = false;

        if (PlatformHandler.ENABLE_VIDEO_ADS) {
            try {
                rewarded = await PlatformHandler.instance.platform.showRewardedVideo('powerup-grant');
            } catch (e) {
                console.error('IslandViewScene: rewarded video failed', e);
            }
        }

        this.gameHud.setPowerupConfirmVideoBusy(false);

        if (this.pendingConfirmPowerupId !== powerupId) {
            return;
        }

        this.closePowerupConfirm();
        this.useHudPowerup(powerupId, true);
        this.faceTower.suppressGameOverBriefly(1);
    }

    /**
     * GameHud's onUsePowerup callback — branches on the tapped powerup's
     * own PowerupActivationType (see PowerupStorage):
     *  - skip-piece: instant one-shot, no "held" state — pay the cost, swap
     *    the held piece for the next, done. Not a real PowerupDefinition,
     *    so it's checked before even looking one up.
     *  - 'instant' (trapdoor/clear-low-tier): pay the cost, apply the
     *    effect to the live board right away — see applyInstantPowerup().
     *  - 'target' (destroy-piece/upgrade-piece): pay the cost, enter
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
     * can't take effect right now never spends the player's gems for
     * nothing — 'instant'/'target' don't touch the held piece at all, but
     * still only make sense mid-run, not e.g. while a level-up popup has
     * play frozen. Called from beginPowerupConfirm() (a cancel-gesture tap)
     * or from confirmPendingPowerup()/handlePowerupWatchVideo() (the
     * player's actual USE/WATCH VIDEO choice) — never directly from GameHud
     * any more.
     */

    private closePowerupConfirm(): void {
        this.powerupConfirmOpen = false;
        this.faceTower.setInputEnabled(true);
        this.gameHud.hidePowerupConfirm();
    }

    /** `skipCost` is true only from handlePowerupWatchVideo() — a watched video stands in for `powerupId`'s own gem cost (see PowerupStorage.getPowerupGemCost()) instead of spending gems too. */
    private useHudPowerup(powerupId: string, skipCost: boolean = false): void {
        const cost = getPowerupGemCost(powerupId);

        if (powerupId === SKIP_PIECE_POWERUP_ID) {
            if (!this.faceTower.canUsePowerup() || (!skipCost && !GemStorage.spend(cost))) {
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
            if (!this.faceTower.canUsePowerup() || (!skipCost && !GemStorage.spend(cost))) {
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

            if (this.targetingPowerupId !== null || !this.faceTower.canUsePowerup()) {
                return;
            }

            if (!skipCost && !GemStorage.spend(cost)) {
                return;
            }

            this.targetingPowerupSkippedCost = skipCost;
            this.beginTargeting(powerupId);
            return;
        }

        if (this.activePowerupId !== null) {
            this.cancelActivePowerup();
            return;
        }

        if (!this.faceTower.canUsePowerup()) {
            return;
        }

        if (!skipCost && !GemStorage.spend(cost)) {
            return;
        }

        this.activePowerupSkippedCost = skipCost;
        this.preActivationPiece = this.faceTower.getHeldBlock()?.piece ?? null;
        this.activePowerupId = powerupId;
        this.gameHud.setActivePowerup(powerupId);

        this.faceTower.spawnPowerup(powerupId);
    }

    /**
     * 'instant'-type powerups apply immediately, no held piece or targeting
     * involved — see PowerupStorage.PowerupActivationType. clear-low-tier's
     * own VFX/SFX (TowerVfxUtils.onDiscardLowTierVfx()/PowerupDiscard) don't
     * fire here — triggerClearLowTierPowerup() only QUEUES the removals now
     * (staggered over time, see its own doc), so those play per-removal off
     * the onLowTierPieceRemoved event instead (see buildFaceTowerLayer()'s
     * event wiring).
     */
    private applyInstantPowerup(powerupId: string): void {
        if (powerupId === TRAPDOOR_POWERUP_ID) {
            this.faceTower.triggerTrapdoorPowerup();
            SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.PowerupTrapdoor);
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
            SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.PowerupDestroy);
        } else if (powerupId === UPGRADE_PIECE_POWERUP_ID) {
            this.faceTower.upgradeBlock(blockId);
            SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.PowerupUpgrade);
        } else {
            return;
        }

        // Same reasoning as confirmPendingPowerup()'s own call — the pile
        // may still be resettling right as game time resumes (see
        // fixedUpdate()'s gameTimeFrozen), so give it a moment before the
        // game-over grace timer can start counting against the player again.
        this.faceTower.suppressGameOverBriefly(1);
    }

    /** Exits targeting mode, restoring the HUD/input — `refund` is true only for an explicit cancel (the close button, or tapping the same powerup again), never for an actual chosen-target resolution, which already spent it for real. */
    private endTargeting(refund: boolean): void {
        if (this.targetingPowerupId === null) {
            return;
        }

        if (refund) {
            this.refundTargetingPowerupGems();
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

        this.refundActivePowerupGems();

        if (this.preActivationPiece) {
            this.faceTower.replaceHeldBlockWithPiece(this.preActivationPiece);
        }

        this.activePowerupId = null;
        this.preActivationPiece = null;
        this.gameHud.setActivePowerup(null);
    }

    /** Refunds activePowerupId's own gem cost unless it was activated for free via a rewarded video (see useHudPowerup()'s skipCost/activePowerupSkippedCost) — a cancelled video-granted use must never hand back gems that were never spent. Always clears the flag. Call only while activePowerupId is still set (every call site checks this first). */
    private refundActivePowerupGems(): void {
        if (!this.activePowerupSkippedCost && this.activePowerupId !== null) {
            GemStorage.add(getPowerupGemCost(this.activePowerupId));
        }

        this.activePowerupSkippedCost = false;
    }

    /** Same as refundActivePowerupGems(), for the currently-targeting powerup — see targetingPowerupSkippedCost. */
    private refundTargetingPowerupGems(): void {
        if (!this.targetingPowerupSkippedCost && this.targetingPowerupId !== null) {
            GemStorage.add(getPowerupGemCost(this.targetingPowerupId));
        }

        this.targetingPowerupSkippedCost = false;
    }

    /**
     * Swaps to a different GAME_THEMES entry — reloads PIECES from its own
     * catalog (see PieceStorage.loadPieces()), applies PieceShapeMode's
     * existing polygon-clear toggle for the square look (only 'cube' sets
     * that; 'cats' keeps its own authored circle polygons, same as
     * 'circle'), rebuilds the sky/cloud/particle backdrop from the theme's
     * own colors/images, and swaps the wall/trapdoor fallback colors — then
     * starts a fresh run under all of it, same "clear the 3D base meshes,
     * reset the game controller" sequence restartRun() uses, so the board
     * never ends up with pieces/backdrop from two different themes mixed
     * together. Refunds an in-flight powerup the same defensive way
     * restartRun() does, in case one happened to be active the instant the
     * theme was switched. Called both by HomePopup's level rows (a real
     * player picking a level) and the dev-only ShapeModeToggleButton.
     */
    private handleThemeToggle(themeId: GameThemeId): void {
        const theme = getGameTheme(themeId);
        this.currentThemeId = themeId;
        TowerThemeStorage.save(themeId);
        this.isGameOver = false;
        this.respawnsUsedThisRun = 0;

        this.gameHud.hideGameOver();

        if (Game.debugParams.dev) {
            saveTowerDevMeta({ themeId });
        }

        loadPieces(theme.piecesBundle);
        setPieceShapeMode(theme.forceSquare ? 'cube' : 'circle');

        // BlockBodyTextureCache rasterizes a block's 2D body shape once per
        // piece.id and reuses it forever after (see its own doc) — every
        // GAME_THEMES catalog reuses the SAME ids for its tier ladder (e.g.
        // "circle-tier0"), so without this, switching catalogs would keep
        // showing whatever shape got cached for that id under the PREVIOUS
        // theme instead of the new catalog's own polygon.
        this.faceTower.invalidateBlockTexture();

        DEFAULT_TOWER_3D_CONFIG.poleColor = theme.wallColor;
        DEFAULT_TOWER_3D_CONFIG.baseColor = theme.trapdoorColor;

        // Tower3DConfig.poleColor/baseColor above are only a FALLBACK for an
        // unconfigured static-piece role (see that config's own doc) — every
        // role in static-pieces-config.json currently IS configured, so
        // without this, TowerWallSync3D/TowerBaseSync3D would always keep
        // using that static piece's own hardcoded `color` and the theme's
        // wall/trapdoor color would never actually show.
        setStaticPieceColor('column', formatHexColor(theme.wallColor));
        setStaticPieceColor('base', formatHexColor(theme.trapdoorColor));
        setStaticPieceColor('milestone', formatHexColor(theme.trapdoorColor));

        this.skyController.build(this.threeCamera, theme.skyColors);

        // NOT awaited — cloud/particle textures load over the network and
        // can take a moment (or fail, e.g. a 404 hitting a theme's art
        // before the asset pipeline had actually produced its .webp yet).
        // Gating the board reset below behind that load was the actual bug
        // reported here: the sky/wall/trapdoor colors above (all synchronous)
        // would already read as the new theme while the piece catalog swap
        // that PieceProgressionBar/GateProgressPanel need — only delivered by
        // reset() below — sat waiting on a slow image fetch, so the UI kept
        // showing the PREVIOUS theme's icons in the meantime. The backdrop
        // now just updates itself whenever its own load finishes, decoupled
        // from everything else here.
        this.cloudBackdropController.build(this.threeCamera, theme.cloudImages, theme.cloudsAlpha, theme.cloudsLayout)
            .catch((err) => console.error('IslandViewScene: theme cloud backdrop failed to build', err));
        this.starSparkleController.build(this.threeCamera, theme.particles.images, theme.particles.tint)
            .catch((err) => console.error('IslandViewScene: theme particles failed to build', err));

        this.baseSync3D.clear();
        this.faceTower.reset();
        TowerHighScoreStorage.markRunStart();

        if (this.activePowerupId !== null) {
            this.refundActivePowerupGems();
            this.activePowerupId = null;
            this.preActivationPiece = null;
            this.gameHud.setActivePowerup(null);
        }

        this.endTargeting(true);
    }

    /**
     * HomePopup's RESTART button — resets the CURRENT run in place (same
     * theme as `currentThemeId`), same board-clear/refund/commercial-break
     * sequence the old direct-replay flow used before RESTART moved into
     * HomePopup (see GameOverPopup's own doc). Unlike handleThemeToggle(),
     * this never touches the piece catalog/backdrop — nothing about the
     * theme changed, so there's nothing to reload.
     */
    private restartRun(): void {
        this.gameHud.hideGameOver();
        this.isGameOver = false;
        this.respawnsUsedThisRun = 0;
        this.baseSync3D.clear();
        this.faceTower.reset();
        TowerHighScoreStorage.markRunStart();

        if (this.activePowerupId !== null) {
            this.refundActivePowerupGems();
            this.activePowerupId = null;
            this.preActivationPiece = null;
            this.gameHud.setActivePowerup(null);
        }

        this.endTargeting(true);

        void PlatformHandler.instance.platform.showCommercialBreak();
    }

    /**
     * Opens HomePopup — from HomeButton (mid-run) or GameOverPopup's
     * CONTINUE button (see the replayCallback passed into GameHud's
     * constructor). No-op while another modal (the powerup confirm popup,
     * targeting mode, or the home popup itself) is already up, same guard
     * beginPowerupConfirm() applies to itself. RESTART only makes sense
     * while a run is actually still going — see `isGameOver`'s own doc.
     */
    private openHomePopup(): void {
        if (this.homePopupOpen || this.powerupConfirmOpen || this.targetingPowerupId !== null) {
            return;
        }

        this.homePopupOpen = true;
        this.faceTower.setInputEnabled(false);
        this.gameHud.showHomePopup(!this.isGameOver);
    }

    /** Closes HomePopup — see HomePopup's onRestart/onSelectLevel/onClose listeners, all of which call this first. */
    private closeHomePopup(): void {
        this.homePopupOpen = false;
        this.gameHud.hideHomePopup();

        if (!this.powerupConfirmOpen) {
            this.faceTower.setInputEnabled(true);
        }
    }

    /**
     * Plays the CURRENT theme's extra `sounds.merge`/`sounds.hit` (see
     * GameThemeStorage.GameThemeSounds) if one is configured — layered ON
     * TOP of whatever normally plays for that moment (onMerge/
     * onBlockFirstHit below), never replacing it. No-op (as it does for
     * every theme today) when the theme doesn't set one.
     */
    private playThemeSound(kind: keyof GameThemeSounds): void {
        const sound = getGameTheme(this.currentThemeId).sounds?.[kind];

        if (sound) {
            SoundManager.instance.tryToPlaySound(sound);
        }
    }

    /**
     * GameHud's game-over "RESPAWN" callback — awaits the platform's
     * rewarded-video call and only actually respawns (hide the popup,
     * continue the run in place) if it was watched successfully; re-enables
     * the button on failure/cancel so the player isn't stuck watching
     * nothing happen. Capped at MAX_RESPAWNS_PER_RUN — GameOverPopup already
     * hides RESPAWN once exhausted (see onGameOver's respawnsRemaining), so
     * this is just a defensive no-op if it somehow still fires.
     */
    private async handleGameOverRespawnVideo(): Promise<void> {
        if (this.respawnsUsedThisRun >= MAX_RESPAWNS_PER_RUN) {
            return;
        }

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

        this.respawnsUsedThisRun++;
        this.gameHud.hideGameOver();
        this.faceTower.continueRun();
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
