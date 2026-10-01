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

import type { HatSpec } from '../entities/CharacterBody';
import type { ModelDefinition } from '../../registry/assetsRegistry/modelsRegistry';

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
    /**
     * RANDOM LOOK — one NPC setup for a whole crowd (e.g. store clients): each spawn rolls one of
     * these colors, one of these faces and a scale between minScale and maxScale (see
     * rollNpcLook()). Anything left empty falls back to characterViewId's color/face and `scale`.
     */
    colors?: NpcColorEntry[];
    faces?: NpcFaceEntry[];
    minScale?: number;
    maxScale?: number;
    /** Hat pool for the random look — each spawn that gets a hat picks one entry, weighted by `weight`. Empty = never a hat. */
    hats?: NpcHatEntry[];
    /** 0-1: chance a spawn gets NO hat at all (0.5 = half of them wear one from `hats`). Unset = 0 (always a hat, when there are any). */
    noHatChance?: number;
}

/** One hat in an NPC's pool — see NpcConfig.hats. */
export interface NpcHatEntry {
    /** First entry used — a MODELS "Group.Key" ref (e.g. "Hats.CowboyHat") or MODELS.* itself. */
    models: (string | ModelDefinition)[];
    /** Relative odds against the pool's other hats (2 = twice as likely as a 1). */
    weight: number;
    /** See HatSpec (CharacterBody.ts) — fitted-size multiplier, lift, yaw. */
    scale?: number;
    offsetY?: number;
    rotationDeg?: number;
}

/** One color an NPC's random look can roll — a list entry (not a bare string) so the web editor's color picker can edit it. */
export interface NpcColorEntry {
    color: string;
}

/** One face an NPC's random look can roll — "skins/....webp" under images/non-preload, same as CharacterViewConfig.face. */
export interface NpcFaceEntry {
    face: string;
}

/** A rolled look — undefined fields fall back to the NPC's CharacterView / scale (see NpcBodyLoader.loadNpcBody()). Saved as-is by anything that must look the same after a reload (StoreClientStorage). */
export interface NpcLook {
    color?: string;
    face?: string;
    scale?: number;
    /** The hat it wears (see CharacterBody.setHat()) — undefined = none. */
    hat?: HatSpec;
}

/** Rolls a random look from `config`'s colors/faces/minScale..maxScale — see NpcConfig.colors' own doc. Empty when it has none of those. */
export function rollNpcLook(config: NpcConfig): NpcLook {
    const look: NpcLook = {};
    const colors = (config.colors ?? []).map(entry => entry.color).filter(Boolean);
    const faces = (config.faces ?? []).map(entry => entry.face).filter(Boolean);
    if (colors.length > 0) {
        look.color = colors[Math.floor(Math.random() * colors.length)];
    }
    if (faces.length > 0) {
        look.face = faces[Math.floor(Math.random() * faces.length)];
    }
    if (config.minScale !== undefined || config.maxScale !== undefined) {
        const min = config.minScale ?? config.maxScale!;
        const max = Math.max(min, config.maxScale ?? min);
        look.scale = min + Math.random() * (max - min);
    }
    look.hat = rollNpcHat(config);
    return look;
}

/** No hat with noHatChance, else one entry of `hats` by weight — see NpcConfig.hats. */
function rollNpcHat(config: NpcConfig): HatSpec | undefined {
    const pool = (config.hats ?? []).filter(entry => entry.models?.[0] && entry.weight > 0);
    if (pool.length === 0 || Math.random() < (config.noHatChance ?? 0)) {
        return undefined;
    }
    let roll = Math.random() * pool.reduce((sum, entry) => sum + entry.weight, 0);
    const entry = pool.find(candidate => (roll -= candidate.weight) < 0) ?? pool[pool.length - 1];
    return hatSpecOf(entry);
}

