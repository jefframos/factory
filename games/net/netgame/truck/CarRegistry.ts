import { Body } from "matter-js";

// TruckRegistry.ts
export class CarRegistry {
    private static chassisMap = new Map<number, Body>(); // partBodyId -> chassisBody

    public static register(chassis: Body, parts: Body[]): void {
        parts.forEach(p => this.chassisMap.set(p.id, chassis));
        this.chassisMap.set(chassis.id, chassis); // chassis maps to itself
    }

    public static resolveToTruck(body: Body): Body {
        // Walk up compound parts first
        const root = (body.parent && body.parent !== body) ? body.parent : body;
        return this.chassisMap.get(root.id) ?? root;
    }

    public static unregister(chassis: Body, parts: Body[]): void {
        parts.forEach(p => this.chassisMap.delete(p.id));
        this.chassisMap.delete(chassis.id);
    }
}