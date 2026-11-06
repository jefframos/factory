// Auto-generated file - DO NOT EDIT
export type ModelFormat = 'glb' | 'gltf' | 'fbx' | 'obj';
export interface ModelDefinition {
  readonly id: string;
  readonly path: string;
  readonly fullPath: string;
  readonly format: ModelFormat;
  readonly nodes: Record<string, string>;
}

const MobMobAnims = {
  id: 'mob-anims',
  path: 'mob/mob-anims',
  fullPath: 'mob/models/mob/mob-anims.glb',
  format: 'glb',
  nodes: {
  "Hips": "Hips",
  "Spine": "Spine",
  "Spine1": "Spine1",
  "Neck": "Neck",
  "Head": "Head",
  "LeftShoulder": "LeftShoulder",
  "LeftArm": "LeftArm",
  "LeftForeArm": "LeftForeArm",
  "LeftHand": "LeftHand",
  "LeftUpLeg": "LeftUpLeg",
  "LeftLeg": "LeftLeg",
  "LeftFoot": "LeftFoot",
  "LeftToeBase": "LeftToeBase",
  "RightShoulder": "RightShoulder",
  "RightArm": "RightArm",
  "RightForeArm": "RightForeArm",
  "RightHand": "RightHand",
  "RightUpLeg": "RightUpLeg",
  "RightLeg": "RightLeg",
  "RightFoot": "RightFoot",
  "RightToeBase": "RightToeBase"
}
} as const;

const MobMob = {
  id: 'mob',
  path: 'mob/mob',
  fullPath: 'mob/models/mob/mob.glb',
  format: 'glb',
  nodes: {
  "Skeleton": "Skeleton",
  "Mob": "mob",
  "Root": "Root",
  "Hips": "Hips",
  "LeftUpLeg": "LeftUpLeg",
  "LeftLeg": "LeftLeg",
  "LeftFoot": "LeftFoot",
  "LeftToeBase": "LeftToeBase",
  "Spine": "Spine",
  "Spine1": "Spine1",
  "Neck": "Neck",
  "Head": "Head",
  "LeftShoulder": "LeftShoulder",
  "LeftArm": "LeftArm",
  "LeftForeArm": "LeftForeArm",
  "LeftHand": "LeftHand",
  "LeftHandIndex1": "LeftHandIndex1",
  "LeftHandIndex2": "LeftHandIndex2",
  "LeftHandMiddle1": "LeftHandMiddle1",
  "LeftHandMiddle2": "LeftHandMiddle2",
  "LeftHandPinky1": "LeftHandPinky1",
  "LeftHandPinky2": "LeftHandPinky2",
  "LeftHandProp": "LeftHandProp",
  "LeftHandRing1": "LeftHandRing1",
  "LeftHandRing2": "LeftHandRing2",
  "LeftHandThumb1": "LeftHandThumb1",
  "LeftHandThumb2": "LeftHandThumb2",
  "RightShoulder": "RightShoulder",
  "RightArm": "RightArm",
  "RightForeArm": "RightForeArm",
  "RightHand": "RightHand",
  "RightHandIndex1": "RightHandIndex1",
  "RightHandIndex2": "RightHandIndex2",
  "RightHandMiddle1": "RightHandMiddle1",
  "RightHandMiddle2": "RightHandMiddle2",
  "RightHandPinky1": "RightHandPinky1",
  "RightHandPinky2": "RightHandPinky2",
  "RightHandProp": "RightHandProp",
  "RightHandRing1": "RightHandRing1",
  "RightHandRing2": "RightHandRing2",
  "RightHandThumb1": "RightHandThumb1",
  "RightHandThumb2": "RightHandThumb2",
  "RightUpLeg": "RightUpLeg",
  "RightLeg": "RightLeg",
  "RightFoot": "RightFoot",
  "RightToeBase": "RightToeBase"
}
} as const;

// Grouped by top-level raw-assets/models folder (the '{...}' tag stripped) — e.g.
// raw-assets/models/characters{m}/... becomes MODELS.Characters.<name>. Files with no
// containing folder land in MODELS.Root.
export const MODELS = {
  Mob: {
    MobAnims: MobMobAnims,
    Mob: MobMob
  }
} as const;

export type ModelGroup = keyof typeof MODELS;
export default MODELS;