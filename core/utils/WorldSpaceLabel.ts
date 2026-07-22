import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import * as PIXI from 'pixi.js';
import * as THREE from 'three';

/**
 * A PIXI.Text that tracks a 3D world position — projects it to screen
 * space every frame (via ThreeScene.worldToScreen, which already rejects
 * behind-camera points) and repositions/hides itself accordingly, instead
 * of needing actual 3D text geometry (TextGeometry/troika-three-text —
 * font loading, extra tooling this repo doesn't otherwise use). Simpler,
 * cheaper, and stays crisp at any distance/angle since it's never actually
 * placed in the 3D scene — same technique EntityIndicatorManager already
 * uses for its name tags (see its toOverlayLocal()).
 *
 * `root` is whatever Pixi container you want the label parented under —
 * pass the same container your other screen-space HUD elements use, so it
 * shares that container's own coordinate space/z-order.
 */
export class WorldSpaceLabel {
    private readonly text: PIXI.Text;

    public constructor(
        private readonly threeScene: ThreeScene,
        private readonly game: Game,
        root: PIXI.Container,
        style: Partial<PIXI.ITextStyle> = {},
    ) {
        this.text = new PIXI.Text('', {
            fill: 0xffffff,
            fontSize: 18,
            fontWeight: 'bold',
            stroke: 0x000000,
            strokeThickness: 3,
            ...style,
        });

        this.text.anchor.set(0.5);
        root.addChild(this.text);
    }

    /** Projects `worldPosition` and moves the label there this frame; hides it (rather than leaving it at a stale position) whenever the point is currently behind the camera. */
    public update(worldPosition: THREE.Vector3, value: string): void {
        this.text.text = value;

        const screen = this.threeScene.worldToScreen(worldPosition);

        if (!screen) {
            this.text.visible = false;
            return;
        }

        const local = this.text.parent.toLocal(new PIXI.Point(screen.x, screen.y), this.game.app.stage);

        this.text.visible = true;
        this.text.position.set(local.x, local.y);
    }

    public setVisible(visible: boolean): void {
        this.text.visible = visible;
    }

    public destroy(): void {
        this.text.destroy();
    }
}
