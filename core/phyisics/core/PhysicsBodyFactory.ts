import { Bodies, Body, IBodyDefinition, Vector, Vertices } from 'matter-js';
import * as PIXI from 'pixi.js';

export interface BodyDescription {
    body: Body;
    debugGraphic: PIXI.Graphics;
    centroidOffset?: Vector;
    correctedVertices?: Vector[];
    decomposedParts?: Vector[][];
}

export class PhysicsBodyFactory {
    private static DEFAULT_DEBUG_COLOR = 0x00FF00; // Bright green for physics

    public static createRect(x: number, y: number, w: number, h: number, options?: any, debugColor?: number): BodyDescription {
        const body = Bodies.rectangle(x, y, w, h, options);
        const gfx = new PIXI.Graphics();
        const color = debugColor ?? this.DEFAULT_DEBUG_COLOR;

        gfx.lineStyle(2, color);
        // Added a slight fill so shapes are easier to see in the editor
        gfx.beginFill(color, 0.1);
        gfx.drawRect(-w / 2, -h / 2, w, h);
        gfx.endFill();

        return { body, debugGraphic: gfx };
    }

    public static createCircle(x: number, y: number, radius: number, options?: any, debugColor?: number): BodyDescription {
        const body = Bodies.circle(x, y, radius, options);
        const gfx = new PIXI.Graphics();
        const color = debugColor ?? this.DEFAULT_DEBUG_COLOR;

        gfx.lineStyle(2, color);
        gfx.beginFill(color, 0.1);
        gfx.drawCircle(0, 0, radius);
        gfx.moveTo(0, 0).lineTo(radius, 0); // Rotation indicator
        gfx.endFill();

        return { body, debugGraphic: gfx };
    }

    public static createPolygonFromVertices(x: number, y: number, vertexSets: any[], options: any, debugColor?: number): BodyDescription {
        const body = Bodies.fromVertices(x, y, [vertexSets], options);
        const graphic = new PIXI.Graphics();
        const color = debugColor ?? this.DEFAULT_DEBUG_COLOR;

        graphic.lineStyle(2, color);
        graphic.beginFill(color, 0.2);

        // Draw each convex part created by poly-decomp
        for (let i = 1; i < body.parts.length; i++) {
            const part = body.parts[i];
            const path = part.vertices.map(v => ({
                x: v.x - body.position.x,
                y: v.y - body.position.y
            }));
            graphic.drawPolygon(path);
        }

        graphic.endFill();
        return { body, debugGraphic: graphic };
    }

    // PhysicsBodyFactory.ts

    /**
 * Creates a Matter.js body from vertices (supporting concave shapes)
 * and generates a matching PIXI.Graphics object.
 */
    /**
 * Creates a Matter.js body from vertices with automatic 
 * spawn-position compensation to keep the body at (x, y).
 */

    public static createPolygon(x: number, y: number, vertices: Vector[], options?: any, debugColor?: number): BodyDescription {
        // 1. Create the body at 0,0 first to find the Matter-calculated Center of Mass
        const tempBody = Bodies.fromVertices(0, 0, [vertices], options);
        const comOffset = { x: tempBody.position.x, y: tempBody.position.y };

        const spawnX = x - comOffset.x
        const spawnY = y - comOffset.y
        // 2. Create the real body at the compensated position so it 'lands' at (x,y)
        const body = Bodies.fromVertices(spawnX, spawnY, [vertices], options);
        const centroid = Vertices.centre(vertices as any);

        body.position.x = spawnX - centroid.x
        body.position.y = spawnY - centroid.y
        // 3. Extract the 'Source of Truth' vertices
        // We map every part (convex sub-polygon) to be relative to the body's center
        const decomposedParts = body.parts.length > 1
            ? body.parts.slice(1).map(part => part.vertices.map(v => ({ x: v.x - body.position.x, y: v.y - body.position.y })))
            : [body.vertices.map(v => ({ x: v.x - body.position.x, y: v.y - body.position.y }))];

        // 4. Create PIXI Debug Graphic (Optional, uses the same truth)
        const gfx = new PIXI.Graphics();
        const color = debugColor ?? 0x00FF00;
        gfx.lineStyle(2, color).beginFill(color, 0.2);
        decomposedParts.forEach(path => gfx.drawPolygon(path));
        gfx.endFill();

        return { body, debugGraphic: gfx, decomposedParts, centroidOffset: comOffset };
    }
    /**
     * Calculates the geometric centroid of a polygon from raw vertices.
     * This matches what Matter.js uses internally, so pre-applying it
     * ensures fromVertices places the body exactly where intended.
     */
    private static calcCentroid(vertices: Vector[]): Vector {
        let area = 0;
        let cx = 0;
        let cy = 0;
        const n = vertices.length;

        for (let i = 0; i < n; i++) {
            const v0 = vertices[i];
            const v1 = vertices[(i + 1) % n];
            const cross = v0.x * v1.y - v1.x * v0.y;
            area += cross;
            cx += (v0.x + v1.x) * cross;
            cy += (v0.y + v1.y) * cross;
        }

        area /= 2;
        cx /= (6 * area);
        cy /= (6 * area);

        return { x: cx, y: cy };
    }
    /**
     * EDITOR ONLY — No physics body, no centroid shift.
     * Vertices are stored and drawn exactly as-is, relative to (x, y).
     * Use this in the level editor so Matter.js never touches your coordinates.
     */
    public static createPolygonEditor(vertices: Vector[], debugColor?: number): BodyDescription {
        const color = debugColor ?? this.DEFAULT_DEBUG_COLOR;
        const gfx = new PIXI.Graphics();

        gfx.lineStyle(2, color);
        gfx.beginFill(color, 0.2);
        gfx.drawPolygon(vertices.flatMap(v => [v.x, v.y]));
        gfx.endFill();

        // Stub body — never used in editor context
        return {
            body: null as any,
            debugGraphic: gfx,
            correctedVertices: vertices
        };
    }
    public static createComposite(x: number, y: number, parts: Body[], options?: IBodyDefinition, debugColor?: number): BodyDescription {
        const mainBody = Body.create({
            ...options,
            parts: parts,
            position: { x, y }
        });

        const gfx = new PIXI.Graphics();
        const color = debugColor ?? this.DEFAULT_DEBUG_COLOR;
        gfx.lineStyle(2, color);

        parts.forEach(part => {
            const vertices = part.vertices;
            const path = vertices.flatMap(v => [
                v.x - mainBody.position.x,
                v.y - mainBody.position.y
            ]);

            gfx.beginFill(color, 0.2);
            gfx.drawPolygon(path);
            gfx.endFill();
        });

        return { body: mainBody, debugGraphic: gfx };
    }
}