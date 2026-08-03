// test-actions.ts
//
// Plain deterministic regression test for PlayerActionController/
// FacingComponent (games/pizza/game/components/) — no rendering, no
// browser, no FBX assets needed: ThirdPersonCharacter/CharacterBody's
// fields (container, targetRotation) all initialize eagerly in their
// constructors, so FacingComponent's actual rotation effect is testable
// without ever calling loadMesh(). Run with `npm run test:actions`.
//
// Wrapped in an async main() (rather than top-level await) since this runs
// through ts-node with --compiler-options module:commonjs.
//
// Note this deliberately does NOT build a PlayerMovementController: since
// actions no longer freeze movement (walking away is the cancel gesture —
// see PlayerActionController's own doc), PlayerActionController has no
// reference to it whatsoever, so "an action can't disturb movement" is a
// structural property of the imports rather than something to assert at
// runtime. Leaving it out also keeps this file clear of the real Pixi input
// stack (see scripts/headlessShims.ts, which test-gather.ts needs for that).

import * as THREE from 'three';
import Entity from '../games/pizza/game/ecs/Entity';
import RigidBody from '../games/pizza/game/physics/RigidBody';
import PlayerActionController from '../games/pizza/game/components/PlayerActionController';
import FacingComponent from '../games/pizza/game/components/FacingComponent';
import CharacterVisualComponent from '../games/pizza/game/components/CharacterVisualComponent';
import ThirdPersonCharacter from '../games/pizza/game/entities/ThirdPersonCharacter';
import { ActionType, ACTION_CONFIG } from '../games/pizza/game/actions/ActionTypes';

let failures = 0;

function assert(condition: boolean, message: string): void {
    if (condition) {
        console.log(`  ok   ${message}`);
    } else {
        failures += 1;
        console.error(`  FAIL ${message}`);
    }
}

function makePlayer(): { entity: Entity; action: PlayerActionController } {
    const entity = new Entity();
    entity.addComponent(new RigidBody({ halfExtents: new THREE.Vector3(0.4, 0.9, 0.4), useGravity: false }));
    entity.addComponent(new FacingComponent());
    const action = entity.addComponent(new PlayerActionController());
    return { entity, action };
}

/** Bare ActionTarget stand-in — PlayerActionController only needs a position + applyHit(), so these tests don't need a real ResourceNode (that pairing is covered end-to-end in test-gather.ts). Records hits so the interval/damage schedule is directly observable. */
function makeTarget(life: number, position: THREE.Vector3 = new THREE.Vector3(5, 0, 0)) {
    const target = {
        position,
        life,
        hits: 0,
        applyHit(damage: number): boolean {
            target.hits += 1;
            target.life -= damage;
            return target.life <= 0;
        },
    };
    return target;
}

