import { Game } from 'core/Game';
import SoundToggleButton from 'core/ui/SoundToggleButton';
import * as PIXI from 'pixi.js';
import type { Signal } from 'signals';
import { NextPiecePreview } from '../NextPiecePreview';
import { PieceDefinition } from '../PieceStorage';
import type { GateRequirement } from '../TowerGateController';
import { TowerHeightGauge, HeightMark } from '../TowerHeightGauge';
import { TowerProgressBar2D } from '../TowerProgressBar2D';
import { DEFAULT_FACE_TOWER_CONFIG } from '../FaceTowerConfig';
import { GameOverCountdown } from './GameOverCountdown';
import { GateProgressPanel } from './GateProgressPanel';
import { PieceProgressionBar } from './PieceProgressionBar';
import { ShapeModeToggleButton } from './ShapeModeToggleButton';
import { TopPowerupSlots } from './TopPowerupSlots';
import { TowerHeader } from './TowerHeader';
import { TowerScorePanel } from './TowerScorePanel';
import { ZoneNotification } from './notifications/ZoneNotification';
import { LevelUpNotification } from './notifications/LevelUpNotification';
import {
    GameOverPopup,
    type GameOverData,
} from './GameOverPopup';
import { PowerupConfirmPopup } from './PowerupConfirmPopup';
import { PowerupUnavailableToast } from './PowerupUnavailableToast';

export class GameHud extends PIXI.Container {
    private soundBtn!: SoundToggleButton;
    private nextPiecePreview!: NextPiecePreview;

    /** Always-visible score bubble, left of towerHeader — see showScore()/getScoreLabelScreenPosition(). */
    private readonly scorePanel = new TowerScorePanel();

    /** Always-visible "Level N" bubble — see updateLevelGoal(). */
    private readonly towerHeader = new TowerHeader();

    private heightGauge!: TowerHeightGauge;
    private progressBar2D!: TowerProgressBar2D;

    private gameOverPopup!: GameOverPopup;

    /**
     * "Use this powerup?" confirmation — see showPowerupConfirm()/
     * onConfirmPowerup/onCancelPowerup. Unlike gameOverPopup (constructed in
     * the constructor body since it needs continueCallback/replayCallback),
     * this needs no constructor args of its own, so it's a plain field
     * initializer — same convention as topPowerupSlots below — which also
     * means it already exists by the time onConfirmPowerup/onCancelPowerup's
     * own field initializers run (class fields initialize in declaration
     * order, top to bottom, before the constructor body).
     */
    private readonly powerupConfirmPopup = new PowerupConfirmPopup(Game.DESIGN_WIDTH, Game.DESIGN_HEIGHT);

    /** "Zone X complete!" toast — see showZoneComplete(). */
    private readonly zoneNotification = new ZoneNotification();
    /** "Can't use this powerup right now" toast — see showPowerupUnavailable(). */
    private readonly powerupUnavailableToast = new PowerupUnavailableToast();
    /** The bigger "you leveled up, here's your powerup (+ double via video)" popup — see showLevelUp(). */
    private readonly levelUpNotification: LevelUpNotification;

    /** The 4-slot top powerup row (2 left, 2 right) — owns its own building/layout; GameHud just positions it and mirrors counts/active-state into it. See onUsePowerup below for how a tap reaches the game. Replaces the old bottom-right PowerupBelt (removed — see this file's git history if it's ever needed again; PowerupBelt.ts itself is untouched). */
    private readonly topPowerupSlots = new TopPowerupSlots();

    /** Bottom-center "which pieces have I unlocked so far" strip — see updatePieceProgression(). Sits at the very bottom; gateProgressPanel stacks directly above it. */
    private readonly pieceProgressionBar = new PieceProgressionBar();
    /** "Current gate requirement" box — stacked above pieceProgressionBar. Replaces the old TowerNextLevelPanel (hidden, not deleted — see this file's own PowerupBelt precedent). See showGateRequirement()/playGateUnlockCelebration(). */
    private readonly gateProgressPanel = new GateProgressPanel();

    /** Big centered "N seconds left" warning — see updateGameOverCountdown(). */
    private readonly gameOverCountdown = new GameOverCountdown();

