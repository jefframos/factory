// NpcEntity.ts
//
// A stationary, animated NPC — the reuse case CharacterBody's own doc calls
// out explicitly ("Kept separate so NPCs can reuse the exact same rig/
// animation setup directly"). Loads the same base mesh/clip set the player
// itself uses (see PlayerConfig.ts's own `animations` table — the single
// source both read from) and applies a CharacterView look (color/head/face),
// then just calls body.update(delta) every frame with no move input, which
// per CharacterBody.setUp()'s own doc is enough to sit in 'idle' forever and
// never rotate — no waypoints, no gsap tweens, unlike QuestGiverEntity.
//
// First caller: PizzaScene.setupMarts(), when a MartConfig sets `npcId` (see
// MartTypes.ts) — spawned at the mart's own position plus that config's
// `npcOffset`.
//
// Cone-of-view look-at: if NpcConfig sets BOTH `viewRadius`/`viewAngleDeg`, this checks every
// frame whether the player is within that distance-plus-facing-cone (same convention
// PlayerConfig.resourceDetectionRadius/AngleDeg uses — see AutoGatherController.ts) of this
// NPC's own (fixed — an NPC never rotates its own body) facing, and turns the neck to look at
// them if so — eased back to the rest pose otherwise — via an EntityBoneLookAt.ts built on this
// NPC's own "Neck"/"Head" bones (see that file's own doc for why the actual rotating/smoothing
// logic lives there rather than here or on CharacterBody: it must NOT read the bone's own
// quaternion back as state, since the AnimationMixer resets it every tick). That check/ease
// deliberately runs in lateUpdate(), NOT update(): it needs `getPlayerPosition()` to already
// reflect wherever the player ends up THIS frame (after that entity's own movement has resolved),
// not wherever it was before, AND it needs to run strictly after this NPC's own
// AnimatorController/AnimationMixer update (also this frame) has already reset every bone —
// see Entity.lateUpdate()'s own doc.

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import CharacterBody from '../entities/CharacterBody';
import EntityBoneLookAt from '../entities/EntityBoneLookAt';
import { getPlayerConfig } from '../data/PlayerConfig';
import { getCharacterView } from '../data/CharacterViewTypes';
import { NpcConfig } from '../data/NpcTypes';
import { CHARACTER_SCALE } from '../player/MainPlayer';
import MODELS from '../../registry/assetsRegistry/modelsRegistry';

/** Same `./` + repo-relative convention every other model load in pizza uses (see CharacterBody.ts/MainPlayer.ts's own modelUrl()). */
const modelUrl = (fullPath: string): string => `./${fullPath}`;

type CharacterClipName = keyof typeof MODELS.Characters;

export default class NpcEntity extends Entity {
    private readonly config: NpcConfig;
    private readonly body = new CharacterBody();
    /** Built once "Neck"/"Head" bones exist (see load()) — undefined for any NPC missing either bone, or one whose config never set viewRadius/viewAngleDeg in the first place (no point building it). */
    private neckLookAt?: EntityBoneLookAt;
    /** A live getter (not a snapshot), same "always reads the player's CURRENT position" convention as AnimalNode's own getPlayerPosition. */
    private readonly getPlayerPosition: () => THREE.Vector3;

    /** Reused every lateUpdate() call instead of allocating a fresh Vector3 every frame. */
    private readonly toPlayerScratch = new THREE.Vector3();

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
        const playerConfig = getPlayerConfig();
        const anim = playerConfig.animations;

        await this.body.loadMesh(modelUrl(MODELS.Characters.CharacterMedium.fullPath));
        await this.body.registerAnimation('idle', modelUrl(MODELS.Characters[anim.idle as CharacterClipName].fullPath));
        await this.body.registerAnimation('walk', modelUrl(MODELS.Characters[anim.walk as CharacterClipName].fullPath));
        await this.body.registerAnimation('run', modelUrl(MODELS.Characters[anim.run as CharacterClipName].fullPath));
        this.body.setUp(playerConfig.idleToWalkSpeed, playerConfig.walkToRunSpeed);

        const view = getCharacterView(this.config.characterViewId);
        if (view) {
            this.body.applyNpcView(view);
        }

        // MUST run AFTER applyNpcView()'s mountHeadCube() — see MainPlayer.loadCharacter()'s own
        // ordering (applyCharacterView() → mountBackpackCube() → THEN container.scale.setScalar()).
        // applyHeadTransform() computes its holder's compensating scale from the head bone's
        // CURRENT cumulative world scale (see that method's own doc) — if the container is
        // already scaled down to CHARACTER_SCALE by that point, the compensation cancels THAT
        // scale out too, leaving the head cube at its full, uncompensated HEAD_CUBE_SIZE in world
        // space (i.e. exactly as if the body had never been scaled down) instead of shrinking
        // proportionally with the rest of the body afterward.
        this.body.container.scale.setScalar(this.config.scale ?? CHARACTER_SCALE);

        // Also last, for the same reason — EntityBoneLookAt captures its rest pose in WORLD
        // space (see that class's own doc), so it has to be built once the container's final
        // scale/position/rotation for this NPC are already in place. Only worth building at all
        // if this NPC's config actually wants a cone of view.
        if (this.config.viewRadius !== undefined && this.config.viewAngleDeg !== undefined) {
            const neckBone = this.body.getBone('Neck');
            const headBone = this.body.getBone('Head');
            if (neckBone && headBone) {
                // (0,0,1): the head cube's own face decal always sits on local +Z with zero
                // extra rotation of its own — see CubeBuilder.buildFaceDecal()'s own doc and
                // EntityBoneLookAt.ts's own top doc for why that's the axis to pass here, not a
                // Neck->Head position difference (that's mostly the spine's own "up" axis).
                this.neckLookAt = new EntityBoneLookAt(neckBone, headBone, new THREE.Vector3(0, 0, 1));
            } else {
                console.warn(`[NpcEntity] "${this.config.characterViewId}" has viewRadius/viewAngleDeg set but this rig is missing a "Neck" or "Head" bone — skipping look-at.`);
            }
        }
    }

    public override update(delta: number): void {
        super.update(delta);
        this.body.update(delta);
    }

    public override lateUpdate(delta: number): void {
        if (!this.neckLookAt || this.config.viewRadius === undefined || this.config.viewAngleDeg === undefined) {
            return;
        }

        const playerPosition = this.getPlayerPosition();
        const toPlayer = this.toPlayerScratch.copy(playerPosition).sub(this.transform.position);
        const toPlayerFlat = new THREE.Vector3(toPlayer.x, 0, toPlayer.z);
        const distance = toPlayerFlat.length();

        let inView = false;
        if (distance <= this.config.viewRadius && distance > 1e-6) {
            // This NPC never rotates its own body (moveInputX/Z stay 0 forever — see
            // CharacterBody.update()), so container.quaternion is always its spawn-time facing;
            // read it live anyway rather than assuming identity, in case a future feature ever
            // lets an NPC turn.
            const bodyForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.body.container.quaternion);
            const angleDeg = THREE.MathUtils.radToDeg(bodyForward.angleTo(toPlayerFlat.normalize()));
            inView = angleDeg <= this.config.viewAngleDeg / 2;
        }

        this.neckLookAt.update(inView ? playerPosition : undefined, delta);
    }

    public override destroy(): void {
        this.body.destroy();
        super.destroy();
    }
}
