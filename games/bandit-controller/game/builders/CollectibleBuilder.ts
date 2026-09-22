// CollectibleBuilder.ts
//
// Shared "place a pickup + wire its collection payout" plumbing for every scene that spawns
// Collectible entities — HubScene's money piles, RunnerMinigameScene/SwipeMinigameScene's
// floating coins. One MoneyHud (see MoneyHud.ts) is shared across all of them via index.ts,
// so collecting a coin mid-run and collecting a money pile in the hub both fly to and update
// the SAME top-left counter — this is what wires a spawned pickup into that shared instance
// instead of each scene hand-rolling its own copy of the flying-icon-then-add-money dance.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import World from 'core/ecs/World';
import { WorldBendService } from 'core/services/BendService';
import Collectible from '../entities/Collectible';
import { CollectibleDefinition } from '../data/CollectibleSettings';
import { GameState } from '../data/GameState';
import MoneyHud from '../ui/MoneyHud';
import { spawnFlyingIconToOverlayPoint } from '../ui/FlyingResourceIcon';

/**
 * Spawns one Collectible at `position`, wires its onCollected payout into `moneyHud`, and
 * starts loading its mesh — the caller owns tracking the returned entity in its own array
 * and pruning it once `.collected` (see pruneCollected() below), same as it already had to
 * for RigidBody-bearing entities in general.
 */
export function spawnCollectible(
    world: World,
    threeScene: THREE.Scene,
    scene: ThreeScene,
    game: Game,
    moneyHud: MoneyHud,
    definition: CollectibleDefinition,
    position: THREE.Vector3,
    getPlayerPosition: () => THREE.Vector3,
    bendService: WorldBendService,
): Collectible {
    const collectible = world.add(new Collectible(definition, threeScene, getPlayerPosition, bendService));
    collectible.transform.position.copy(position);

    // Same "mutate the counter only once the icon actually LANDS, not when it departs"
    // convention bandit/legacy's QueueZone.flyRewardToWallet() follows (see
    // FlyingResourceIcon.ts's own doc) — captures the pickup's own position at the moment it
    // fires (already essentially at the player, since onCollected only dispatches once the
    // homing arc has fully landed), not before.
    collectible.onCollected.add((amount) => {
        spawnFlyingIconToOverlayPoint(
            scene,
            game,
            collectible.transform.position.clone(),
            () => moneyHud.getMoneyIconOverlayPosition(),
            moneyHud.getIconTexture() ?? PIXI.Texture.WHITE,
            () => {
                GameState.addMoney(amount);
                moneyHud.setResourceCount(GameState.getMoney());
            },
        );
    });

    void collectible.load();
    return collectible;
}

/** Removes (and despawns) every collectible in `list` that flagged itself collected this tick — see Collectible.collected's own doc on why this can't happen mid-World-iteration. Call once per frame from the owning scene's own update(). */
export function pruneCollected(world: World, list: Collectible[]): void {
    for (let i = list.length - 1; i >= 0; i--) {
        const collectible = list[i];
        if (!collectible.collected) {
            continue;
        }
        list.splice(i, 1);
        world.remove(collectible);
    }
}
