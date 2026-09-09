// NpcBodyLoader.ts
//
// The mesh/clip/CharacterView loading sequence NpcEntity.ts's own load()
// used to do inline, factored out so any OTHER caller that wants an
// animated CharacterBody NPC can build the exact same rig without
// duplicating this async chain — see QuestGiverEntity.ts's own `npc`
// variant (QuestGiverTypes.ts's QuestGiverVariant.npc), which walks this
// same rig along a queue's waypoints instead of sitting stationary.
//
// Populates an EXISTING CharacterBody (the caller creates it and parents
// `body.container` wherever it needs to live BEFORE calling this, same as
// NpcEntity.awake() already does) rather than constructing/returning one
// itself — callers differ on when/where that parenting has to happen
// relative to their own lifecycle, but the load steps themselves never do.
//
// `body.container` stays HIDDEN for the entire load, only revealed at the
// very end once idle's own first frame has actually been applied — see this
// function's own doc below for why that's not the same moment as "the mesh
// finished loading."

import CharacterBody from '../entities/CharacterBody';
import { getPlayerConfig } from '../data/PlayerConfig';
import { getCharacterView } from '../data/CharacterViewTypes';
import { NpcConfig } from '../data/NpcTypes';
import { CHARACTER_SCALE } from '../player/MainPlayer';
import MODELS from '../../registry/assetsRegistry/modelsRegistry';

/** Same `./` + repo-relative convention every other model load in pizza uses. */
const modelUrl = (fullPath: string): string => `./${fullPath}`;

type CharacterClipName = keyof typeof MODELS.Characters;

/**
 * Loads mesh + idle/walk/run clips + a CharacterView look onto `body`, per `config` — see this
 * file's own doc. Caller still owns calling `body.update(delta, ...)` every frame and
 * `body.destroy()` when done.
 *
 * `body.container` is hidden the instant this starts and only revealed at the very end — the
 * raw FBX's own bind pose is a flat, white, T-posed mesh (see CharacterBody's own FALLBACK_COLOR
 * doc), and that's exactly what renders for however long it takes loadMesh()/registerAnimation()
 * to resolve (real network + decompress time) if the container is visible the whole time. Worse,
 * even once every clip is registered and setUp()/applyNpcView() have run, the skeleton is STILL
 * in that bind pose for one more moment: AnimatorController.play('idle') only QUEUES the clip on
 * the mixer, it doesn't retroactively pose anything — nothing actually moves a single bone until
 * the mixer's own update() runs at least once. Calling body.update(0) right before revealing
 * forces that first tick synchronously (delta=0 still snaps to the clip's own time-0 frame), so
 * whatever's about to become visible is already correctly posed in 'idle', never a T-pose.
 */
export async function loadNpcBody(body: CharacterBody, config: NpcConfig): Promise<void> {
    body.container.visible = false;

    const playerConfig = getPlayerConfig();
    const anim = playerConfig.animations;

    await body.loadMesh(modelUrl(MODELS.Characters.CharacterMedium.fullPath));
    await body.registerAnimation('idle', modelUrl(MODELS.Characters[anim.idle as CharacterClipName].fullPath));
    await body.registerAnimation('walk', modelUrl(MODELS.Characters[anim.walk as CharacterClipName].fullPath));
    await body.registerAnimation('run', modelUrl(MODELS.Characters[anim.run as CharacterClipName].fullPath));
    // Unused by the idle/walk/run board itself (see CharacterBody.setUp()'s own doc — a
    // one-shot pose played directly via body.animator.mix(), never a state this movement graph
    // transitions into on its own) — loaded unconditionally anyway, same as 'walk'/'run' already
    // are for a stationary NpcEntity that never moves either, so every npc rig can play it
    // on demand (see QuestGiverEntity.playHappyAnimation()) without a separate load path.
    await body.registerAnimation('happy', modelUrl(MODELS.Characters[anim.happy as CharacterClipName].fullPath));
    body.setUp(playerConfig.idleToWalkSpeed, playerConfig.walkToRunSpeed);

    const view = getCharacterView(config.characterViewId);
    if (view) {
        body.applyNpcView(view);
    }

    // MUST run AFTER applyNpcView()'s mountHeadCube() — see MainPlayer.loadCharacter()'s own
    // ordering (applyCharacterView() → mountBackpackCube() → THEN container.scale.setScalar()).
    body.container.scale.setScalar(config.scale ?? CHARACTER_SCALE);

    // See this function's own doc — forces idle's own first frame onto the skeleton before
    // anything is shown, so revealing it never flashes the raw bind-pose T-pose.
    body.update(0);
    body.container.visible = true;
}
