import { Game } from 'core/Game';
import SoundToggleButton from 'core/ui/SoundToggleButton';
import * as PIXI from 'pixi.js';
import type { Signal } from 'signals';
import Assets from '../../Assets';
import { NextPiecePreview } from '../NextPiecePreview';
import { PieceDefinition } from '../PieceStorage';
import { TowerHeightGauge, HeightMark } from '../TowerHeightGauge';
import { TowerProgressBar2D } from '../TowerProgressBar2D';
import { DEFAULT_FACE_TOWER_CONFIG } from '../FaceTowerConfig';
import { formatHeightRounded, formatSpaceDistance } from '../Tower3DConfig';
import { PowerupBelt } from './PowerupBelt';
import { ZoneNotification } from './notifications/ZoneNotification';
import { LevelUpNotification } from './notifications/LevelUpNotification';
import {
    GameOverPopup,
} from './GameOverPopup';

export class GameHud extends PIXI.Container {
    private soundBtn!: SoundToggleButton;
    private nextPiecePreview!: NextPiecePreview;

    private scoreLabel!: PIXI.Text;

    /** Always-visible "Level N — next: Xm" hint — see updateLevelGoal(). */
    private levelGoalLabel!: PIXI.Text;

    private heightGauge!: TowerHeightGauge;
    private progressBar2D!: TowerProgressBar2D;

    private gameOverPopup!: GameOverPopup;

    /** "Zone X complete!" toast — see showZoneComplete(). */
    private readonly zoneNotification = new ZoneNotification();
    /** The bigger "you leveled up, here's your powerup (+ double via video)" popup — see showLevelUp(). */
    private readonly levelUpNotification: LevelUpNotification;

    /** The row of powerup buttons — owns its own building/layout; GameHud just positions it and mirrors counts/active-state into it. See onUsePowerup below for how a tap reaches the game. */
    private readonly powerupBelt = new PowerupBelt();

    /** Fired when a powerup button is tapped with count > 0 — see IslandViewScene, which listens, checks FaceTowerGameController.canUsePowerup(), spends one from PowerupInventoryStorage, and triggers the actual effect (spawnPowerup()/skipHeldPiece()). Just PowerupBelt's own signal, exposed here so GameHud's own consumers don't need to reach through to a sub-component. */
    public readonly onUsePowerup: Signal = this.powerupBelt.onUsePowerup;

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

        if (DEFAULT_FACE_TOWER_CONFIG.render2D) {
            this.heightGauge = new TowerHeightGauge(this);
        }
        // this.progressBar2D = new TowerProgressBar2D(this);