    /** Fired when a powerup button is tapped with count > 0 — see IslandViewScene, which listens and opens the USE/CANCEL confirm popup (see onConfirmPowerup/onCancelPowerup below) rather than applying the effect straight away. Just topPowerupSlots' own signal, exposed here so GameHud's own consumers don't need to reach through to a sub-component. */
    public readonly onUsePowerup: Signal = this.topPowerupSlots.onUsePowerup;
    /** Fired when the powerup confirm popup's USE is tapped — see IslandViewScene.confirmPendingPowerup(), which is where FaceTowerGameController.canUsePowerup()/PowerupInventoryStorage.consume()/the actual effect all still happen (re-checked at confirm-time, not tap-time). Just powerupConfirmPopup's own signal. */
    public readonly onConfirmPowerup: Signal = this.powerupConfirmPopup.onConfirm;
    /** Fired when the powerup confirm popup's CANCEL is tapped (or dismissed without spending anything). */
    public readonly onCancelPowerup: Signal = this.powerupConfirmPopup.onCancel;
    /** Fired when the powerup confirm popup's WATCH VIDEO is tapped (shown instead of USE when the player owns zero of that powerup) — see IslandViewScene.handlePowerupWatchVideo(). */
    public readonly onWatchVideoForPowerup: Signal = this.powerupConfirmPopup.onWatchVideo;

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
        this.gameplayLayer.addChild(this.topPowerupSlots);
        this.gameplayLayer.addChild(this.zoneNotification);
        this.gameplayLayer.addChild(this.powerupUnavailableToast);
        // Dev-only — see ShapeModeToggleButton's own doc ("experimental").
        this.shapeModeToggle.visible = Game.debugParams.dev;
        this.gameplayLayer.addChild(this.shapeModeToggle);
        this.gameplayLayer.addChild(this.pieceProgressionBar);
        this.gameplayLayer.addChild(this.gateProgressPanel);
        this.gameplayLayer.addChild(this.gameOverCountdown);

        // The level number itself is retired from the HUD — see
        // showScore()'s own "points + best, centered" replacement. Left
        // constructed (rather than removed outright) since updateLevelGoal()
        // still calls .update() on it.
        this.towerHeader.visible = false;

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
        // Sits above gameOverPopup too — a powerup can never be used once
        // the game is actually over, but this keeps the stacking order
        // unambiguous either way.
        this.addChild(this.powerupConfirmPopup);

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

    /** See IslandViewScene.canUsePowerupRightNow() — shown instead of opening the confirm popup when a powerup would have nothing to actually act on. */
    public showPowerupUnavailable(message: string): void {
        this.powerupUnavailableToast.show(message);
    }

    /** Global (stage-space) position of the level-up popup's currently-shown powerup icon — see TowerRewardFlyUtils/IslandViewScene's onLevelUpCollected handler. */
    public getLevelUpIconGlobalPosition(): { x: number; y: number } {
        return this.levelUpNotification.getIconGlobalPosition();
    }

