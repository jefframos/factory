// NpcTypes.ts
//
// A stationary NPC "look" — which CharacterView it wears — set from the pizza
// web editor's NPCs tab. This is deliberately the ONLY thing an NpcConfig
// carries for now (first test: a standing NPC that can be assigned a look and
// dropped at a Mart, see MartTypes.ts's own `npcId`/`npcOffset` fields and
// NpcEntity.ts). Behavior (waypoint walking, task offers) belongs to
// QuestGiverTypes.ts's own separate system; this one instead reuses
// CharacterBody/AnimatorController directly (see NpcEntity.ts) so an NPC
// shares the exact same idle/walk/run/jump rig and PlayerConfig.animations
// clip bindings the player itself uses, rather than QuestGiverEntity's
// static-glb/no-animator path.
//
// Free-designer id (like CharacterViewTypes.ts's own CHARACTER_VIEW_CONFIG),
// not map/queue-derived — an id here only means something once some other
// tab (Marts today) actually references it via `npcId`.

export interface NpcConfig {
    /** CharacterViewTypes.ts id — this NPC's color/head/face, same join every CharacterView consumer uses. An id with no CharacterView entry just falls back to CharacterBody's own flat-color default (see applyCharacterView()'s caller in NpcEntity.ts). */
    characterViewId: string;
    /** Uniform scale applied to the NPC's own container (see NpcEntity.ts) — same rig, same raw FBX export size the player's own MainPlayer.CHARACTER_SCALE corrects for. undefined defaults to that same 0.0075; only set this per-NPC for a deliberately bigger/smaller character. */
    scale?: number;
    /**
     * World-unit radius of this NPC's own "cone of view" — same distance-plus-facing-cone
     * convention as PlayerConfig.resourceDetectionRadius/AngleDeg (see that field's own doc).
     * While the player is within BOTH this radius and viewAngleDeg of this NPC's own facing (see
     * NpcEntity.lateUpdate()), the NPC turns its neck to look at them (CharacterBody.lookAt()).
     * undefined (alongside viewAngleDeg) means this NPC never looks at the player at all.
     */
    viewRadius?: number;
    /** Full aperture, in degrees, of the cone of view above — symmetric around the NPC's own current facing, same convention as PlayerConfig.resourceDetectionAngleDeg. Only meaningful alongside viewRadius. */
    viewAngleDeg?: number;
}

export const NPC_CONFIG_BY_ID: Partial<Record<string, NpcConfig>> = {
    default: {
        characterViewId: "purple",
    },
    "shopper1": {
        "characterViewId": "violet",
        "viewRadius": 3,
        "viewAngleDeg": 180
    },
    "shopper2": {
        "characterViewId": "cyan",
        "viewRadius": 3,
        "viewAngleDeg": 180
    }
};

export function getNpcConfig(id: string): NpcConfig | undefined {
    return NPC_CONFIG_BY_ID[id];
}
