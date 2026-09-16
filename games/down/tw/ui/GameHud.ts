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
import type { GameThemeId } from '../GameThemeStorage';
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
import { GemCounter } from './GemCounter';
import { HomeButton } from './HomeButton';
import { HomePopup } from './HomePopup';

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
    /** The bigger "Level Up!" milestone celebration — see showLevelUp(). No reward attached any more — powerups are gem-purchased (see IslandViewScene.useHudPowerup). */
    private readonly levelUpNotification: LevelUpNotification;

    /** The 4-slot top powerup row (2 left, 2 right) — owns its own building/layout; GameHud just positions it and mirrors counts/active-state into it. See onUsePowerup below for how a tap reaches the game. Replaces the old bottom-right PowerupBelt (removed — see this file's git history if it's ever needed again; PowerupBelt.ts itself is untouched). */
    private readonly topPowerupSlots = new TopPowerupSlots();

    /** Bottom-center "which pieces have I unlocked so far" strip — see updatePieceProgression(). Sits at the very bottom; gateProgressPanel stacks directly above it. */
    private readonly pieceProgressionBar = new PieceProgressionBar();
    /** "Current gate requirement" box — stacked above pieceProgressionBar. Replaces the old TowerNextLevelPanel (hidden, not deleted — see this file's own PowerupBelt precedent). See showGateRequirement()/playGateUnlockCelebration(). */
    private readonly gateProgressPanel = new GateProgressPanel();

    /** Top-left "how many gems do I have" pill — see updateGems(). Gems are earned from big merges and a run's final score, spent on powerups (see IslandViewScene). Sits just right of homeButton — see layout(). */
    private readonly gemCounter = new GemCounter();

    /** Top-left "open the home menu" button — see onHomeTapped/showHomePopup(). */
    private readonly homeButton = new HomeButton();
    /** "Restart" / "choose your level" modal — see showHomePopup()/hideHomePopup(). Added as a direct child of `this` (not gameplayLayer), same as gameOverPopup/powerupConfirmPopup, so it stays visible/interactive regardless of gameplayLayer's own visibility. */
    private readonly homePopup = new HomePopup(Game.DESIGN_WIDTH, Game.DESIGN_HEIGHT);
    /** Fired when homeButton is tapped — see IslandViewScene.openHomePopup(). Just homeButton's own signal, exposed the same way onUsePowerup is. */
    public readonly onHomeTapped: Signal = this.homeButton.onTap;
    /** Fired when HomePopup's RESTART is tapped — see IslandViewScene, which resets the current run in place (same theme). */
    public readonly onHomeRestart: Signal = this.homePopup.onRestart;
    /** Fired with the tapped level's GameThemeId — see IslandViewScene.handleThemeToggle(), which applies the new theme/catalog and resets the run for a fresh start. */
    public readonly onHomeSelectLevel: Signal = this.homePopup.onSelectLevel;
    /** Fired when HomePopup is dismissed without picking anything (dimmer tap or the close mark). */
    public readonly onHomeClose: Signal = this.homePopup.onClose;

    /** Big centered "N seconds left" warning — see updateGameOverCountdown(). */
    private readonly gameOverCountdown = new GameOverCountdown();

    /** Fired when a powerup button is tapped with count > 0 — see IslandViewScene, which listens and opens the USE/CANCEL confirm popup (see onConfirmPowerup/onCancelPowerup below) rather than applying the effect straight away. Just topPowerupSlots' own signal, exposed here so GameHud's own consumers don't need to reach through to a sub-component. */
    public readonly onUsePowerup: Signal = this.topPowerupSlots.onUsePowerup;
    /** Fired when the powerup confirm popup's USE is tapped — see IslandViewScene.confirmPendingPowerup(), which is where FaceTowerGameController.canUsePowerup()/GemStorage.spend()/the actual effect all still happen (re-checked at confirm-time, not tap-time). Just powerupConfirmPopup's own signal. */
    public readonly onConfirmPowerup: Signal = this.powerupConfirmPopup.onConfirm;
    /** Fired when the powerup confirm popup's CANCEL is tapped (or dismissed without spending anything). */
    public readonly onCancelPowerup: Signal = this.powerupConfirmPopup.onCancel;
    /** Fired when the powerup confirm popup's WATCH VIDEO is tapped (shown instead of USE when the player can't afford the gem cost) — see IslandViewScene.handlePowerupWatchVideo(). */
    public readonly onWatchVideoForPowerup: Signal = this.powerupConfirmPopup.onWatchVideo;

    /** Top-left "Circles / Cubes / Cats" experimental theme toggle — see GameThemeStorage. */
    private readonly shapeModeToggle = new ShapeModeToggleButton();
    /** Fired with the newly-selected GameThemeId — see IslandViewScene.handleThemeToggle(), which applies the theme's catalog/shape/backdrop/colors and resets the run for a clean switch. Just ShapeModeToggleButton's own signal, exposed the same way onUsePowerup is. */
    public readonly onShapeModeToggle: Signal = this.shapeModeToggle.onToggle;

    /** Syncs the toggle button's label to `themeId` without dispatching onShapeModeToggle — see IslandViewScene restoring a saved TowerDevMeta.themeId at boot. */
    public setThemeId(themeId: GameThemeId): void {
        this.shapeModeToggle.setThemeId(themeId);
    }

    /** Fired when the level-up popup's "CLAIM" is tapped — see IslandViewScene, which resumes the game (FaceTowerGameController.resumeAfterLevelUpNotification()) since the board deliberately sits frozen until this fires. */
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
        this.gameplayLayer.addChild(this.homeButton);
        this.gameplayLayer.addChild(this.gemCounter);
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
        this.onLevelUpCollected = this.levelUpNotification.onCollect;
        // Dismissing is purely visual on this side — the powerup was
        // already granted the instant the level-up happened, and resuming
        // play (spawning the next piece) is IslandViewScene's job, done via
        // its own onLevelUpCollected listener (see FaceTowerGameController.
        // resumeAfterLevelUpNotification()) — this listener only hides it.
        this.levelUpNotification.onCollect.add(() => this.levelUpNotification.hide());
        this.addChild(this.levelUpNotification);

        // Added LAST — must draw on top of everything else, including
        // gameOverPopup, since GameOverPopup's CONTINUE button opens this
        // right on top of itself (fading one out while this fades in, see
        // IslandViewScene's replayCallback).
        this.addChild(this.homePopup);

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

    /** "Level Up!" milestone celebration with the gems just earned (see IslandViewScene's onLevelProgressed) — no powerup reward, see LevelUpNotification's own doc. Confetti fires as part of LevelUpNotification.show(). */
    public showLevelUp(levelIndex: number, gemsEarned: number): void {
        this.levelUpNotification.show(levelIndex, gemsEarned);
    }

    /** Call every frame (or whenever it might have changed) — see GemCounter.update(). */
    public updateGems(amount: number): void {
        this.gemCounter.update(amount);
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

    /** Shows the "Use this powerup?" confirm popup for `powerupId` — see IslandViewScene.beginPowerupConfirm(). `canAfford` picks USE vs WATCH VIDEO, `cost` labels the USE button — see PowerupConfirmPopup's own doc. */
    public showPowerupConfirm(powerupId: string, canAfford: boolean, cost: number): void {
        this.powerupConfirmPopup.showPopup(powerupId, canAfford, cost);
    }

    /** Hides the powerup confirm popup — call on USE, CANCEL, or after a watch-video grant, see IslandViewScene.confirmPendingPowerup()/cancelPendingPowerup()/handlePowerupWatchVideo(). */
    public hidePowerupConfirm(): void {
        this.powerupConfirmPopup.hidePopup();
    }

    /** Call while awaiting the platform's rewarded-video promise for the powerup confirm popup's WATCH VIDEO button. */
    public setPowerupConfirmVideoBusy(busy: boolean): void {
        this.powerupConfirmPopup.setVideoBusy(busy);
    }

    /** Shows the home menu — `canRestart` hides RESTART when the run has already ended, see IslandViewScene.openHomePopup(). */
    public showHomePopup(canRestart: boolean): void {
        this.homePopup.showPopup(canRestart);
    }

    /** Hides the home menu — call on RESTART, a level pick, or an explicit close, see IslandViewScene.closeHomePopup(). */
    public hideHomePopup(): void {
        this.homePopup.hidePopup();
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

    /** Call every frame (or whenever the gem balance might have changed) — see TopPowerupSlots.updateCosts(). */
    public updatePowerupCosts(gemBalance: number): void {
        this.topPowerupSlots.updateCosts(gemBalance);
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
        // HomeButton's own layout) — no width/height offset needed to
        // flush it into the corner, unlike the center-anchored widgets
        // above.
        this.homeButton.position.set(
            topLeft.x + padding,
            topLeft.y + padding,
        );

        // Shifted right of homeButton (same gap convention as
        // topPowerupSlots' own BUTTON_GAP) rather than sharing its corner.
        this.gemCounter.position.set(
            this.homeButton.x + HomeButton.SIZE + padding * 0.75,
            topLeft.y + padding,
        );

        // Same top-left corner as homeButton — only visibly stacks with it
        // in dev mode (shapeModeToggle is hidden in production, see the
        // constructor), so this nudges below rather than overlapping.
        this.shapeModeToggle.position.set(
            topLeft.x + padding,
            topLeft.y + padding + (this.shapeModeToggle.visible ? Math.max(HomeButton.SIZE, this.gemCounter.height) + 8 : 0),
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
        this.homePopup.layout();
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
        this.homeButton.destroy();
        this.homePopup.destroy();

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
