import * as PIXI from 'pixi.js';

export class DebugGraphicsHelper {
    private static debugGraphics = new PIXI.Container();

    /** Call once to add the debug layer to your stage or world */
    public static initializeDebugLayer(parent: PIXI.Container): void {
        parent.addChild(this.debugGraphics);
    }

    /** Adds a debug circle below an entity (must have a `radius` property) */
    public static addCircle(entity: PIXI.Container & { radius: number }, color = 0xff0000, alpha = 0.5): void {
        const gfx = new PIXI.Graphics();
        gfx.beginFill(color, alpha);
        gfx.drawCircle(0, 0, entity.radius);
        gfx.endFill();

        // Position it at the bottom of the container
        entity.addChildAt(gfx, 0);

        // Optional: track for future cleanup
        gfx.name = '__debugCircle';
    }

    /** Removes any existing debug circle from the entity */
    public static removeCircle(entity: PIXI.Container): void {
        const debug = entity.getChildByName('__debugCircle');
        if (debug) {
            entity.removeChild(debug);
            debug.destroy();
        }
    }
}
