import { CollisionLayer } from "@core/phyisics/core/CollisionLayer";
import Physics from "@core/phyisics/Physics";
import { Body, Constraint } from "matter-js";
import * as PIXI from "pixi.js";
import { CargoEntity } from "./CargoEntity";

export interface ICargoGridItem {
    id: string;
    size: { w: number, h: number };      // Grid units (e.g., 2x2)
    position: { x: number, y: number };  // x = column index, y = manual override (optional)
}

export class CarCargoSystem {
    private truck: Body;
    private gridUnit: number = 20;

    /** * Local offset: The "Zero" point of the cargo bed relative to truck center.
     * Adjust these to match your truck's visual cargo area.
     */
    private bedOffset = { x: 0, y: -15 };
    private renderTarget: PIXI.Container;

    private activeCargo: CargoEntity[] = [];
    private constraints: Constraint[] = [];

    /** * Stacking Logic: Tracks current height (in grid units) for each column.
     * Key: Column Index (x), Value: Total height currently occupied.
     */
    private columnHeights: Map<number, number> = new Map();

    constructor(truckBody: Body, renderTarget: PIXI.Container) {
        this.truck = truckBody;
        this.renderTarget = renderTarget;
    }

    /**
     * Adds a piece of cargo to the truck.
     * @param item The grid definitions.
     * @param isWelded If true, uses a constraint to fix the cargo to the truck (ignoring gravity/sliding).
     */
    public addCargoItem(item: ICargoGridItem, isWelded: boolean = true): void {
        const cargo = new CargoEntity();

        // 1. Calculate Stacking height
        const currentHeight = this.columnHeights.get(item.position.x) || 0;

        // 2. Local-to-Truck Coordinates
        // Horizontal: Bed start + (column * unit) + half width for center
        const localX = this.bedOffset.x + (item.position.x * this.gridUnit) + (item.size.w * this.gridUnit / 2);

        // Vertical: Bed start - (current stacked height * unit) - half height for center
        // Note: Y is negative because "Up" is negative in screen space
        const localY = this.bedOffset.y - (currentHeight * this.gridUnit) - (item.size.h * this.gridUnit / 2);

        // 3. World Transformation (Rotation Matrix)
        const cos = Math.cos(this.truck.angle);
        const sin = Math.sin(this.truck.angle);

        const worldX = this.truck.position.x + (localX * cos - localY * sin);
        const worldY = this.truck.position.y + (localX * sin + localY * cos);

        // 4. Build and Add
        this.renderTarget.addChild(cargo.view);
        cargo.build({
            x: worldX,
            y: worldY,
            width: item.size.w * this.gridUnit,
            height: item.size.h * this.gridUnit,
            layer: CollisionLayer.CARGO
        });

        // 5. Physics Link (Weld)
        if (isWelded) {
            const weld = Constraint.create({
                bodyA: this.truck,
                bodyB: cargo.body,
                pointA: { x: localX, y: localY },
                pointB: { x: 0, y: 0 },
                stiffness: 1.0, // Solid weld
                length: 0,
                render: { visible: false }
            });



            Physics.addConstraint(weld);
            this.constraints.push(weld);

            cargo.body.isSensor = true
            // Set cargo to fixed rotation to match truck perfectly
            Body.setAngle(cargo.body, this.truck.angle);
        }

        // 6. Finalize tracking
        this.activeCargo.push(cargo);
        this.columnHeights.set(item.position.x, currentHeight + item.size.h);
    }

    /**
     * Resets the cargo area. Use this on respawn or level start.
     */
    public reset(): void {
        this.activeCargo.forEach(c => {
            Physics.removeBody(c.body);
            c.destroy();
        });

        this.constraints.forEach(c => Physics.removeConstraint(c));

        this.activeCargo = [];
        this.constraints = [];
        this.columnHeights.clear();
    }

    /**
     * Standard bulk setter for level loading.
     */
    public setCargo(items: ICargoGridItem[]): void {
        this.reset();
        items.forEach(item => this.addCargoItem(item, true));
    }

    public fixedUpdate(delta: number): void {
        this.activeCargo.forEach(c => c.fixedUpdate(delta));
    }

    public update(delta: number): void {
        this.activeCargo.forEach(c => c.update(delta));
    }
}