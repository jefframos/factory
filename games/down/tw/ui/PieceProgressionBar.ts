// PieceProgressionBar.ts

import * as PIXI from 'pixi.js';
import Assets from '../../Assets';
import { getPieceShapeMode } from '../PieceShapeMode';
import { getPieceCatalogGeneration, type PieceDefinition } from '../PieceStorage';
import { PieceIconRenderer } from './PieceIconRenderer';

/**
 * Horizontal strip showing every piece in the run's tier progression at a
 * glance, ONE slot per catalog piece (the catalog is a fixed 11 tiers — see
 * pieces-config.json — so nothing is windowed/scrolled any more) —
 * unlocked pieces (tier <= the run's own
 * FaceTowerGameController.getMaxTierReached()) render normally (shape +
 * face texture, same drawing approach as NextPiecePreview's own 2D swatch);
 * anything past that draws through the SAME real art, black-tinted at ~50%
 * alpha with a "?" stamped on top (see applyLockedLook()) — its rough
 * silhouette still reads as "a piece exists here" without spoiling its
 * actual color/face art ahead of time.
 *
 * Every slot renders a little bigger than the one before it (see
 * PROGRESSION_STEP) — a smooth, continuous ramp across the whole strip
 * (not just the last few), culminating in the final (highest-tier) piece
 * being the biggest, rather than every slot reading as the same flat
 * importance.
 *
 * Slots share ONE background spanning the whole strip (see buildShared()),
 * not one per slot — reads as a single panel/shelf the pieces sit on,
 * rather than a row of separate buttons. Same nine-slice texture every
 * other HUD panel here already uses (see TowerNextLevelPanel/
 * NextPiecePreview), so it still reads as part of the same UI family.
 */
export class PieceProgressionBar extends PIXI.Container {
    private static readonly BG_TEXTURE = 'Button01_s_White_Light1';
    private static readonly BG_SLICE = 30;
    /** Background padding beyond the strip's own tight bounding box, on every side. */
    private static readonly BG_PADDING = 12;

    // Sized to sit comfortably narrower than Game.DESIGN_WIDTH (see the
    // class doc) — not edge-to-edge. GameHud.layout() also clamps the whole
    // bar down to the safe area as a last-resort safety net, but these
    // constants are chosen to make that clamp a no-op in practice.
    private static readonly SLOT_SIZE = 75;
    /**
     * Gap between two adjacent slots as a fraction of their own (averaged)
     * size — NOT a fixed px gap, so bigger neighboring slots automatically
     * get more breathing room. NEGATIVE on purpose: at this piece count/size
     * a small positive (or zero) gap still read as too spaced out/small on
     * a small screen, so slots actually overlap slightly (like a hand of
     * fanned cards) to sit closer and let SLOT_SIZE itself go bigger while
     * the whole strip still fits its width budget. See gapBetween().
     */
    private static readonly GAP_RATIO = -0.4;

    /** How much bigger each slot renders than the previous one, e.g. 0.045 means the LAST of 11 slots ends up 1 + 10 * 0.045 = 1.45× SLOT_SIZE. See sizeForIndex(). */
    private static readonly PROGRESSION_STEP = 0.045;

    /** Alpha applied to a locked piece's real (black-tinted) art — see applyLockedLook(). */
    private static readonly LOCKED_ALPHA = 0.5;

    private readonly bg: PIXI.NineSlicePlane;
    private readonly strip = new PIXI.Container();
    private readonly icons: PIXI.Container[] = [];
    /** This slot's own on-screen size (SLOT_SIZE × its own escalation factor) — icons need it to size their own content, since it varies per slot now. */
    private readonly slotSizes: number[] = [];

    /** Skips a redundant rebuild — see update(). */
    private lastPieceCount = -1;
    private lastMaxTierReached = -1;
    /** Also part of the rebuild-skip check — toggling circle/cube (see PieceShapeMode) changes what every icon should draw WITHOUT necessarily changing maxTierReached, so it needs its own explicit check. */
    private lastShapeMode: string | undefined;
    /** Also part of the rebuild-skip check — a theme switch (see GameThemeStorage) that reloads an entirely different piece catalog can still resolve to the SAME PieceShapeMode (e.g. 'cats' back to 'circle' are both 'circle'), which would otherwise leave stale icons/art from the previous catalog showing. */
    private lastCatalogGeneration = -1;

