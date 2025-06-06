import * as PIXI from 'pixi.js';
import * as SAT from 'sat';

export type ColliderShape = 'circle' | 'polygon';

export interface ColliderOptions {
    shape: ColliderShape;
    points?: PIXI.Point[];
    radius?: number;
    id?: string;
    position?: PIXI.IPointData;
    parent?: PIXI.Container;
    onCollideEnter?: (other: PIXI.Container | undefined) => void;
    onCollide?: (other: PIXI.Container | undefined) => void;
    onCollideExit?: (other: PIXI.Container | undefined) => void;
    trigger?: boolean;
}

export default class Collider {
    static currentID: number = 0;
    public _colliderID: number = Collider.currentID++;

    public enabled: boolean = true;
    public shape: ColliderShape;
    public points: PIXI.Point[];
    public radius: number;
    public position: PIXI.Point;
    public parent?: PIXI.Container;
    public id?: string;
    public onCollideEnter?: (other: PIXI.Container | undefined) => void;
    public onCollide?: (other: PIXI.Container | undefined) => void;
    public onCollideExit?: (other: PIXI.Container | undefined) => void;
    public readonly isTrigger: boolean;

    private _cachedShape: SAT.Circle | SAT.Polygon | null = null;
    public get colliderShape() {
        return this._cachedShape;
    }

    private canD: boolean = false;

    constructor(public options: ColliderOptions) {
        this.shape = options.shape;
        this.points = options.points ?? [];
        this.radius = options.radius ?? 0;
        this.id = options.id ?? "";
        const pos = options.position ?? { x: 0, y: 0 };
        this.position = new PIXI.Point(pos.x, pos.y);
        this.parent = options.parent;
        this.onCollideEnter = options.onCollideEnter;
        this.onCollide = options.onCollide;
        this.onCollideExit = options.onCollideExit;
        this.isTrigger = options.trigger ?? false;
        this.getSATShape(); // precompute shape
    }

    setPosition(x: number, y: number) {
        this.position.set(x, y);

        this._cachedShape?.pos.copy(new SAT.Vector(this.position.x, this.position.y))
    }

    private getWorldPos(): PIXI.Point {
        return this.parent ? this.parent.toGlobal(this.position) : this.position.clone();
    }

    getSATShape(): SAT.Circle | SAT.Polygon {
        const worldPos = this.getWorldPos();

        if (this._cachedShape) {
            this._cachedShape.pos.x = worldPos.x;
            this._cachedShape.pos.y = worldPos.y;
            return this._cachedShape;
        }

        if (this.shape === 'circle') {
            this._cachedShape = new SAT.Circle(
                new SAT.Vector(worldPos.x, worldPos.y),
                this.radius
            );
        } else {
            const verts = this.points.map(p => new SAT.Vector(p.x, p.y));
            this._cachedShape = new SAT.Polygon(new SAT.Vector(worldPos.x, worldPos.y), verts);
        }

        return this._cachedShape;
    }

    checkCollisionWithCircle(pos: PIXI.Point, radius: number, response: SAT.Response): SAT.Response {
        const player = new SAT.Circle(new SAT.Vector(pos.x, pos.y), radius);
        const other = this.getSATShape();

        let result = false;

        if (other instanceof SAT.Circle) {
            result = SAT.testCircleCircle(player, other, response);
        } else if (other instanceof SAT.Polygon) {
            result = SAT.testCirclePolygon(player, other, response);
        }

        return response;
    }
}