    /** Global (stage-space) position of `id`'s top-slot button — null if it's not one of the assigned slots. See TowerRewardFlyUtils. */
    public getPowerupBeltButtonPosition(id: string): { x: number; y: number } | null {
        return this.topPowerupSlots.getButtonGlobalPosition(id);
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
     * Feeds the (invisible, but still tracked — see the constructor)
     * towerHeader with the level currently being built. Used to also feed
     * TowerNextLevelPanel's board-weight progress bar — that panel is
     * hidden now (see gateProgressPanel), since weight no longer gates
     * anything; board weight itself is still tracked elsewhere (
     * FaceTowerGameController.getWeightProgress(), consumed by
     * updateProgressBar()/the starfield) and is unaffected by this.
     */
    public updateLevelGoal(levelIndex: number): void {
        this.towerHeader.update(levelIndex);
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

    /** Shows the "Use this powerup?" confirm popup for `powerupId` — see IslandViewScene.beginPowerupConfirm(). `hasCount` picks USE vs WATCH VIDEO — see PowerupConfirmPopup's own doc. */
    public showPowerupConfirm(powerupId: string, hasCount: boolean): void {
        this.powerupConfirmPopup.showPopup(powerupId, hasCount);
    }

    /** Hides the powerup confirm popup — call on USE, CANCEL, or after a watch-video grant, see IslandViewScene.confirmPendingPowerup()/cancelPendingPowerup()/handlePowerupWatchVideo(). */
    public hidePowerupConfirm(): void {
        this.powerupConfirmPopup.hidePopup();
    }

    /** Call while awaiting the platform's rewarded-video promise for the powerup confirm popup's WATCH VIDEO button. */
    public setPowerupConfirmVideoBusy(busy: boolean): void {
        this.powerupConfirmPopup.setVideoBusy(busy);
    }

    public showNextPiece(piece: PieceDefinition): void {
        this.nextPiecePreview.show(piece);
    }

    /**
     * Hides/shows every always-visible gameplay widget at once (score,
     * next-piece, powerup slots, piece-progression strip, etc.) — see
     * IslandViewScene's target-powerup targeting mode (PieceTargetingOverlay),
     * which hides the whole HUD while the player picks a piece to
     * destroy/upgrade. Doesn't touch gameOverPopup/levelUpNotification —
     * those are separate modal layers, not part of gameplayLayer.
     */
    public setHudVisible(visible: boolean): void {
        this.gameplayLayer.visible = visible;
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

    /** `secondsRemaining` — see FaceTowerGameController.getGameOverWarningSecondsRemaining(); undefined hides the countdown entirely. */
    public updateGameOverCountdown(secondsRemaining: number | undefined): void {
        this.gameOverCountdown.update(secondsRemaining);
    }

    public updateProgressBar(progress: number): void {
        this.progressBar2D?.update(progress);
    }

    /** Call every frame — see PieceProgressionBar.update(), which no-ops unless something actually changed. */
    public updatePieceProgression(pieces: readonly PieceDefinition[], maxTierReached: number): void {
        this.pieceProgressionBar.update(pieces, maxTierReached);
    }

    /** Shows `requirement`'s piece + closed lock — see FaceTowerGameEvents.onGateProgressRevealed, which fires at run start and again every time a gate opens (after its settle delay). */
    public showGateRequirement(requirement: GateRequirement, piece: PieceDefinition): void {
        this.gateProgressPanel.showRequirement(requirement, piece);
    }

    /** Plays the "gate just opened" pop-away/lock-opening beat — see FaceTowerGameEvents.onTrapdoorOpened. */
    public playGateUnlockCelebration(): void {
        this.gateProgressPanel.celebrateUnlock();
    }

    /** Call every frame (or whenever it might have changed) — see TopPowerupSlots.updateCounts(). */
    public updatePowerupCounts(counts: Readonly<Record<string, number>>): void {
        this.topPowerupSlots.updateCounts(counts);
    }

    /** Highlights whichever button matches `activeId` (null clears every highlight) — see IslandViewScene's activePowerupId toggle/cancel/switch logic. */
    public setActivePowerup(activeId: string | null): void {
        this.topPowerupSlots.setActive(activeId);
    }

    public layout(): void {
        const padding = 20;
        const { topLeft, topRight, bottomRight } = Game.overlayScreenData;

        this.soundBtn.position.set(
            topRight.x - this.soundBtn.width / 2 - padding,
            topLeft.y + this.soundBtn.height / 2 + padding,
        );

        // Horizontal now (label beside the icon, not above it — see
        // NextPiecePreview's own redesign), sitting just to the mute
        // button's left at the same vertical center, instead of below it.
        this.nextPiecePreview.position.set(
            this.soundBtn.x - this.soundBtn.width / 2 - padding - this.nextPiecePreview.width,
            this.soundBtn.y - this.nextPiecePreview.height / 2,
        );

        this.zoneNotification.position.set(Game.DESIGN_WIDTH * 0.5, Game.DESIGN_HEIGHT / 2 - 50);
        // Same anchor as zoneNotification — the two never show at once (one's a
        // trapdoor-opened celebration, the other a powerup-tap rejection).
        this.powerupUnavailableToast.position.set(Game.DESIGN_WIDTH * 0.5, Game.DESIGN_HEIGHT / 2 - 50);
        // Just below the fixed game-over line — see FaceTowerConfig.
        // gameOverLineScreenY — so the countdown reads as tied to that line
        // rather than floating arbitrarily.
        this.gameOverCountdown.position.set(
            Game.DESIGN_WIDTH * 0.5,
            topLeft.y + DEFAULT_FACE_TOWER_CONFIG.gameOverLineScreenY + 70,
        );
        this.towerHeader.position.set(Game.DESIGN_WIDTH * 0.5, topLeft.y + 40);
        // Centered now that towerHeader (the level number) is hidden —
        // used to sit to its left instead. Nudged down a bit from 40 — also
        // gives the trophy badge straddling its top edge (see
        // TowerScorePanel) a little more room before the actual screen edge.
        this.scorePanel.position.set(Game.DESIGN_WIDTH * 0.5, topLeft.y + 60);

        // + topLeft.y — same pattern soundBtn/scorePanel/shapeModeToggle
        // all already use for their own Y — so this tracks the ACTUAL
        // visible top edge exactly like everything else does. Passing the
        // raw config value alone (the previous bug) meant this stayed put
        // on any resize that shifted the safe area vertically while every
        // other top element moved together, drifting the two apart.
        this.topPowerupSlots.layout(
            topLeft.x + padding,
            topRight.x - padding,
            topLeft.y + DEFAULT_FACE_TOWER_CONFIG.powerupSlotsScreenY,
        );

        // Its own local origin is already its top-left corner (see
        // ShapeModeToggleButton's own layout) — no width/height offset
        // needed to flush it into the corner, unlike the center-anchored
        // widgets above.
        this.shapeModeToggle.position.set(
            topLeft.x + padding,
            topLeft.y + padding,
        );

        // Bottom-center stack: pieceProgressionBar sits at the very bottom
        // (same anchor TowerNextLevelPanel used to occupy), gateProgressPanel
        // directly above it — both center-anchored horizontally.
        const bottomStackGap = 8;

        this.pieceProgressionBar.position.set(
            Game.DESIGN_WIDTH * 0.5,
            bottomRight.y - padding - this.pieceProgressionBar.height / 2,
        );

        // Last-resort safety net: PieceProgressionBar's own constants are
        // sized to already fit every catalog slot within Game.DESIGN_WIDTH
        // (see its own doc), but a narrower-than-usual safe area (an
        // unusually tall/narrow aspect ratio) could still leave it wider
        // than what's actually visible — uniformly scaling it down (never
        // up, so it never drifts LARGER than its own designed size) keeps
        // it from ever running off the sides. Measured against the bar's
        // own unscaled width (getNaturalWidth()), not `.width` (which would
        // already reflect any scale a previous layout() call applied,
        // compounding the shrink further every frame instead of settling).
        const barMaxWidth = (topRight.x - topLeft.x) - padding * 2;
        const barScale = Math.min(1, barMaxWidth / this.pieceProgressionBar.getNaturalWidth());
        this.pieceProgressionBar.scale.set(barScale);

        // Small/fixed-size content (one piece icon + a lock, occasionally a
        // "+"), so unlike PieceProgressionBar this doesn't need its own
        // scale-to-fit safety net.
        this.gateProgressPanel.position.set(
            Game.DESIGN_WIDTH * 0.5,
            this.pieceProgressionBar.y - this.pieceProgressionBar.height / 2 - bottomStackGap - this.gateProgressPanel.height / 2,
        );

        // Popups handle their own internal layout
        this.gameOverPopup.layout();
        this.levelUpNotification.layout();
        this.powerupConfirmPopup.layout();
    }

    public override destroy(
        options?: boolean | PIXI.IDestroyOptions,
    ): void {
        this.heightGauge?.destroy();
        this.progressBar2D?.destroy();
        this.zoneNotification.destroy();
        this.powerupUnavailableToast.destroy();
        this.levelUpNotification.destroy();
        this.topPowerupSlots.destroy();
        this.shapeModeToggle.destroy();
        this.pieceProgressionBar.destroy();
        this.gateProgressPanel.destroy();
        this.gameOverCountdown.destroy();
        this.powerupConfirmPopup.destroy();

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
    }
}
