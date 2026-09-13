// PieceProgressionBar.ts

import * as PIXI from 'pixi.js';
import { DEFAULT_FACE_TOWER_CONFIG } from '../FaceTowerConfig';
import { getPieceShapeMode } from '../PieceShapeMode';
import { resolvePieceImagePath, type PieceDefinition } from '../PieceStorage';

function hexStringToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

/**
 * Horizontal strip of SLOT_COUNT piece "slots" showing the run's tier
 * progression at a glance — unlocked pieces (tier <= the run's own
 * FaceTowerGameController.getMaxTierReached()) render normally (shape +
 * face texture, same drawing approach as NextPiecePreview's own 2D swatch);
 * anything past that draws as a dark, textureless silhouette instead, so
 * upcoming pieces don't get spoiled ahead of time.
 *
 * Each slot reuses the same nine-slice background (BG_TEXTURE) every other
 * HUD panel here already uses (see TowerNextLevelPanel/NextPiecePreview),
 * so it reads as part of the same UI family rather than a bespoke widget.
 */
export class PieceProgressionBar extends PIXI.Container {
    private static readonly BG_TEXTURE = 'Button01_s_White_Light1';
    private static readonly BG_SLICE = 30;

    private static readonly SLOT_COUNT = 8;
    private static readonly SLOT_SIZE = 56;
    private static readonly SLOT_GAP = 8;

    private static readonly LOCKED_FILL = 0x2a2a2a;
    private static readonly LOCKED_ALPHA = 0.55;

    private readonly icons: PIXI.Container[] = [];

    /** Skips a redundant rebuild — see update(). */
    private lastStart = -1;
    private lastMaxTierReached = -1;
    /** Also part of the rebuild-skip check — toggling circle/cube (see PieceShapeMode) changes what every icon should draw WITHOUT necessarily changing the window start or maxTierReached, so it needs its own explicit check. */
    private lastShapeMode: string | undefined;

    public constructor() {
        super();

        const count = PieceProgressionBar.SLOT_COUNT;
        const size = PieceProgressionBar.SLOT_SIZE;
        const gap = PieceProgressionBar.SLOT_GAP;
        const totalWidth = count * size + (count - 1) * gap;

        for (let i = 0; i < count; i++) {
            const slot = new PIXI.Container();
            slot.position.x = -totalWidth * 0.5 + size * 0.5 + i * (size + gap);

            const bg = new PIXI.NineSlicePlane(
                PIXI.Texture.from(PieceProgressionBar.BG_TEXTURE),
                PieceProgressionBar.BG_SLICE, PieceProgressionBar.BG_SLICE,
                PieceProgressionBar.BG_SLICE, PieceProgressionBar.BG_SLICE,
            );
            bg.width = size;
            bg.height = size;
            bg.position.set(-size * 0.5, -size * 0.5);
            slot.addChild(bg);

            const icon = new PIXI.Container();
            slot.addChild(icon);
            this.icons.push(icon);

            this.addChild(slot);
        }
    }

    /**
     * `pieces` is the full catalog, ascending by tier (see
     * FaceTowerGameController.getPieceProgression()); `maxTierReached` is
     * FaceTowerGameController.getMaxTierReached(). Re-centers the visible
     * window on `maxTierReached` (clamped so the window never runs past
     * either end of `pieces` — see computeWindowStart()) and redraws every
     * slot, but only when the window's start index, maxTierReached, or the
     * active PieceShapeMode actually changed since the last call, so
     * calling this every frame is cheap. `pieces` themselves are the SAME
     * shared PieceDefinition objects PieceShapeMode.setPieceShapeMode()
     * mutates in place (clearing/restoring `polygon`), so a plain redraw
     * already picks up circle vs. cube automatically — the shape-mode
     * check below exists purely so toggling it (which doesn't necessarily
     * change the window or maxTierReached) doesn't get skipped by the
     * cache and leave stale-shaped icons showing.
     */
    public update(pieces: readonly PieceDefinition[], maxTierReached: number): void {
        const start = PieceProgressionBar.computeWindowStart(pieces.length, maxTierReached);
        const shapeMode = getPieceShapeMode();

        if (
            start === this.lastStart &&
            maxTierReached === this.lastMaxTierReached &&
            shapeMode === this.lastShapeMode
        ) {
            return;
        }

        this.lastStart = start;
        this.lastMaxTierReached = maxTierReached;
        this.lastShapeMode = shapeMode;

        for (let i = 0; i < PieceProgressionBar.SLOT_COUNT; i++) {
            const piece = pieces[start + i];
            const icon = this.icons[i];

            for (const child of icon.removeChildren()) {
                child.destroy();
            }

            if (!piece) {
                continue;
            }

            const unlocked = (piece.tier ?? 0) <= maxTierReached;
            PieceProgressionBar.drawIcon(icon, piece, unlocked, shapeMode);
        }
    }

    /** How many slots to keep BEHIND `maxTierReached`, rather than splitting the window evenly front/back. */
    private static readonly BACK_COUNT = 6;

