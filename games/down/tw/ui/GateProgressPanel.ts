// GateProgressPanel.ts

import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import Assets from '../../Assets';
import { getPieceShapeMode } from '../PieceShapeMode';
import type { PieceDefinition } from '../PieceStorage';
import type { GateRequirement } from '../TowerGateController';
import { PieceIconRenderer } from './PieceIconRenderer';

/**
 * Bottom-center HUD box showing the CURRENT gate requirement — replaces
 * PieceProgressionBar/TowerNextLevelPanel (both hidden, not deleted — see
 * GameHud). Two states, driven by TowerGateController via
 * FaceTowerGameController's events:
 *
 * - Normal: [the piece that needs unlocking] + [a closed lock] — shown by
 *   showRequirement(), including once at run start for the very first
 *   requirement.
 * - Once every real tier is unlocked (`GateRequirement.isTopTierRepeat`):
 *   [the top piece] + [a "+"] + [closed lock] — the requirement now repeats
 *   ("merge two of these again") instead of naming a new piece.
 *
 * The moment a requirement is met, celebrateUnlock() pops the box away and
 * pops in a lock-opening icon as a beat of feedback; showRequirement() for
 * the NEXT requirement is called separately, `trapdoorSettleDelay` later
 * (the same beat the game already gives the level-up popup) — this panel
 * has no timer of its own for that gap, it just waits for the next call.
 *
 * Modeled on ZoneNotification's lightweight gsap-timeline pop style, not
 * the heavier modal-popup pattern.
 */
export class GateProgressPanel extends PIXI.Container {
    private static readonly BG_TEXTURE = 'Button01_s_White_Light1';
    private static readonly BG_SLICE = 30;
    private static readonly BG_PADDING_X = 8;
    private static readonly BG_PADDING_Y = 8;

    // Piece icons (PieceIconRenderer's snapshot/flat art) carry a lot of
    // baked-in transparent margin around the actual piece — sized big here
    // to read clearly, then laid out/measured using a much smaller
    // EFFECTIVE size (see layoutRow()'s `effectiveWidth` and this class's
    // own width/height math below) so neighboring items sit close to (or
    // overlapping) that empty margin instead of being pushed far away by
    // the icon's full (mostly-transparent) bounding box — an intentionally
    // NEGATIVE padding around it.
    private static readonly ICON_SIZE = 120;
    private static readonly ICON_EFFECTIVE_SIZE = 60;

    private static readonly LOCK_SIZE = 40;
    private static readonly GAP = 10;

    private readonly bg: PIXI.NineSlicePlane;
    /** Holds whichever requirement is currently shown (piece icon + optional "+" + lock) — fully rebuilt each showRequirement() call. */
    private readonly content = new PIXI.Container();
    /** Standalone "lock opening" celebration sprite — NOT part of `content`, so it can pop in/out independently while content is mid-transition. Hidden (alpha 0) until celebrateUnlock() runs. */
    private readonly lockOpen: PIXI.Sprite;
    /** lockOpen's own fitted scale (see fitSprite()) — celebrateUnlock() pops IN to this, not to a hardcoded 1, since the sprite's native texture is much bigger than its intended on-screen size. */
    private readonly lockOpenScale: number;

    private tween: gsap.core.Timeline | null = null;

    public constructor() {
        super();

        this.bg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(GateProgressPanel.BG_TEXTURE),
            GateProgressPanel.BG_SLICE, GateProgressPanel.BG_SLICE,
            GateProgressPanel.BG_SLICE, GateProgressPanel.BG_SLICE,
        );
        this.addChild(this.bg);
        this.addChild(this.content);

