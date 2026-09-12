// StaticPieceView2D.ts

import * as PIXI from 'pixi.js';
import { resolvePieceImagePath } from './PieceStorage';
import type { StaticPieceDefinition } from './StaticPieceStorage';

function hexStringToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

/**
 * Draws the 2D look for a static (base/column) physics entity from its
 * StaticPieceDefinition — same rect-or-polygon body + face-decal
 * composition as FaceTowerBlockController.styleBlockView uses for gameplay
 * blocks — but standalone rather than routed through BlockBodyTextureCache,
 * since that cache draws at FaceTowerConfig.blockWidth/blockHeight, while
 * bases/columns are sized off floorWidth/floorHeight or
 * wallWidth/wallHeight instead. Not cached either — bases/columns are only
 * ever created a handful of times per run, unlike the many blocks dropped
 * during play.
 *
 * `piece` is optional so callers can fall back to a plain `fallbackColor`
 * rect when a role has no static piece configured (see StaticPieceStorage).
 */
export function buildStaticPieceView(
    piece: StaticPieceDefinition | undefined,
    width: number,
    height: number,
    fallbackColor: number,
    strokeColor: number,
    strokeWidth: number,
    bevelRadius: number,
): PIXI.Container {
    const view = new PIXI.Container();

    // Pivoted to the plain geometric middle — NOT the polygon's own area
    // centroid — because every caller here (base/column) has a physics body
    // that stays a plain symmetric BoxEntity no matter what polygon it's
    // drawn with (see FaceTowerBlockController.addBase /
    // TowerDeadZoneController.createWall). The view's local origin is what
    // the entity positions every frame, so it has to line up with that
    // fixed rect's own center, not drift toward wherever a concave outline
    // (e.g. an arch notch) happens to shift its centroid.
    const body = new PIXI.Graphics();
    body.lineStyle(strokeWidth, strokeColor, 1);
    body.beginFill(0xffffff, 1);

    if (piece?.polygon) {
        body.drawPolygon(piece.polygon.flatMap(p => [p.x * width, p.y * height]));
    } else if (bevelRadius > 0) {
        body.drawRoundedRect(0, 0, width, height, bevelRadius);
    } else {
        body.drawRect(0, 0, width, height);
    }

    body.endFill();
    body.pivot.set(width * 0.5, height * 0.5);
    body.tint = piece ? hexStringToNumber(piece.color) : fallbackColor;

    view.addChild(body);

    const faceScale = piece?.faceScale ?? { x: 1, y: 1 };
    const faceHidden = faceScale.x <= 0 || faceScale.y <= 0;

    if (piece?.texture && !faceHidden) {
        const face = PIXI.Sprite.from(resolvePieceImagePath(piece.texture));
        const faceSize = Math.min(width, height) * 0.8;
        const faceOffset = piece.faceOffset ?? { x: 0, y: 0 };

        face.anchor.set(0.5);
        face.width = faceSize * faceScale.x;
        face.height = faceSize * faceScale.y;
        face.position.set(faceOffset.x, faceOffset.y);

        view.addChild(face);
    }

    return view;
}
