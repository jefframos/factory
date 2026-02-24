import Physics from '@core/phyisics/Physics';
import { gsap } from 'gsap';
import * as THREE from 'three';
import { InteractionDefinition, ModifierTrigger } from '../level/LevelTypes';

export class InteractionService3D {
    private static meshMap: Map<number, THREE.Object3D> = new Map();
    // Keep track of active tweens so we can kill them
    private static activeTweens: Map<THREE.Object3D, gsap.core.Timeline> = new Map();

    public static link(bodyId: number, mesh: THREE.Object3D): void {
        this.meshMap.set(bodyId, mesh);
    }

    public static register(body: Matter.Body, interaction: InteractionDefinition): void {
        const triggerMap = {
            [ModifierTrigger.ON_START]: Physics.events.onStart,
            [ModifierTrigger.ON_ACTIVE]: Physics.events.onActive,
            [ModifierTrigger.ON_END]: Physics.events.onEnd,
        };

        const registerFn = triggerMap[interaction.trigger];
        if (registerFn) {
            registerFn(body, () => this.execute(body.id, interaction));
        }
    }

    private static execute(bodyId: number, interaction: InteractionDefinition): void {
        const mesh = this.meshMap.get(bodyId);
        if (!mesh) return;

        if (interaction.type === 'scale_bounce') {
            this.playBounce(mesh, interaction.targetScale || 1.2);
        }
    }

    private static playBounce(mesh: THREE.Object3D, target: number): void {
        // 1. Kill any existing tween on this mesh to prevent "stacking"
        const existing = this.activeTweens.get(mesh);
        if (existing) {
            existing.kill();
        }

        // 2. Create a fresh bounce timeline
        const tl = gsap.timeline({
            onComplete: () => { this.activeTweens.delete(mesh); }
        });

        // Save it to our tracker
        this.activeTweens.set(mesh, tl);

        // 3. The Animation
        // Start from current scale (in case it was interrupted)
        tl.to(mesh.scale, {
            x: target,
            y: target,
            z: target,
            duration: 0.1,
            ease: "power2.out"
        })
            .to(mesh.scale, {
                x: 1,
                y: 1,
                z: 1,
                duration: 0.4,
                ease: "elastic.out(1, 0.3)" // This creates the bouncy "settle" effect
            });
    }

    public static clear(): void {
        // Kill all active tweens before clearing
        this.activeTweens.forEach(tl => tl.kill());
        this.activeTweens.clear();
        this.meshMap.clear();
    }
}