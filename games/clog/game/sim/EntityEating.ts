import { PlayerEntity } from "../entities/PlayerEntity";
import { CollectibleManager } from "../systems/CollectibleManager";
import { SimWorld } from "./SimWorld";
import { isFacingTarget } from "./VisionCone";

const KILL_SCATTER = 0.6; // world-units of random offset applied to dropped cubes

/**
 * Resolves eating between every pair of `entities` each frame — head-eats-head
 * kills and tail-snipe nibbles are both checked in both directions, so bots
 * and the player are symmetric threats to each other (not just player-as-eater).
 *
 * `entities` itself is not mutated. Killed entities are unregistered from
 * SimWorld and returned so the caller can react by identity — e.g. destroy a
 * bot outright but respawn the player, since PlayerEntity.onEaten() tears
 * down its visuals unconditionally.
 */
export function resolveEntityEating(
    entities: PlayerEntity[],
    collectibles: CollectibleManager,
): PlayerEntity[] {
    const eaten = new Set<PlayerEntity>();

    const kill = (victim: PlayerEntity, eater: PlayerEntity): void => {
        eater.notifyKill();
        const dropped = victim.onEaten();
        for (const cube of dropped) {
            // Unlike normal food spawns (LevelManager only picks from
            // grid-derived free cells), this scatter isn't checked against
            // the walkable grid — so it can knock a cube onto/inside an
            // obstacle tile, especially when the kill happens right next to
            // one (common: entities often die while wedged near terrain).
            // A cube embedded in an obstacle is permanently uncollectable —
            // the eater's own collision keeps it from ever getting close
            // enough to trigger pickup. Only apply the scatter if it lands
            // somewhere walkable; otherwise keep the un-scattered position,
            // which was walkable a moment ago since the victim stood there.
            const scatterX = cube.position.x + (Math.random() - 0.5) * KILL_SCATTER;
            const scatterZ = cube.position.z + (Math.random() - 0.5) * KILL_SCATTER;
            if (SimWorld.isWalkable(scatterX, scatterZ)) {
                cube.position.x = scatterX;
                cube.position.z = scatterZ;
            }
            cube.startSpawnPop();
        }
        collectibles.absorbDrop(dropped);
        SimWorld.unregister(victim);
        eaten.add(victim);
    };

    for (let i = 0; i < entities.length; i++) {
        const a = entities[i];
        if (eaten.has(a)) continue;

        for (let j = i + 1; j < entities.length; j++) {
            const b = entities[j];
            if (eaten.has(b)) continue;

            // Head-eats-head, checked in both directions: either side eats the
            // other once its value is at least the other's, AND two
            // conditions both hold — unlike food (grabbable from any side),
            // a kill requires the eater to actually be facing its victim:
            //   1. Range — a plain center-to-center radius check (no facing
            //      involved), so this step alone can't cause the rotation-
            //      dependent "stuck" behavior food pickup used to have.
            //   2. Cone vision — the victim must sit inside the eater's
            //      forward bite arc (see isFacingTarget), same as before.
            // Equal values are eatable too — `>=`, not `>` — so a same-value
            // head-on meeting is resolved by who's actually biting whom
            // rather than being blocked outright. A victim mid-spawn-
            // invincibility (see PlayerEntity.isInvincible) can't be killed
            // — checked on the victim only; an invincible entity can still
            // eat others normally.
            if (a.value >= b.value && !b.isInvincible
                && a.position.distanceTo(b.position) < a.eatRadius + b.collisionRadius
                && isFacingTarget(a.position, a.eatPosition, b.position)) {
                kill(b, a);
                continue; // b is gone — no tail-snipe left to resolve for this pair
            }
            if (b.value >= a.value && !a.isInvincible
                && b.position.distanceTo(a.position) < b.eatRadius + a.collisionRadius
                && isFacingTarget(b.position, b.eatPosition, a.position)) {
                kill(a, b);
                break; // a is gone — stop checking the rest of the row against it
            }

            // Tail-snipe, both directions: either side can nibble the other's
            // weaker tail cubes even without a head kill this frame. Same
            // invincibility guard as above — an invincible entity's tail
            // can't be sniped either.
            const cubeFromB = !b.isInvincible ? b.tryDetachTailCube(a.eatPosition, a.eatRadius, a.value) : null;
            if (cubeFromB) a.collect(cubeFromB);
            const cubeFromA = !a.isInvincible ? a.tryDetachTailCube(b.eatPosition, b.eatRadius, b.value) : null;
            if (cubeFromA) b.collect(cubeFromA);
        }
    }

    return [...eaten];
}
