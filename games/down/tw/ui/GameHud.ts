import { Game } from 'core/Game';
import SoundToggleButton from 'core/ui/SoundToggleButton';
import * as PIXI from 'pixi.js';
import type { Signal } from 'signals';
import { NextPiecePreview } from '../NextPiecePreview';
import { PieceDefinition } from '../PieceStorage';
import { TowerHeightGauge, HeightMark } from '../TowerHeightGauge';
import { TowerProgressBar2D } from '../TowerProgressBar2D';
import { DEFAULT_FACE_TOWER_CONFIG } from '../FaceTowerConfig';
import { PieceProgressionBar } from './PieceProgressionBar';
import { PowerupBelt } from './PowerupBelt';
import { ShapeModeToggleButton } from './ShapeModeToggleButton';
import { TowerHeader } from './TowerHeader';
import { TowerNextLevelPanel } from './TowerNextLevelPanel';
import { TowerScorePanel } from './TowerScorePanel';
import { ZoneNotification } from './notifications/ZoneNotification';
import { LevelUpNotification } from './notifications/LevelUpNotification';
import {
    GameOverPopup,
    type GameOverData,
} from './GameOverPopup';

export class GameHud extends PIXI.Container {
    private soundBtn!: SoundToggleButton;
    private nextPiecePreview!: NextPiecePreview;

    /** Always-visible score bubble, left of towerHeader — see showScore()/getScoreLabelScreenPosition(). */
    private readonly scorePanel = new TowerScorePanel();

    /** Always-visible "Level N" bubble — see updateLevelGoal(). */
    private readonly towerHeader = new TowerHeader();
    /** Separate "current/target next-level height" progress bar — own container so it can be positioned independently of towerHeader. See updateLevelGoal(). */
    private readonly nextLevelPanel = new TowerNextLevelPanel();

    private heightGauge!: TowerHeightGauge;
    private progressBar2D!: TowerProgressBar2D;

    private gameOverPopup!: GameOverPopup;

    /** "Zone X complete!" toast — see showZoneComplete(). */
    private readonly zoneNotification = new ZoneNotification();
    /** The bigger "you leveled up, here's your powerup (+ double via video)" popup — see showLevelUp(). */
    private readonly levelUpNotification: LevelUpNotification;

    /** The row of powerup buttons — owns its own building/layout; GameHud just positions it and mirrors counts/active-state into it. See onUsePowerup below for how a tap reaches the game. */
    private readonly powerupBelt = new PowerupBelt();

    /** Bottom-center "which pieces have I unlocked so far" strip — see updatePieceProgression(). */
    private readonly pieceProgressionBar = new PieceProgressionBar();

    /** Fired when a powerup button is tapped with count > 0 — see IslandViewScene, which listens, checks FaceTowerGameController.canUsePowerup(), spends one from PowerupInventoryStorage, and triggers the actual effect (spawnPowerup()/skipHeldPiece()). Just PowerupBelt's own signal, exposed here so GameHud's own consumers don't need to reach through to a sub-component. */
    public readonly onUsePowerup: Signal = this.powerupBelt.onUsePowerup;

    /** Top-left "Circles / Cubes" experimental toggle — see PieceShapeMode. */
    private readonly shapeModeToggle = new ShapeModeToggleButton();
    /** Fired with the newly-selected mode ('circle' | 'cube') — see IslandViewScene, which calls setPieceShapeMode() and resets the run for a clean switch. Just ShapeModeToggleButton's own signal, exposed the same way onUsePowerup is. */
    public readonly onShapeModeToggle: Signal = this.shapeModeToggle.onToggle;

    /** Fired when the level-up popup's "WATCH AD: x2" is tapped — see IslandViewScene, which awaits the platform's rewarded-video call and reports back via notifyLevelUpDoubled()/notifyLevelUpVideoFailed(). Just LevelUpNotification's own signal, exposed the same way onUsePowerup is. */
    public readonly onWatchVideoForLevelUp: Signal;
    /** Fired when the level-up popup's "COLLECT" is tapped — see IslandViewScene, which resumes the game (FaceTowerGameController.resumeAfterLevelUpNotification()) since the board deliberately sits frozen until this fires. */
    public readonly onLevelUpCollected: Signal;

    /** Always-visible gameplay widgets. */
    private readonly gameplayLayer: PIXI.Container = new PIXI.Container();

