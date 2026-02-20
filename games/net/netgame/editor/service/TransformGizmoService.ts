import * as PIXI from 'pixi.js';
import { EditorEntityWrapper } from '../EditorEntityWrapper';

export class TransformGizmoService {
    private activeWrapper: EditorEntityWrapper | null = null;
    private gizmoLayer: PIXI.Graphics = new PIXI.Graphics();

    private isDragging: boolean = false;
    private dragOffset = new PIXI.Point();

    public onTransformUpdate?: (data: any) => void;

    constructor(private worldContainer: PIXI.Container) {
        this.worldContainer.addChild(this.gizmoLayer);

        // Listen to the window for movement so it never "drops" the object
        window.addEventListener('mousemove', this.onGlobalMove);
        window.addEventListener('mouseup', () => this.isDragging = false);
    }

    public select(wrapper: EditorEntityWrapper | null, event?: PIXI.FederatedPointerEvent): void {
        if (this.activeWrapper) this.activeWrapper.setSelection(false);
        this.activeWrapper = wrapper;

        if (this.activeWrapper) {
            this.activeWrapper.setSelection(true);

            if (event) {
                // Calculate the offset between mouse and object center in WORLD space
                const localMouse = this.worldContainer.toLocal(event.global);
                const d = this.activeWrapper.data;

                this.dragOffset.set(d.x - localMouse.x, d.y - localMouse.y);
                this.isDragging = true;
            }
        } else {
            // Selection cleared
            this.isDragging = false;
            this.gizmoLayer.clear();
        }
        this.draw();
    }

    private onGlobalMove = (e: MouseEvent) => {
        if (!this.isDragging || !this.activeWrapper) return;

        // Convert raw screen pixels to PIXI world coordinates
        // We use the renderer to get the global position from the mouse event
        const globalPoint = new PIXI.Point(e.clientX, e.clientY);
        const localPos = this.worldContainer.toLocal(globalPoint);

        const d = this.activeWrapper.data;

        // Move logic with offset preservation
        d.x = Math.round(localPos.x + this.dragOffset.x);
        d.y = Math.round(localPos.y + this.dragOffset.y);

        // Notify UI and Redraw
        this.onTransformUpdate?.(d);
        this.draw();
    };

    public draw(): void {
        this.gizmoLayer.clear();
        if (!this.activeWrapper) return;

        const d = this.activeWrapper.data;
        const w = d.width || 100;
        const h = d.height || 100;

        this.gizmoLayer.lineStyle(2, 0x3498db);
        this.gizmoLayer.drawRect(d.x - w / 2, d.y - h / 2, w, h);

        // Simple handle for visual feedback
        this.gizmoLayer.beginFill(0x3498db);
        this.gizmoLayer.drawCircle(d.x + w / 2, d.y + h / 2, 6);
        this.gizmoLayer.endFill();
    }
}