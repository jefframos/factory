// NpcEntity.ts
//
// A stationary, animated NPC — the reuse case CharacterBody's own doc calls
// out explicitly ("Kept separate so NPCs can reuse the exact same rig/
// animation setup directly"). Loads the same base mesh/clip set the player
// itself uses (see PlayerConfig.ts's own `animations` table — the single
// source both read from) and applies a CharacterView look (color/head/face),
// then just calls body.update(delta) every frame with no move input, which
// per CharacterBody.setUp()'s own doc is enough to sit in 'idle' forever and
// never rotate — no waypoints, no gsap tweens, unlike QuestGiverEntity. Still
// passes `grounded: true` (this NPC never jumps/falls, but the idle<->walk<->run
// transitions themselves are gated on it — see CharacterBody.setUp()'s own
// transition conditions) so a future feature that DOES feed it real move
// input isn't left silently stuck in 'idle' by a missing extraVar.
//
// First caller: PizzaScene.setupMarts(), when a MartConfig sets `npcId` (see
// MartTypes.ts) — spawned at the mart's own position plus that config's
// `npcOffset`.
//
// Cone-of-view look-at (see NpcLookAtSensor.ts) — the SAME sensor
// QuestGiverEntity.ts's own `npc` variant uses, so a mart's stationary NPC
// and a queue's walking one behave identically here. That check/ease
// deliberately runs in lateUpdate(), NOT update(): it needs `getPlayerPosition()`
// to already reflect wherever the player ends up THIS frame (after that
// entity's own movement has resolved), not wherever it was before, AND it
// needs to run strictly after this NPC's own AnimatorController/AnimationMixer
// update (also this frame) has already reset every bone — see
// Entity.lateUpdate()'s own doc.

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import { NpcConfig } from '../data/NpcTypes';
import { loadNpcBody } from './NpcBodyLoader';
import NpcLookAtSensor from './NpcLookAtSensor';
import CharacterBody from '../entities/CharacterBody';

export default class NpcEntity extends Entity {
    private readonly config: NpcConfig;
    private readonly body = new CharacterBody();
    /** Built once this NPC's rig has loaded — see load()/NpcLookAtSensor.tryBuild()'s own doc for when this stays undefined. */
    private lookAtSensor?: NpcLookAtSensor;
    /** A live getter (not a snapshot), same "always reads the player's CURRENT position" convention as AnimalNode's own getPlayerPosition. */
    private readonly getPlayerPosition: () => THREE.Vector3;

    public constructor(position: THREE.Vector3, config: NpcConfig, getPlayerPosition: () => THREE.Vector3) {
        super();
        this.transform.position.copy(position);
        this.config = config;
        this.getPlayerPosition = getPlayerPosition;
    }

    public override awake(): void {
        this.transform.add(this.body.container);
        void this.load();
    }

    private async load(): Promise<void> {
        // See NpcBodyLoader.ts's own doc — this is the same mesh/clip/CharacterView sequence
        // QuestGiverEntity.ts's own `npc` variant uses to build its rig, factored out so neither
        // caller duplicates it.
        await loadNpcBody(this.body, this.config);

        // Also last, for the same reason — EntityBoneLookAt captures its rest pose in WORLD
        // space (see that class's own doc), so it has to be built once the container's final
        // scale/position/rotation for this NPC are already in place.
        this.lookAtSensor = NpcLookAtSensor.tryBuild(this.body, this.config, this.config.characterViewId);
    }

    public override update(delta: number): void {
        super.update(delta);
        this.body.update(delta, 0, 0, { grounded: true });
    }

    public override lateUpdate(delta: number): void {
        this.lookAtSensor?.update(this.transform.position, this.body.container.quaternion, this.getPlayerPosition(), delta);
    }

    public override destroy(): void {
        this.body.destroy();
        super.destroy();
    }
}
