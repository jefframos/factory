// Collectible.ts
//
// A single world-placed resource pickup: gently floats/spins in place (see
// updateIdleFloat()) until the player's RigidBody overlaps its attract-radius trigger, then
// homes to the player along an ArcSpline curve over a FIXED real-time duration
// (CollectibleSettings.COLLECTIBLE_TUNING.snapDurationSec) — not a closing
// speed — firing `onCollected` once with its resourceAmount right as it
// lands. Using a constant duration rather than a constant speed/distance
// check means a running player never makes the pickup "chase" forever or
// arrive early: the arc's `to` endpoint is re-read from getPlayerPosition()
// every tick (see ArcSpline.ts's own doc — it re-aims at whatever `to` it's
// given each call), so the curve continuously re-bends toward wherever the
// player actually is, but always finishes at exactly the same moment.
// Removal from the World is the caller's job (see CollectibleBuilder.
// pruneCollected()) — this entity only flags itself `collected`, since
// despawning itself mid-tick would mutate World's own entities array while
// World is still iterating it.

import * as THREE from 'three';
import { Signal } from 'signals';
import Entity from 'core/ecs/Entity';
import RigidBody from 'core/physics/RigidBody';
import { Layers } from 'core/physics/PhysicsConstants';
import { BendService, WorldBendService } from 'core/services/BendService';
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
    /** Which bend flavor this pickup's own mesh (and its debug collider wireframe) uses — the hub's plain radial BendService by default; RunnerMinigameScene/SwipeMinigameScene pass RunnerBendService instead, same "match whichever bend the rest of THIS scene uses" reasoning as every other bent object in this codebase (see ObstacleBuilder.ts/MainPlayer.ts). */
    private readonly bendService: WorldBendService;

    private mesh?: THREE.Object3D;
    private attracted = false;
    /** Seconds elapsed since attraction started — drives the ArcSpline's `t`, NOT distance. */
    private elapsed = 0;
    /** Where the pickup was resting when it got attracted — the arc's fixed `from` endpoint (only the `to` endpoint, the player, keeps moving). */
    private readonly arcFrom = new THREE.Vector3();
    private readonly arc = new ArcSpline(COLLECTIBLE_TUNING.arcHeight);
    /** World-Y the pickup was actually placed at — the center updateIdleFloat()'s bob oscillates around. Captured lazily (see updateIdleFloat()) rather than at construction, since the caller sets transform.position AFTER `new Collectible(...)`, not before. */
    private restingY?: number;
    /** Own phase (see updateIdleFloat()), advanced every idle tick — randomized starting value per instance so a whole row of coins doesn't bob/spin in lockstep. */
    private floatPhase = Math.random() * Math.PI * 2;

    public constructor(
        definition: CollectibleDefinition,
        threeScene: THREE.Scene,
        getPlayerPosition: () => THREE.Vector3,
        bendService: WorldBendService = BendService,
    ) {
        super();
        this.definition = definition;
        this.threeScene = threeScene;
        this.getPlayerPosition = getPlayerPosition;
        this.bendService = bendService;
    }

    public override awake(): void {
        const rigidBody = this.addComponent(new RigidBody({
            halfExtents: new THREE.Vector3(COLLECTIBLE_TUNING.attractRadius, COLLECTIBLE_TUNING.attractRadius, COLLECTIBLE_TUNING.attractRadius),
            isStatic: true,
            isTrigger: true,
            layer: Layers.Default,
            mask: Layers.Player,
            bendService: this.bendService,
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
                this.bendService.applyBend(material);
            }
        });

        this.mesh = object;
        this.threeScene.add(object);
    }

    public override fixedUpdate(delta: number): void {
        super.fixedUpdate(delta);

        if (this.collected) {
            return;
        }

        if (!this.attracted) {
            this.updateIdleFloat(delta);
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

    /**
     * Gentle sine bob (world-Y) + slow spin (around the mesh's own Y axis) while nothing's
     * attracted this pickup yet — what actually reads as "floating" rather than a static prop
     * sitting on the ground. `restingY` is captured on the FIRST tick rather than in the
     * constructor/awake() because the caller (see CollectibleBuilder.spawnCollectible())
     * only sets transform.position AFTER construction, so awake() would still be reading the
     * Entity default (0,0,0). Mutates transform.position.y directly (not just the visual
     * mesh) — harmless for the attract-radius trigger (COLLECTIBLE_TUNING.floatAmplitude is
     * tiny next to attractRadius) and means arcFrom (captured the instant attraction starts)
     * naturally picks up wherever the bob currently is, no visual snap.
     */
    private updateIdleFloat(delta: number): void {
        if (this.restingY === undefined) {
            this.restingY = this.transform.position.y;
        }

        this.transform.position.y = this.restingY + Math.sin(this.floatPhase) * COLLECTIBLE_TUNING.floatAmplitude;
        this.floatPhase += delta * COLLECTIBLE_TUNING.floatSpeed;

        if (this.mesh) {
            this.mesh.position.copy(this.transform.position);
            this.mesh.rotation.y += COLLECTIBLE_TUNING.spinSpeed * delta;
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
