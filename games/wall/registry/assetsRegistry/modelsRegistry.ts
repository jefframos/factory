// Auto-generated file - DO NOT EDIT
export type ModelFormat = 'glb' | 'gltf' | 'fbx' | 'obj';
export interface ModelDefinition {
  readonly id: string;
  readonly path: string;
  readonly fullPath: string;
  readonly format: ModelFormat;
  readonly nodes: Record<string, string>;
}

const CrewBeaver = {
  id: 'beaver',
  path: 'crew/beaver',
  fullPath: 'wall/models/crew/beaver.glb',
  format: 'glb',
  nodes: {
  "Root": "root",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right",
  "Body": "body",
  "Tail": "tail"
}
} as const;

const CrewChick = {
  id: 'chick',
  path: 'crew/chick',
  fullPath: 'wall/models/crew/chick.glb',
  format: 'glb',
  nodes: {
  "Root": "root",
  "LegFrontRight": "leg-front-right",
  "LegFrontLeft": "leg-front-left",
  "Body": "body",
  "WingLeft": "wing-left",
  "WingRight": "wing-right"
}
} as const;

const CrewCow = {
  id: 'cow',
  path: 'crew/cow',
  fullPath: 'wall/models/crew/cow.glb',
  format: 'glb',
  nodes: {
  "Root": "root",
  "LegFrontRight": "leg-front-right",
  "LegFrontLeft": "leg-front-left",
  "LegBackRight": "leg-back-right",
  "LegBackLeft": "leg-back-left",
  "Body": "body",
  "Group": "Group"
}
} as const;

const CrewElephant = {
  id: 'elephant',
  path: 'crew/elephant',
  fullPath: 'wall/models/crew/elephant.glb',
  format: 'glb',
  nodes: {
  "Root": "root",
  "Body": "body",
  "Tail": "tail",
  "LegBackLeft": "leg-back-left",
  "LegFrontLeft": "leg-front-left",
  "LegBackRight": "leg-back-right",
  "LegFrontRight": "leg-front-right"
}
} as const;

const CrewGiraffe = {
  id: 'giraffe',
  path: 'crew/giraffe',
  fullPath: 'wall/models/crew/giraffe.glb',
  format: 'glb',
  nodes: {
  "Root": "root",
  "Body": "body",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right"
}
} as const;

const CrewHog = {
  id: 'hog',
  path: 'crew/hog',
  fullPath: 'wall/models/crew/hog.glb',
  format: 'glb',
  nodes: {
  "Root": "root",
  "Body": "body",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right"
}
} as const;

const CrewMonkey = {
  id: 'monkey',
  path: 'crew/monkey',
  fullPath: 'wall/models/crew/monkey.glb',
  format: 'glb',
  nodes: {
  "Root": "root",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right",
  "LegBackRight": "leg-back-right",
  "LegBackLeft": "leg-back-left",
  "Body": "body",
  "Tail": "tail"
}
} as const;

const CrewPanda = {
  id: 'panda',
  path: 'crew/panda',
  fullPath: 'wall/models/crew/panda.glb',
  format: 'glb',
  nodes: {
  "Root": "root",
  "Body": "body",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right"
}
} as const;

const PlayerAxe = {
  id: 'axe',
  path: 'player/axe',
  fullPath: 'wall/models/player/axe.glb',
  format: 'glb',
  nodes: {
  "Axe": "axe"
}
} as const;

const PlayerBattleaxe = {
  id: 'battleaxe',
  path: 'player/battleaxe',
  fullPath: 'wall/models/player/battleaxe.glb',
  format: 'glb',
  nodes: {
  "AxeB": "axe_B"
}
} as const;

const PlayerBoxing = {
  id: 'boxing',
  path: 'player/boxing',
  fullPath: 'wall/models/player/boxing.glb',
  format: 'glb',
  nodes: {
  "GloveLPCube001": "GloveLP_Cube.001"
}
} as const;

const PlayerHammer = {
  id: 'hammer',
  path: 'player/hammer',
  fullPath: 'wall/models/player/hammer.glb',
  format: 'glb',
  nodes: {
  "Hammer": "hammer"
}
} as const;

