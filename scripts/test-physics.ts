// test-physics.ts
//
// Plain deterministic regression test for games/pizza/game/physics — no
// rendering, no browser, no test framework: just build a couple of
// Entities/RigidBodies exactly like PizzaScene does and assert on the
// numbers after stepping PhysicsWorld. Run with `npm run test:physics`.
//
// Exists specifically to pin down the "player thrown out of the scene"
// regression: a body resting on the ground must stay put over many small
// steps, and one abnormally large raw delta (the exact failure mode when
// physics ran off Game's unclamped variable delta) must NOT fling it
// across the map. If either check ever fails again, this script exits 1.

import * as THREE from 'three';
import Entity from '../games/pizza/game/ecs/Entity';
import RigidBody from '../games/pizza/game/physics/RigidBody';
import PhysicsWorld from '../games/pizza/game/physics/PhysicsWorld';
import { ALL_LAYERS, Layers, MAX_PHYSICS_DELTA } from '../games/pizza/game/physics/PhysicsConstants';

let failures = 0;

function assert(condition: boolean, message: string): void {
    if (condition) {
        console.log(`  ok   ${message}`);
    } else {
        failures += 1;
        console.error(`  FAIL ${message}`);
    }
}

function makeGround(world: PhysicsWorld): void {
    const ground = new Entity();
    const groundBody = ground.addComponent(new RigidBody({
        halfExtents: new THREE.Vector3(100, 0.5, 100),
        isStatic: true,
        centerOffset: new THREE.Vector3(0, -0.5, 0),
    }));
    world.register(groundBody);
}

function makePlayer(world: PhysicsWorld): { entity: Entity; body: RigidBody } {
    const entity = new Entity();
    const body = entity.addComponent(new RigidBody({
        halfExtents: new THREE.Vector3(0.4, 0.9, 0.4),
        centerOffset: new THREE.Vector3(0, 0.9, 0),
    }));
    world.register(body);
    return { entity, body };
}

console.log('Test 1: resting on the ground stays put over many small fixed steps');
{
    const world = new PhysicsWorld();
    makeGround(world);
    const { entity } = makePlayer(world);

    for (let i = 0; i < 300; i++) {
        world.step(1 / 60);
    }

    assert(Math.abs(entity.transform.position.y) < 0.01, `player.y stayed near 0 (was ${entity.transform.position.y.toFixed(4)})`);
    assert(Math.abs(entity.transform.position.x) < 0.01, `player.x didn't drift (was ${entity.transform.position.x.toFixed(4)})`);
    assert(Math.abs(entity.transform.position.z) < 0.01, `player.z didn't drift (was ${entity.transform.position.z.toFixed(4)})`);
}

console.log('Test 2: one abnormally large raw delta must not fling the player (the actual regression)');
{
    const world = new PhysicsWorld();
    makeGround(world);
    const { entity } = makePlayer(world);

    // Simulates the real failure mode: a multi-second stall (FBX load blocking the
    // main thread) reporting one huge delta on the next frame, fed straight into a
    // single physics step.
    world.step(3);

    assert(entity.transform.position.y > -1, `player didn't tunnel through the ground (y=${entity.transform.position.y.toFixed(4)})`);
    assert(Math.abs(entity.transform.position.x) < 1, `player wasn't flung sideways in X (x=${entity.transform.position.x.toFixed(4)})`);
    assert(Math.abs(entity.transform.position.z) < 1, `player wasn't flung sideways in Z (z=${entity.transform.position.z.toFixed(4)})`);
    assert(MAX_PHYSICS_DELTA <= 1 / 20 + 1e-9, `MAX_PHYSICS_DELTA is still clamped small (${MAX_PHYSICS_DELTA})`);
}

console.log('Test 3: walking straight into a static box stops the player instead of clipping through');
{
    const world = new PhysicsWorld();
    makeGround(world);
    const { entity, body } = makePlayer(world);

    const box = new Entity();
    box.transform.position.set(0, 0, 4);
    const boxBody = box.addComponent(new RigidBody({
        halfExtents: new THREE.Vector3(0.5, 0.5, 0.5),
        isStatic: true,
        centerOffset: new THREE.Vector3(0, 0.5, 0),
    }));
    world.register(boxBody);

    body.velocity.z = 3; // walk toward the box at a normal move speed
    for (let i = 0; i < 600; i++) { // 10 seconds at 60Hz — plenty to reach and rest against it
        world.step(1 / 60);
    }

    const boxNearFaceZ = 4 - 0.5; // box center Z minus its own half-extent
    const playerFrontZ = entity.transform.position.z + 0.4; // player center Z plus its own half-extent
    assert(playerFrontZ <= boxNearFaceZ + 0.01, `player stopped at the box's face instead of clipping through (front=${playerFrontZ.toFixed(4)}, box face=${boxNearFaceZ})`);
}

