import * as PIXI from 'pixi.js';
import { EditorEntityWrapper } from '../EditorEntityWrapper';

export class PolygonEditorService {
    private activeWrapper: EditorEntityWrapper | null = null;
    private handleLayer: PIXI.Graphics = new PIXI.Graphics();

    // Interaction State
    private selectedVertexIndex: number | null = null;
    private isDragging: boolean = false;
    private handleType: 'move' | 'vertex' = 'move';
    private dragOffset = new PIXI.Point();
    private lastClickTime: number = 0;
    private vertexLabels: Map<number, PIXI.Text> = new Map();
    private originLabel: PIXI.Text | null = null;
    // Constants
    private readonly VERTEX_RADIUS = 6;
    private readonly CLICK_THRESHOLD = 12;

    constructor(private worldContainer: PIXI.Container) {
        this.worldContainer.addChild(this.handleLayer);

        // Global listeners for dragging
        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('mouseup', this.onMouseUp);
        window.addEventListener('keydown', this.onKeyDown);
    }

    /**
     * Called by the Manager when a polygon is selected
     */
    public activate(wrapper: EditorEntityWrapper | null, event?: PIXI.FederatedPointerEvent): void {
        this.activeWrapper = wrapper;
        this.selectedVertexIndex = null;
        this.clearLabels(); // <-- add this

        if (this.activeWrapper && event) {
            const localMouse = this.getMouseLocal(event.global);
            this.handleInteraction(localMouse);
        }

        this.draw();
    }

    private handleInteraction(mouse: PIXI.Point) {
        if (!this.activeWrapper) return;
        const data = this.activeWrapper.data;
        const verts = data.vertices || [];

        // 1. Check for Point Selection (Vertex Edit Mode)
        for (let i = 0; i < verts.length; i++) {
            const worldV = { x: data.x + verts[i].x, y: data.y + verts[i].y };
            const dist = Math.sqrt(Math.pow(mouse.x - worldV.x, 2) + Math.pow(mouse.y - worldV.y, 2));

            if (dist < this.CLICK_THRESHOLD) {
                this.selectedVertexIndex = i;
                this.handleType = 'vertex';
                this.isDragging = true;
                return;
            }
        }

        // 2. Check for Edge Double Click (Add Point)
        const now = Date.now();
        if (now - this.lastClickTime < 300) {
            if (this.tryInsertPoint(mouse)) return;
        }
        this.lastClickTime = now;

        // 3. Fallback: Move the whole object
        this.handleType = 'move';
        this.isDragging = true;
        this.dragOffset.set(data.x - mouse.x, data.y - mouse.y);
    }

    private tryInsertPoint(mouse: PIXI.Point): boolean {
        if (!this.activeWrapper) return false;
        const data = this.activeWrapper.data;
        const verts = data.vertices || [];

        let bestDist = 15; // Max distance to edge to trigger insertion
        let insertIndex = -1;

        for (let i = 0; i < verts.length; i++) {
            const v1 = { x: data.x + verts[i].x, y: data.y + verts[i].y };
            const v2 = { x: data.x + verts[(i + 1) % verts.length].x, y: data.y + verts[(i + 1) % verts.length].y };

            const dist = this.distToSegment(mouse, v1, v2);
            if (dist < bestDist) {
                bestDist = dist;
                insertIndex = i + 1;
            }
        }

        if (insertIndex !== -1) {
            verts.splice(insertIndex, 0, { x: mouse.x - data.x, y: mouse.y - data.y });
            this.selectedVertexIndex = insertIndex;
            this.activeWrapper.refresh();
            this.draw();
            return true;
        }
        return false;
    }

    private onMouseMove = (e: MouseEvent) => {
        if (!this.isDragging || !this.activeWrapper) return;

        const mouse = this.getMouseLocal(new PIXI.Point(e.clientX, e.clientY));
        const data = this.activeWrapper.data;

        if (this.handleType === 'vertex' && this.selectedVertexIndex !== null) {
            data.vertices![this.selectedVertexIndex] = {
                x: Math.round(mouse.x - data.x),
                y: Math.round(mouse.y - data.y)
            };
        } else {
            data.x = Math.round(mouse.x + this.dragOffset.x);
            data.y = Math.round(mouse.y + this.dragOffset.y);
        }

        // Use refresh(false) to keep the pivot locked
        this.activeWrapper.refresh(false);
        this.draw();
    }