async function main(): Promise<void> {
    console.log('Test 1: starting an action marks it busy immediately (synchronously, before any tick) and leaves velocity alone');
    {
        // The player is deliberately NOT frozen during an action — walking away is the
        // cancel gesture (see Test 3 / PlayerActionController's own doc), so freezing
        // movement would make cancellation unreachable.
        const { entity, action } = makePlayer();
        const rigidBody = entity.getComponent(RigidBody)!;
        rigidBody.velocity.set(3, 0, 0); // pretend the player was already moving

        void action.onPlayActionAnimation(ActionType.Chop, makeTarget(3));

        assert(rigidBody.velocity.x === 3 && rigidBody.velocity.z === 0, 'RigidBody velocity is left alone, so movement genuinely continues during the action');
        assert(action.isBusy, 'isBusy reflects the in-flight action');
    }

    console.log('Test 2: hits land one per hitIntervalSec, and the action completes when the target runs out of life');
    {
        const { entity, action } = makePlayer();
        const config = ACTION_CONFIG[ActionType.Chop];
        // 3 life at damagePerHit=1 means exactly 3 hits to clear.
        const target = makeTarget(3 * config.damagePerHit);

        let result: string | undefined;
        const promise = action.onPlayActionAnimation(ActionType.Chop, target).then(r => { result = r; });

        // Deliberately stepping in whole intervals rather than 1/60ths: it makes the hit
        // schedule exact instead of depending on how 1/60 accumulates in floating point.
        entity.update(config.hitIntervalSec / 2);
        assert(target.hits === 0, `no hit yet halfway through the first interval (hits=${target.hits})`);

        entity.update(config.hitIntervalSec / 2);
        assert(target.hits === 1, `first hit landed on the interval boundary (hits=${target.hits})`);
        assert(action.isBusy, 'still busy — the target has life left');

        entity.update(config.hitIntervalSec);
        assert(target.hits === 2, `second hit landed one interval later (hits=${target.hits})`);
        assert(action.isBusy, 'still busy after the second of three hits');

        entity.update(config.hitIntervalSec);
        await promise;

        assert(target.hits === 3, `third hit landed and finished the target (hits=${target.hits})`);
        assert(result === 'completed', `resolved with 'completed' (got '${result}')`);
        assert(!action.isBusy, 'isBusy cleared on completion');
    }

    console.log("Test 3: cancel() ends the action as 'cancelled', stops further hits, and leaves the target's remaining life intact");
    {
        const { entity, action } = makePlayer();
        const config = ACTION_CONFIG[ActionType.Chop];
        const target = makeTarget(5 * config.damagePerHit);

        let result: string | undefined;
        const promise = action.onPlayActionAnimation(ActionType.Chop, target).then(r => { result = r; });

        entity.update(config.hitIntervalSec);
        entity.update(config.hitIntervalSec);
        assert(target.hits === 2, `two hits landed before cancelling (hits=${target.hits})`);
        const lifeAtCancel = target.life;

        action.cancel();
        await promise;

        assert(result === 'cancelled', `resolved with 'cancelled' (got '${result}')`);
        assert(!action.isBusy, 'isBusy cleared on cancel');
        assert(action.target === undefined, 'the cancelled action no longer holds its target');

        // Keep ticking well past several more intervals — nothing should keep hitting it.
        for (let i = 0; i < 5; i++) {
            entity.update(config.hitIntervalSec);
        }
        assert(target.hits === 2, `no further hits after cancelling (hits=${target.hits})`);
        assert(target.life === lifeAtCancel, `target kept the life it had at cancel time (${target.life} vs ${lifeAtCancel}) — returning later resumes rather than restarting`);
    }

    console.log('Test 4: starting a second action while one is already in flight throws instead of silently overwriting it');
    {
        const { action } = makePlayer();
        void action.onPlayActionAnimation(ActionType.Chop, makeTarget(3));

        let threw = false;
        try {
            void action.onPlayActionAnimation(ActionType.Mine, makeTarget(3));
        } catch {
            threw = true;
        }
        assert(threw, 'calling onPlayActionAnimation() while already busy throws synchronously');
    }

    console.log('Test 5: FacingComponent turns the character toward the target over several frames, without needing a loaded FBX mesh');
    {
        const entity = new Entity();
        const facing = entity.addComponent(new FacingComponent());
        const character = new ThirdPersonCharacter(); // constructed, never loadMesh()'d — container/targetRotation exist regardless
        entity.addComponent(new CharacterVisualComponent(character));

        entity.transform.position.set(0, 0, 0);
        facing.faceToward(new THREE.Vector3(10, 0, 0)); // due +X

        const initialAngle = new THREE.Euler().setFromQuaternion(character.container.quaternion).y;
        for (let i = 0; i < 30; i++) {
            entity.update(1 / 60);
        }
        const turnedAngle = new THREE.Euler().setFromQuaternion(character.container.quaternion).y;

        assert(Math.abs(turnedAngle - initialAngle) > 0.05, `character actually rotated toward the target over 30 frames (from ${initialAngle.toFixed(3)} to ${turnedAngle.toFixed(3)} rad)`);

        // Let it fully converge (slerp asymptotically approaches its target, never bit-exactly
        // — so asserting exact quaternion equality one frame after clearTarget() would be
        // testing float-precision noise, not the actual behavior) before clearing.
        for (let i = 0; i < 300; i++) {
            entity.update(1 / 60);
        }
        const converged = character.container.quaternion.clone();

        facing.clearTarget();
        for (let i = 0; i < 30; i++) {
            entity.update(1 / 60);
        }
        const drift = converged.angleTo(character.container.quaternion);
        assert(drift < 1e-4, `clearTarget() leaves the character settled instead of drifting toward a new direction (drift=${drift})`);
    }

    if (failures > 0) {
        console.error(`\n${failures} check(s) failed.`);
        process.exit(1);
    }

    console.log('\nAll action-system regression checks passed.');
}

main();
