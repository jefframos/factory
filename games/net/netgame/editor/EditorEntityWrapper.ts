import { PhysicsBodyFactory } from '@core/phyisics/core/PhysicsBodyFactory';
import * as PIXI from 'pixi.js';
import { LevelObject } from '../level/LevelTypes';

export class EditorEntityWrapper {
    public view: PIXI.Container = new PIXI.Container();
    public data: LevelObject;

    private selectionGfx: PIXI.Graphics = new PIXI.Graphics();
    private contentGfx: PIXI.Graphics | null = null;

    constructor(obj: LevelObject) {
        this.data = obj;
        this.view.eventMode = 'static';
        this.view.cursor = 'pointer';

        this.view.addChild(this.selectionGfx);

        // Initial build and sync with Physics Centroid
        this.refresh();
    }

    /**
     * FULL REFRESH: Re-syncs the data.x/y and vertices with the Matter.js Centroid.
     * Use this: After point insertion/deletion, or after a drag finishes.
     */
    public refresh(forceCentroidSync: boolean = false): void {
        const debugColor = this.data.debugColor || 0x00FF00;
        this.clearContent();

        let result: any;

        switch (this.data.type) {
            case 'box':
            case 'sensor':
                result = PhysicsBodyFactory.createRect(0, 0, this.data.width || 100, this.data.height || 100, {}, debugColor);
                break;
            case 'circle':
                result = PhysicsBodyFactory.createCircle(0, 0, this.data.radius || 30, {}, debugColor);
                break;
            case 'polygon':
                // We use the "original" x/y. 
                result = PhysicsBodyFactory.createPolygonEditor(
                    this.data.vertices || [],
                    debugColor
                );
                break;
        }

        this.applyResult(result);
    }

    private applyResult(result: any): void {
        this.contentGfx = result.debugGraphic;
        this.view.addChildAt(this.contentGfx, 0);

        this.view.position.set(this.data.x, this.data.y);
        this.view.alpha = this.data.type === 'sensor' ? 0.5 : 1.0;

        this.drawSelectionBrackets();
    }

    private clearContent(): void {
        if (this.contentGfx) {
            this.view.removeChild(this.contentGfx);
            this.contentGfx.destroy({ children: true });
            this.contentGfx = null;
        }
    }

    private drawSelectionBrackets(): void {
        this.selectionGfx.clear();
        this.selectionGfx.lineStyle(2, 0x3498db);

        if (this.data.type === 'circle') {
            const r = this.data.radius || 30;
            this.selectionGfx.drawCircle(0, 0, r);
            this.selectionGfx.beginFill(0x3498db);
            this.selectionGfx.drawCircle(r, 0, 4);
            this.selectionGfx.endFill();
        } else {
            const w = this.data.width || (this.calculatePolyWidth());
            const h = this.data.height || (this.calculatePolyHeight());
            const s = 10; // corner size

            // Draw 4 corners
            this.selectionGfx.moveTo(-w / 2, -h / 2 + s).lineTo(-w / 2, -h / 2).lineTo(-w / 2 + s, -h / 2);
            this.selectionGfx.moveTo(w / 2, -h / 2 + s).lineTo(w / 2, -h / 2).lineTo(w / 2 - s, -h / 2);
            this.selectionGfx.moveTo(-w / 2, h / 2 - s).lineTo(-w / 2, h / 2).lineTo(-w / 2 + s, h / 2);
            this.selectionGfx.moveTo(w / 2, h / 2 - s).lineTo(w / 2, h / 2).lineTo(w / 2 - s, h / 2);
        }
    }

    private calculatePolyWidth(): number {
        if (!this.data.vertices?.length) return 100;
        const xs = this.data.vertices.map(v => v.x);
        return Math.max(...xs) - Math.min(...xs);
    }

    private calculatePolyHeight(): number {
        if (!this.data.vertices?.length) return 100;
        const ys = this.data.vertices.map(v => v.y);
        return Math.max(...ys) - Math.min(...ys);
    }

    public setSelection(selected: boolean): void {
        this.selectionGfx.visible = selected;
    }

    public update(): void {
        this.view.position.set(this.data.x, this.data.y);
    }

    public destroy(): void {
        this.view.destroy({ children: true });
    }
}