    /**
     * Keeps `maxTierReached` BACK_COUNT slots into the SLOT_COUNT-wide
     * window (6 behind it, the rest ahead) — clamped to
     * [0, pieceCount - SLOT_COUNT] so the window never runs off either end
     * (fewer pieces "behind" right at the start, fewer "ahead" once nearing
     * the top tier). Shows every piece (start 0) whenever the whole catalog
     * already fits in one strip.
     */
    private static computeWindowStart(pieceCount: number, maxTierReached: number): number {
        if (pieceCount <= PieceProgressionBar.SLOT_COUNT) {
            return 0;
        }

        const anchorIndex = Math.max(0, Math.min(maxTierReached, pieceCount - 1));
        const idealStart = anchorIndex - PieceProgressionBar.BACK_COUNT;

        return Math.max(0, Math.min(idealStart, pieceCount - PieceProgressionBar.SLOT_COUNT));
    }

    /** Matches PieceSnapshotTool's default `size` setting — see NextPiecePreview's own identical constant. */
    private static readonly SNAPSHOT_SIZE = 128;

    /**
     * An unlocked piece, in 'circle' mode, with the 3D layer active shows
     * its real pre-rendered PieceSnapshotTool image (same asset
     * NextPiecePreview's "next piece" swatch uses) instead of a flat drawn
     * shape — reads as the actual polished piece rather than an
     * approximation. Falls back to the flat draw otherwise: a locked piece
     * (no spoiling the real look early), 'cube' mode (the snapshot is
     * baked for the circle outline specifically — see PieceShapeMode — so
     * it would show the wrong shape while cubes are active), 2D-only mode
     * (no 3D render to have snapshotted), or if the image simply fails to
     * load.
     */
    private static drawIcon(
        icon: PIXI.Container,
        piece: PieceDefinition,
        unlocked: boolean,
        shapeMode: 'circle' | 'cube',
    ): void {
        if (unlocked && shapeMode === 'circle' && DEFAULT_FACE_TOWER_CONFIG.render3D) {
            PieceProgressionBar.drawSnapshotIcon(icon, piece);
            return;
        }

        PieceProgressionBar.drawFlatIcon(icon, piece, unlocked);
    }

    private static resolvePieceSnapshotPath(pieceId: string): string {
        return resolvePieceImagePath(`pieces/tower-piece-snapshots_${pieceId}_${PieceProgressionBar.SNAPSHOT_SIZE}x${PieceProgressionBar.SNAPSHOT_SIZE}.webp`);
    }

    private static drawSnapshotIcon(icon: PIXI.Container, piece: PieceDefinition): void {
        const size = PieceProgressionBar.SLOT_SIZE * 0.85;
        const texture = PIXI.Texture.from(PieceProgressionBar.resolvePieceSnapshotPath(piece.id));
        const sprite = new PIXI.Sprite(texture);

        sprite.anchor.set(0.5);
        sprite.width = size;
        sprite.height = size;
        icon.addChild(sprite);

        if (!texture.baseTexture.valid) {
            texture.baseTexture.once('error', () => {
                // Still showing (i.e. this slot hasn't already been redrawn
                // for something else since) — this piece just has no
                // pre-rendered snapshot, fall back to the flat draw instead
                // of a broken image.
                if (icon.children.includes(sprite)) {
                    sprite.destroy();
                    PieceProgressionBar.drawFlatIcon(icon, piece, true);
                }
            });
        }
    }

    /** Same shape+face draw NextPiecePreview.showDrawn() uses, just with a locked/dark variant swapped in instead of the piece's real color/texture. */
    private static drawFlatIcon(icon: PIXI.Container, piece: PieceDefinition, unlocked: boolean): void {
        const size = PieceProgressionBar.SLOT_SIZE * 0.7;
        const longestAxis = Math.max(piece.scale.x, piece.scale.y);
        const pixelsPerUnit = size / longestAxis;
        const w = piece.scale.x * pixelsPerUnit;
        const h = piece.scale.y * pixelsPerUnit;

        const shape = new PIXI.Graphics();
        const fillColor = unlocked ? hexStringToNumber(piece.color) : PieceProgressionBar.LOCKED_FILL;
        const fillAlpha = unlocked ? 1 : PieceProgressionBar.LOCKED_ALPHA;

        shape.lineStyle(1.5, 0x000000, unlocked ? 1 : 0.4);
        shape.beginFill(fillColor, fillAlpha);

        if (piece.polygon) {
            shape.drawPolygon(piece.polygon.flatMap(p => [p.x * w, p.y * h]));
        } else {
            shape.drawRect(0, 0, w, h);
        }

        shape.endFill();
        shape.pivot.set(w * 0.5, h * 0.5);
        icon.addChild(shape);

        // Locked pieces stay a plain dark silhouette — no face texture, so
        // nothing about an upcoming piece's actual look is spoiled early.
        if (unlocked && piece.texture) {
            const face = PIXI.Sprite.from(resolvePieceImagePath(piece.texture));
            const faceScale = piece.faceScale ?? { x: 1, y: 1 };
            const faceSize = Math.min(w, h) * 0.8;

            face.anchor.set(0.5);
            face.width = faceSize * faceScale.x;
            face.height = faceSize * faceScale.y;
            icon.addChild(face);
        }
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        super.destroy(options ?? { children: true });
    }
}
