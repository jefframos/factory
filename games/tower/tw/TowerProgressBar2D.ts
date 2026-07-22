// TowerProgressBar2D.ts

import { Game } from 'core/Game';
import { VerticalNineSliceProgressBar } from 'core/ui/VerticalNineSliceProgressBar';
import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';

/**
 * The tower's "progress toward the next zone" bar — fills bottom-up as the
 * player climbs closer to the current target line (see
 * FaceTowerGameController.getZoneProgress()).
 *
 * This is a NEW, separate 2D progress display running ALONGSIDE the
 * existing dashed-line TowerHeightGauge, not a replacement for it yet —
 * both stay wired up in IslandViewScene while this one gets evaluated.
 *
 * - A ticket icon ('ItemIcon_Ticket_Gold-2', from the shared 'ui' atlas)
 *   sits at the bar's TOP end — the reward for reaching it. Call
 *   playEarnedAnimation() to pulse it once the zone actually completes
 *   (see FaceTowerGameEvents.onMilestoneReached in IslandViewScene) —
 *   that's the moment the player actually earns it, not just approaches it.
 * - A bright line marks the fill's exact current top edge, drawn on top of
 *   the nine-slice fill itself, so the boundary reads clearly even at
 *   small progress increments where the fill's own top edge is subtle.
 *
 * Pinned to the actual bottom-right screen corner via pinBottomRight()
 * (call every frame) — same Game.gameScreenData technique
 * NextPiecePreview/TowerHeightGauge already use, so it stays correctly
 * anchored across aspect ratios/resizes instead of a fixed design-space
 * point.
 */
export class TowerProgressBar2D {
    private static readonly WIDTH = 36;
    private static readonly HEIGHT = 260;
    private static readonly BORDER = 20;
    private static readonly PADDING = 6;
    private static readonly MARGIN = 20;

    private static readonly BG_FRAME = 'ResourceBar_Single_Btn_Grey';
    private static readonly FILL_FRAME = 'ResourceBar_Single_Btn_Green1';
    private static readonly TICKET_FRAME = 'ItemIcon_Ticket_Gold-2';
    private static readonly TICKET_WIDTH = 40;
    /** Gap between the bar's top edge and the ticket icon sitting above it. */
    private static readonly TICKET_GAP = 4;

    private readonly container: PIXI.Container;
    private readonly bar: VerticalNineSliceProgressBar;
    private readonly progressLine: PIXI.Graphics;
    private readonly ticket: PIXI.Sprite;
    private readonly ticketBaseScale: number;

    public constructor(root: PIXI.Container) {
        this.container = new PIXI.Container();

        this.bar = new VerticalNineSliceProgressBar({
            width: TowerProgressBar2D.WIDTH,
            height: TowerProgressBar2D.HEIGHT,
            bgTexture: PIXI.Texture.from(TowerProgressBar2D.BG_FRAME),
            barTexture: PIXI.Texture.from(TowerProgressBar2D.FILL_FRAME),
            leftWidth: TowerProgressBar2D.BORDER,
            topHeight: TowerProgressBar2D.BORDER,
            rightWidth: TowerProgressBar2D.BORDER,
            bottomHeight: TowerProgressBar2D.BORDER,
            padding: TowerProgressBar2D.PADDING,
        });

        // VerticalNineSliceProgressBar centers its own pivot — placing it
        // at (width/2, height/2) here means this wrapper's own (0,0)..(WIDTH,HEIGHT)
        // maps to the bar's visual top-left..bottom-right, so the ticket/
        // progress-line math below can just assume a plain top-left origin.
        this.bar.position.set(TowerProgressBar2D.WIDTH / 2, TowerProgressBar2D.HEIGHT / 2);
        this.container.addChild(this.bar);

        this.progressLine = new PIXI.Graphics();
        this.container.addChild(this.progressLine);

        this.ticket = PIXI.Sprite.from(TowerProgressBar2D.TICKET_FRAME);
        this.ticket.anchor.set(0.5, 1);
        this.ticketBaseScale = TowerProgressBar2D.TICKET_WIDTH / this.ticket.texture.width;
        this.ticket.scale.set(this.ticketBaseScale);
        this.ticket.position.set(TowerProgressBar2D.WIDTH / 2, -TowerProgressBar2D.TICKET_GAP);
        this.container.addChild(this.ticket);

        root.addChild(this.container);
    }

    /** Call every frame — keeps the bar pinned to the actual bottom-right screen corner across resizes/orientation changes. */
    public pinBottomRight(): void {
        const bottomRight = Game.gameScreenData.bottomRight;

        this.container.position.set(
            bottomRight.x - TowerProgressBar2D.WIDTH - TowerProgressBar2D.MARGIN,
            bottomRight.y - TowerProgressBar2D.HEIGHT - TowerProgressBar2D.MARGIN,
        );
    }

    /** 0..1 — see FaceTowerGameController.getZoneProgress(). */
    public update(fraction: number): void {
        this.bar.update(fraction);

        const clamped = Math.max(0, Math.min(1, fraction));
        const available = TowerProgressBar2D.HEIGHT - TowerProgressBar2D.PADDING * 2;
        const fillTopY = TowerProgressBar2D.HEIGHT - TowerProgressBar2D.PADDING - clamped * available;

        this.progressLine.clear();
        this.progressLine.lineStyle(2, 0xffffff, 0.9);
        this.progressLine.moveTo(TowerProgressBar2D.PADDING, fillTopY);
        this.progressLine.lineTo(TowerProgressBar2D.WIDTH - TowerProgressBar2D.PADDING, fillTopY);

        this.pinBottomRight()
    }

    /** Pulses the ticket icon once — call when the zone actually completes, the moment the player "earns" it. */
    public playEarnedAnimation(): void {
        gsap.killTweensOf(this.ticket.scale);

        gsap.timeline()
            .to(this.ticket.scale, {
                x: this.ticketBaseScale * 1.6,
                y: this.ticketBaseScale * 1.6,
                duration: 0.18,
                ease: 'back.out(3)',
            })
            .to(this.ticket.scale, {
                x: this.ticketBaseScale,
                y: this.ticketBaseScale,
                duration: 0.25,
                ease: 'elastic.out(1, 0.5)',
            });
    }

    public destroy(): void {
        gsap.killTweensOf(this.ticket.scale);
        // Cascades into VerticalNineSliceProgressBar's own overridden
        // destroy() (it's a child of this.container) — no need to call it
        // separately.
        this.container.destroy({ children: true });
    }
}
