// test-ecs.ts
//
// Plain deterministic regression test for games/pizza/game/ecs (Entity/
// Component/World) — no rendering, no browser, no test framework. Run with
// `npm run test:ecs`.
//
// Covers the three things that would silently break gameplay if they ever
// regressed: awake()/start() firing in the right order (including for a
// component added after the entity's already ticking), fixedUpdate()
// running before update() reads its result, and World.despawn()/spawn()
// actually reusing the same pooled Entity shell instead of leaking a new
// one every time.

import Entity from '../games/pizza/game/ecs/Entity';
import Component from '../games/pizza/game/ecs/Component';
import World from '../games/pizza/game/ecs/World';

let failures = 0;

function assert(condition: boolean, message: string): void {
    if (condition) {
        console.log(`  ok   ${message}`);
    } else {
        failures += 1;
        console.error(`  FAIL ${message}`);
    }
}

console.log('Test 1: awake() fires immediately, start() fires once before the first tick, in add order');
{
    const log: string[] = [];

    class Recorder extends Component {
        public constructor(private readonly label: string) {
            super();
        }
        public awake(): void { log.push(`awake:${this.label}`); }
        public start(): void { log.push(`start:${this.label}`); }
        public update(): void { log.push(`update:${this.label}`); }
        public fixedUpdate(): void { log.push(`fixedUpdate:${this.label}`); }
    }

    const world = new World();
    const entity = world.spawn();
    entity.addComponent(new Recorder('a'));
    entity.addComponent(new Recorder('b'));

    // Both awake()s should have already fired from addComponent() alone, before any tick.
    assert(log.join(',') === 'awake:a,awake:b', `awake() fires on addComponent(), in add order (got: ${log.join(',')})`);

    log.length = 0;
    world.fixedUpdate(1 / 60);
    assert(log.join(',') === 'start:a,start:b,fixedUpdate:a,fixedUpdate:b', `start() fires once before the first fixedUpdate(), then fixedUpdate() runs (got: ${log.join(',')})`);

    log.length = 0;
    world.update(1 / 60);
    assert(log.join(',') === 'update:a,update:b', `second tick just runs update(), no repeated start() (got: ${log.join(',')})`);
}

console.log('Test 2: a component added AFTER the entity is already ticking still gets start() before its own first update()');
{
    const log: string[] = [];

    class Recorder extends Component {
        public constructor(private readonly label: string) {
            super();
        }
        public start(): void { log.push(`start:${this.label}`); }
        public update(): void { log.push(`update:${this.label}`); }
    }

    const world = new World();
    const entity = world.spawn();
    entity.addComponent(new Recorder('early'));

    world.update(1 / 60); // entity already ticking once...
    log.length = 0;

    entity.addComponent(new Recorder('late')); // ...then a component shows up later (e.g. an async load resolving)

    world.update(1 / 60);
    assert(log.join(',') === 'start:late,update:early,update:late', `late component starts before its own first update, without re-starting the early one (got: ${log.join(',')})`);
}

console.log('Test 3: fixedUpdate() (physics-relevant work) always runs before update() reads its result, each frame');
{
    const order: string[] = [];

    class Physicsy extends Component {
        public fixedUpdate(): void { order.push('fixedUpdate'); }
    }
    class Visualy extends Component {
        public update(): void { order.push('update'); }
    }

    const world = new World();
    const entity = world.spawn();
    entity.addComponent(new Physicsy());
    entity.addComponent(new Visualy());

    world.fixedUpdate(1 / 60);
    world.update(1 / 60);
    assert(order.join(',') === 'fixedUpdate,update', `fixedUpdate ran before update (got: ${order.join(',')})`);
}