const PlayerHands = {
  id: 'hands',
  path: 'player/hands',
  fullPath: 'wall/models/player/hands.glb',
  format: 'glb',
  nodes: {
  "WristL": "wrist.L",
  "Palm4L": "palm_4.L",
  "Pinky1L": "pinky_1.L",
  "Pinky2L": "pinky_2.L",
  "Pinky3L": "pinky_3.L",
  "PinkyTipL": "pinky_tip.L",
  "Palm3L": "palm_3.L",
  "Ring1L": "ring_1.L",
  "Ring2L": "ring_2.L",
  "Ring3L": "ring_3.L",
  "RingTipL": "ring_tip.L",
  "Palm2L": "palm_2.L",
  "Middle1L": "middle_1.L",
  "Middle2L": "middle_2.L",
  "Middle3L": "middle_3.L",
  "MiddleTipL": "middle_tip.L",
  "Palm1L": "palm_1.L",
  "Index1L": "index_1.L",
  "Index2L": "index_2.L",
  "Index3L": "index_3.L",
  "IndexTipL": "index_tip.L",
  "Thumb1L": "thumb_1.L",
  "Thumb2L": "thumb_2.L",
  "Thumb3L": "thumb_3.L",
  "ThumbTipL": "thumb_tip.L",
  "HandMeshL": "hand_mesh.L",
  "WristR": "wrist.R",
  "Thumb1R": "thumb_1.R",
  "Thumb2R": "thumb_2.R",
  "Thumb3R": "thumb_3.R",
  "ThumbTipR": "thumb_tip.R",
  "Palm1R": "palm_1.R",
  "Index1R": "index_1.R",
  "Index2R": "index_2.R",
  "Index3R": "index_3.R",
  "IndexTipR": "index_tip.R",
  "Palm2R": "palm_2.R",
  "Middle1R": "middle_1.R",
  "Middle2R": "middle_2.R",
  "Middle3R": "middle_3.R",
  "MiddleTipR": "middle_tip.R",
  "Palm3R": "palm_3.R",
  "Ring1R": "ring_1.R",
  "Ring2R": "ring_2.R",
  "Ring3R": "ring_3.R",
  "RingTipR": "ring_tip.R",
  "Palm4R": "palm_4.R",
  "Pinky1R": "pinky_1.R",
  "Pinky2R": "pinky_2.R",
  "Pinky3R": "pinky_3.R",
  "PinkyTipR": "pinky_tip.R",
  "HandMeshR": "hand_mesh.R"
}
} as const;

const PlayerMace = {
  id: 'mace',
  path: 'player/mace',
  fullPath: 'wall/models/player/mace.glb',
  format: 'glb',
  nodes: {
  "HammerB": "hammer_B"
}
} as const;

const PlayerPickaxe = {
  id: 'pickaxe',
  path: 'player/pickaxe',
  fullPath: 'wall/models/player/pickaxe.glb',
  format: 'glb',
  nodes: {
  "Pickaxe": "pickaxe"
}
} as const;

const PlayerWarhammer = {
  id: 'warhammer',
  path: 'player/warhammer',
  fullPath: 'wall/models/player/warhammer.glb',
  format: 'glb',
  nodes: {
  "HammerD": "hammer_D"
}
} as const;

// Grouped by top-level raw-assets/models folder (the '{...}' tag stripped) — e.g.
// raw-assets/models/characters{m}/... becomes MODELS.Characters.<name>. Files with no
// containing folder land in MODELS.Root.
export const MODELS = {
  Crew: {
    Beaver: CrewBeaver,
    Chick: CrewChick,
    Cow: CrewCow,
    Elephant: CrewElephant,
    Giraffe: CrewGiraffe,
    Hog: CrewHog,
    Monkey: CrewMonkey,
    Panda: CrewPanda
  },
  Player: {
    Axe: PlayerAxe,
    Battleaxe: PlayerBattleaxe,
    Boxing: PlayerBoxing,
    Hammer: PlayerHammer,
    Hands: PlayerHands,
    Mace: PlayerMace,
    Pickaxe: PlayerPickaxe,
    Warhammer: PlayerWarhammer
  }
} as const;

export type ModelGroup = keyof typeof MODELS;
export default MODELS;