        //this.showGameOver(10)
    }

    // =========================================================================
    // Public API — called by IslandViewScene
    // =========================================================================

    public showScore(score: number): void {
        this.scoreLabel.text = String(score);
    }

    /** Every zone (not just full level-ups) — see FaceTowerGameEvents.onMilestoneReached. */
    public showZoneComplete(zoneIndex: number): void {
        this.zoneNotification.show(zoneIndex);
    }

    /**
     * Full level-up — shows the bigger popup with the powerup already
     * granted (see IslandViewScene's onLevelProgressed handler, which
     * grants BEFORE calling this) and offers doubling it via a rewarded
     * video. Confetti fires as part of LevelUpNotification.show().
     */
    public showLevelUp(levelIndex: number, powerupId: string): void {
        this.levelUpNotification.show(levelIndex, powerupId);
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
     * Always-visible hint of the level currently being built and (when
     * levels-config.json provides them) which destination this leg of the
     * trip is headed to — see IslandViewScene.update().
     *
     * `useRawHeightValues` (see Tower3DConfig) picks between two looks:
     *  - false (default off — i.e. conversion ON): `progressFraction` (0..1,
     *    how far through the level's own zones) scales `distanceKm` down to
     *    a "current" distance in the SAME unit as the destination's own
     *    distance — "Level 2 → Mars: 118M / 225M km".
     *  - true: the original pre-conversion look — plain climbed meters via
     *    `nextLevelHeightMeters`, destination distance shown alongside but
     *    NOT unified with it — "Level 2 → Mars (225M km) — next: 71.0m".
     *
     * `destination`/`distanceKm` are optional since LevelConfig's own fields
     * are (flavor text, not every level needs them) — falls back to a bare
     * "Level N — next: Xm" without either.
     */
    public updateLevelGoal(
        levelIndex: number,
        isFinalLevel: boolean,
        progressFraction: number,
        destination: string | undefined,
        distanceKm: number | undefined,
        useRawHeightValues: boolean,
        nextLevelHeightMeters: number,
    ): void {
        if (!useRawHeightValues && destination && distanceKm !== undefined) {
            const currentKm = distanceKm * Math.max(0, Math.min(1, progressFraction));

            const progressPart = isFinalLevel
                ? formatSpaceDistance(currentKm)
                : `${formatSpaceDistance(currentKm)} / ${formatSpaceDistance(distanceKm)}`;

            this.levelGoalLabel.text = `Level ${levelIndex + 1} → ${destination}: ${progressPart}`;
            return;
        }

        const heightPart = isFinalLevel
            ? formatHeightRounded(nextLevelHeightMeters)
            : `next: ${formatHeightRounded(nextLevelHeightMeters)}`;

        const destinationPart = destination && distanceKm !== undefined
            ? ` → ${destination} (${formatSpaceDistance(distanceKm)})`
            : '';

        this.levelGoalLabel.text = `Level ${levelIndex + 1}${destinationPart} — ${heightPart}`;
    }

    public showGameOver(score: number): void {
        this.gameOverPopup.showPopup(score);
    }

    public hideGameOver(): void {
        this.gameOverPopup.hidePopup();
    }

    public showNextPiece(piece: PieceDefinition): void {
        this.nextPiecePreview.show(piece);
    }

    public updateHeightGauge(
        currentMark: HeightMark,
        targetMark: HeightMark,
        milestoneMarks: HeightMark[],
        delta: number,
    ): void {
        this.heightGauge?.update(currentMark, targetMark, milestoneMarks, delta);
    }

    public updateProgressBar(progress: number): void {
        this.progressBar2D?.update(progress);
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
        const { topLeft, topRight, bottomLeft, bottomRight } = Game.overlayScreenData;

        this.soundBtn.position.set(
            topRight.x - this.soundBtn.width / 2 - padding,
            topLeft.y + this.soundBtn.height / 2 + padding,
        );

        this.nextPiecePreview.position.set(
            topRight.x - this.nextPiecePreview.width - padding,
            this.soundBtn.y + this.soundBtn.height / 2 + padding,
        );

        this.scoreLabel.position.set(Game.DESIGN_WIDTH * 0.5, 40);
        this.zoneNotification.position.set(Game.DESIGN_WIDTH * 0.5, 100);
        this.levelGoalLabel.position.set(Game.DESIGN_WIDTH * 0.5, topLeft.y + 20);

        this.powerupBelt.position.set(
            (bottomLeft.x + bottomRight.x) * 0.5 - this.powerupBelt.width * 0.5,
            bottomRight.y - this.powerupBelt.height - padding,
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
        this.scoreLabel = new PIXI.Text('0', {
            fill: 0xffffff,
            fontSize: 48,
            fontWeight: 'bold',
            stroke: 0x000000,
            strokeThickness: 4,
        });
        this.scoreLabel.anchor.set(0.5, 0);
        // this.gameplayLayer.addChild(this.scoreLabel);

        this.levelGoalLabel = new PIXI.Text('', Assets.TextStyles.NextLabel);
        this.levelGoalLabel.anchor.set(0.5, 0);
        this.gameplayLayer.addChild(this.levelGoalLabel);
    }
}