console.log('Test 4: disabling a component stops its update()/fixedUpdate() without re-running awake()/start() or blocking siblings');
{
    let awakeCount = 0;
    let startCount = 0;
    let updateCount = 0;
    let fixedUpdateCount = 0;
    let enableCalls = 0;
    let disableCalls = 0;

    class Toggleable extends Component {
        public awake(): void { awakeCount += 1; }
        public start(): void { startCount += 1; }
        public update(): void { updateCount += 1; }
        public fixedUpdate(): void { fixedUpdateCount += 1; }
        public onEnable(): void { enableCalls += 1; }
        public onDisable(): void { disableCalls += 1; }
    }

    const siblingTicks: string[] = [];
    class Sibling extends Component {
        public update(): void { siblingTicks.push('update'); }
        public fixedUpdate(): void { siblingTicks.push('fixedUpdate'); }
    }

    const world = new World();
    const entity = world.spawn();
    const toggleable = entity.addComponent(new Toggleable());
    entity.addComponent(new Sibling());

    world.update(1 / 60);
    world.fixedUpdate(1 / 60);
    assert(updateCount === 1 && fixedUpdateCount === 1, 'enabled component ticks normally');

    toggleable.enabled = false;
    assert(disableCalls === 1 && enableCalls === 0, 'setting enabled=false fires onDisable() exactly once');

    siblingTicks.length = 0;
    world.update(1 / 60);
    world.fixedUpdate(1 / 60);
    assert(updateCount === 1 && fixedUpdateCount === 1, 'disabled component\'s own update()/fixedUpdate() stop running (counts unchanged)');
    assert(siblingTicks.join(',') === 'update,fixedUpdate', 'a disabled component does not block its sibling from ticking');
    assert(awakeCount === 1 && startCount === 1, 'disabling never re-runs awake()/start()');

    toggleable.enabled = true;
    assert(enableCalls === 1, 'setting enabled=true fires onEnable() exactly once');
    world.update(1 / 60);
    world.fixedUpdate(1 / 60);
    assert(updateCount === 2 && fixedUpdateCount === 2, 're-enabling resumes update()/fixedUpdate()');
    assert(awakeCount === 1 && startCount === 1, 're-enabling still never re-runs awake()/start()');
}

console.log('Test 5: despawn()/spawn() actually reuses the same pooled Entity shell');
{
    const world = new World();
    const first = world.spawn();
    first.transform.position.set(5, 5, 5);

    let destroyed = false;
    class Marker extends Component {
        public destroy(): void { destroyed = true; }
    }
    first.addComponent(new Marker());

    world.despawn(first);
    assert(destroyed, 'despawn() called the component\'s destroy()');
    assert(first.transform.position.length() === 0, 'despawn() blanked the transform back to origin');

    const second = world.spawn();
    assert(second === first, 'spawn() reused the exact same pooled Entity instance instead of allocating a new one');
    assert(second.getComponent(Marker) === undefined, 'the reused shell has no leftover components from its previous life');
}

console.log('Test 6: a dedicated Entity subclass self-configures via awake(), added through World.add()/remove() instead of the pool');
{
    const log: string[] = [];

    class Marker extends Component {
        public destroy(): void { log.push('component destroyed'); }
    }

    class CustomEntity extends Entity {
        public override awake(): void {
            log.push('awake');
            this.addComponent(new Marker());
        }
    }

    const world = new World();
    const custom = world.add(new CustomEntity());

    assert(log.join(',') === 'awake', `World.add() called awake() exactly once, synchronously (got: ${log.join(',')})`);
    assert(custom.world === world, 'World.add() wired entity.world just like spawn() does');
    assert(custom.getComponent(Marker) !== undefined, 'the component awake() added is actually there');

    let ticked = false;
    class Ticker extends Component {
        public update(): void { ticked = true; }
    }
    custom.addComponent(new Ticker());
    world.update(1 / 60);
    assert(ticked, 'an entity added via World.add() ticks normally through World.update()');

    log.length = 0;
    world.remove(custom);
    assert(log.join(',') === 'component destroyed', `World.remove() tore its components down (got: ${log.join(',')})`);

    ticked = false;
    world.update(1 / 60);
    assert(!ticked, 'a removed entity no longer ticks — it was actually taken out of the world, not just destroyed in place');
}

if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
}

console.log('\nAll ECS regression checks passed.');
