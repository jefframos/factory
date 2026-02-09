import * as PIXI from "pixi.js";

export class BoundaryController {
    private container: PIXI.Container = new PIXI.Container();

    constructor(private world: PIXI.Container) {
        this.world.addChild(this.container);
        this.container.visible = false;
    }

    public setVisible(visible: boolean) {
        this.container.visible = visible;
        if (visible) {
            // Ensure it's always the last child (on top)
            this.world.addChild(this.container);
        }
    }

    public render(boundaries: any[], onUpdate: (id: string, updates: any) => void) {
        this.container.removeChildren();

        boundaries.forEach(b => {
            const g = new PIXI.Graphics();
            g.eventMode = 'static';
            g.cursor = 'move';

            // Thick pink line and semi-transparent fill
            g.lineStyle(10, 0xFF00FF, 1);
            g.beginFill(0xFF00FF, 0.2);
            g.drawRect(b.x, b.y, b.width, b.height);
            g.endFill();

            // --- MOVE LOGIC ---
            g.on('pointerdown', (pixiEvent: PIXI.FederatedPointerEvent) => {
                if (pixiEvent.button !== 0) return;
                pixiEvent.stopPropagation();

                const startX = b.x;
                const startY = b.y;
                const startPointerX = pixiEvent.clientX;
                const startPointerY = pixiEvent.clientY;
                // Capture scale at the start of the interaction
                const worldScale = this.container.worldTransform.a;

                const onMove = (browserEvent: PointerEvent) => {
                    const deltaX = browserEvent.clientX - startPointerX;
                    const deltaY = browserEvent.clientY - startPointerY;

                    onUpdate(b.id, {
                        x: startX + (deltaX / worldScale),
                        y: startY + (deltaY / worldScale)
                    });
                };

                const onUp = () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                };

                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
            });

            // Add Resize Handle
            this.createHandle(b, g, onUpdate);

            this.container.addChild(g);
        });
    }

    private createHandle(b: any, parent: PIXI.Graphics, onUpdate: (id: string, updates: any) => void) {
        const h = new PIXI.Graphics();
        h.beginFill(0xFFFFFF);
        h.drawCircle(0, 0, 15);
        h.endFill();

        // Position handle at the bottom-right corner of the boundary
        h.position.set(b.x + b.width, b.y + b.height);

        h.eventMode = 'static';
        h.cursor = 'nwse-resize';

        h.on('pointerdown', (pixiEvent: PIXI.FederatedPointerEvent) => {
            pixiEvent.stopPropagation();

            const startWidth = b.width;
            const startHeight = b.height;
            const startPointerX = pixiEvent.clientX;
            const startPointerY = pixiEvent.clientY;
            const worldScale = this.container.worldTransform.a;

            const onMove = (browserEvent: PointerEvent) => {
                const deltaX = browserEvent.clientX - startPointerX;
                const deltaY = browserEvent.clientY - startPointerY;

                onUpdate(b.id, {
                    width: Math.max(50, startWidth + (deltaX / worldScale)),
                    height: Math.max(50, startHeight + (deltaY / worldScale))
                });
            };

            const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
            };

            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });

        parent.addChild(h);
    }
}