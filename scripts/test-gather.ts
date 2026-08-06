// test-gather.ts
//
// End-to-end regression test for the M2 gather/deposit loop — MainPlayer +
// ResourceNode + DropZone + AutoGatherController + BackpackStorage, all
// wired through a real World (so RigidBody self-registration, Entity.awake(),
// and World.fixedUpdate()'s "components first, then physics" ordering are
// all exercised for real, not stubbed). No rendering, no browser, no FBX
// assets — see test-actions.ts's own doc for why that's possible headlessly.
//
// BackpackStorage is a global singleton (see that file's own doc) shared
// across every test block in this one process — BackpackStorage.clearAll()
// at the top of each block is what keeps them from leaking into each other,
// unlike the old per-MainPlayer BackpackComponent instance that made
// isolation automatic.
//
// None of these MainPlayers ever call loadCharacter(), so
// CharacterVisualComponent never attaches and DropZone's
// getBackpackWorldPosition() always reads undefined — exercising its
// drainInstantly() fallback path (see DropZone.tryDeposit()'s own doc)
// rather than the flying-chip path. Both still drain one unit at a time via
// real gsap delayedCalls, though, so the drop-zone test below still needs a
// real sleep() (not just more world.fixedUpdate() calls) before asserting.
//
// Wrapped in an async main() (rather than top-level await) since this runs
// through ts-node with --compiler-options module:commonjs.
//
// headlessShims MUST be imported first — MainPlayer builds a real
// PlayerMovementController, which builds a real AnalogInput joystick, which
// constructs PIXI.Graphics and needs a `document`/canvas to exist.

import './headlessShims';
import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import World from '../games/pizza/game/ecs/World';
import RigidBody from '../games/pizza/game/physics/RigidBody';
import MainPlayer from '../games/pizza/game/player/MainPlayer';
import ResourceNode from '../games/pizza/game/player/ResourceNode';
import DropZone from '../games/pizza/game/player/DropZone';
import PlayerActionController from '../games/pizza/game/components/PlayerActionController';
import { ScreenAnchorHost } from '../games/pizza/game/components/ScreenAnchorComponent';
import { BackpackStorage } from '../games/pizza/game/data/BackpackStorage';
import { ResourceType, RESOURCE_CONFIG } from '../games/pizza/game/actions/ResourceTypes';

let failures = 0;

function assert(condition: boolean, message: string): void {
    if (condition) {
        console.log(`  ok   ${message}`);
    } else {
        failures += 1;
        console.error(`  FAIL ${message}`);
    }
}

/**
 * A REAL PIXI.Container, not a stub: PlayerMovementController builds an actual AnalogInput
 * joystick that parents Graphics into whatever it's given, so it needs genuine
 * addChild/eventMode/hitArea behavior. Works headlessly thanks to headlessShims.
 */
function makeFakeInputHost(): any {
    const host: any = new PIXI.Container();
    host.worldToScreen = () => null;
    return host;
}

/** worldToScreen returning a fixed on-screen point is enough here — this test checks the gather/deposit LOGIC, not ScreenAnchorComponent's own screen-space math. */
function makeScreenHost(): ScreenAnchorHost {
    return {
        worldToScreen: () => ({ x: 100, y: 100 }),
        overlayContainer: new PIXI.Container(),
    };
}

/** DropZone's default popup content is a real PIXI.Text, which needs an actual canvas/`document` to measure itself — unavailable in this headless run. A plain PIXI.Container stands in fine: this test only checks backpack counts, not what any popup looks like. */
function makeFakePopupContent(): PIXI.Container {
    return new PIXI.Container();
}

/** Same reasoning as makeFakePopupContent() — DropZone's default nameplate is also a real PIXI.Text. */
function makeFakeLabelContent(): PIXI.Container {
    return new PIXI.Container();
}

/** Real wall-clock wait — needed wherever a check depends on a gsap-driven delayedCall/tween (e.g. DropZone's staggered per-unit drain), since those run on gsap's own real-time ticker, not on this test's fixed-step world.fixedUpdate() calls. */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function addGround(world: World): void {
    const ground = world.spawn();
    ground.addComponent(new RigidBody({
        halfExtents: new THREE.Vector3(100, 0.5, 100),
        isStatic: true,
        centerOffset: new THREE.Vector3(0, -0.5, 0),
    }));
}

