// ParticleBurstOnDestroyComponent.ts
//
// Attach to ANY entity to make it fire a one-shot particle burst (see
// ParticleSystem.burst()/ParticleRegistry.ts) the instant that entity is
// torn down — `world.remove(entity)`/`world.despawn(entity)` both call
// Entity.destroy(), which calls every component's own destroy() BEFORE the
// entity's transform is cleared/detached (see Entity.ts's own doc), so
// reading this entity's world position here is still safe. Reusable the
// same way ParticleEmitterComponent is: `addComponent(new
// ParticleBurstOnDestroyComponent('destroyBurst', 24))` is the entire setup
// — see Gate.ts for a real call site.

import * as THREE from 'three';
import Component from '../ecs/Component';
import { ParticleSystem } from '../vfx/ParticleSystem';
import { getParticleEffect } from '../vfx/ParticleRegistry';

export default class ParticleBurstOnDestroyComponent extends Component {
    private readonly effectId: string;
    private readonly count: number;
    private readonly localOffset: THREE.Vector3;

    public constructor(effectId: string, count: number, localOffset: THREE.Vector3 = new THREE.Vector3()) {
        super();
        getParticleEffect(effectId); // throws immediately on a bad id, rather than silently never bursting
        this.effectId = effectId;
        this.count = count;
        this.localOffset = localOffset;
    }

    public destroy(): void {
        this.entity.transform.updateWorldMatrix(true, false);
        const worldPos = this.localOffset.clone().applyMatrix4(this.entity.transform.matrixWorld);
        ParticleSystem.burst(this.effectId, worldPos, this.count);
    }
}
