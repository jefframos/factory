// NpcLookAtSensor.ts
//
// Shared "turn the neck to look at the player while they're within a cone
// of view" sensor for an animated NPC rig — the exact distance-plus-facing-
// cone check (see NpcConfig.viewRadius/viewAngleDeg's own doc) NpcEntity.ts's
// own lateUpdate() used to do inline, factored out so QuestGiverEntity.ts's
// own `npc` variant (see QuestGiverTypes.ts) gets the IDENTICAL sensor
// instead of a second, drifting copy — a mart's stationary NPC and a
// queue's walking one should behave the same way here.
//
// Built once a CharacterBody's rig actually has "Neck"/"Head" bones AND its
// NpcConfig sets BOTH viewRadius/viewAngleDeg (see tryBuild()) — undefined
// (with a console warning only for the missing-bones case) otherwise, same
// "not worth building at all" convention NpcEntity used before this file
// existed.

import * as THREE from 'three';
import CharacterBody from '../entities/CharacterBody';
import EntityBoneLookAt from '../entities/EntityBoneLookAt';
import { NpcConfig } from '../data/NpcTypes';

export default class NpcLookAtSensor {
    private readonly lookAt: EntityBoneLookAt;
    private readonly viewRadius: number;
    private readonly viewAngleDeg: number;

    /** Reused every update() call instead of allocating fresh Vector3s every frame. */
    private readonly toPlayerScratch = new THREE.Vector3();
    private readonly toPlayerFlatScratch = new THREE.Vector3();
    private readonly bodyForwardScratch = new THREE.Vector3();

    private constructor(lookAt: EntityBoneLookAt, viewRadius: number, viewAngleDeg: number) {
        this.lookAt = lookAt;
        this.viewRadius = viewRadius;
        this.viewAngleDeg = viewAngleDeg;
    }

    /**
     * Builds a sensor for `body`'s CURRENT rig — call once the rig's mesh has actually finished
     * loading (see loadNpcBody()), since EntityBoneLookAt captures its rest pose in WORLD space
     * at construction. Returns undefined (no sensor at all) if `config` doesn't set BOTH
     * viewRadius/viewAngleDeg — no point building one a caller will never feed a player position
     * anyway. `warnId` only names the console warning if the rig is missing a "Neck"/"Head" bone
     * (a mart's NpcConfig id, or a queue's own id — whichever the caller has on hand).
     */
    public static tryBuild(body: CharacterBody, config: NpcConfig, warnId: string): NpcLookAtSensor | undefined {
        if (config.viewRadius === undefined || config.viewAngleDeg === undefined) {
            return undefined;
        }

        const neckBone = body.getBone('Neck');
        const headBone = body.getBone('Head');
        if (!neckBone || !headBone) {
            console.warn(`[NpcLookAtSensor] "${warnId}" has viewRadius/viewAngleDeg set but this rig is missing a "Neck" or "Head" bone — skipping look-at.`);
            return undefined;
        }

        // (0,0,1): the head cube's own face decal always sits on local +Z with zero extra
        // rotation of its own — see CubeBuilder.buildFaceDecal()'s own doc and EntityBoneLookAt.ts's
        // own top doc for why that's the axis to pass here, not a Neck->Head position difference.
        return new NpcLookAtSensor(new EntityBoneLookAt(neckBone, headBone, new THREE.Vector3(0, 0, 1)), config.viewRadius, config.viewAngleDeg);
    }

    /**
     * Call once per frame, from a lateUpdate() (see EntityBoneLookAt.update()'s own doc for why
     * — it needs the player's THIS-frame position and must run after the AnimationMixer resets
     * every bone). `bodyPosition`/`bodyForwardQuaternion` are the NPC's own current world
     * position/facing — a stationary NpcEntity's fixed spawn transform, or QuestGiverEntity's
     * own live transform.position/npcBody.container.quaternion while walking a waypoint path.
     */
    public update(bodyPosition: THREE.Vector3, bodyForwardQuaternion: THREE.Quaternion, playerPosition: THREE.Vector3, delta: number): void {
        const toPlayer = this.toPlayerScratch.copy(playerPosition).sub(bodyPosition);
        const toPlayerFlat = this.toPlayerFlatScratch.set(toPlayer.x, 0, toPlayer.z);
        const distance = toPlayerFlat.length();

        let inView = false;
        if (distance <= this.viewRadius && distance > 1e-6) {
            const bodyForward = this.bodyForwardScratch.set(0, 0, 1).applyQuaternion(bodyForwardQuaternion);
            const angleDeg = THREE.MathUtils.radToDeg(bodyForward.angleTo(toPlayerFlat.normalize()));
            inView = angleDeg <= this.viewAngleDeg / 2;
        }

        this.lookAt.update(inView ? playerPosition : undefined, delta);
    }
}