    constructor(
        continueCallback: () => void,
        replayCallback: () => void,
    ) {
        super();

        this.addChild(this.gameplayLayer);

        this.buildStaticLabels();
        this.buildSoundAndPreview();
        this.gameplayLayer.addChild(this.powerupBelt);
        this.gameplayLayer.addChild(this.zoneNotification);
        this.gameplayLayer.addChild(this.shapeModeToggle);
        this.gameplayLayer.addChild(this.pieceProgressionBar);

        this.gameOverPopup = new GameOverPopup(
            Game.DESIGN_WIDTH, Game.DESIGN_HEIGHT
        );


        this.gameOverPopup.onContinue.add(() => {
            continueCallback?.()
        })

        this.gameOverPopup.onReplay.add(() => {
            replayCallback?.()
        })
        // Popup sits on top of everything else in the HUD
        this.addChild(this.gameOverPopup);

        this.levelUpNotification = new LevelUpNotification(Game.DESIGN_WIDTH, Game.DESIGN_HEIGHT);
        this.onWatchVideoForLevelUp = this.levelUpNotification.onWatchVideo;
        this.onLevelUpCollected = this.levelUpNotification.onCollect;
        // Dismissing is purely visual on this side — the powerup was
        // already granted the instant the level-up happened, and resuming
        // play (spawning the next piece) is IslandViewScene's job, done via
        // its own onLevelUpCollected listener (see FaceTowerGameController.
        // resumeAfterLevelUpNotification()) — this listener only hides it.
        this.levelUpNotification.onCollect.add(() => this.levelUpNotification.hide());
        this.addChild(this.levelUpNotification);

        // The climbed-height/km meter gauge is retired — the game no longer
        // needs it (the siren band + countdown label are the only game-over
        // warning now). Left unbuilt rather than deleted wholesale: every
        // call site already reaches it through `?.` (updateHeightGauge()/
        // destroy()), so leaving heightGauge undefined is a clean no-op.
        // this.progressBar2D = new TowerProgressBar2D(this);

        //this.showGameOver(10)
    }

    // =========================================================================
    // Public API — called by IslandViewScene
    // =========================================================================

    /** `bestScore` — see TowerScorePanel.update()'s own doc. */
    public showScore(score: number, bestScore: number): void {
        this.scorePanel.update(score, bestScore);
    }

    /** This container's own local coordinates (same design-space frame the score-popup flying numbers already fly in — see TowerScorePopupUtils/IslandViewScene) — where the score panel currently sits, for the popup's numbers to fly toward. */
    public getScoreLabelScreenPosition(): { x: number; y: number } {
        return { x: this.scorePanel.x, y: this.scorePanel.y };
    }

    /** Every zone (not just full level-ups) — see FaceTowerGameEvents.onTrapdoorOpened. */
    public showZoneComplete(zoneIndex: number): void {
        this.zoneNotification.show(zoneIndex);
    }

    /** Global (stage-space) position of the level-up popup's currently-shown powerup icon — see TowerRewardFlyUtils/IslandViewScene's onLevelUpCollected handler. */
    public getLevelUpIconGlobalPosition(): { x: number; y: number } {
        return this.levelUpNotification.getIconGlobalPosition();
    }

    /** Global (stage-space) position of `id`'s belt button — null if it's currently disabled/not built. See TowerRewardFlyUtils. */
    public getPowerupBeltButtonPosition(id: string): { x: number; y: number } | null {
        return this.powerupBelt.getButtonGlobalPosition(id);
    }

    /**
     * Full level-up — shows the bigger popup with the powerup already
     * granted (see IslandViewScene's onLevelProgressed handler, which
     * grants BEFORE calling this) and offers doubling it via a rewarded
     * video. Confetti fires as part of LevelUpNotification.show().
     */
    public showLevelUp(levelIndex: number, powerupId: string, videoBonusAmount: number): void {
        this.levelUpNotification.show(levelIndex, powerupId, videoBonusAmount);
    }

    /** Call while awaiting the platform's rewarded-video promise — disables the watch button so a slow ad load can't be double-tapped. */
    public setLevelUpWatchBusy(busy: boolean): void {
        this.levelUpNotification.setWatchBusy(busy);
    }

    /** Call once the rewarded video actually completed — bumps the popup to the x2 reward state. */
    public notifyLevelUpDoubled(): void {
        this.levelUpNotification.showDoubled();
    }

    /** Call if the video was cancelled/failed to load — re-enables the watch button so the player can try again. */
    public notifyLevelUpVideoFailed(): void {
        this.levelUpNotification.reenableWatch();
    }

    /**
     * Always-visible hint of the level currently being built, plus the
     * current-vs-target BOARD WEIGHT progress toward the next trapdoor
     * milestone (see FaceTowerGameController.getTotalWeight/getTargetWeight/
     * getWeightProgress) — see IslandViewScene.update().
     */
    public updateLevelGoal(
        levelIndex: number,
        currentWeight: number,
        targetWeight: number,
        weightFraction: number,
    ): void {
        this.towerHeader.update(levelIndex);
        this.nextLevelPanel.update(currentWeight, targetWeight, weightFraction);
    }

    public showGameOver(data: GameOverData): void {
        this.gameOverPopup.showPopup(data);
    }

    public hideGameOver(): void {
        this.gameOverPopup.hidePopup();
    }

