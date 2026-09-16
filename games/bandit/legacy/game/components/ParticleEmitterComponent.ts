// ParticleEmitterComponent.ts
//
// Continuously spawns particles of a registered effect (see
// ParticleRegistry.ts) at this entity's world position — e.g. the purple
// "myst" ambience on a CraftZone (see CraftZone.awake()). All the actual
// geometry/shading/aging is owned by ParticleSystem/ParticleBatch; this
// component is just a timed position source, so reusing the same effect on
// a different entity is a one-line `addComponent(new
// ParticleEmitterComponent('craftingMyst', ...))` away.

import * as THREE from 'three';
import Component from '../ecs/Component';
import { ParticleSystem } from '../vfx/ParticleSystem';
import { getParticleEffect } from '../vfx/ParticleRegistry';

export default class ParticleEmitterComponent extends Component {
    private readonly effectId: string;
    private readonly localOffset: THREE.Vector3;
    private readonly spawnIntervalSec: number;
    private accumulatorSec = 0;
    private readonly worldPos = new THREE.Vector3();

    public constructor(effectId: string, spawnRatePerSec: number, localOffset: THREE.Vector3 = new THREE.Vector3()) {
        super();
        getParticleEffect(effectId); // throws immediately on a bad id, rather than silently never spawning anything
        this.effectId = effectId;
        this.localOffset = localOffset;
        this.spawnIntervalSec = 1 / spawnRatePerSec;
    }

    public update(delta: number): void {
        this.accumulatorSec += delta;

        // ZoneVisibilityManager hides a not-yet-unlocked zone's entities by setting
        // transform.visible = false (see that file's own doc) — it has no idea this component
        // exists, so without this check the emitter keeps ticking and spawning into the
        // shared, always-rendered ParticleSystem batch regardless, leaking particles from a
        // gate/zone that's supposed to be fully hidden. Accumulator still advances above so a
        // burst doesn't fire the instant the zone reveals; only the spawn itself is skipped.
        if (!this.entity.transform.visible) {
            this.accumulatorSec = Math.min(this.accumulatorSec, this.spawnIntervalSec);
            return;
        }

        while (this.accumulatorSec >= this.spawnIntervalSec) {
            this.accumulatorSec -= this.spawnIntervalSec;

            // updateWorldMatrix rather than reading a possibly-stale matrixWorld — THREE only
            // refreshes it during renderer.render(), which for this scene runs AFTER
            // World.update() (see ThreeScene.update()/PizzaScene.update()), so without this an
            // entity that moves would spawn a frame behind. Cheap for a single entity.
            this.entity.transform.updateWorldMatrix(true, false);
            this.worldPos.copy(this.localOffset).applyMatrix4(this.entity.transform.matrixWorld);
            ParticleSystem.spawn(this.effectId, this.worldPos);
        }
    }
}
