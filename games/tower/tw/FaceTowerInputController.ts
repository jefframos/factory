// FaceTowerInputController.ts

import * as PIXI from 'pixi.js';

export interface FaceTowerInputCallbacks {
    onMove(x: number): void;
    onRelease(): void;
}

export class FaceTowerInputController {
    private readonly inputLayer: PIXI.Sprite;

    private pointerActive = false;

    public constructor(
        private readonly root: PIXI.Container,
        private readonly coordinateRoot: PIXI.Container,
        private readonly callbacks: FaceTowerInputCallbacks,
    ) {
        this.inputLayer = new PIXI.Sprite(PIXI.Texture.WHITE);

        this.inputLayer.alpha = 0;
        this.inputLayer.eventMode = 'static';
        this.inputLayer.cursor = 'grab';

        this.root.addChild(this.inputLayer);

        this.inputLayer.on(
            'pointerdown',
            this.onPointerDown,
            this,
        );

        this.inputLayer.on(
            'pointermove',
            this.onPointerMove,
            this,
        );

        this.inputLayer.on(
            'pointerup',
            this.onPointerUp,
            this,
        );

        this.inputLayer.on(
            'pointerupoutside',
            this.onPointerUp,
            this,
        );
    }

    public resize(
        x: number,
        y: number,
        width: number,
        height: number,
    ): void {
        this.inputLayer.position.set(x, y);
        this.inputLayer.width = width;
        this.inputLayer.height = height;
    }

    /**
     * Toggles the input layer's OWN eventMode rather than relying solely on some other overlay
     * sitting on top of it — PIXI's EventSystem listens on the canvas's native pointer events
     * directly and keeps dispatching regardless of whether the render ticker is running, so a
     * frozen screen alone does NOT stop this layer from still seeing pointerdown/move/up. See
     * IslandViewScene's _onPlatformPause/_onPlatformResume, the intended caller.
     */
    public setEnabled(enabled: boolean): void {
        this.inputLayer.eventMode = enabled ? 'static' : 'none';

        if (!enabled && this.pointerActive) {
            // Cancel a drag in progress instead of leaving pointerActive stuck true — else
            // re-enabling later would silently ignore the next pointerdown, since
            // onPointerMove's touch-input gate (see above) requires pointerActive to already
            // be true from an EARLIER pointerdown that, with eventMode off, will never arrive.
            this.pointerActive = false;
            this.inputLayer.cursor = 'grab';
        }
    }

    public destroy(): void {
        this.inputLayer.off(
            'pointerdown',
            this.onPointerDown,
            this,
        );

        this.inputLayer.off(
            'pointermove',
            this.onPointerMove,
            this,
        );

        this.inputLayer.off(
            'pointerup',
            this.onPointerUp,
            this,
        );

        this.inputLayer.off(
            'pointerupoutside',
            this.onPointerUp,
            this,
        );

        this.inputLayer.removeFromParent();
        this.inputLayer.destroy();
    }

    private onPointerDown(
        event: PIXI.FederatedPointerEvent,
    ): void {
        this.pointerActive = true;
        this.inputLayer.cursor = 'grabbing';

        this.emitMovement(event);
    }

    private onPointerMove(
        event: PIXI.FederatedPointerEvent,
    ): void {
        /*
         * Desktop mouse movement can move the block without holding.
         * Touch input normally requires pointerdown first.
         */
        if (
            event.pointerType === 'touch' &&
            !this.pointerActive
        ) {
            return;
        }

        this.emitMovement(event);
    }

    private onPointerUp(): void {
        if (!this.pointerActive) {
            return;
        }

        this.pointerActive = false;
        this.inputLayer.cursor = 'grab';

        this.callbacks.onRelease();
    }

    private emitMovement(
        event: PIXI.FederatedPointerEvent,
    ): void {
        const point = event.getLocalPosition(
            this.coordinateRoot,
        );

        this.callbacks.onMove(point.x);
    }
}