import { Bodies, Body, IBodyDefinition, Vector } from 'matter-js';
import * as PIXI from 'pixi.js';

export interface BodyDescription {
    body: Body;
    debugGraphic: PIXI.Graphics;
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

    public static createPolygon(x: number, y: number, vertices: Vector[], options?: IBodyDefinition, debugColor?: number): BodyDescription {
        const body = Bodies.fromVertices(x, y, [vertices], options);
        const gfx = new PIXI.Graphics();
        const color = debugColor ?? this.DEFAULT_DEBUG_COLOR;

        gfx.lineStyle(2, color);
        gfx.beginFill(color, 0.2);

        const bodyVertices = body.vertices;
        const path = bodyVertices.flatMap(v => [
            v.x - body.position.x,
            v.y - body.position.y
        ]);

        gfx.drawPolygon(path);
        gfx.endFill();

        return { body, debugGraphic: gfx };
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