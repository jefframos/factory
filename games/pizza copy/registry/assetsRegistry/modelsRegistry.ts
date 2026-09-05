// Auto-generated file - DO NOT EDIT
export type ModelFormat = 'glb' | 'gltf' | 'fbx' | 'obj';
export interface ModelDefinition {
  readonly id: string;
  readonly path: string;
  readonly fullPath: string;
  readonly format: ModelFormat;
  readonly nodes: Record<string, string>;
}

const CharactersFallingIdle = {
  id: 'FallingIdle',
  path: 'characters/default/FallingIdle',
  fullPath: 'pizza copy/models/characters/default/FallingIdle.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersJumpingUp = {
  id: 'JumpingUp',
  path: 'characters/default/JumpingUp',
  fullPath: 'pizza copy/models/characters/default/JumpingUp.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersLanding = {
  id: 'Landing',
  path: 'characters/default/Landing',
  fullPath: 'pizza copy/models/characters/default/Landing.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersRoll = {
  id: 'Roll',
  path: 'characters/default/Roll',
  fullPath: 'pizza copy/models/characters/default/Roll.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersRunning = {
  id: 'Running',
  path: 'characters/default/Running',
  fullPath: 'pizza copy/models/characters/default/Running.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersStandToRoll = {
  id: 'Stand To Roll',
  path: 'characters/default/Stand To Roll',
  fullPath: 'pizza copy/models/characters/default/Stand To Roll.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersCharacterMedium = {
  id: 'characterMedium',
  path: 'characters/default/characterMedium',
  fullPath: 'pizza copy/models/characters/default/characterMedium.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersIdle = {
  id: 'idle',
  path: 'characters/default/idle',
  fullPath: 'pizza copy/models/characters/default/idle.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersIdle2 = {
  id: 'idle2',
  path: 'characters/default/idle2',
  fullPath: 'pizza copy/models/characters/default/idle2.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersJump = {
  id: 'jump',
  path: 'characters/default/jump',
  fullPath: 'pizza copy/models/characters/default/jump.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersRun = {
  id: 'run',
  path: 'characters/default/run',
  fullPath: 'pizza copy/models/characters/default/run.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersTestIdle = {
  id: 'test_idle',
  path: 'characters/default/test_idle',
  fullPath: 'pizza copy/models/characters/default/test_idle.glb',
  format: 'glb',
  nodes: {
  "Root": "Root",
  "LeftFootCtrl": "LeftFootCtrl",
  "LeftHeelRoll": "LeftHeelRoll",
  "LeftToeRoll": "LeftToeRoll",
  "LeftFootIK": "LeftFootIK",
  "LeftFootIKEnd": "LeftFootIK_end",
  "LeftFootRollCtrl": "LeftFootRollCtrl",
  "LeftFootRollCtrlEnd": "LeftFootRollCtrl_end",
  "LeftKneeCtrl": "LeftKneeCtrl",
  "LeftKneeCtrlEnd": "LeftKneeCtrl_end",
  "RightFootCtrl": "RightFootCtrl",
  "RightHeelRoll": "RightHeelRoll",
  "RightToeRoll": "RightToeRoll",
  "RightFootIK": "RightFootIK",
  "RightFootIKEnd": "RightFootIK_end",
  "RightFootRollCtrl": "RightFootRollCtrl",
  "RightFootRollCtrlEnd": "RightFootRollCtrl_end",
  "RightKneeCtrl": "RightKneeCtrl",
  "RightKneeCtrlEnd": "RightKneeCtrl_end",
  "HipsCtrl": "HipsCtrl",
  "Hips": "Hips",
  "Spine": "Spine",
  "Chest": "Chest",
  "UpperChest": "UpperChest",
  "Neck": "Neck",
  "Head": "Head",
  "HeadEnd": "Head_end",
  "LeftShoulder": "LeftShoulder",
  "LeftArm": "LeftArm",
  "LeftForeArm": "LeftForeArm",
  "LeftHand": "LeftHand",
  "LeftHandIndex1": "LeftHandIndex1",
  "LeftHandIndex2": "LeftHandIndex2",
  "LeftHandIndex3": "LeftHandIndex3",
  "LeftHandIndex3End": "LeftHandIndex3_end",
  "LeftHandThumb1": "LeftHandThumb1",
  "LeftHandThumb2": "LeftHandThumb2",
  "LeftHandThumb2End": "LeftHandThumb2_end",
  "RightShoulder": "RightShoulder",
  "RightArm": "RightArm",
  "RightForeArm": "RightForeArm",
  "RightHand": "RightHand",
  "RightHandIndex1": "RightHandIndex1",
  "RightHandIndex2": "RightHandIndex2",
  "RightHandIndex3": "RightHandIndex3",
  "RightHandIndex3End": "RightHandIndex3_end",
  "RightHandThumb1": "RightHandThumb1",
  "RightHandThumb2": "RightHandThumb2",
  "RightHandThumb2End": "RightHandThumb2_end",
  "LeftUpLeg": "LeftUpLeg",
  "LeftLeg": "LeftLeg",
  "LeftFoot": "LeftFoot",
  "LeftToes": "LeftToes",
  "LeftToesEnd": "LeftToes_end",
  "RightUpLeg": "RightUpLeg",
  "RightLeg": "RightLeg",
  "RightFoot": "RightFoot",
  "RightToes": "RightToes",
  "RightToesEnd": "RightToes_end"
}
} as const;

// Grouped by top-level raw-assets/models folder (the '{...}' tag stripped) — e.g.
// raw-assets/models/characters{m}/... becomes MODELS.Characters.<name>. Files with no
// containing folder land in MODELS.Root.
export const MODELS = {
  Characters: {
    FallingIdle: CharactersFallingIdle,
    JumpingUp: CharactersJumpingUp,
    Landing: CharactersLanding,
    Roll: CharactersRoll,
    Running: CharactersRunning,
    StandToRoll: CharactersStandToRoll,
    CharacterMedium: CharactersCharacterMedium,
    Idle: CharactersIdle,
    Idle2: CharactersIdle2,
    Jump: CharactersJump,
    Run: CharactersRun,
    TestIdle: CharactersTestIdle
  }
} as const;

export type ModelGroup = keyof typeof MODELS;
export default MODELS;