async function main(): Promise<void> {
    console.log('Test 1: walking into a resource node auto-starts gathering, and completing it fills the backpack + depletes the node');
    {
        BackpackStorage.clearAll();
        const world = new World();
        addGround(world);

        const player = world.add(new MainPlayer(makeFakeInputHost(), new THREE.Scene()));
        // Overlaps the node's trigger immediately (see this file's own doc math in the
        // original design notes — node at z=1, trigger half-extent 1, player half-extent 0.4).
        player.transform.position.set(0, 0, 0);

        const node = world.add(new ResourceNode(ResourceType.Tree, new THREE.Vector3(0, 0, 1)));

        world.fixedUpdate(1 / 60); // the step whose PhysicsWorld.updateContacts() fires onTriggerEnter

        const action = player.getComponent(PlayerActionController)!;
        assert(action.isBusy, 'AutoGatherController started the chop action automatically, with no explicit call from the test');
        assert(node.isAvailable, "the node isn't depleted yet — gather() only runs once the action completes, not when it starts");

        for (let i = 0; i < 600 && action.isBusy; i++) {
            world.fixedUpdate(1 / 60);
            world.update(1 / 60); // PlayerActionController's own countdown ticks here, not in fixedUpdate()
        }
        // resolve() runs synchronously inside that last update(), but AutoGatherController's
        // .then() (its completion log) is a queued microtask — flush it before checking
        // anything past this point. BackpackStorage.add() itself already ran synchronously,
        // once per landed hit (see AutoGatherController.onHitLanded()) — not deferred here.
        await Promise.resolve();

        assert(!action.isBusy, 'the action finished within a reasonable number of steps');
        const expectedWood = RESOURCE_CONFIG[ResourceType.Tree].maxLife * RESOURCE_CONFIG[ResourceType.Tree].amountPerGather;
        assert(BackpackStorage.getCount(ResourceType.Tree) === expectedWood, `backpack received one gather's worth of Wood PER HIT across the full harvest (expected ${expectedWood}, has ${BackpackStorage.getCount(ResourceType.Tree)})`);
        assert(!node.isAvailable, 'the node is depleted after yielding (respawn timer running)');
    }

    console.log('Test 2: a depleted node does not trigger a second gather until it respawns');
    {
        BackpackStorage.clearAll();
        const world = new World();
        addGround(world);
        const player = world.add(new MainPlayer(makeFakeInputHost(), new THREE.Scene()));
        player.transform.position.set(0, 0, 0);
        const node = world.add(new ResourceNode(ResourceType.Tree, new THREE.Vector3(0, 0, 1)));

        const action = player.getComponent(PlayerActionController)!;
        world.fixedUpdate(1 / 60); // starts the gather
        for (let i = 0; i < 600 && action.isBusy; i++) {
            world.fixedUpdate(1 / 60);
            world.update(1 / 60); // PlayerActionController's own countdown ticks here, not in fixedUpdate()
        }
        // resolve() runs synchronously inside that last update(), but AutoGatherController's
        // .then() (its completion log) is a queued microtask — flush it before checking
        // anything past this point. BackpackStorage.add() itself already ran synchronously,
        // once per landed hit — not deferred here.
        await Promise.resolve();
        const expectedWood = RESOURCE_CONFIG[ResourceType.Tree].maxLife * RESOURCE_CONFIG[ResourceType.Tree].amountPerGather;
        assert(BackpackStorage.getCount(ResourceType.Tree) === expectedWood, `first gather completed (has ${BackpackStorage.getCount(ResourceType.Tree)}, expected ${expectedWood})`);
        assert(!action.isBusy, 'not busy right after the first gather');
        assert(!node.isAvailable, 'node depleted after the first gather (sets up this test\'s actual point)');

        // Depleted — walking through the same spot again must NOT start a second action,
        // since the node's RigidBody was unregistered from PhysicsWorld (see ResourceNode.deplete()).
        world.fixedUpdate(1 / 60);
        assert(!action.isBusy, 'no second gather starts while the node is depleted');
        assert(BackpackStorage.getCount(ResourceType.Tree) === expectedWood, 'backpack count unchanged — no phantom second gather');
    }

    console.log('Test 3: walking into the drop zone deposits everything in the backpack and empties it');
    {
        BackpackStorage.clearAll();
        const world = new World();
        addGround(world);
        const player = world.add(new MainPlayer(makeFakeInputHost(), new THREE.Scene()));
        player.transform.position.set(0, 0, 0);
        // Skip the gather cycle — just give the player something to deposit directly.
        BackpackStorage.add(ResourceType.Tree, 3);
        BackpackStorage.add(ResourceType.Stone, 2);

        world.add(new DropZone(new THREE.Vector3(0, 0, 0), makeScreenHost(), makeFakePopupContent, makeFakeLabelContent));
        // Same position as the player, so it's already overlapping — no walking needed for this check.

        world.fixedUpdate(1 / 60);

        // No CharacterVisualComponent ever attaches in this test (loadCharacter() is never
        // called) — DropZone falls back to drainInstantly() (see DropZone.tryDeposit()'s own
        // doc), which still drains one unit at a time, staggered by FLY_OUT_STAGGER_SEC via
        // real gsap delayedCalls — NOT synchronously within this fixedUpdate() call. Waiting
        // comfortably past the longest drain (3 units * stagger) before asserting is what
        // this sleep() is for.
        await sleep(1000);
        assert(BackpackStorage.getCount(ResourceType.Tree) === 0, `Tree emptied on entering the drop zone (had ${BackpackStorage.getCount(ResourceType.Tree)} left)`);
        assert(BackpackStorage.getCount(ResourceType.Stone) === 0, `Stone emptied on entering the drop zone (had ${BackpackStorage.getCount(ResourceType.Stone)} left)`);
    }

    console.log('Test 4: an empty backpack entering the drop zone deposits nothing and does not throw');
    {
        BackpackStorage.clearAll();
        const world = new World();
        addGround(world);
        const player = world.add(new MainPlayer(makeFakeInputHost(), new THREE.Scene()));
        player.transform.position.set(0, 0, 0);

        world.add(new DropZone(new THREE.Vector3(0, 0, 0), makeScreenHost(), makeFakePopupContent, makeFakeLabelContent));
        world.fixedUpdate(1 / 60);

        assert(BackpackStorage.getCount(ResourceType.Tree) === 0, 'still nothing in an already-empty backpack');
    }

    if (failures > 0) {
        console.error(`\n${failures} check(s) failed.`);
        process.exit(1);
    }

    console.log('\nAll gather/deposit regression checks passed.');
}

main();
