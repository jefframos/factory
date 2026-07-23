import { Game } from 'core/Game';
import SoundToggleButton from 'core/ui/SoundToggleButton';
import * as PIXI from 'pixi.js';
import { NextPiecePreview } from '../NextPiecePreview';
import { PieceDefinition } from '../PieceStorage';
import { TowerHeightGauge, HeightMark } from '../TowerHeightGauge';
import { TowerProgressBar2D } from '../TowerProgressBar2D';
import { DEFAULT_FACE_TOWER_CONFIG } from '../FaceTowerConfig';
import {
    GameOverPopup,
} from './GameOverPopup';

export class GameHud extends PIXI.Container {
    private soundBtn!: SoundToggleButton;
    private nextPiecePreview!: NextPiecePreview;

    private scoreLabel!: PIXI.Text;
    private milestoneLabel!: PIXI.Text;
    private milestoneTimer: ReturnType<typeof setTimeout> | null = null;

    private heightGauge!: TowerHeightGauge;
    private progressBar2D!: TowerProgressBar2D;

    private gameOverPopup!: GameOverPopup;

    /** Always-visible gameplay widgets. */
    private readonly gameplayLayer: PIXI.Container = new PIXI.Container();

    constructor(continueCallback: () => void, replayCallback: () => void) {
        super();

        this.addChild(this.gameplayLayer);

        this.buildStaticLabels();
        this.buildSoundAndPreview();

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

    public showMilestone(zoneIndex: number): void {
        this.milestoneLabel.text = `Zone ${zoneIndex} complete!`;
        this.milestoneLabel.alpha = 1;

        if (this.milestoneTimer !== null) clearTimeout(this.milestoneTimer);

        this.milestoneTimer = setTimeout(() => {
            this.milestoneLabel.alpha = 0;
            this.milestoneTimer = null;
        }, 1200);
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

    public layout(): void {
        const padding = 20;
        const { topLeft, topRight } = Game.overlayScreenData;

        this.soundBtn.position.set(
            topRight.x - this.soundBtn.width / 2 - padding,
            topLeft.y + this.soundBtn.height / 2 + padding,
        );

        this.nextPiecePreview.position.set(
            topRight.x - this.nextPiecePreview.width - padding,
            this.soundBtn.y + this.soundBtn.height / 2 + padding,
        );

        this.scoreLabel.position.set(Game.DESIGN_WIDTH * 0.5, 40);
        this.milestoneLabel.position.set(Game.DESIGN_WIDTH * 0.5, 100);

        // Popup handles its own internal layout
        this.gameOverPopup.layout();
    }

    public override destroy(
        options?: boolean | PIXI.IDestroyOptions,
    ): void {
        if (this.milestoneTimer !== null) clearTimeout(this.milestoneTimer);

        this.heightGauge?.destroy();
        this.progressBar2D?.destroy();

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

        this.milestoneLabel = new PIXI.Text('', {
            fill: 0xffe066,
            fontSize: 28,
            fontWeight: 'bold',
            stroke: 0x000000,
            strokeThickness: 4,
        });
        this.milestoneLabel.anchor.set(0.5, 0);
        this.milestoneLabel.alpha = 0;
        this.gameplayLayer.addChild(this.milestoneLabel);
    }
}