        this.lockOpen = PIXI.Sprite.from(Assets.Textures.Icons.LockOpen);
        this.lockOpen.anchor.set(0.5);
        this.lockOpenScale = GateProgressPanel.fitSprite(this.lockOpen, GateProgressPanel.LOCK_SIZE * 1.4);
        this.lockOpen.alpha = 0;
        this.lockOpen.scale.set(0);
        this.addChild(this.lockOpen);
    }

    /**
     * Scales `sprite` uniformly so its LONGER side matches `targetSize` —
     * neither Icon_Lock02 (83×86) nor Icon_Lock03 (71×93) is square, so
     * setting `.width`/`.height` independently would squash them; scaling
     * both axes by the same factor keeps their real aspect ratio. Returns
     * the scale actually applied, for callers that need to animate TO this
     * size later rather than to a hardcoded 1.
     */
    private static fitSprite(sprite: PIXI.Sprite, targetSize: number): number {
        const source = Math.max(sprite.texture.width, sprite.texture.height);
        const scale = targetSize / source;
        sprite.scale.set(scale);
        return scale;
    }

    /**
     * `piece` is the requirement's actual PieceDefinition (resolved by the
     * caller from `requirement.tier` — see FaceTowerGameController.
     * getPieceProgression()) — this panel only knows how to draw it, not
     * how to look it up.
     */
    public showRequirement(requirement: GateRequirement, piece: PieceDefinition): void {
        this.tween?.kill();

        for (const child of this.content.removeChildren()) {
            child.destroy();
        }

        this.lockOpen.alpha = 0;
        this.lockOpen.scale.set(0);

        const shapeMode = getPieceShapeMode();

        const pieceIcon = new PIXI.Container();
        this.content.addChild(pieceIcon);
        PieceIconRenderer.draw(pieceIcon, piece, GateProgressPanel.ICON_SIZE, shapeMode);

        // effectiveWidth/Height are what LAYOUT and background-sizing treat
        // the item as occupying — pieceIcon's is deliberately much smaller
        // than its real (mostly-transparent) bounding box, see this class's
        // own doc.
        const rowItems: { node: PIXI.Container; effectiveWidth: number; effectiveHeight: number }[] = [
            { node: pieceIcon, effectiveWidth: GateProgressPanel.ICON_EFFECTIVE_SIZE, effectiveHeight: GateProgressPanel.ICON_EFFECTIVE_SIZE },
        ];

        if (requirement.isTopTierRepeat) {
            const plus = new PIXI.Text('+', {
                ...Assets.TextStyles.DefaultLabel,
                fontSize: Math.round(GateProgressPanel.ICON_SIZE * 0.3),
            });
            plus.anchor.set(0.5);
            this.content.addChild(plus);
            rowItems.push({ node: plus, effectiveWidth: plus.width, effectiveHeight: plus.height });
        }

        const lockClosed = PIXI.Sprite.from(Assets.Textures.Icons.LockClosed);
        lockClosed.anchor.set(0.5);
        GateProgressPanel.fitSprite(lockClosed, GateProgressPanel.LOCK_SIZE);
        this.content.addChild(lockClosed);
        rowItems.push({ node: lockClosed, effectiveWidth: lockClosed.width, effectiveHeight: lockClosed.height });

        this.layoutRow(rowItems);

        const width = rowItems.reduce((sum, item) => sum + item.effectiveWidth, 0)
            + GateProgressPanel.GAP * (rowItems.length - 1);
        const height = Math.max(...rowItems.map(item => item.effectiveHeight));

        this.bg.width = width + GateProgressPanel.BG_PADDING_X * 2;
        this.bg.height = height + GateProgressPanel.BG_PADDING_Y * 2;
        this.bg.position.set(-this.bg.width * 0.5, -this.bg.height * 0.5);

        this.content.scale.set(0);
        this.tween = gsap.timeline()
            .to(this.content.scale, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2)' });
    }

    /** Centers `items` (each already anchored at 0.5) in a single horizontal row, spaced by their EFFECTIVE width (not their real, possibly much-larger-and-mostly-transparent one — see this class's own doc) with GateProgressPanel.GAP between them. */
    private layoutRow(items: { node: PIXI.Container; effectiveWidth: number }[]): void {
        const totalWidth = items.reduce((sum, item) => sum + item.effectiveWidth, 0)
            + GateProgressPanel.GAP * (items.length - 1);

        let x = -totalWidth * 0.5;

        for (const item of items) {
            item.node.position.x = x + item.effectiveWidth * 0.5;
            x += item.effectiveWidth + GateProgressPanel.GAP;
        }
    }

    /**
     * Plays the "requirement just met" beat: the current box pops away,
     * then a lock-opening icon pops in, holds briefly, and fades — see
     * this class's own doc for why there's no "then show the next
     * requirement" step here (the caller handles that separately, later).
     */
    public celebrateUnlock(): void {
        this.tween?.kill();

        this.tween = gsap.timeline()
            .to(this.content.scale, { x: 0, y: 0, duration: 0.15, ease: 'back.in(2)' })
            .to(this.content, { alpha: 0, duration: 0.1 }, '<')
            .set(this.lockOpen, { alpha: 1 })
            .to(this.lockOpen.scale, { x: this.lockOpenScale, y: this.lockOpenScale, duration: 0.35, ease: 'back.out(3)' })
            .to({}, { duration: 0.5 })
            .to(this.lockOpen, { alpha: 0, duration: 0.25 })
            .set(this.content, { alpha: 1 });
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        this.tween?.kill();
        super.destroy(options ?? { children: true });
    }
}