    public constructor() {
        super();

        this.bg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(PieceProgressionBar.BG_TEXTURE),
            PieceProgressionBar.BG_SLICE, PieceProgressionBar.BG_SLICE,
            PieceProgressionBar.BG_SLICE, PieceProgressionBar.BG_SLICE,
        );
        this.addChild(this.bg);
        this.addChild(this.strip);
    }

    /**
     * The strip's own unscaled width (this.bg's width, set fresh in
     * buildSlots() and unaffected by whatever `this.scale` GameHud.layout()
     * applies to fit it into the safe area) — used there to compute that
     * fit-to-width scale without the two feeding back into each other frame
     * over frame (reading `this.width` instead would already reflect last
     * frame's clamp, compounding it further every subsequent call).
     */
    public getNaturalWidth(): number {
        return this.bg.width;
    }

    /** The size (width == height) of the slot at `index` — a smooth linear ramp, SLOT_SIZE at index 0 growing by PROGRESSION_STEP for every slot after it. */
    private static sizeForIndex(index: number): number {
        return PieceProgressionBar.SLOT_SIZE * (1 + index * PieceProgressionBar.PROGRESSION_STEP);
    }

    /** Gap between slot `i` and slot `i + 1`, scaled to their own (averaged) size rather than a flat px value — see GAP_RATIO's own doc. */
    private static gapBetween(sizeA: number, sizeB: number): number {
        return (sizeA + sizeB) * 0.5 * PieceProgressionBar.GAP_RATIO;
    }

    /** Builds one slot (icon container only, no per-slot background any more) per piece, laid out left-to-right with each slot's own escalated size — only called once, the first time `update()` sees the real piece count. */
    private buildSlots(count: number): void {
        this.strip.removeChildren();
        this.icons.length = 0;
        this.slotSizes.length = 0;

        for (let i = 0; i < count; i++) {
            this.slotSizes.push(PieceProgressionBar.sizeForIndex(i));
        }

        let totalWidth = this.slotSizes.reduce((sum, size) => sum + size, 0);
        for (let i = 0; i < count - 1; i++) {
            totalWidth += PieceProgressionBar.gapBetween(this.slotSizes[i], this.slotSizes[i + 1]);
        }

        const maxSize = Math.max(...this.slotSizes, PieceProgressionBar.SLOT_SIZE);

        let x = -totalWidth * 0.5;

        for (let i = 0; i < count; i++) {
            const size = this.slotSizes[i];
            const slot = new PIXI.Container();
            slot.position.x = x + size * 0.5;
            x += size + (i < count - 1 ? PieceProgressionBar.gapBetween(size, this.slotSizes[i + 1]) : 0);

            const icon = new PIXI.Container();
            slot.addChild(icon);
            this.icons.push(icon);

            this.strip.addChild(slot);
        }

        this.bg.width = totalWidth + PieceProgressionBar.BG_PADDING * 2;
        this.bg.height = maxSize - 20;
        this.bg.position.set(-this.bg.width * 0.5, -this.bg.height * 0.5);
    }

    /**
     * `pieces` is the full catalog, ascending by tier (see
     * FaceTowerGameController.getPieceProgression()); `maxTierReached` is
     * FaceTowerGameController.getMaxTierReached(). Builds one slot per piece
     * the first time `pieces.length` is known (or if it ever changes — it
     * shouldn't mid-run, but rebuilding defensively is cheap), then redraws
     * every slot, but only when maxTierReached or the active PieceShapeMode
     * actually changed since the last call, so calling this every frame is
     * cheap. `pieces` themselves are the SAME shared PieceDefinition objects
     * PieceShapeMode.setPieceShapeMode() mutates in place (clearing/
     * restoring `polygon`), so a plain redraw already picks up circle vs.
     * cube automatically — the shape-mode check below exists purely so
     * toggling it (which doesn't necessarily change maxTierReached) doesn't
     * get skipped by the cache and leave stale-shaped icons showing.
     */
    public update(pieces: readonly PieceDefinition[], maxTierReached: number): void {
        if (pieces.length !== this.lastPieceCount) {
            this.buildSlots(pieces.length);
            this.lastPieceCount = pieces.length;
        }

        const shapeMode = getPieceShapeMode();
        const catalogGeneration = getPieceCatalogGeneration();

        if (
            maxTierReached === this.lastMaxTierReached &&
            shapeMode === this.lastShapeMode &&
            catalogGeneration === this.lastCatalogGeneration
        ) {
            return;
        }

        this.lastMaxTierReached = maxTierReached;
        this.lastShapeMode = shapeMode;
        this.lastCatalogGeneration = catalogGeneration;

        for (let i = 0; i < pieces.length; i++) {
            const piece = pieces[i];
            const icon = this.icons[i];

            for (const child of icon.removeChildren()) {
                child.destroy();
            }

            const unlocked = (piece.tier ?? 0) <= maxTierReached;
            PieceProgressionBar.drawIcon(icon, piece, unlocked, shapeMode, this.slotSizes[i]);
        }
    }

    /**
     * Draws the piece's real look via PieceIconRenderer (shared with
     * GateProgressPanel) regardless of lock state — a LOCKED piece then
     * gets darkened by applyLockedLook() (black tint + ~50% alpha, "?"
     * stamped on top) rather than drawing a fake dark placeholder, so its
     * rough silhouette still reads as "a piece exists here" without
     * spoiling its actual color/face art ahead of time. Applied from
     * PieceIconRenderer's `onDrawn` (not right after the call returns) —
     * for a locked piece whose snapshot then fails to load, `onDrawn` fires
     * AGAIN once the flat-draw fallback replaces it, so applyLockedLook()
     * must be safe to call more than once (see its own doc).
     */
    private static drawIcon(
        icon: PIXI.Container,
        piece: PieceDefinition,
        unlocked: boolean,
        shapeMode: 'circle' | 'cube',
        slotSize: number,
    ): void {
        PieceIconRenderer.draw(icon, piece, slotSize, shapeMode, () => {
            if (!unlocked) {
                PieceProgressionBar.applyLockedLook(icon, slotSize);
            }
        });
    }

    /** Name tag on the "?" mark applyLockedLook() adds — lets it find and remove a stale one first, so re-running it (see drawIcon's own doc) never stacks a second mark on top. */
    private static readonly LOCK_MARK_NAME = 'lockMark';

    /**
     * Darkens every OTHER visual already added to `icon` (the real
     * snapshot/shape + face texture, not a fake placeholder) — tinted pure
     * black plus LOCKED_ALPHA (~50%) — then stamps a bold "?" centered on
     * top at full opacity, so a locked slot still reads as "a real piece is
     * here, details TBD" instead of either spoiling it outright or hiding
     * it as a flat blank shape. Idempotent: safe to call again on the same
     * `icon` (removes its own previous "?" mark first) — see drawIcon()'s
     * own doc for why that matters.
     */
    private static applyLockedLook(icon: PIXI.Container, slotSize: number): void {
        const stale = icon.getChildByName(PieceProgressionBar.LOCK_MARK_NAME);
        if (stale) {
            icon.removeChild(stale);
            stale.destroy();
        }

        for (const child of icon.children) {
            if (child instanceof PIXI.Sprite || child instanceof PIXI.Graphics) {
                child.tint = 0x000000;
            }
            child.alpha = PieceProgressionBar.LOCKED_ALPHA;
        }

        // Assets.TextStyles.DefaultLabel — same Baloo2-ExtraBold family/stroke/
        // drop-shadow every other HUD label here uses, not a generic system
        // font, so the "?" reads as part of the same UI instead of a mismatch.
        const mark = new PIXI.Text('?', {
            ...Assets.TextStyles.DefaultLabel,
            fontSize: Math.round(slotSize * 0.45),
            strokeThickness: Math.max(2, slotSize * 0.08),
        });
        mark.name = PieceProgressionBar.LOCK_MARK_NAME;
        mark.anchor.set(0.5);
        icon.addChild(mark);
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        super.destroy(options ?? { children: true });
    }
}