    private onMouseUp = () => {
        if (this.isDragging && this.activeWrapper) {
            // We still use false here. 
            // We only want to sync the centroid when the user CLICKS SAVE 
            // or specifically hits a "Recenter" button.
            this.activeWrapper.refresh(false);
        }
        this.isDragging = false;
        this.draw();
    }

    private onKeyDown = (e: KeyboardEvent) => {
        if (document.activeElement?.tagName === 'INPUT') return;

        if (e.key === 'Delete' || e.key === 'Backspace') {
            this.deleteSelectedPoint();
        }
    }

    private deleteSelectedPoint() {
        if (!this.activeWrapper || this.selectedVertexIndex === null) return;
        const verts = this.activeWrapper.data.vertices || [];

        if (verts.length > 3) {
            verts.splice(this.selectedVertexIndex, 1);
            this.selectedVertexIndex = null;
            this.activeWrapper.refresh(); // Full refresh to recalculate visual center
            this.draw();
        }
    }

    public draw() {
        this.handleLayer.clear();
        this.clearLabels();

        if (!this.activeWrapper) return;

        const data = this.activeWrapper.data;
        const verts = data.vertices || [];

        // Draw edges
        this.handleLayer.lineStyle(1, 0x3498db, 0.3);
        this.handleLayer.moveTo(data.x + verts[0].x, data.y + verts[0].y);
        for (let i = 1; i < verts.length; i++) {
            this.handleLayer.lineTo(data.x + verts[i].x, data.y + verts[i].y);
        }
        this.handleLayer.lineTo(data.x + verts[0].x, data.y + verts[0].y);

        // Origin dot + label
        this.handleLayer.lineStyle(2, 0xFF0000);
        this.handleLayer.beginFill(0xFF0000);
        this.handleLayer.drawCircle(data.x, data.y, 6);
        this.handleLayer.endFill();

        this.originLabel = this.createLabel(
            `origin (${data.x}, ${data.y})`,
            data.x + 8, data.y - 10,
            0xFF4444
        );

        // Vertex handles + labels
        verts.forEach((v, i) => {
            const isSelected = this.selectedVertexIndex === i;
            const worldX = data.x + v.x;
            const worldY = data.y + v.y;

            this.handleLayer.lineStyle(2, isSelected ? 0x3498db : 0xffffff);
            this.handleLayer.beginFill(isSelected ? 0x3498db : 0x111111);
            this.handleLayer.drawCircle(worldX, worldY, isSelected ? 7 : 5);
            this.handleLayer.endFill();

            const label = this.createLabel(
                `[${i}] rel:(${v.x},${v.y}) world:(${Math.round(worldX)},${Math.round(worldY)})`,
                worldX + 8, worldY - 8,
                isSelected ? 0x3498db : 0xffffff
            );
            this.vertexLabels.set(i, label);
        });
    }

    private createLabel(text: string, x: number, y: number, color: number): PIXI.Text {
        const label = new PIXI.Text(text, {
            fontSize: 10,
            fill: color,
            stroke: 0x000000,
            strokeThickness: 3,
        });
        label.position.set(x, y);
        this.handleLayer.addChild(label);
        return label;
    }

    private clearLabels(): void {
        this.vertexLabels.forEach(label => {
            this.handleLayer.removeChild(label);
            label.destroy();
        });
        this.vertexLabels.clear();

        if (this.originLabel) {
            this.handleLayer.removeChild(this.originLabel);
            this.originLabel.destroy();
            this.originLabel = null;
        }
    }
    // --- Math Helpers ---

    private getMouseLocal(global: PIXI.Point) {
        return this.worldContainer.toLocal(global);
    }

    /**
     * Standard point-to-segment distance algorithm
     */
    private distToSegment(p: PIXI.Point, v: { x: number, y: number }, w: { x: number, y: number }) {
        const l2 = Math.pow(v.x - w.x, 2) + Math.pow(v.y - w.y, 2);
        if (l2 === 0) return Math.sqrt(Math.pow(p.x - v.x, 2) + Math.pow(p.y - v.y, 2));
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.sqrt(Math.pow(p.x - (v.x + t * (w.x - v.x)), 2) + Math.pow(p.y - (v.y + t * (w.y - v.y)), 2));
    }
}