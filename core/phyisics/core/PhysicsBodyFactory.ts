import { Bodies, Body, IBodyDefinition, Vector } from 'matter-js';
import * as PIXI from 'pixi.js';

export interface BodyDescription {
    body: Body;
    debugGraphic: PIXI.Graphics;
}

export class PhysicsBodyFactory {
    private static DEBUG_COLOR = 0x00FF00; // Bright green for physics

    public static createRect(x: number, y: number, w: number, h: number, options?: any): BodyDescription {
        const body = Bodies.rectangle(x, y, w, h, options);
        const gfx = new PIXI.Graphics();
        gfx.lineStyle(2, this.DEBUG_COLOR);

        // Always draw relative to (0,0) because this graphic 
        // will be childed to a container that we move to body.position
        gfx.drawRect(-w / 2, -h / 2, w, h);

        return { body, debugGraphic: gfx };
    }

    public static createCircle(x: number, y: number, radius: number, options?: any): BodyDescription {
        const body = Bodies.circle(x, y, radius, options);
        const gfx = new PIXI.Graphics();
        gfx.lineStyle(2, this.DEBUG_COLOR);
        gfx.drawCircle(0, 0, radius);
        // Add a line so we can see the rotation
        gfx.moveTo(0, 0).lineTo(radius, 0);
        return { body, debugGraphic: gfx };
    }
    public static createPolygonFromVertices(x: number, y: number, vertexSets: any[], options: any): BodyDescription {
        // 1. Create the body (poly-decomp will split this into parts)
        const body = Bodies.fromVertices(x, y, [vertexSets], options);

        const graphic = new PIXI.Graphics();
        graphic.lineStyle(2, 0x00FF00); // Debug Green
        graphic.beginFill(0x00FF00, 0.2);

        // 2. Matter.js structure: body.parts[0] is the body itself.
        // body.parts[1...] are the convex shapes created by decomposition.
        // We want to draw each individual part.
        for (let i = 1; i < body.parts.length; i++) {
            const part = body.parts[i];

            const path = part.vertices.map(v => ({
                x: v.x - body.position.x,
                y: v.y - body.position.y
            }));

            graphic.drawPolygon(path);
        }

        graphic.endFill();

        return {
            body: body,
            debugGraphic: graphic
        };
    }
    public static createPolygon(x: number, y: number, vertices: Vector[], options?: IBodyDefinition): BodyDescription {
        // 1. Create the body
        const body = Bodies.fromVertices(x, y, [vertices], options);

        // 2. IMPORTANT: Matter might have re-centered the body. 
        // We must use the vertices from the 'body' object itself to draw correctly.
        const gfx = new PIXI.Graphics();
        gfx.lineStyle(2, this.DEBUG_COLOR);
        gfx.beginFill(this.DEBUG_COLOR, 0.2);

        // We extract the points relative to the body's center
        const bodyVertices = body.vertices;
        const path = bodyVertices.flatMap(v => [
            v.x - body.position.x,
            v.y - body.position.y
        ]);

        gfx.drawPolygon(path);
        gfx.endFill();

        return { body, debugGraphic: gfx };
    }

    public static createComposite(x: number, y: number, parts: Body[], options?: IBodyDefinition): BodyDescription {
        // Create the main container body
        const mainBody = Body.create({
            ...options,
            parts: parts, // Matter.js uses the first part in this array as the 'parent'
            position: { x, y }
        });

        const gfx = new PIXI.Graphics();
        gfx.lineStyle(2, this.DEBUG_COLOR);

        // Draw each part's shape into the single debug graphic
        parts.forEach(part => {
            // We draw vertices relative to the main body position
            const vertices = part.vertices;

            // Matter.js vertices are absolute in world space after Body.create
            // We subtract the mainBody position to draw them correctly inside the PIXI Container
            const path = vertices.flatMap(v => [
                v.x - mainBody.position.x,
                v.y - mainBody.position.y
            ]);

            gfx.beginFill(this.DEBUG_COLOR, 0.2); // Light fill to see the parts
            gfx.drawPolygon(path);
            gfx.endFill();
        });

        return { body: mainBody, debugGraphic: gfx };
    }
}