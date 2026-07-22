// TowerHeightGauge.ts

import { Game } from 'core/Game';
import * as PIXI from 'pixi.js';

export interface HeightMark {
    /** Where this mark falls in this container's local space (design px) — see TowerHeightGauge.update(). */
    screenY: number;
    heightMeters: number;
}

/**
 * Right-edge dashed-line ruler showing how tall the tower currently is —
 * a horizontal dashed tick at the tower's current top, "-------22.4m"
 * style, with the meters label past its right end (one decimal place —
 * not rounded to whole meters — so close highscores actually separate).
 * Dimmer, smaller ticks mark every milestone (completed zone) already
 * passed, at their own fixed height, so past progress stays visible even
 * once the live tick has climbed well above them.
 *
 * Pinned against Game.gameScreenData.topLeft/topRight rather than a fixed
 * DESIGN_WIDTH/0 — see NextPiecePreview's doc for why (this scene's
 * container lives under Game.stageContainer, and gameScreenData is what
 * actually matches its local space across aspect ratios/resizes).
 *
 * The live tick's Y and displayed value never jump straight to a new
 * reading — both ease toward whatever update() passes in (see
 * smoothTowards()), so a sudden change (a taller piece finally counting
 * once it settles, a zone completing) reads as the tick sliding/counting
 * up rather than teleporting. Once its (eased) Y climbs above the visible
 * top edge — the top of a tall stack can genuinely be off the top of the
 * screen mid-zone, before the camera pans to catch up — it's clamped to
 * sit just below the top edge instead of being drawn off-canvas, i.e.
 * "pinned to the top" of the screen.
 *
 * A third, distinctly-colored tick marks the CURRENT target — the height
 * the player still needs to reach for the next zone, not one already
 * passed. Milestone ticks (completed zones) are dimmer/smaller and not
 * eased or top-clamped the same way — once passed they're historical, so
 * letting one scroll off the top just means it's no longer the frontier.
 */
export class TowerHeightGauge {
    private static readonly TOP_MARGIN = 60;
    /** Gap kept clear past the label's own right edge — this is "the padding" past the actual visible screen edge (Game.gameScreenData.topRight.x). */
    private static readonly RIGHT_MARGIN = 20;
    private static readonly LINE_WIDTH = 140;
    private static readonly MILESTONE_LINE_WIDTH = 90;
    /** Gap between the dashed line's end and the label's left edge. */
    private static readonly LABEL_GAP = 8;
    private static readonly DASH = 10;
    private static readonly GAP = 6;
    /** Higher = the live tick catches up to a new reading faster; see smoothTowards(). */
    private static readonly EASE_SPEED = 6;

    private readonly line: PIXI.Graphics;
    private readonly label: PIXI.Text;

    /** Eased (not snapped) — see smoothTowards(). Undefined only before the first update() call, so that one snaps instead of easing in from nothing. */
    private displayedScreenY?: number;
    private displayedMeters?: number;

    private readonly targetLine: PIXI.Graphics;
    private readonly targetLabel: PIXI.Text;

    /** One dashed tick + label per completed milestone, reused by index across frames instead of recreated (see updateMilestones()). */
    private readonly milestonesContainer: PIXI.Container;
    private readonly milestoneViews: { line: PIXI.Graphics; label: PIXI.Text }[] = [];

    public constructor(root: PIXI.Container) {
        this.milestonesContainer = new PIXI.Container();
        root.addChild(this.milestonesContainer);

        this.targetLine = new PIXI.Graphics();
        root.addChild(this.targetLine);

        this.targetLabel = new PIXI.Text('', {
            fill: 0x2ecc71,
            fontSize: 16,
            fontWeight: 'bold',
            stroke: 0x000000,
            strokeThickness: 2,
        });
        this.targetLabel.anchor.set(1, 0.5);
        root.addChild(this.targetLabel);

        this.line = new PIXI.Graphics();
        root.addChild(this.line);

        this.label = new PIXI.Text('0.0m', {
            fill: 0xffe066,
            fontSize: 20,
            fontWeight: 'bold',
            stroke: 0x000000,
            strokeThickness: 3,
        });

        // anchor.x = 1 pins the label's OWN right edge to its position
        // point, rather than its left edge — so budgeting from
        // RIGHT_MARGIN below always keeps the full label (whatever width
        // "5.0m" vs "120.4m" needs) inside the margin, instead of the label
        // starting at a fixed point and potentially overflowing PAST the
        // visible edge as its text (and therefore width) changes.
        this.label.anchor.set(1, 0.5);
        root.addChild(this.label);
    }

