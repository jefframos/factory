import Physics from "@core/phyisics/Physics";
import { BasePhysicsEntity } from "@core/phyisics/entities/BaseEntity";
import { Body } from "matter-js";
import { ModifierDescriptor, ModifierTrigger } from "../level/LevelTypes";
import { CarRegistry } from "../truck/CarRegistry";

export class ModifierService {
    /**
     * Attaches logic to an entity based on its modifier descriptor
     */
    public static register(entity: BasePhysicsEntity, mod: ModifierDescriptor): void {
        const body = entity.body;


        mod.trigger = mod.trigger ?? ModifierTrigger.ON_START;
        console.log(`Registering ${mod.type} on body ${entity.body.id} - ${mod.trigger}`);

        switch (mod.trigger) {
            case ModifierTrigger.ON_START:
                Physics.events.onStart(body, (other) => this.execute(entity, other, mod));
                break;
            case ModifierTrigger.ON_ACTIVE:
                Physics.events.onActive(body, (other) => this.execute(entity, other, mod));
                break;
            case ModifierTrigger.ON_END:
                Physics.events.onEnd(body, (other) => this.execute(entity, other, mod));
                break;
        }
    }

    private static execute(source: BasePhysicsEntity, other: Body, mod: ModifierDescriptor): void {
        // Always target the main body (Chassis) if a part (Wheel) hits the modifier
        const target = CarRegistry.resolveToTruck(other);
        const force = mod.force || 1;
        console.log(force)

        switch (mod.type) {
            case 'boost':
                const dir = mod.direction || { x: 1, y: 0 };
                if (mod.trigger === ModifierTrigger.ON_ACTIVE) {
                    // Instead of setting or applying force, we 'nudge' the velocity
                    // every frame. This creates smooth, powerful acceleration.
                    Body.setVelocity(target, {
                        x: target.velocity.x + (dir.x * force),
                        y: target.velocity.y + (dir.y * force)
                    });
                } else {
                    // Instant kick for ON_START
                    Body.setVelocity(target, {
                        x: target.velocity.x + (dir.x * force * 10),
                        y: target.velocity.y + (dir.y * force * 10)
                    });
                }
                break;

            case 'trampoline':
                // Launch the whole assembly upward
                Body.setVelocity(target, {
                    x: target.velocity.x,
                    y: -force
                });
                break;

            case 'bouncer':
                const angle = Math.atan2(
                    target.position.y - source.body.position.y,
                    target.position.x - source.body.position.x
                );
                Body.setVelocity(target, {
                    x: Math.cos(angle) * force,
                    y: Math.sin(angle) * force
                });
                break;
        }
    }
}