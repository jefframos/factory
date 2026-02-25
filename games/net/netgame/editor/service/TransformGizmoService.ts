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

        window.addEventListener('mousemove', this.onGlobalMove);
        window.addEventListener('mouseup', () => this.isDragging = false);
    }

    public select(wrapper: EditorEntityWrapper | null, event?: PIXI.FederatedPointerEvent): void {
        if (this.activeWrapper) this.activeWrapper.setSelection(false);
        this.activeWrapper = wrapper;

        if (this.activeWrapper) {
            // This now triggers the moveToFront() logic we added to the Wrapper
            this.activeWrapper.setSelection(true);

            if (event) {
                const localMouse = this.worldContainer.toLocal(event.global);
                const d = this.activeWrapper.data;

                // --- LOCK CHECK ---
                // If it's a collectible, we force it to only allow 'move' logic
                const isCollectible = !!d.collectible;
                let isHandleClick = false;

                if (!isCollectible) {
                    if (d.type === 'circle') {
                        const handleX = d.x + (d.radius || 30);
                        const handleY = d.y;
                        const dist = Math.sqrt(Math.pow(localMouse.x - handleX, 2) + Math.pow(localMouse.y - handleY, 2));
                        isHandleClick = dist < this.resizeHandleSize + 10;
                    } else if (d.type !== 'polygon') {
                        const handleX = d.x + (d.width || 100) / 2;
                        const handleY = d.y + (d.height || 100) / 2;
                        const dist = Math.sqrt(Math.pow(localMouse.x - handleX, 2) + Math.pow(localMouse.y - handleY, 2));
                        isHandleClick = dist < this.resizeHandleSize + 10;
                    }
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
            // Safety check: handleType should never be 'resize' for collectibles due to logic in select()
            if (d.type === 'circle') {
                const dx = localPos.x - d.x;
                const dy = localPos.y - d.y;
                d.radius = Math.max(10, Math.sqrt(dx * dx + dy * dy));
            } else {
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
        const isCollectible = !!d.collectible;

        this.gizmoLayer.lineStyle(2, 0x3498db, 0.5);

        if (d.type === 'circle') {
            const r = d.radius || 30;
            this.gizmoLayer.drawCircle(d.x, d.y, r);

            // Only draw resize handle if not a collectible
            if (!isCollectible) {
                this.gizmoLayer.beginFill(0xffffff);
                this.gizmoLayer.drawCircle(d.x + r, d.y, 6);
                this.gizmoLayer.endFill();
            }
        } else {
            const w = (d.width || 100);
            const h = (d.height || 100);
            this.gizmoLayer.drawRect(d.x - w / 2, d.y - h / 2, w, h);

            // Only draw resize handle if not a collectible
            if (!isCollectible && d.type !== 'polygon') {
                this.gizmoLayer.beginFill(0xffffff);
                this.gizmoLayer.drawCircle(d.x + w / 2, d.y + h / 2, 6);
                this.gizmoLayer.endFill();
            }
        }
    }
}