    /** Call while awaiting the platform's rewarded-video promise for the game-over RESPAWN button. */
    public setGameOverContinueBusy(busy: boolean): void {
        this.gameOverPopup.setContinueBusy(busy);
    }

    public showNextPiece(piece: PieceDefinition): void {
        this.nextPiecePreview.show(piece);
    }

    public updateHeightGauge(
        currentMark: HeightMark,
        gameOverLineScreenY: number,
        milestoneMarks: HeightMark[],
        delta: number,
        gameOverWarningSecondsRemaining?: number,
    ): void {
        this.heightGauge?.update(currentMark, gameOverLineScreenY, milestoneMarks, delta, gameOverWarningSecondsRemaining);
    }

    public updateProgressBar(progress: number): void {
        this.progressBar2D?.update(progress);
    }

    /** Call every frame — see PieceProgressionBar.update(), which no-ops unless something actually changed. */
    public updatePieceProgression(pieces: readonly PieceDefinition[], maxTierReached: number): void {
        this.pieceProgressionBar.update(pieces, maxTierReached);
    }

    /** Call every frame (or whenever it might have changed) — see PowerupBelt.updateCounts(). */
    public updatePowerupCounts(counts: Readonly<Record<string, number>>): void {
        this.powerupBelt.updateCounts(counts);
    }

    /** Highlights whichever button matches `activeId` (null clears every highlight) — see IslandViewScene's activePowerupId toggle/cancel/switch logic. */
    public setActivePowerup(activeId: string | null): void {
        this.powerupBelt.setActive(activeId);
    }

    public layout(): void {
        const padding = 20;
        const { topLeft, topRight, bottomRight } = Game.overlayScreenData;

        this.soundBtn.position.set(
            topRight.x - this.soundBtn.width / 2 - padding,
            topLeft.y + this.soundBtn.height / 2 + padding,
        );

        this.nextPiecePreview.position.set(
            topRight.x - this.nextPiecePreview.width - padding,
            this.soundBtn.y + this.soundBtn.height / 2 + padding,
        );

        this.zoneNotification.position.set(Game.DESIGN_WIDTH * 0.5, Game.DESIGN_HEIGHT / 2 - 50);
        this.towerHeader.position.set(Game.DESIGN_WIDTH * 0.5, topLeft.y + 40);
        this.nextLevelPanel.position.set(Game.DESIGN_WIDTH * 0.5 + this.towerHeader.width + 10, topLeft.y + 40);
        this.scorePanel.position.set(Game.DESIGN_WIDTH * 0.5 - this.towerHeader.width - 10, topLeft.y + 40);

        this.powerupBelt.position.set(
            bottomRight.x - this.powerupBelt.width - padding,
            bottomRight.y - this.powerupBelt.height - padding,
        );

        // Its own local origin is already its top-left corner (see
        // ShapeModeToggleButton's own layout) — no width/height offset
        // needed to flush it into the corner, unlike the center-anchored
        // widgets above.
        this.shapeModeToggle.position.set(
            topLeft.x + padding,
            topLeft.y + padding,
        );

        // Its own local origin is already its own center (every slot is
        // built symmetric around (0, 0) — see PieceProgressionBar's own
        // constructor), so just centering horizontally and flushing its
        // bottom edge against the screen's bottom edge is enough.
        this.pieceProgressionBar.position.set(
            Game.DESIGN_WIDTH * 0.5,
            bottomRight.y - this.pieceProgressionBar.height / 2 - padding,
        );

        // Popups handle their own internal layout
        this.gameOverPopup.layout();
        this.levelUpNotification.layout();
    }

    public override destroy(
        options?: boolean | PIXI.IDestroyOptions,
    ): void {
        this.heightGauge?.destroy();
        this.progressBar2D?.destroy();
        this.zoneNotification.destroy();
        this.levelUpNotification.destroy();
        this.powerupBelt.destroy();
        this.shapeModeToggle.destroy();
        this.nextLevelPanel.destroy();
        this.pieceProgressionBar.destroy();

        super.destroy(options ?? { children: true });
    }

    // =========================================================================
    // Private — builders
    // =========================================================================

    private buildSoundAndPreview(): void {
        this.nextPiecePreview = new NextPiecePreview();

        this.soundBtn = new SoundToggleButton(
            'PictoIcon_Music_1',
            'PictoIcon_Music_1_Off',
        );
        this.soundBtn.scale.set(0.7);

        this.gameplayLayer.addChild(this.soundBtn);
        this.gameplayLayer.addChild(this.nextPiecePreview);
    }

    private buildStaticLabels(): void {
        this.gameplayLayer.addChild(this.scorePanel);
        this.gameplayLayer.addChild(this.towerHeader);
        this.gameplayLayer.addChild(this.nextLevelPanel);
    }
}
