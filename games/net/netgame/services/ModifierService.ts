import { BasePhysicsEntity } from "@core/phyisics/entities/BaseEntity";
import Physics from "@core/phyisics/Physics";
import { Body } from "matter-js";
import { ModifierDescriptor, ModifierTrigger } from "../level/LevelTypes";
import { CarRegistry } from "../truck/CarRegistry";

export class ModifierService {
    public static register(entity: BasePhysicsEntity, mod: ModifierDescriptor): void {
        const body = entity.body;
        const triggerMap = {
            [ModifierTrigger.ON_START]: Physics.events.onStart,
            [ModifierTrigger.ON_ACTIVE]: Physics.events.onActive,
            [ModifierTrigger.ON_END]: Physics.events.onEnd,
        };

        const registerFn = triggerMap[mod.trigger];
        if (registerFn) {
            registerFn(body, (other) => this.execute(entity, other, mod));
        }
    }

    private static execute(source: BasePhysicsEntity, other: Body, mod: ModifierDescriptor): void {
        const target = CarRegistry.resolveToTruck(other);
        if (!target) return;

        let fx = mod.force.x;
        let fy = mod.force.y;
        const multiplier = mod.multiplier ?? 1;

        // Handle Radial (Old "Bouncer" logic)
        if (mod.useRadialDirection) {
            const angle = Math.atan2(
                target.position.y - source.body.position.y,
                target.position.x - source.body.position.x
            );
            // We use the magnitude of the provided force vector
            const magnitude = Math.sqrt(fx * fx + fy * fy);
            fx = Math.cos(angle) * magnitude;
            fy = Math.sin(angle) * magnitude;
        }

        const finalForce = {
            x: fx * multiplier,
            y: fy * multiplier
        };

        // Apply based on Mode
        switch (mod.mode) {
            case 'add':
                Body.setVelocity(target, {
                    x: target.velocity.x + finalForce.x,
                    y: target.velocity.y + finalForce.y
                });
                break;
            case 'set':
                Body.setVelocity(target, finalForce);
                break;
            case 'multiply':
                Body.setVelocity(target, {
                    x: target.velocity.x * finalForce.x,
                    y: target.velocity.y * finalForce.y
                });
                break;
        }
    }
}