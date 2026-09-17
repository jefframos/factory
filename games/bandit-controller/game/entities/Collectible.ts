// Collectible.ts
//
// A single world-placed resource pickup: idle until the player's RigidBody
// overlaps its attract-radius trigger, then homes to the player along an
// ArcSpline curve over a FIXED real-time duration
// (CollectibleSettings.COLLECTIBLE_TUNING.snapDurationSec) — not a closing
// speed — firing `onCollected` once with its resourceAmount right as it
// lands. Using a constant duration rather than a constant speed/distance
// check means a running player never makes the pickup "chase" forever or
// arrive early: the arc's `to` endpoint is re-read from getPlayerPosition()
// every tick (see ArcSpline.ts's own doc — it re-aims at whatever `to` it's
// given each call), so the curve continuously re-bends toward wherever the
// player actually is, but always finishes at exactly the same moment.
// Removal from the World is the caller's job (see
// ControllerScene.buildCollectibles()) — this entity only flags itself
// `collected`, since despawning itself mid-tick would mutate World's own
// entities array while World is still iterating it.

import * as THREE from 'three';
import { Signal } from 'signals';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { BendService } from '../services/BendService';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import ArcSpline from '../utils/ArcSpline';
import { CollectibleDefinition, COLLECTIBLE_TUNING } from '../data/CollectibleSettings';

/** Model-registry entries carry a repo-relative fullPath (e.g. "bandit-controller/models/..."), served at runtime from ./bandit-controller/... — same convention as MainPlayer.ts's own modelUrl(). */
const modelUrl = (fullPath: string): string => `./${fullPath}`;

export default class Collectible extends Entity {
    /** Fires once, with resourceAmount, the instant this pickup reaches the player. */
    public readonly onCollected: Signal<number> = new Signal();

    /** True once this pickup has paid out — see this file's own doc on why removal itself is deferred to the caller. */
    public collected = false;

    private readonly definition: CollectibleDefinition;
    private readonly threeScene: THREE.Scene;
    private readonly getPlayerPosition: () => THREE.Vector3;

    private mesh?: THREE.Object3D;
    private attracted = false;
    /** Seconds elapsed since attraction started — drives the ArcSpline's `t`, NOT distance. */
    private elapsed = 0;
    /** Where the pickup was resting when it got attracted — the arc's fixed `from` endpoint (only the `to` endpoint, the player, keeps moving). */
    private readonly arcFrom = new THREE.Vector3();
    private readonly arc = new ArcSpline(COLLECTIBLE_TUNING.arcHeight);

    public constructor(definition: CollectibleDefinition, threeScene: THREE.Scene, getPlayerPosition: () => THREE.Vector3) {
        super();
        this.definition = definition;
        this.threeScene = threeScene;
        this.getPlayerPosition = getPlayerPosition;
    }

    public override awake(): void {
        const rigidBody = this.addComponent(new RigidBody({
            halfExtents: new THREE.Vector3(COLLECTIBLE_TUNING.attractRadius, COLLECTIBLE_TUNING.attractRadius, COLLECTIBLE_TUNING.attractRadius),
            isStatic: true,
            isTrigger: true,
            layer: Layers.Default,
            mask: Layers.Player,
        }));

        rigidBody.onTriggerEnter.add((other) => {
            if (!this.attracted && other.layer === Layers.Player) {
                this.attracted = true;
                this.arcFrom.copy(this.transform.position);
            }
        });
    }

    /** Loads + places the pickup's mesh at the entity's current transform.position — call once right after World.add(), same two-step (sync awake() + async load()) split MainPlayer.loadCharacter() uses. */
    public async load(): Promise<void> {
        const object = await ModelLoaderManager.instance.loadModel(modelUrl(this.definition.model.fullPath));
        object.scale.setScalar(this.definition.modelScale);
        object.position.copy(this.transform.position);

        object.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) {
                return;
            }
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const material of materials) {
                BendService.applyBend(material);
            }
        });

        this.mesh = object;
        this.threeScene.add(object);
    }

    public override fixedUpdate(delta: number): void {
        super.fixedUpdate(delta);

        if (!this.attracted || this.collected) {
            return;
        }

        this.elapsed += delta;
        const t = Math.min(1, this.elapsed / COLLECTIBLE_TUNING.snapDurationSec);
        // Ease-out cubic — a quick departure that gently settles into the player, rather than
        // a robotic constant-speed slide, while the total real-time duration stays exactly fixed.
        const eased = 1 - (1 - t) ** 3;

        const position = this.arc.evaluate(this.arcFrom, this.getPlayerPosition(), eased);
        this.transform.position.copy(position);
        this.mesh?.position.copy(position);

        if (t >= 1) {
            this.collected = true;
            this.onCollected.dispatch(this.definition.resourceAmount);
        }
    }

    public override destroy(): void {
        this.mesh?.removeFromParent();
        this.mesh?.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
            }
        });
        super.destroy();
    }
}