    /**
     * `current` is the tower's current top; `target` is the next zone's
     * own fixed height (the one the player still needs to reach — see
     * FaceTowerGameController.getTargetLineWorldY()), undefined only
     * before the first zone's target line exists; `milestones` is every
     * completed zone's own fixed height. All already converted to this
     * container's local screen space and a meters value by the caller —
     * see IslandViewScene.update(). `delta` (seconds) drives the live
     * tick's easing, frame-rate independent.
     */
    public update(current: HeightMark, target: HeightMark | undefined, milestones: readonly HeightMark[], delta: number): void {
        const topLeft = Game.gameScreenData.topLeft;
        const topRight = Game.gameScreenData.topRight;
        const labelRightEdge = topRight.x - TowerHeightGauge.RIGHT_MARGIN;

        this.displayedScreenY = TowerHeightGauge.smoothTowards(current.screenY, this.displayedScreenY, delta);
        this.displayedMeters = TowerHeightGauge.smoothTowards(current.heightMeters, this.displayedMeters, delta);

        const clampedY = Math.max(topLeft.y + TowerHeightGauge.TOP_MARGIN, this.displayedScreenY);

        this.label.text = `${Math.max(0, this.displayedMeters).toFixed(1)}m`;
        this.label.position.set(labelRightEdge, clampedY);

        // The line's own end budgets AROUND the label's actual (now
        // up-to-date) width, so it never runs underneath the text.
        const lineEndX = labelRightEdge - this.label.width - TowerHeightGauge.LABEL_GAP;
        const lineStartX = lineEndX - TowerHeightGauge.LINE_WIDTH;

        TowerHeightGauge.drawDashedLine(this.line, lineStartX, lineEndX, clampedY, 3, 0xffe066, 0.9);

        this.updateTarget(target, labelRightEdge);
        this.updateMilestones(milestones, labelRightEdge);
    }

    /** Not eased/clamped — a fixed height, always meaningful to show exactly where it actually is even if that's off the top edge (a strong hint the target is still well above the current build). */
    private updateTarget(target: HeightMark | undefined, labelRightEdge: number): void {
        if (!target) {
            this.targetLine.visible = false;
            this.targetLabel.visible = false;
            return;
        }

        this.targetLine.visible = true;
        this.targetLabel.visible = true;

        this.targetLabel.text = `Goal ${target.heightMeters.toFixed(1)}m`;
        this.targetLabel.position.set(labelRightEdge, target.screenY);

        const lineEndX = labelRightEdge - this.targetLabel.width - TowerHeightGauge.LABEL_GAP;
        const lineStartX = lineEndX - TowerHeightGauge.LINE_WIDTH;

        TowerHeightGauge.drawDashedLine(this.targetLine, lineStartX, lineEndX, target.screenY, 2, 0x2ecc71, 0.9);
    }

    /**
     * Frame-rate-independent exponential ease toward `target` — each call
     * closes a fixed FRACTION of the remaining distance rather than a
     * fixed amount, so it settles smoothly regardless of frame rate.
     * `current === undefined` (only true before the very first update())
     * snaps straight to `target` instead of easing in from nothing.
     */
    private static smoothTowards(target: number, current: number | undefined, delta: number): number {
        if (current === undefined) {
            return target;
        }

        const t = 1 - Math.exp(-TowerHeightGauge.EASE_SPEED * delta);
        return current + (target - current) * t;
    }

    private updateMilestones(milestones: readonly HeightMark[], labelRightEdge: number): void {
        while (this.milestoneViews.length < milestones.length) {
            const line = new PIXI.Graphics();
            const label = new PIXI.Text('', {
                fill: 0xcccccc,
                fontSize: 14,
                fontWeight: 'bold',
                stroke: 0x000000,
                strokeThickness: 2,
            });

            label.anchor.set(1, 0.5);
            this.milestonesContainer.addChild(line, label);
            this.milestoneViews.push({ line, label });
        }

        milestones.forEach((mark, i) => {
            const view = this.milestoneViews[i];

            view.line.visible = true;
            view.label.visible = true;

            view.label.text = `${mark.heightMeters.toFixed(1)}m`;
            view.label.position.set(labelRightEdge, mark.screenY);

            const lineEndX = labelRightEdge - view.label.width - TowerHeightGauge.LABEL_GAP;
            const lineStartX = lineEndX - TowerHeightGauge.MILESTONE_LINE_WIDTH;

            TowerHeightGauge.drawDashedLine(view.line, lineStartX, lineEndX, mark.screenY, 2, 0xcccccc, 0.6);
        });

        // Only ever shrinks in the same run if a reset drops the milestone
        // count (see IslandViewScene passing a fresh, shorter array) —
        // hide the leftover pooled views rather than destroying them, so
        // growth back up later doesn't need to recreate them.
        for (let i = milestones.length; i < this.milestoneViews.length; i++) {
            this.milestoneViews[i].line.visible = false;
            this.milestoneViews[i].label.visible = false;
        }
    }

    private static drawDashedLine(
        graphic: PIXI.Graphics,
        startX: number,
        endX: number,
        y: number,
        width: number,
        color: number,
        alpha: number,
    ): void {
        graphic.clear();
        graphic.lineStyle(width, color, alpha);

        for (let x = startX; x < endX; x += TowerHeightGauge.DASH + TowerHeightGauge.GAP) {
            const segmentEnd = Math.min(x + TowerHeightGauge.DASH, endX);
            graphic.moveTo(x, y).lineTo(segmentEnd, y);
        }
    }

    public destroy(): void {
        this.line.destroy();
        this.label.destroy();
        this.targetLine.destroy();
        this.targetLabel.destroy();

        for (const view of this.milestoneViews) {
            view.line.destroy();
            view.label.destroy();
        }

        this.milestonesContainer.destroy({ children: true });
    }
}
