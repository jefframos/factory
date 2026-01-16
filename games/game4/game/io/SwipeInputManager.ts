import * as PIXI from 'pixi.js';
import { Signal } from 'signals';

export type Direction = 'up' | 'down' | 'left' | 'right';

export default class SwipeInputManager {
    public onMove: Signal = new Signal();

    private startX = 0;
    private startY = 0;
    private threshold = 30;
    private shape?: PIXI.Container;
    private activeTarget: EventTarget = window;

    constructor() {
        this.attachListeners(window);
        window.addEventListener('keydown', this.handleKey);
    }

    public setShape(container?: PIXI.Container) {
        this.detachListeners(this.activeTarget);
        this.shape = container;

        if (this.shape) {
            this.activeTarget = this.shape || (this.shape as any).eventMode ? this.shape : window;
            // Enable interaction for PIXI.Container if not already set
            this.shape.eventMode = 'static';
            this.shape.interactive = true;
            this.attachListeners(this.shape);
        } else {
            this.activeTarget = window;
            this.attachListeners(window);
        }
    }

    private attachListeners(target: EventTarget) {
        target.addEventListener('touchstart', this.handleTouchStart as any, { passive: true });
        target.addEventListener('touchend', this.handleTouchEnd as any);
        target.addEventListener('mousedown', this.handleMouseDown as any);
        target.addEventListener('mouseup', this.handleMouseUp as any);
    }

    private detachListeners(target: EventTarget) {
        target.removeEventListener('touchstart', this.handleTouchStart as any);
        target.removeEventListener('touchend', this.handleTouchEnd as any);
        target.removeEventListener('mousedown', this.handleMouseDown as any);
        target.removeEventListener('mouseup', this.handleMouseUp as any);
    }

    private handleKey = (e: KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowUp':
            case 'w':
            case 'W':
                this.onMove.dispatch('up');
                break;
            case 'ArrowDown':
            case 's':
            case 'S':
                this.onMove.dispatch('down');
                break;
            case 'ArrowLeft':
            case 'a':
            case 'A':
                this.onMove.dispatch('left');
                break;
            case 'ArrowRight':
            case 'd':
            case 'D':
                this.onMove.dispatch('right');
                break;
        }
    };

    private handleTouchStart = (e: PIXI.FederatedPointerEvent) => {
        this.startX = e.clientX;
        this.startY = e.clientY;
    };

    private handleTouchEnd = (e: PIXI.FederatedPointerEvent) => {
        this.detectSwipe(e.clientX, e.clientY);
    };

    private handleMouseDown = (e: MouseEvent) => {
        this.startX = e.clientX;
        this.startY = e.clientY;
    };

    private handleMouseUp = (e: MouseEvent) => {
        this.detectSwipe(e.clientX, e.clientY);
    };

    private detectSwipe(endX: number, endY: number) {
        const deltaX = endX - this.startX;
        const deltaY = endY - this.startY;

        if (Math.abs(deltaX) > Math.abs(deltaY)) {
            if (Math.abs(deltaX) > this.threshold) {
                this.onMove.dispatch(deltaX > 0 ? 'right' : 'left');
            }
        } else {
            if (Math.abs(deltaY) > this.threshold) {
                this.onMove.dispatch(deltaY > 0 ? 'down' : 'up');
            }
        }
    }

    public destroy() {
        this.detachListeners(this.activeTarget);
        window.removeEventListener('keydown', this.handleKey);
    }
}
