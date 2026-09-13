// PieceTargetingOverlay.ts

import { Game } from 'core/Game';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import type { FaceTowerBlock } from '../FaceTowerTypes';

const MARKER_ALPHA = 0.45;
const CLOSE_BUTTON_SIZE = 56;
const CLOSE_ICON_SIZE = 24;

/**
 * "Pick a piece" mode for the two target-type powerups (destroy-piece/
 * upgrade-piece — see PowerupStorage.PowerupActivationType) — while active:
 *  - one plain white marker sprite sits over every live, non-powerup block,
 *    sized to roughly match it (a placeholder look — swap for a real
 *    texture whenever one's ready, nothing else here needs to change).
 *    Tapping a marker fires onTargetChosen with that block's id.
 *  - a small close button (top-right) fires onCancel instead.
 *
 * Positioned in the SAME screen/overlay space as the rest of the HUD (see
 * GameHud.layout()'s own doc on why that matters) — added to
 * IslandViewScene's hudContainer, not the 3D scene, even though it tracks
 * 3D-rendered pieces: this game's 2D physics coordinates already line up
 * 1:1 with screen space once the camera's own vertical pan offset is added
 * (same convention TowerScorePopupUtils/TowerVfxUtils popups already rely
 * on), so no 3D raycasting is needed to know where a piece is on screen.
 */
export class PieceTargetingOverlay extends PIXI.Container {
    /** Dispatches the tapped block's id. */
    public readonly onTargetChosen: Signal = new Signal();
    /** Dispatches when the close button is tapped. */
    public readonly onCancel: Signal = new Signal();

    private readonly markers: PIXI.Sprite[] = [];
    private readonly markerPool: PIXI.Sprite[] = [];
    private readonly closeButton: PIXI.Container;

    public constructor() {
        super();

        this.visible = false;

        this.closeButton = PieceTargetingOverlay.buildCloseButton(() => this.onCancel.dispatch());
        this.addChild(this.closeButton);
    }

    public activate(): void {
        this.visible = true;
    }

    /** Hides everything and returns every marker to the pool — call once the player has chosen a target or canceled. */
    public deactivate(): void {
        this.visible = false;

        for (const marker of this.markers) {
            marker.visible = false;
            this.markerPool.push(marker);
        }

        this.markers.length = 0;
    }

    /**
     * Call every frame while active() — `blocks` is
     * FaceTowerGameController.getBlocks(), `cameraOffsetY` is
     * getCameraOffsetY() (same pair TowerVfxUtils/score-popup positioning
     * already uses). `blockWidth`/`blockHeight` are
     * FaceTowerConfig.blockWidth/blockHeight, scaled per-piece the same way
     * the real 2D block view does. `heldBlockId` (FaceTowerGameController.
     * getHeldBlock()?.id) excludes the piece still hovering over the drop
     * area, not yet released — it isn't really "on the board" yet, and
     * destroying/upgrading it out from under FaceTowerBlockController's own
     * heldBlock bookkeeping would leave that reference dangling (pointing
     * at an already-destroyed entity), breaking the next spawn.
     */
    public update(
        blocks: readonly FaceTowerBlock[],
        cameraOffsetY: number,
        blockWidth: number,
        blockHeight: number,
        heldBlockId: number | undefined,
    ): void {
        let i = 0;

        for (const block of blocks) {
            if (block.powerup || block.id === heldBlockId) {
                continue;
            }

            const marker = this.markers[i] ?? this.acquireMarker();
            this.markers[i] = marker;
            i++;

            const w = blockWidth * block.piece.scale.x;
            const h = blockHeight * block.piece.scale.y;

            marker.visible = true;
            marker.width = w;
            marker.height = h;
            marker.position.set(
                block.entity.body.position.x,
                block.entity.body.position.y + cameraOffsetY,
            );

            marker.removeAllListeners();
            marker.on('pointertap', () => this.onTargetChosen.dispatch(block.id));
        }

        // Anything left over from a previous frame with MORE blocks than
        // this one — hide, don't destroy, so acquireMarker() can reuse them.
        for (let j = i; j < this.markers.length; j++) {
            this.markers[j].visible = false;
            this.markerPool.push(this.markers[j]);
        }

        this.markers.length = i;
    }

    /**
     * Call every frame — top-right corner, same topLeft.y-tracking pattern
     * every other top-anchored HUD element uses (see GameHud.layout()'s own
     * doc on why the Y must combine with topLeft.y, not a bare offset).
     */
    public layout(): void {
        const { topLeft, topRight } = Game.overlayScreenData;
        const padding = 20;

        this.closeButton.position.set(
            topRight.x - CLOSE_BUTTON_SIZE / 2 - padding,
            topLeft.y + CLOSE_BUTTON_SIZE / 2 + padding,
        );
    }

    private acquireMarker(): PIXI.Sprite {
        const pooled = this.markerPool.pop();

        if (pooled) {
            this.addChildAt(pooled, 0);
            return pooled;
        }

        const marker = new PIXI.Sprite(PIXI.Texture.WHITE);
        marker.anchor.set(0.5);
        marker.alpha = MARKER_ALPHA;
        marker.interactive = true;
        marker.cursor = 'pointer';
        this.addChildAt(marker, 0);

        return marker;
    }

    private static buildCloseButton(onTap: () => void): PIXI.Container {
        const button = new PIXI.Container();

        const bg = new PIXI.Graphics();
        bg.beginFill(0x000000, 0.55);
        bg.drawCircle(0, 0, CLOSE_BUTTON_SIZE / 2);
        bg.endFill();
        button.addChild(bg);

        const icon = PIXI.Sprite.from('Icon_Close02');
        icon.anchor.set(0.5);
        icon.width = CLOSE_ICON_SIZE;
        icon.height = CLOSE_ICON_SIZE;
        button.addChild(icon);

        button.interactive = true;
        button.cursor = 'pointer';
        button.on('pointertap', onTap);

        return button;
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        this.onTargetChosen.removeAll();
        this.onCancel.removeAll();
        super.destroy(options ?? { children: true });
    }
}
