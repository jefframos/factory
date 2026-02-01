import * as PIXI from "pixi.js";
import { EntityView } from "../manager/EntityManager";
import { MergeEgg } from "./MergeEgg";

export class EntityGridView extends PIXI.Container {
    // Only "pickable" entities (for raycast / merge checks). Coins are not included here.
    private entities: (EntityView)[] = [];

    private active?: PIXI.DisplayObject;

    public constructor() {
        super();
        this.sortableChildren = true; // required for zIndex sorting
    }

    public getTileAt(localPos: PIXI.Point): any | null {
        return null;
    }
    private static distSq(a: PIXI.Point, b: PIXI.Point): number {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return dx * dx + dy * dy;
    }

    public setActive(entity: PIXI.DisplayObject | null): void {
        // restore previous active depth
        if (this.active) {
            this.active.zIndex = this.active.y;
        }

        this.active = entity ?? undefined;

        if (this.active) {
            // Force it to the front (must be larger than any normal y)
            this.active.zIndex = 1_000_000_000;
        }
    }

    public addEntity(entity: EntityView): void {
        this.entities.push(entity);
        this.addChild(entity);

        // initial depth
        entity.zIndex = entity.y;
    }

    public removeEntity(entity: EntityView): void {
        const index = this.entities.indexOf(entity);
        if (index > -1) {
            this.entities.splice(index, 1);
        }

        if (this.active === entity) {
            this.setActive(null);
        }

        if (entity.parent === this) {
            this.removeChild(entity);
        }
    }

    // Coins should use this so they live in the same container and get depth sorting.
    public addFloating(child: PIXI.DisplayObject): void {
        this.addChild(child);
        child.zIndex = child.y;
    }

    public removeFloating(child: PIXI.DisplayObject): void {
        if (this.active === child) {
            this.setActive(null);
        }
        if (child.parent === this) {
            this.removeChild(child);
        }
    }

    // Raycasting logic for the Input class (pickables only)
    public getEntityAt(globalPos: PIXI.Point, ignore?: any): any {
        const hits: any[] = [];

        for (let i = 0; i < this.entities.length; i++) {
            const ent = this.entities[i];

            if (ent === ignore || !ent.visible) continue;

            if (ent.getBounds().contains(globalPos.x, globalPos.y)) {
                hits.push(ent);
            }
        }

        if (hits.length === 0) return null;
        if (hits.length === 1) return hits[0];

        hits.sort((a, b) => {
            const aIsEgg = a instanceof MergeEgg;
            const bIsEgg = b instanceof MergeEgg;

            if (aIsEgg && !bIsEgg) return -1;
            if (!aIsEgg && bIsEgg) return 1;

            return b.y - a.y;
        });

        return hits[0];
    }

    public getEntityNear(globalPos: PIXI.Point, radiusPx: number, ignore?: any): any {
        const hits: any[] = [];
        const r2 = radiusPx * radiusPx;

        for (let i = 0; i < this.entities.length; i++) {
            const ent = this.entities[i];
            if (ent === ignore || !ent.visible) continue;

            const entGlobal = ent.getGlobalPosition(new PIXI.Point());

            if (EntityGridView.distSq(entGlobal, globalPos) <= r2) {
                hits.push(ent);
            }
        }

        if (hits.length === 0) return null;
        if (hits.length === 1) return hits[0];

        hits.sort((a, b) => {
            const aIsEgg = a instanceof MergeEgg;
            const bIsEgg = b instanceof MergeEgg;

            if (aIsEgg && !bIsEgg) return -1;
            if (!aIsEgg && bIsEgg) return 1;

            return b.y - a.y;
        });

        return hits[0];
    }

    public update(delta: number, bounds: PIXI.Rectangle): void {
        // Update pickables
        // console.log(bounds)
        for (let i = 0; i < this.entities.length; i++) {
            const ent = this.entities[i] as any;
            if (typeof ent.update === "function") {
                ent.update(delta, bounds);
            }
        }

        // Depth-sort ALL children by Y every frame (simple and robust).
        // If you want micro-optimizations later, we can make it "dirty only".
        for (let i = 0; i < this.children.length; i++) {
            const c = this.children[i];

            if (c === this.active) {
                continue;
            }

            c.zIndex = c.y;
        }

        if (this.active) {
            this.active.zIndex = 1_000_000_000;
        }
    }
}
