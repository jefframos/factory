import { PlayerEntity } from "../entities/PlayerEntity";
import { CollectibleManager } from "../systems/CollectibleManager";
import { SimWorld } from "./SimWorld";

const KILL_SCATTER = 0.6; // world-units of random offset applied to dropped cubes

/**
 * Resolves eating between `eater` and a list of other live players each frame:
 *  - touching an opponent's head kills them if `eater` is bigger, scattering
 *    their whole body (tail + head) as loose food anyone can grab
 *  - touching an opponent's tail cube nibbles it off if it's smaller than `eater`
 * `others` is mutated in place: killed entities are removed and unregistered.
 */
export function resolveEntityEating(
    eater: PlayerEntity,
    others: PlayerEntity[],
    collectibles: CollectibleManager,
): void {
    const eatPos = eater.eatPosition;
    const eatRadius = eater.eatRadius;

    for (let i = others.length - 1; i >= 0; i--) {
        const victim = others[i];
        if (victim === eater) continue;

        const headDist = eatPos.distanceTo(victim.position);
        if (eater.value > victim.value && headDist < eatRadius + victim.collisionRadius) {
            const dropped = victim.onEaten();
            for (const cube of dropped) {
                cube.position.x += (Math.random() - 0.5) * KILL_SCATTER;
                cube.position.z += (Math.random() - 0.5) * KILL_SCATTER;
                cube.startSpawnPop();
            }
            collectibles.absorbDrop(dropped);
            SimWorld.unregister(victim);
            others.splice(i, 1);
            continue;
        }

        const cube = victim.tryDetachTailCube(eatPos, eatRadius, eater.value);
        if (cube) eater.collect(cube);
    }
}