console.log('Test 4: a trigger never blocks movement, but still fires onTriggerEnter/Stay/Exit on both sides');
{
    const world = new PhysicsWorld();
    // No ground here, deliberately — gravity would drop the player out of the trigger
    // zone's Y band long before it travels far enough in Z to reach it, and a ground body
    // would give onCollisionEnter a second, legitimate reason to fire that this test isn't
    // trying to isolate. useGravity:false keeps this purely a Z-axis walk-through.
    const entity = new Entity();
    const body = entity.addComponent(new RigidBody({
        halfExtents: new THREE.Vector3(0.4, 0.9, 0.4),
        centerOffset: new THREE.Vector3(0, 0.9, 0),
        useGravity: false,
    }));
    world.register(body);

    const zone = new Entity();
    zone.transform.position.set(0, 0, 4);
    const zoneBody = zone.addComponent(new RigidBody({
        halfExtents: new THREE.Vector3(0.5, 0.5, 0.5),
        isStatic: true,
        isTrigger: true,
        centerOffset: new THREE.Vector3(0, 0.5, 0),
    }));
    world.register(zoneBody);

    const playerEvents: string[] = [];
    const zoneEvents: string[] = [];
    body.onTriggerEnter.add(() => playerEvents.push('enter'));
    body.onTriggerStay.add(() => playerEvents.push('stay'));
    body.onTriggerExit.add(() => playerEvents.push('exit'));
    zoneBody.onTriggerEnter.add(() => zoneEvents.push('enter'));
    zoneBody.onTriggerStay.add(() => zoneEvents.push('stay'));
    zoneBody.onTriggerExit.add(() => zoneEvents.push('exit'));
    // A trigger must never fire the solid-collision events instead.
    body.onCollisionEnter.add(() => { throw new Error('onCollisionEnter should never fire for a trigger pair'); });

    body.velocity.z = 3; // walk straight through the zone toward Z=10
    for (let i = 0; i < 600; i++) { // 10 seconds — plenty to pass all the way through
        world.step(1 / 60);
    }

    assert(entity.transform.position.z > 6, `player passed straight through the trigger instead of stopping (z=${entity.transform.position.z.toFixed(4)})`);
    assert(playerEvents[0] === 'enter', `player fired onTriggerEnter on the way in (events: ${playerEvents.join(',')})`);
    assert(playerEvents.includes('stay'), `player fired onTriggerStay while passing through (events: ${playerEvents.join(',')})`);
    assert(playerEvents[playerEvents.length - 1] === 'exit', `player fired onTriggerExit on the way out (events: ${playerEvents.join(',')})`);
    assert(zoneEvents.join(',') === playerEvents.join(','), `the zone's own RigidBody fired the identical enter/stay/exit sequence (zone: ${zoneEvents.join(',')}, player: ${playerEvents.join(',')})`);
}

console.log('Test 5: a solid (non-trigger) pair fires onCollisionEnter/Stay/Exit while resting against it, never the trigger events');
{
    const world = new PhysicsWorld();
    makeGround(world);
    const { body } = makePlayer(world);

    const box = new Entity();
    box.transform.position.set(0, 0, 4);
    const boxBody = box.addComponent(new RigidBody({
        halfExtents: new THREE.Vector3(0.5, 0.5, 0.5),
        isStatic: true,
        centerOffset: new THREE.Vector3(0, 0.5, 0),
    }));
    world.register(boxBody);

    const events: string[] = [];
    body.onCollisionEnter.add(() => events.push('enter'));
    body.onCollisionStay.add(() => events.push('stay'));
    body.onTriggerEnter.add(() => { throw new Error('onTriggerEnter should never fire for a solid pair'); });

    body.velocity.z = 3;
    for (let i = 0; i < 600; i++) {
        world.step(1 / 60);
    }

    assert(events[0] === 'enter', `onCollisionEnter fired once on contact (events so far: ${events.slice(0, 3).join(',')})`);
    assert(events.filter(e => e === 'stay').length > 10, `onCollisionStay kept firing while resting against the box (${events.filter(e => e === 'stay').length} stays)`);
}

console.log('Test 6: mismatched layer masks skip interaction entirely — no push-out, no events');
{
    const world = new PhysicsWorld();
    // No ground — it defaults to Layers.Default, which restrictedBody's mask still
    // includes, so it would legitimately fire onCollisionEnter on contact and confuse
    // this test's assertion, which is specifically isolating the box/Environment exclusion.

    const restrictedPlayer = new Entity();
    const restrictedBody = restrictedPlayer.addComponent(new RigidBody({
        halfExtents: new THREE.Vector3(0.4, 0.9, 0.4),
        centerOffset: new THREE.Vector3(0, 0.9, 0),
        useGravity: false,
        layer: Layers.Player,
        mask: ALL_LAYERS & ~Layers.Environment, // explicitly won't interact with Layers.Environment
    }));
    world.register(restrictedBody);
    restrictedPlayer.transform.position.set(0, 0, 0);

    const box = new Entity();
    box.transform.position.set(0, 0, 4);
    const boxBody = box.addComponent(new RigidBody({
        halfExtents: new THREE.Vector3(0.5, 0.5, 0.5),
        isStatic: true,
        layer: Layers.Environment,
        centerOffset: new THREE.Vector3(0, 0.5, 0),
    }));
    world.register(boxBody);

    let fired = false;
    restrictedBody.onCollisionEnter.add(() => { fired = true; });

    restrictedBody.velocity.z = 3;
    for (let i = 0; i < 600; i++) {
        world.step(1 / 60);
    }

    assert(restrictedPlayer.transform.position.z > 10, `body with a mismatched mask walked straight through the box instead of stopping (z=${restrictedPlayer.transform.position.z.toFixed(4)})`);
    assert(!fired, 'onCollisionEnter never fired for a layer/mask-excluded pair');
}

if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
}

console.log('\nAll physics regression checks passed.');
