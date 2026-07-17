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