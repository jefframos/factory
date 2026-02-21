import { Game } from "@core/Game";
import * as PIXI from 'pixi.js';

export interface LayoutAnchor {
    x: number; // 0 (left) to 1 (right)
    y: number; // 0 (top) to 1 (bottom)
}

interface PinnedElement {
    object: PIXI.Container;
    anchor: LayoutAnchor;
    offset: { x: number, y: number };
}

export class LayoutUpdater {
    private pinnedElements: PinnedElement[] = [];
    private lastWidth: number = 0;
    private lastHeight: number = 0;

    /**
     * Registers a display object to be managed by the updater
     * @param object The PIXI container to move
     * @param anchor The screen anchor (e.g., {x: 1, y: 1} for bottom-right)
     * @param offset Pixel offset from that anchor point
     */
    public register(object: PIXI.Container, anchor: LayoutAnchor, offset: { x: number, y: number }): void {
        this.pinnedElements.push({ object, anchor, offset });
        // Immediate position for the new element
        this.updateObjectPosition(this.pinnedElements[this.pinnedElements.length - 1]);
    }

    public update(): void {
        const currentW = Game.overlayScreenData.width;
        const currentH = Game.overlayScreenData.height;

        // Only update all positions if the resolution actually changed
        if (this.lastWidth !== currentW || this.lastHeight !== currentH) {
            this.refreshAll();
            this.lastWidth = currentW;
            this.lastHeight = currentH;
        }
    }

    public refreshAll(): void {
        this.pinnedElements.forEach(item => this.updateObjectPosition(item));
    }

    private updateObjectPosition(item: PinnedElement): void {
        const screenW = Game.overlayScreenData.width;
        const screenH = Game.overlayScreenData.height;

        const targetX = (screenW * item.anchor.x) + item.offset.x;
        const targetY = (screenH * item.anchor.y) + item.offset.y;

        item.object.position.set(targetX, targetY);
    }
}