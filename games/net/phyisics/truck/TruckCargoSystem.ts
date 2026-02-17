import { Body } from "matter-js";
import PIXI from "pixi.js";
import { CollisionLayer } from "../CollisionLayer";
import { CargoEntity } from "./CargoEntity";
export interface ICargoGridItem {
    id: string;
    size: { w: number, h: number };      // Grid units (e.g., 2x2)
    position: { x: number, y: number };  // Grid units (e.g., 0,0)
}
export class TruckCargoSystem {
    private truck: Body;
    private gridUnit: number = 20;
    // Local offset: Where the "Zero" of your cargo grid is relative to the truck center
    private bedOffset = { x: -60, y: -15 };
    private renderTarget: PIXI.Container;

    private activeCargo: CargoEntity[] = [];

    constructor(truckBody: Body, renderTarget: PIXI.Container) {
        this.truck = truckBody;
        this.renderTarget = renderTarget;
    }

    public setCargo(items: ICargoGridItem[]): void {
        items.forEach(item => {
            const cargo = new CargoEntity();

            // 1. Convert Grid units to Local Pixels
            // We add half the width/height to center the physics body on the grid cell
            const localX = this.bedOffset.x + (item.position.x * this.gridUnit) + (item.size.w * this.gridUnit / 2);
            const localY = this.bedOffset.y - (item.position.y * this.gridUnit) - (item.size.h * this.gridUnit / 2);

            // 2. Local-to-World Transformation (Rotation Matrix)
            const cos = Math.cos(this.truck.angle);
            const sin = Math.sin(this.truck.angle);

            const worldX = this.truck.position.x + (localX * cos - localY * sin);
            const worldY = this.truck.position.y + (localX * sin + localY * cos);

            this.renderTarget.addChild(cargo.view);

            // 3. Build using the Grid dimensions
            cargo.build({
                x: worldX,
                y: worldY,
                width: item.size.w * this.gridUnit,
                height: item.size.h * this.gridUnit,
                layer: CollisionLayer.CARGO
            });
            this.activeCargo.push(cargo);
            // 4. Match truck tilt
            Body.setAngle(cargo.body, this.truck.angle);
        });
    }

    public fixedUpdate(delta: number): void {
        this.activeCargo.forEach(c => {
            c.fixedUpdate(delta)
        });
    }

    public update(delta: number): void {
        this.activeCargo.forEach(c => {
            c.update(delta)
        });
    }
}