/** The HatSpec an NPC hat entry (or a store's worker hat — see StoreTypes.ts) describes, or undefined without a model. */
export function hatSpecOf(entry: { models?: (string | ModelDefinition)[]; scale?: number; offsetY?: number; rotationDeg?: number } | undefined): HatSpec | undefined {
    const model = entry?.models?.[0];
    if (!model) {
        return undefined;
    }
    return { model, scale: entry.scale, offsetY: entry.offsetY, rotationDeg: entry.rotationDeg };
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
    },
    "shopper3": {
        "characterViewId": "red",
        "viewRadius": 3,
        "viewAngleDeg": 180
    },
    "shopper4": {
        "characterViewId": "yellow",
        "scale": 0.0065,
        "viewRadius": 3,
        "viewAngleDeg": 180
    },
    "shopper5": {
        "characterViewId": "coral",
        "viewRadius": 3,
        "viewAngleDeg": 180
    },
    "shopper6": {
        "characterViewId": "purple",
        "scale": 0.0085,
        "viewRadius": 3,
        "viewAngleDeg": 180
    },
    "shopper7": {
        "characterViewId": "pink",
        "scale": 0.0065,
        "viewRadius": 3,
        "viewAngleDeg": 180
    },
    "shopper8": {
        "characterViewId": "green",
        "viewRadius": 3,
        "viewAngleDeg": 180
    },
    "shopper9": {
        "characterViewId": "orange",
        "scale": 0.008,
        "viewRadius": 3,
        "viewAngleDeg": 180
    },
    "shopper10": {
        "characterViewId": "mint",
        "viewRadius": 3,
        "viewAngleDeg": 180
    },
    "shopper11": {
        "characterViewId": "lime",
        "scale": 0.0065,
        "viewRadius": 3,
        "viewAngleDeg": 180
    },
    "shopper12": {
        "characterViewId": "teal",
        "viewRadius": 3,
        "viewAngleDeg": 180
    },
    "shopper13": {
        "characterViewId": "brown",
        "scale": 0.0085,
        "viewRadius": 3,
        "viewAngleDeg": 180
    },
    "shopper14": {
        "characterViewId": "gold",
        "viewRadius": 3,
        "viewAngleDeg": 180
    },
    "shopper15": {
        "characterViewId": "sky",
        "scale": 0.0065,
        "viewRadius": 3,
        "viewAngleDeg": 180
    },
    "shopper16": {
        "characterViewId": "rose",
        "viewRadius": 3,
        "viewAngleDeg": 180
    },
    "shopper17": {
        "characterViewId": "slate",
        "scale": 0.008,
        "viewRadius": 3,
        "viewAngleDeg": 180
    },
    "shopper": {
        "characterViewId": "default",
        "viewRadius": 3,
        "viewAngleDeg": 180,
        "colors": [
            {
                "color": "#ff9100"
            },
            {
                "color": "#ff7a00"
            },
            {
                "color": "#ff6d1f"
            },
            {
                "color": "#ff5722"
            },
            {
                "color": "#ff5a3c"
            },
            {
                "color": "#ff4f5e"
            },
            {
                "color": "#ff4a78"
            },
            {
                "color": "#ff4081"
            },
            {
                "color": "#f5398f"
            },
            {
                "color": "#ff5fa2"
            }
        ],
        "faces": [
            {
                "face": "skins/panda.webp"
            },
            {
                "face": "skins/face-brave-1.webp"
            },
            {
                "face": "skins/devil.webp"
            },
            {
                "face": "skins/face-mustache-1.webp"
            },
            {
                "face": "skins/face-dizzy-1.webp"
            },
            {
                "face": "skins/face-smirk-1.webp"
            },
            {
                "face": "skins/face-sunglasses-2.webp"
            },
            {
                "face": "skins/face-smile-1.webp"
            },
            {
                "face": "skins/face-laughing-1.webp"
            },
            {
                "face": "skins/face-glasses-1.webp"
            },
            {
                "face": "skins/face-money-1.webp"
            },
            {
                "face": "skins/face-star-1.webp"
            },
            {
                "face": "skins/face-smiling-2.webp"
            }
        ],
        "noHatChance": 0.5,
        "hats": [
            {
                "models": [
                    "Hats.CowboyHat"
                ],
                "weight": 3
            },
            {
                "models": [
                    "Hats.AmericanHat"
                ],
                "weight": 2
            },
            {
                "models": [
                    "Hats.PirateHat"
                ],
                "weight": 1
            }
        ],
        "minScale": 0.0065,
        "maxScale": 0.0085
    },
    "worker": {
        "characterViewId": "slate",
        "scale": 0.008,
        "viewRadius": 3,
        "viewAngleDeg": 180,
        "colors": [
            {
                "color": "#2ecc40"
            }
        ]
    }
};

export function getNpcConfig(id: string): NpcConfig | undefined {
    return NPC_CONFIG_BY_ID[id];
}
