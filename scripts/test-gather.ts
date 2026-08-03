// test-gather.ts
//
// End-to-end regression test for the M2 gather/deposit loop — MainPlayer +
// ResourceNode + DropZone + AutoGatherController + BackpackComponent, all
// wired through a real World (so RigidBody self-registration, Entity.awake(),
// and World.fixedUpdate()'s "components first, then physics" ordering are
// all exercised for real, not stubbed). No rendering, no browser, no FBX
// assets — see test-actions.ts's own doc for why that's possible headlessly.
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
import { ResourceType, RESOURCE_CONFIG } from '../games/pizza/game/actions/ResourceTypes';
import { ACTION_CONFIG, ActionType } from '../games/pizza/game/actions/ActionTypes';

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

/** DropZone's default popup content is a real PIXI.Text, which needs an actual canvas/`document` to measure itself — unavailable in this headless run. A plain PIXI.Container stands in fine: this test only checks that a popup got spawned per deposited resource type, not what it looks like. */
function makeFakePopupContent(): PIXI.Container {
    return new PIXI.Container();
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
        // .then() (which actually calls node.gather()/backpack.add()) is a queued microtask —
        // flush it before checking anything that callback touches.
        await Promise.resolve();

        assert(!action.isBusy, 'the action finished within a reasonable number of steps');
        assert(player.backpack.getCount(ResourceType.Tree) === RESOURCE_CONFIG[ResourceType.Tree].amountPerGather, `backpack received exactly one gather's worth of Wood (has ${player.backpack.getCount(ResourceType.Tree)})`);
        assert(!node.isAvailable, 'the node is depleted after yielding (respawn timer running)');
    }

    console.log('Test 2: a depleted node does not trigger a second gather until it respawns');
    {
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
        // .then() (which actually calls node.gather()/backpack.add()) is a queued microtask —
        // flush it before checking anything that callback touches.
        await Promise.resolve();
        assert(player.backpack.getCount(ResourceType.Tree) === 1, 'first gather completed');
        assert(!action.isBusy, 'not busy right after the first gather');
        assert(!node.isAvailable, 'node depleted after the first gather (sets up this test\'s actual point)');

        // Depleted — walking through the same spot again must NOT start a second action,
        // since the node's RigidBody was unregistered from PhysicsWorld (see ResourceNode.deplete()).
        world.fixedUpdate(1 / 60);
        assert(!action.isBusy, 'no second gather starts while the node is depleted');
        assert(player.backpack.getCount(ResourceType.Tree) === 1, 'backpack count unchanged — no phantom second gather');
    }

    console.log('Test 3: walking into the drop zone deposits everything in the backpack and empties it');
    {
        const world = new World();
        addGround(world);
        const player = world.add(new MainPlayer(makeFakeInputHost(), new THREE.Scene()));
        player.transform.position.set(0, 0, 0);
        // Skip the gather cycle — just give the player something to deposit directly.
        player.backpack.add(ResourceType.Tree, 3);
        player.backpack.add(ResourceType.Stone, 2);

        const dropZone = world.add(new DropZone(new THREE.Vector3(0, 0, 0), makeScreenHost(), makeFakePopupContent));
        // Same position as the player, so it's already overlapping — no walking needed for this check.

        world.fixedUpdate(1 / 60);

        assert(player.backpack.totalCount === 0, `backpack emptied on entering the drop zone (had ${player.backpack.totalCount} left)`);
        assert((dropZone as any).popups.length === 2, `one popup spawned per deposited resource type (got ${(dropZone as any).popups.length})`);
    }

    console.log('Test 4: an empty backpack entering the drop zone deposits nothing and spawns no popups');
    {
        const world = new World();
        addGround(world);
        const player = world.add(new MainPlayer(makeFakeInputHost(), new THREE.Scene()));
        player.transform.position.set(0, 0, 0);

        const dropZone = world.add(new DropZone(new THREE.Vector3(0, 0, 0), makeScreenHost(), makeFakePopupContent));
        world.fixedUpdate(1 / 60);

        assert(player.backpack.totalCount === 0, 'still nothing in an already-empty backpack');
        assert((dropZone as any).popups.length === 0, 'no popups spawned for an empty deposit');
    }

    if (failures > 0) {
        console.error(`\n${failures} check(s) failed.`);
        process.exit(1);
    }

    console.log('\nAll gather/deposit regression checks passed.');
}

main();
