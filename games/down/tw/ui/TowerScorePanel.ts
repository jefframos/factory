// TowerScorePanel.ts

import * as PIXI from 'pixi.js';
import Assets from '../../Assets';

const BG_TEXTURE = 'Button01_s_White_Light1';
const BG_SLICE = 30;

const DEFAULT_WIDTH = 140;
const DEFAULT_HEIGHT = 66;

/**
 * Always-visible score bubble — same "shared background texture, own
 * container" convention as TowerHeader/TowerNextLevelPanel — positioned to
 * TowerHeader's LEFT in GameHud.layout(). Also where TowerScorePopupUtils'
 * flying "+N" numbers land — see GameHud.getScoreLabelScreenPosition().
 *
 * Shows the run's live score, plus the all-time best (see
 * TowerHighScoreStorage) right below it in smaller text — update() takes
 * the MAX of the two for that second line, so the instant a run's own
 * score overtakes the previous record it reads as the new best immediately,
 * without waiting for TowerHighScoreStorage.recordPoints() to actually
 * persist it (that still only happens at game-over — see IslandViewScene).
 *
 * `width`/`height` fix the WHOLE container's size up front (matching
 * TowerNextLevelPanel's own fixed-size convention) — unlike TowerHeader,
 * this does NOT grow with the label as the score gets longer, so it stays
 * visually consistent with the other panels in the row instead of widening
 * every time the score changes.
 */
export class TowerScorePanel extends PIXI.Container {
    private readonly bg: PIXI.NineSlicePlane;
    private readonly label: PIXI.Text;
    private readonly bestLabel: PIXI.Text;

    public constructor(width: number = DEFAULT_WIDTH, height: number = DEFAULT_HEIGHT) {
        super();

        this.bg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(BG_TEXTURE),
            BG_SLICE, BG_SLICE, BG_SLICE, BG_SLICE,
        );
        this.bg.width = width;
        this.bg.height = height;
        this.bg.position.set(-width / 2, -height / 2);
        this.addChild(this.bg);

        this.label = new PIXI.Text('0', Assets.TextStyles.HeaderCurrentLevel);
        this.label.anchor.set(0.5, 0.5);
        this.label.position.set(0, -12);
        this.addChild(this.label);

        this.bestLabel = new PIXI.Text('BEST 0', Assets.TextStyles.HeaderNextLevel);
        this.bestLabel.anchor.set(0.5, 0.5);
        this.bestLabel.position.set(0, 16);
        this.addChild(this.bestLabel);
    }

    /** `bestScore` is TowerHighScoreStorage.getPoints() — the persisted all-time record, from before this run. */
    public update(score: number, bestScore: number): void {
        this.label.text = String(score);
        this.bestLabel.text = `BEST ${Math.max(score, bestScore)}`;
    }
}
