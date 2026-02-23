import * as PIXI from 'pixi.js';
import { EditorEntityWrapper } from '../EditorEntityWrapper';

export class TransformGizmoService {
    private activeWrapper: EditorEntityWrapper | null = null;
    private gizmoLayer: PIXI.Graphics = new PIXI.Graphics();

    private isDragging: boolean = false;
    private dragOffset = new PIXI.Point();

    private handleType: 'move' | 'resize' = 'move';
    private resizeHandleSize = 25;

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
                const localMouse = this.worldContainer.toLocal(event.global);
                const d = this.activeWrapper.data;

                let isHandleClick = false;

                if (d.type === 'circle') {
                    // Handle is at [Center + Radius, Center]
                    const handleX = d.x + (d.radius || 30);
                    const handleY = d.y;
                    const dist = Math.sqrt(Math.pow(localMouse.x - handleX, 2) + Math.pow(localMouse.y - handleY, 2));
                    isHandleClick = dist < this.resizeHandleSize + 10;
                } else {
                    // Box handle at Bottom-Right
                    const handleX = d.x + (d.width || 100) / 2;
                    const handleY = d.y + (d.height || 100) / 2;
                    const dist = Math.sqrt(Math.pow(localMouse.x - handleX, 2) + Math.pow(localMouse.y - handleY, 2));
                    isHandleClick = dist < this.resizeHandleSize + 10;
                }

                if (isHandleClick) {
                    this.handleType = 'resize';
                } else {
                    this.handleType = 'move';
                    this.dragOffset.set(d.x - localMouse.x, d.y - localMouse.y);
                }

                this.isDragging = true;
            }
        }
        this.draw();
    }

    private onGlobalMove = (e: MouseEvent) => {
        if (!this.isDragging || !this.activeWrapper) return;

        const globalPoint = new PIXI.Point(e.clientX, e.clientY);
        const localPos = this.worldContainer.toLocal(globalPoint);
        const d = this.activeWrapper.data;

        if (this.handleType === 'resize') {
            if (d.type === 'circle') {
                // Distance from center to mouse is the new radius
                const dx = localPos.x - d.x;
                const dy = localPos.y - d.y;
                d.radius = Math.max(10, Math.sqrt(dx * dx + dy * dy));
            } else {
                // Standard box logic
                d.width = Math.max(20, (localPos.x - d.x) * 2);
                d.height = Math.max(20, (localPos.y - d.y) * 2);
            }
        } else {
            d.x = Math.round(localPos.x + this.dragOffset.x);
            d.y = Math.round(localPos.y + this.dragOffset.y);
        }

        this.activeWrapper.refresh();
        this.onTransformUpdate?.(d);
        this.draw();
    };

    public draw(): void {
        this.gizmoLayer.clear();
        if (!this.activeWrapper) return;

        const d = this.activeWrapper.data;
        this.gizmoLayer.lineStyle(2, 0x3498db, 0.5);

        if (d.type === 'circle') {
            const r = d.radius || 30;
            // Circle guide
            this.gizmoLayer.drawCircle(d.x, d.y, r);
            // Handle at Center-Right
            this.gizmoLayer.beginFill(0xffffff);
            this.gizmoLayer.drawCircle(d.x + r, d.y, 6);
            this.gizmoLayer.endFill();
        } else {
            const w = (d.width || 100);
            const h = (d.height || 100);
            // Box guide
            this.gizmoLayer.drawRect(d.x - w / 2, d.y - h / 2, w, h);
            // Handle at Bottom-Right
            this.gizmoLayer.beginFill(0xffffff);
            this.gizmoLayer.drawCircle(d.x + w / 2, d.y + h / 2, 6);
            this.gizmoLayer.endFill();
        }
    }
}