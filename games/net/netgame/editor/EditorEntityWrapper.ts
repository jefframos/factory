import { PhysicsBodyFactory } from '@core/phyisics/core/PhysicsBodyFactory';
import * as PIXI from 'pixi.js';
import { LevelObject } from '../level/LevelTypes';

export class EditorEntityWrapper {
    public view: PIXI.Container = new PIXI.Container();
    public data: LevelObject;
    private selectionGfx: PIXI.Graphics = new PIXI.Graphics();

    constructor(obj: LevelObject) {
        this.data = obj;
        this.build();
    }

    private build(): void {
        const debugColor = this.data.debugColor || this.data.color;
        let result: { debugGraphic: PIXI.Graphics };

        this.view.eventMode = 'static';
        this.view.cursor = 'pointer';



        // We use the Factory just for the Graphics generation
        switch (this.data.type) {
            case 'box':
            case 'sensor':
                result = PhysicsBodyFactory.createRect(
                    0, 0,
                    this.data.width || 100,
                    this.data.height || 100,
                    {},
                    debugColor
                );
                break;
            case 'circle':
                result = PhysicsBodyFactory.createCircle(
                    0, 0,
                    this.data.radius || 30,
                    {},
                    debugColor
                );
                break;
            case 'polygon':
                result = PhysicsBodyFactory.createPolygon(
                    0, 0,
                    this.data.vertices || [],
                    {},
                    debugColor
                );
                break;
            default:
                return;
        }

        this.view.addChild(result.debugGraphic);
        this.view.position.set(this.data.x, this.data.y);

        // Visual indicator for sensors vs solids
        this.view.alpha = this.data.type === 'sensor' ? 0.5 : 1.0;

        this.selectionGfx.lineStyle(2, 0xffffff, 1);
        this.drawSelectionBrackets();
        this.selectionGfx.visible = false;
        this.view.addChild(this.selectionGfx);
    }

    private drawSelectionBrackets(): void {
        const w = this.data.width || 60;
        const h = this.data.height || 60;
        this.selectionGfx.clear();
        this.selectionGfx.lineStyle(2, 0x3498db);
        // Draw corners
        const s = 10;
        this.selectionGfx.moveTo(-w / 2, -h / 2 + s).lineTo(-w / 2, -h / 2).lineTo(-w / 2 + s, -h / 2);
        this.selectionGfx.moveTo(w / 2, -h / 2 + s).lineTo(w / 2, -h / 2).lineTo(w / 2 - s, -h / 2);
        // ... repeat for bottom corners
    }

    public setSelection(selected: boolean): void {
        this.selectionGfx.visible = selected;
    }

    public update(): void {
        // In the editor, we just ensure view matches data 
        // (Useful if we add dragging later)
        this.view.position.set(this.data.x, this.data.y);
    }

    public destroy(): void {
        this.view.destroy({ children: true });
    }
}