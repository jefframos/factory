// Auto-generated file - DO NOT EDIT
export type ModelFormat = 'glb' | 'gltf' | 'fbx' | 'obj';
export interface ModelDefinition {
  readonly id: string;
  readonly path: string;
  readonly fullPath: string;
  readonly format: ModelFormat;
  readonly nodes: Record<string, string>;
}

const CharactersCharacterMedium = {
  id: 'characterMedium',
  path: 'characters/default/characterMedium',
  fullPath: 'pizza/models/characters/default/characterMedium.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersDigging = {
  id: 'Digging',
  path: 'characters/default/Digging',
  fullPath: 'pizza/models/characters/default/Digging.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersFallingIdle = {
  id: 'FallingIdle',
  path: 'characters/default/FallingIdle',
  fullPath: 'pizza/models/characters/default/FallingIdle.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersIdle = {
  id: 'idle',
  path: 'characters/default/idle',
  fullPath: 'pizza/models/characters/default/idle.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersIdle2 = {
  id: 'idle2',
  path: 'characters/default/idle2',
  fullPath: 'pizza/models/characters/default/idle2.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersJump = {
  id: 'jump',
  path: 'characters/default/jump',
  fullPath: 'pizza/models/characters/default/jump.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersJumpingUp = {
  id: 'JumpingUp',
  path: 'characters/default/JumpingUp',
  fullPath: 'pizza/models/characters/default/JumpingUp.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersLanding = {
  id: 'Landing',
  path: 'characters/default/Landing',
  fullPath: 'pizza/models/characters/default/Landing.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersPickFruit = {
  id: 'PickFruit',
  path: 'characters/default/PickFruit',
  fullPath: 'pizza/models/characters/default/PickFruit.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersPlantTree = {
  id: 'PlantTree',
  path: 'characters/default/PlantTree',
  fullPath: 'pizza/models/characters/default/PlantTree.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersRoll = {
  id: 'Roll',
  path: 'characters/default/Roll',
  fullPath: 'pizza/models/characters/default/Roll.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersRun = {
  id: 'run',
  path: 'characters/default/run',
  fullPath: 'pizza/models/characters/default/run.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersRunning = {
  id: 'Running',
  path: 'characters/default/Running',
  fullPath: 'pizza/models/characters/default/Running.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersStandToRoll = {
  id: 'Stand To Roll',
  path: 'characters/default/Stand To Roll',
  fullPath: 'pizza/models/characters/default/Stand To Roll.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersStandingMeleeAttackDownwardCHOP = {
  id: 'StandingMeleeAttack DownwardCHOP',
  path: 'characters/default/StandingMeleeAttack DownwardCHOP',
  fullPath: 'pizza/models/characters/default/StandingMeleeAttack DownwardCHOP.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersStandingPICKAXE = {
  id: 'StandingPICKAXE',
  path: 'characters/default/StandingPICKAXE',
  fullPath: 'pizza/models/characters/default/StandingPICKAXE.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const CharactersTestIdle = {
  id: 'test_idle',
  path: 'characters/default/test_idle',
  fullPath: 'pizza/models/characters/default/test_idle.glb',
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

const CharactersWatering = {
  id: 'Watering',
  path: 'characters/default/Watering',
  fullPath: 'pizza/models/characters/default/Watering.fbx',
  format: 'fbx',
  nodes: {}
} as const;

const PetsAnimalBeaver = {
  id: 'animal-beaver',
  path: 'pets/animal-beaver',
  fullPath: 'pizza/models/pets/animal-beaver.glb',
  format: 'glb',
  nodes: {
  "AnimalBeaver": "animal-beaver",
  "Root": "root",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right",
  "Body": "body",
  "Tail": "tail"
}
} as const;

const PetsAnimalBee = {
  id: 'animal-bee',
  path: 'pets/animal-bee',
  fullPath: 'pizza/models/pets/animal-bee.glb',
  format: 'glb',
  nodes: {
  "AnimalBee": "animal-bee",
  "Root": "root",
  "Body": "body",
  "WingLeft": "wing-left",
  "WingRight": "wing-right",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right"
}
} as const;

const PetsAnimalBunny = {
  id: 'animal-bunny',
  path: 'pets/animal-bunny',
  fullPath: 'pizza/models/pets/animal-bunny.glb',
  format: 'glb',
  nodes: {
  "AnimalBunny": "animal-bunny",
  "Root": "root",
  "Body": "body",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right"
}
} as const;

const PetsAnimalCat = {
  id: 'animal-cat',
  path: 'pets/animal-cat',
  fullPath: 'pizza/models/pets/animal-cat.glb',
  format: 'glb',
  nodes: {
  "AnimalCat": "animal-cat",
  "Root": "root",
  "Body": "body",
  "Group": "Group",
  "Tail": "tail",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right"
}
} as const;

const PetsAnimalCaterpillar = {
  id: 'animal-caterpillar',
  path: 'pets/animal-caterpillar',
  fullPath: 'pizza/models/pets/animal-caterpillar.glb',
  format: 'glb',
  nodes: {
  "AnimalCaterpillar": "animal-caterpillar",
  "Root": "root",
  "LegFrontLeft": "leg-front-left",
  "Body": "body",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontRight": "leg-front-right"
}
} as const;

const PetsAnimalChick = {
  id: 'animal-chick',
  path: 'pets/animal-chick',
  fullPath: 'pizza/models/pets/animal-chick.glb',
  format: 'glb',
  nodes: {
  "AnimalChick": "animal-chick",
  "Root": "root",
  "LegFrontRight": "leg-front-right",
  "LegFrontLeft": "leg-front-left",
  "Body": "body",
  "WingLeft": "wing-left",
  "WingRight": "wing-right"
}
} as const;

const PetsAnimalCow = {
  id: 'animal-cow',
  path: 'pets/animal-cow',
  fullPath: 'pizza/models/pets/animal-cow.glb',
  format: 'glb',
  nodes: {
  "AnimalCow": "animal-cow",
  "Root": "root",
  "LegFrontRight": "leg-front-right",
  "LegFrontLeft": "leg-front-left",
  "LegBackRight": "leg-back-right",
  "LegBackLeft": "leg-back-left",
  "Body": "body",
  "Group": "Group"
}
} as const;

const PetsAnimalCrab = {
  id: 'animal-crab',
  path: 'pets/animal-crab',
  fullPath: 'pizza/models/pets/animal-crab.glb',
  format: 'glb',
  nodes: {
  "AnimalCrab": "animal-crab",
  "Root": "root",
  "LegBackLeft": "leg-back-left",
  "Body": "body",
  "Group": "Group",
  "LegFrontLeft": "leg-front-left",
  "LegBackRight": "leg-back-right",
  "LegFrontRight": "leg-front-right"
}
} as const;

const PetsAnimalDeer = {
  id: 'animal-deer',
  path: 'pets/animal-deer',
  fullPath: 'pizza/models/pets/animal-deer.glb',
  format: 'glb',
  nodes: {
  "AnimalDeer": "animal-deer",
  "Root": "root",
  "LegBackLeft": "leg-back-left",
  "Body": "body",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right"
}
} as const;

const PetsAnimalDog = {
  id: 'animal-dog',
  path: 'pets/animal-dog',
  fullPath: 'pizza/models/pets/animal-dog.glb',
  format: 'glb',
  nodes: {
  "AnimalDog": "animal-dog",
  "Root": "root",
  "Body": "body",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right"
}
} as const;

const PetsAnimalElephant = {
  id: 'animal-elephant',
  path: 'pets/animal-elephant',
  fullPath: 'pizza/models/pets/animal-elephant.glb',
  format: 'glb',
  nodes: {
  "AnimalElephant": "animal-elephant",
  "Root": "root",
  "Body": "body",
  "Tail": "tail",
  "LegBackLeft": "leg-back-left",
  "LegFrontLeft": "leg-front-left",
  "LegBackRight": "leg-back-right",
  "LegFrontRight": "leg-front-right"
}
} as const;

const PetsAnimalFish = {
  id: 'animal-fish',
  path: 'pets/animal-fish',
  fullPath: 'pizza/models/pets/animal-fish.glb',
  format: 'glb',
  nodes: {
  "AnimalFish": "animal-fish",
  "Root": "root",
  "Body": "body",
  "WingRight": "wing-right",
  "WingLeft": "wing-left"
}
} as const;

const PetsAnimalFox = {
  id: 'animal-fox',
  path: 'pets/animal-fox',
  fullPath: 'pizza/models/pets/animal-fox.glb',
  format: 'glb',
  nodes: {
  "AnimalFox": "animal-fox",
  "Root": "root",
  "Body": "body",
  "Tail": "tail",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right"
}
} as const;

const PetsAnimalGiraffe = {
  id: 'animal-giraffe',
  path: 'pets/animal-giraffe',
  fullPath: 'pizza/models/pets/animal-giraffe.glb',
  format: 'glb',
  nodes: {
  "AnimalGiraffe": "animal-giraffe",
  "Root": "root",
  "Body": "body",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right"
}
} as const;

const PetsAnimalHog = {
  id: 'animal-hog',
  path: 'pets/animal-hog',
  fullPath: 'pizza/models/pets/animal-hog.glb',
  format: 'glb',
  nodes: {
  "AnimalHog": "animal-hog",
  "Root": "root",
  "Body": "body",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right"
}
} as const;

const PetsAnimalKoala = {
  id: 'animal-koala',
  path: 'pets/animal-koala',
  fullPath: 'pizza/models/pets/animal-koala.glb',
  format: 'glb',
  nodes: {
  "AnimalKoala": "animal-koala",
  "Root": "root",
  "Body": "body",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right"
}
} as const;

const PetsAnimalLion = {
  id: 'animal-lion',
  path: 'pets/animal-lion',
  fullPath: 'pizza/models/pets/animal-lion.glb',
  format: 'glb',
  nodes: {
  "AnimalLion": "animal-lion",
  "Root": "root",
  "LegFrontRight": "leg-front-right",
  "Body": "body",
  "Tail": "tail",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left"
}
} as const;

const PetsAnimalMonkey = {
  id: 'animal-monkey',
  path: 'pets/animal-monkey',
  fullPath: 'pizza/models/pets/animal-monkey.glb',
  format: 'glb',
  nodes: {
  "AnimalMonkey": "animal-monkey",
  "Root": "root",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right",
  "LegBackRight": "leg-back-right",
  "LegBackLeft": "leg-back-left",
  "Body": "body",
  "Tail": "tail"
}
} as const;

const PetsAnimalPanda = {
  id: 'animal-panda',
  path: 'pets/animal-panda',
  fullPath: 'pizza/models/pets/animal-panda.glb',
  format: 'glb',
  nodes: {
  "AnimalPanda": "animal-panda",
  "Root": "root",
  "Body": "body",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right"
}
} as const;

const PetsAnimalParrot = {
  id: 'animal-parrot',
  path: 'pets/animal-parrot',
  fullPath: 'pizza/models/pets/animal-parrot.glb',
  format: 'glb',
  nodes: {
  "AnimalParrot": "animal-parrot",
  "Root": "root",
  "Body": "body",
  "Group": "Group",
  "Tail": "tail",
  "WingRight": "wing-right",
  "WingLeft": "wing-left",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right"
}
} as const;

const PetsAnimalPenguin = {
  id: 'animal-penguin',
  path: 'pets/animal-penguin',
  fullPath: 'pizza/models/pets/animal-penguin.glb',
  format: 'glb',
  nodes: {
  "AnimalPenguin": "animal-penguin",
  "Root": "root",
  "LegFrontRight": "leg-front-right",
  "Body": "body",
  "WingLeft": "wing-left",
  "WingRight": "wing-right",
  "LegFrontLeft": "leg-front-left"
}
} as const;

const PetsAnimalPig = {
  id: 'animal-pig',
  path: 'pets/animal-pig',
  fullPath: 'pizza/models/pets/animal-pig.glb',
  format: 'glb',
  nodes: {
  "AnimalPig": "animal-pig",
  "Root": "root",
  "Body": "body",
  "Group": "Group",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right"
}
} as const;

const PetsAnimalPolar = {
  id: 'animal-polar',
  path: 'pets/animal-polar',
  fullPath: 'pizza/models/pets/animal-polar.glb',
  format: 'glb',
  nodes: {
  "AnimalPolar": "animal-polar",
  "Root": "root",
  "Body": "body",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left",
  "LegFrontRight": "leg-front-right"
}
} as const;

const PetsAnimalTiger = {
  id: 'animal-tiger',
  path: 'pets/animal-tiger',
  fullPath: 'pizza/models/pets/animal-tiger.glb',
  format: 'glb',
  nodes: {
  "AnimalTiger": "animal-tiger",
  "Root": "root",
  "LegFrontRight": "leg-front-right",
  "Body": "body",
  "Tail": "tail",
  "LegBackLeft": "leg-back-left",
  "LegBackRight": "leg-back-right",
  "LegFrontLeft": "leg-front-left"
}
} as const;

const PirateBarrel = {
  id: 'barrel',
  path: 'pirate/barrel',
  fullPath: 'pizza/models/pirate/barrel.glb',
  format: 'glb',
  nodes: {
  "Barrel": "barrel"
}
} as const;

const PirateBoatRowLarge = {
  id: 'boat-row-large',
  path: 'pirate/boat-row-large',
  fullPath: 'pizza/models/pirate/boat-row-large.glb',
  format: 'glb',
  nodes: {
  "BoatRowLarge": "boat-row-large",
  "Paddles": "paddles"
}
} as const;

const PirateBoatRowSmall = {
  id: 'boat-row-small',
  path: 'pirate/boat-row-small',
  fullPath: 'pizza/models/pirate/boat-row-small.glb',
  format: 'glb',
  nodes: {
  "BoatRowSmall": "boat-row-small",
  "Paddles": "paddles"
}
} as const;

const PirateBottleLarge = {
  id: 'bottle-large',
  path: 'pirate/bottle-large',
  fullPath: 'pizza/models/pirate/bottle-large.glb',
  format: 'glb',
  nodes: {
  "BottleLarge": "bottle-large"
}
} as const;

const PirateBottle = {
  id: 'bottle',
  path: 'pirate/bottle',
  fullPath: 'pizza/models/pirate/bottle.glb',
  format: 'glb',
  nodes: {
  "Bottle": "bottle"
}
} as const;

const PirateCannonBall = {
  id: 'cannon-ball',
  path: 'pirate/cannon-ball',
  fullPath: 'pizza/models/pirate/cannon-ball.glb',
  format: 'glb',
  nodes: {
  "CannonBall": "cannon-ball"
}
} as const;

const PirateCannonMobile = {
  id: 'cannon-mobile',
  path: 'pirate/cannon-mobile',
  fullPath: 'pizza/models/pirate/cannon-mobile.glb',
  format: 'glb',
  nodes: {
  "CannonMobile": "cannon-mobile",
  "Group": "Group"
}
} as const;

const PirateCannon = {
  id: 'cannon',
  path: 'pirate/cannon',
  fullPath: 'pizza/models/pirate/cannon.glb',
  format: 'glb',
  nodes: {
  "Cannon": "cannon",
  "Group": "Group"
}
} as const;

const PirateCastleDoor = {
  id: 'castle-door',
  path: 'pirate/castle-door',
  fullPath: 'pizza/models/pirate/castle-door.glb',
  format: 'glb',
  nodes: {
  "CastleDoor": "castle-door"
}
} as const;

const PirateCastleGate = {
  id: 'castle-gate',
  path: 'pirate/castle-gate',
  fullPath: 'pizza/models/pirate/castle-gate.glb',
  format: 'glb',
  nodes: {
  "CastleGate": "castle-gate"
}
} as const;

const PirateCastleWall = {
  id: 'castle-wall',
  path: 'pirate/castle-wall',
  fullPath: 'pizza/models/pirate/castle-wall.glb',
  format: 'glb',
  nodes: {
  "CastleWall": "castle-wall"
}
} as const;

const PirateCastleWindow = {
  id: 'castle-window',
  path: 'pirate/castle-window',
  fullPath: 'pizza/models/pirate/castle-window.glb',
  format: 'glb',
  nodes: {
  "CastleWindow": "castle-window"
}
} as const;

const PirateChest = {
  id: 'chest',
  path: 'pirate/chest',
  fullPath: 'pizza/models/pirate/chest.glb',
  format: 'glb',
  nodes: {
  "Chest": "chest",
  "Lid": "lid"
}
} as const;

const PirateCrateBottles = {
  id: 'crate-bottles',
  path: 'pirate/crate-bottles',
  fullPath: 'pizza/models/pirate/crate-bottles.glb',
  format: 'glb',
  nodes: {
  "CrateBottles": "crate-bottles"
}
} as const;

const PirateCrate = {
  id: 'crate',
  path: 'pirate/crate',
  fullPath: 'pizza/models/pirate/crate.glb',
  format: 'glb',
  nodes: {
  "Crate": "crate"
}
} as const;

const PirateFlagHighPennant = {
  id: 'flag-high-pennant',
  path: 'pirate/flag-high-pennant',
  fullPath: 'pizza/models/pirate/flag-high-pennant.glb',
  format: 'glb',
  nodes: {
  "FlagHighPennant": "flag-high-pennant"
}
} as const;

const PirateFlagHigh = {
  id: 'flag-high',
  path: 'pirate/flag-high',
  fullPath: 'pizza/models/pirate/flag-high.glb',
  format: 'glb',
  nodes: {
  "FlagHigh": "flag-high"
}
} as const;

const PirateFlagPennant = {
  id: 'flag-pennant',
  path: 'pirate/flag-pennant',
  fullPath: 'pizza/models/pirate/flag-pennant.glb',
  format: 'glb',
  nodes: {
  "FlagPennant": "flag-pennant"
}
} as const;

const PirateFlagPirateHighPennant = {
  id: 'flag-pirate-high-pennant',
  path: 'pirate/flag-pirate-high-pennant',
  fullPath: 'pizza/models/pirate/flag-pirate-high-pennant.glb',
  format: 'glb',
  nodes: {
  "FlagPirateHighPennant": "flag-pirate-high-pennant"
}
} as const;

const PirateFlagPirateHigh = {
  id: 'flag-pirate-high',
  path: 'pirate/flag-pirate-high',
  fullPath: 'pizza/models/pirate/flag-pirate-high.glb',
  format: 'glb',
  nodes: {
  "FlagPirateHigh": "flag-pirate-high"
}
} as const;

const PirateFlagPiratePennant = {
  id: 'flag-pirate-pennant',
  path: 'pirate/flag-pirate-pennant',
  fullPath: 'pizza/models/pirate/flag-pirate-pennant.glb',
  format: 'glb',
  nodes: {
  "FlagPiratePennant": "flag-pirate-pennant"
}
} as const;

const PirateFlagPirate = {
  id: 'flag-pirate',
  path: 'pirate/flag-pirate',
  fullPath: 'pizza/models/pirate/flag-pirate.glb',
  format: 'glb',
  nodes: {
  "FlagPirate": "flag-pirate"
}
} as const;

const PirateFlag = {
  id: 'flag',
  path: 'pirate/flag',
  fullPath: 'pizza/models/pirate/flag.glb',
  format: 'glb',
  nodes: {
  "Flag": "flag"
}
} as const;

const PirateGrassPatch = {
  id: 'grass-patch',
  path: 'pirate/grass-patch',
  fullPath: 'pizza/models/pirate/grass-patch.glb',
  format: 'glb',
  nodes: {
  "GrassPatch": "grass-patch"
}
} as const;

const PirateGrassPlant = {
  id: 'grass-plant',
  path: 'pirate/grass-plant',
  fullPath: 'pizza/models/pirate/grass-plant.glb',
  format: 'glb',
  nodes: {
  "GrassPlant": "grass-plant"
}
} as const;

const PirateGrass = {
  id: 'grass',
  path: 'pirate/grass',
  fullPath: 'pizza/models/pirate/grass.glb',
  format: 'glb',
  nodes: {
  "Grass": "grass"
}
} as const;

const PirateHole = {
  id: 'hole',
  path: 'pirate/hole',
  fullPath: 'pizza/models/pirate/hole.glb',
  format: 'glb',
  nodes: {
  "Hole": "hole"
}
} as const;

const PirateMastRopes = {
  id: 'mast-ropes',
  path: 'pirate/mast-ropes',
  fullPath: 'pizza/models/pirate/mast-ropes.glb',
  format: 'glb',
  nodes: {
  "MastRopes": "mast-ropes",
  "SailA": "sail-a",
  "FlagC": "flag-c"
}
} as const;

const PirateMast = {
  id: 'mast',
  path: 'pirate/mast',
  fullPath: 'pizza/models/pirate/mast.glb',
  format: 'glb',
  nodes: {
  "Mast": "mast",
  "SailA": "sail-a",
  "FlagC": "flag-c"
}
} as const;

const PiratePalmBend = {
  id: 'palm-bend',
  path: 'pirate/palm-bend',
  fullPath: 'pizza/models/pirate/palm-bend.glb',
  format: 'glb',
  nodes: {
  "PalmBend": "palm-bend"
}
} as const;

const PiratePalmDetailedBend = {
  id: 'palm-detailed-bend',
  path: 'pirate/palm-detailed-bend',
  fullPath: 'pizza/models/pirate/palm-detailed-bend.glb',
  format: 'glb',
  nodes: {
  "PalmDetailedBend": "palm-detailed-bend"
}
} as const;

const PiratePalmDetailedStraight = {
  id: 'palm-detailed-straight',
  path: 'pirate/palm-detailed-straight',
  fullPath: 'pizza/models/pirate/palm-detailed-straight.glb',
  format: 'glb',
  nodes: {
  "PalmDetailedStraight": "palm-detailed-straight"
}
} as const;

const PiratePalmStraight = {
  id: 'palm-straight',
  path: 'pirate/palm-straight',
  fullPath: 'pizza/models/pirate/palm-straight.glb',
  format: 'glb',
  nodes: {
  "PalmStraight": "palm-straight"
}
} as const;

const PiratePatchGrassFoliage = {
  id: 'patch-grass-foliage',
  path: 'pirate/patch-grass-foliage',
  fullPath: 'pizza/models/pirate/patch-grass-foliage.glb',
  format: 'glb',
  nodes: {
  "PatchGrassFoliage": "patch-grass-foliage"
}
} as const;

const PiratePatchGrass = {
  id: 'patch-grass',
  path: 'pirate/patch-grass',
  fullPath: 'pizza/models/pirate/patch-grass.glb',
  format: 'glb',
  nodes: {
  "PatchGrass": "patch-grass"
}
} as const;

const PiratePatchSandFoliage = {
  id: 'patch-sand-foliage',
  path: 'pirate/patch-sand-foliage',
  fullPath: 'pizza/models/pirate/patch-sand-foliage.glb',
  format: 'glb',
  nodes: {
  "PatchSandFoliage": "patch-sand-foliage"
}
} as const;

const PiratePatchSand = {
  id: 'patch-sand',
  path: 'pirate/patch-sand',
  fullPath: 'pizza/models/pirate/patch-sand.glb',
  format: 'glb',
  nodes: {
  "PatchSand": "patch-sand"
}
} as const;

const PiratePlatformPlanks = {
  id: 'platform-planks',
  path: 'pirate/platform-planks',
  fullPath: 'pizza/models/pirate/platform-planks.glb',
  format: 'glb',
  nodes: {
  "PlatformPlanks": "platform-planks"
}
} as const;

const PiratePlatform = {
  id: 'platform',
  path: 'pirate/platform',
  fullPath: 'pizza/models/pirate/platform.glb',
  format: 'glb',
  nodes: {
  "Platform": "platform"
}
} as const;

const PirateRocksA = {
  id: 'rocks-a',
  path: 'pirate/rocks-a',
  fullPath: 'pizza/models/pirate/rocks-a.glb',
  format: 'glb',
  nodes: {
  "RocksA": "rocks-a"
}
} as const;

const PirateRocksB = {
  id: 'rocks-b',
  path: 'pirate/rocks-b',
  fullPath: 'pizza/models/pirate/rocks-b.glb',
  format: 'glb',
  nodes: {
  "RocksB": "rocks-b"
}
} as const;

const PirateRocksC = {
  id: 'rocks-c',
  path: 'pirate/rocks-c',
  fullPath: 'pizza/models/pirate/rocks-c.glb',
  format: 'glb',
  nodes: {
  "RocksC": "rocks-c"
}
} as const;

const PirateRocksSandA = {
  id: 'rocks-sand-a',
  path: 'pirate/rocks-sand-a',
  fullPath: 'pizza/models/pirate/rocks-sand-a.glb',
  format: 'glb',
  nodes: {
  "RocksSandA": "rocks-sand-a"
}
} as const;

const PirateRocksSandB = {
  id: 'rocks-sand-b',
  path: 'pirate/rocks-sand-b',
  fullPath: 'pizza/models/pirate/rocks-sand-b.glb',
  format: 'glb',
  nodes: {
  "RocksSandB": "rocks-sand-b"
}
} as const;

const PirateRocksSandC = {
  id: 'rocks-sand-c',
  path: 'pirate/rocks-sand-c',
  fullPath: 'pizza/models/pirate/rocks-sand-c.glb',
  format: 'glb',
  nodes: {
  "RocksSandC": "rocks-sand-c"
}
} as const;

const PirateShipGhost = {
  id: 'ship-ghost',
  path: 'pirate/ship-ghost',
  fullPath: 'pizza/models/pirate/ship-ghost.glb',
  format: 'glb',
  nodes: {
  "ShipGhost": "ship-ghost",
  "FlagB": "flag-b",
  "FlagC": "flag-c",
  "SailA": "sail-a",
  "SailB": "sail-b",
  "FlagA": "flag-a"
}
} as const;

const PirateShipLarge = {
  id: 'ship-large',
  path: 'pirate/ship-large',
  fullPath: 'pizza/models/pirate/ship-large.glb',
  format: 'glb',
  nodes: {
  "ShipLarge": "ship-large",
  "FlagA": "flag-a",
  "SailB": "sail-b",
  "SailA": "sail-a",
  "FlagC": "flag-c",
  "FlagB": "flag-b"
}
} as const;

const PirateShipMedium = {
  id: 'ship-medium',
  path: 'pirate/ship-medium',
  fullPath: 'pizza/models/pirate/ship-medium.glb',
  format: 'glb',
  nodes: {
  "ShipMedium": "ship-medium",
  "SailB": "sail-b",
  "SailA": "sail-a",
  "FlagC": "flag-c",
  "FlagB": "flag-b",
  "FlagA": "flag-a"
}
} as const;

const PirateShipPirateLarge = {
  id: 'ship-pirate-large',
  path: 'pirate/ship-pirate-large',
  fullPath: 'pizza/models/pirate/ship-pirate-large.glb',
  format: 'glb',
  nodes: {
  "ShipPirateLarge": "ship-pirate-large",
  "SailB": "sail-b",
  "SailA": "sail-a",
  "FlagC": "flag-c"
}
} as const;

const PirateShipPirateMedium = {
  id: 'ship-pirate-medium',
  path: 'pirate/ship-pirate-medium',
  fullPath: 'pizza/models/pirate/ship-pirate-medium.glb',
  format: 'glb',
  nodes: {
  "ShipPirateMedium": "ship-pirate-medium",
  "FlagB": "flag-b",
  "SailB": "sail-b",
  "SailA": "sail-a",
  "FlagC": "flag-c",
  "FlagA": "flag-a"
}
} as const;

const PirateShipPirateSmall = {
  id: 'ship-pirate-small',
  path: 'pirate/ship-pirate-small',
  fullPath: 'pizza/models/pirate/ship-pirate-small.glb',
  format: 'glb',
  nodes: {
  "ShipPirateSmall": "ship-pirate-small",
  "SailA": "sail-a",
  "FlagB": "flag-b",
  "FlagA": "flag-a"
}
} as const;

const PirateShipSmall = {
  id: 'ship-small',
  path: 'pirate/ship-small',
  fullPath: 'pizza/models/pirate/ship-small.glb',
  format: 'glb',
  nodes: {
  "ShipSmall": "ship-small",
  "FlagA": "flag-a",
  "FlagB": "flag-b",
  "SailA": "sail-a"
}
} as const;

const PirateShipWreck = {
  id: 'ship-wreck',
  path: 'pirate/ship-wreck',
  fullPath: 'pizza/models/pirate/ship-wreck.glb',
  format: 'glb',
  nodes: {
  "ShipWreck": "ship-wreck",
  "Grass": "grass",
  "Group": "Group",
  "SailA": "sail-a"
}
} as const;

const PirateStructureFenceSides = {
  id: 'structure-fence-sides',
  path: 'pirate/structure-fence-sides',
  fullPath: 'pizza/models/pirate/structure-fence-sides.glb',
  format: 'glb',
  nodes: {
  "StructureFenceSides": "structure-fence-sides",
  "Group": "Group"
}
} as const;

const PirateStructureFence = {
  id: 'structure-fence',
  path: 'pirate/structure-fence',
  fullPath: 'pizza/models/pirate/structure-fence.glb',
  format: 'glb',
  nodes: {
  "StructureFence": "structure-fence"
}
} as const;

const PirateStructurePlatformDockSmall = {
  id: 'structure-platform-dock-small',
  path: 'pirate/structure-platform-dock-small',
  fullPath: 'pizza/models/pirate/structure-platform-dock-small.glb',
  format: 'glb',
  nodes: {
  "StructurePlatformDockSmall": "structure-platform-dock-small"
}
} as const;

const PirateStructurePlatformDock = {
  id: 'structure-platform-dock',
  path: 'pirate/structure-platform-dock',
  fullPath: 'pizza/models/pirate/structure-platform-dock.glb',
  format: 'glb',
  nodes: {
  "StructurePlatformDock": "structure-platform-dock"
}
} as const;

const PirateStructurePlatformSmall = {
  id: 'structure-platform-small',
  path: 'pirate/structure-platform-small',
  fullPath: 'pizza/models/pirate/structure-platform-small.glb',
  format: 'glb',
  nodes: {
  "StructurePlatformSmall": "structure-platform-small"
}
} as const;

const PirateStructurePlatform = {
  id: 'structure-platform',
  path: 'pirate/structure-platform',
  fullPath: 'pizza/models/pirate/structure-platform.glb',
  format: 'glb',
  nodes: {
  "StructurePlatform": "structure-platform"
}
} as const;

const PirateStructureRoof = {
  id: 'structure-roof',
  path: 'pirate/structure-roof',
  fullPath: 'pizza/models/pirate/structure-roof.glb',
  format: 'glb',
  nodes: {
  "StructureRoof": "structure-roof"
}
} as const;

const PirateStructure = {
  id: 'structure',
  path: 'pirate/structure',
  fullPath: 'pizza/models/pirate/structure.glb',
  format: 'glb',
  nodes: {
  "Structure": "structure"
}
} as const;

const PirateToolPaddle = {
  id: 'tool-paddle',
  path: 'pirate/tool-paddle',
  fullPath: 'pizza/models/pirate/tool-paddle.glb',
  format: 'glb',
  nodes: {
  "ToolPaddle": "tool-paddle"
}
} as const;

const PirateToolShovel = {
  id: 'tool-shovel',
  path: 'pirate/tool-shovel',
  fullPath: 'pizza/models/pirate/tool-shovel.glb',
  format: 'glb',
  nodes: {
  "ToolShovel": "tool-shovel"
}
} as const;

const PirateTowerBaseDoor = {
  id: 'tower-base-door',
  path: 'pirate/tower-base-door',
  fullPath: 'pizza/models/pirate/tower-base-door.glb',
  format: 'glb',
  nodes: {
  "TowerBaseDoor": "tower-base-door"
}
} as const;

const PirateTowerBase = {
  id: 'tower-base',
  path: 'pirate/tower-base',
  fullPath: 'pizza/models/pirate/tower-base.glb',
  format: 'glb',
  nodes: {
  "TowerBase": "tower-base"
}
} as const;

const PirateTowerCompleteLarge = {
  id: 'tower-complete-large',
  path: 'pirate/tower-complete-large',
  fullPath: 'pizza/models/pirate/tower-complete-large.glb',
  format: 'glb',
  nodes: {
  "TowerCompleteLarge": "tower-complete-large"
}
} as const;

const PirateTowerCompleteSmall = {
  id: 'tower-complete-small',
  path: 'pirate/tower-complete-small',
  fullPath: 'pizza/models/pirate/tower-complete-small.glb',
  format: 'glb',
  nodes: {
  "TowerCompleteSmall": "tower-complete-small"
}
} as const;

const PirateTowerMiddleWindows = {
  id: 'tower-middle-windows',
  path: 'pirate/tower-middle-windows',
  fullPath: 'pizza/models/pirate/tower-middle-windows.glb',
  format: 'glb',
  nodes: {
  "TowerMiddleWindows": "tower-middle-windows"
}
} as const;

const PirateTowerMiddle = {
  id: 'tower-middle',
  path: 'pirate/tower-middle',
  fullPath: 'pizza/models/pirate/tower-middle.glb',
  format: 'glb',
  nodes: {
  "TowerMiddle": "tower-middle"
}
} as const;

const PirateTowerRoof = {
  id: 'tower-roof',
  path: 'pirate/tower-roof',
  fullPath: 'pizza/models/pirate/tower-roof.glb',
  format: 'glb',
  nodes: {
  "TowerRoof": "tower-roof"
}
} as const;

const PirateTowerTop = {
  id: 'tower-top',
  path: 'pirate/tower-top',
  fullPath: 'pizza/models/pirate/tower-top.glb',
  format: 'glb',
  nodes: {
  "TowerTop": "tower-top"
}
} as const;

const PirateTowerWatch = {
  id: 'tower-watch',
  path: 'pirate/tower-watch',
  fullPath: 'pizza/models/pirate/tower-watch.glb',
  format: 'glb',
  nodes: {
  "TowerWatch": "tower-watch"
}
} as const;

const PropsBridge = {
  id: 'bridge',
  path: 'props/bridge',
  fullPath: 'pizza/models/props/bridge.glb',
  format: 'glb',
  nodes: {
  "Bridge": "bridge"
}
} as const;

const PropsBuildingPlatform = {
  id: 'building-platform',
  path: 'props/building-platform',
  fullPath: 'pizza/models/props/building-platform.glb',
  format: 'glb',
  nodes: {
  "BuildingPlatform": "building-platform"
}
} as const;

const PropsBuildingRoof = {
  id: 'building-roof',
  path: 'props/building-roof',
  fullPath: 'pizza/models/props/building-roof.glb',
  format: 'glb',
  nodes: {
  "BuildingRoof": "building-roof"
}
} as const;

const PropsBuildingStructure = {
  id: 'building-structure',
  path: 'props/building-structure',
  fullPath: 'pizza/models/props/building-structure.glb',
  format: 'glb',
  nodes: {
  "BuildingStructure": "building-structure"
}
} as const;

const PropsCharacterArcher = {
  id: 'character-archer',
  path: 'props/character-archer',
  fullPath: 'pizza/models/props/character-archer.glb',
  format: 'glb',
  nodes: {
  "CharacterArcher": "character-archer",
  "Root": "root",
  "LegLeft": "leg-left",
  "LegRight": "leg-right",
  "Torso": "torso",
  "ArmLeft": "arm-left",
  "ArmRight": "arm-right",
  "Head": "head",
  "BodyMesh": "body-mesh",
  "HeadMesh": "head-mesh"
}
} as const;

const PropsFence = {
  id: 'fence',
  path: 'props/fence',
  fullPath: 'pizza/models/props/fence.glb',
  format: 'glb',
  nodes: {
  "Fence": "fence"
}
} as const;

const PropsFlag = {
  id: 'flag',
  path: 'props/flag',
  fullPath: 'pizza/models/props/flag.glb',
  format: 'glb',
  nodes: {
  "Flag": "flag"
}
} as const;

const PropsLadder = {
  id: 'ladder',
  path: 'props/ladder',
  fullPath: 'pizza/models/props/ladder.glb',
  format: 'glb',
  nodes: {
  "Ladder": "ladder"
}
} as const;

const PropsPatchDirt = {
  id: 'patch-dirt',
  path: 'props/patch-dirt',
  fullPath: 'pizza/models/props/patch-dirt.glb',
  format: 'glb',
  nodes: {
  "PatchDirt": "patch-dirt"
}
} as const;

const PropsPatchGrass = {
  id: 'patch-grass',
  path: 'props/patch-grass',
  fullPath: 'pizza/models/props/patch-grass.glb',
  format: 'glb',
  nodes: {
  "PatchGrass": "patch-grass"
}
} as const;

const PropsPlant = {
  id: 'plant',
  path: 'props/plant',
  fullPath: 'pizza/models/props/plant.glb',
  format: 'glb',
  nodes: {
  "Plant": "plant"
}
} as const;

const PropsPlatform = {
  id: 'platform',
  path: 'props/platform',
  fullPath: 'pizza/models/props/platform.glb',
  format: 'glb',
  nodes: {
  "Platform": "platform"
}
} as const;

const PropsRocksHigh = {
  id: 'rocks-high',
  path: 'props/rocks-high',
  fullPath: 'pizza/models/props/rocks-high.glb',
  format: 'glb',
  nodes: {
  "RocksHigh": "rocks-high"
}
} as const;

const PropsRocksLow = {
  id: 'rocks-low',
  path: 'props/rocks-low',
  fullPath: 'pizza/models/props/rocks-low.glb',
  format: 'glb',
  nodes: {
  "RocksLow": "rocks-low"
}
} as const;

const PropsRocksRamp = {
  id: 'rocks-ramp',
  path: 'props/rocks-ramp',
  fullPath: 'pizza/models/props/rocks-ramp.glb',
  format: 'glb',
  nodes: {
  "RocksRamp": "rocks-ramp"
}
} as const;

const PropsStones = {
  id: 'stones',
  path: 'props/stones',
  fullPath: 'pizza/models/props/stones.glb',
  format: 'glb',
  nodes: {
  "Stones": "stones"
}
} as const;

const PropsTarget = {
  id: 'target',
  path: 'props/target',
  fullPath: 'pizza/models/props/target.glb',
  format: 'glb',
  nodes: {
  "Target": "target"
}
} as const;

const PropsTent = {
  id: 'tent',
  path: 'props/tent',
  fullPath: 'pizza/models/props/tent.glb',
  format: 'glb',
  nodes: {
  "Tent": "tent"
}
} as const;

const PropsTreeHigh = {
  id: 'tree-high',
  path: 'props/tree-high',
  fullPath: 'pizza/models/props/tree-high.glb',
  format: 'glb',
  nodes: {
  "TreeHigh": "tree-high"
}
} as const;

const PropsTree = {
  id: 'tree',
  path: 'props/tree',
  fullPath: 'pizza/models/props/tree.glb',
  format: 'glb',
  nodes: {
  "Tree": "tree"
}
} as const;

const PropsWeaponArrow = {
  id: 'weapon-arrow',
  path: 'props/weapon-arrow',
  fullPath: 'pizza/models/props/weapon-arrow.glb',
  format: 'glb',
  nodes: {
  "WeaponArrow": "weapon-arrow"
}
} as const;

const PropsWeaponBow = {
  id: 'weapon-bow',
  path: 'props/weapon-bow',
  fullPath: 'pizza/models/props/weapon-bow.glb',
  format: 'glb',
  nodes: {
  "WeaponBow": "weapon-bow"
}
} as const;

const ToolsAnvil = {
  id: 'anvil',
  path: 'tools/gltf/anvil',
  fullPath: 'pizza/models/tools/gltf/anvil.gltf',
  format: 'gltf',
  nodes: {
  "Anvil": "anvil"
}
} as const;

const ToolsAxe = {
  id: 'axe',
  path: 'tools/gltf/axe',
  fullPath: 'pizza/models/tools/gltf/axe.gltf',
  format: 'gltf',
  nodes: {
  "Axe": "axe"
}
} as const;

const ToolsBlueprint = {
  id: 'blueprint',
  path: 'tools/gltf/blueprint',
  fullPath: 'pizza/models/tools/gltf/blueprint.gltf',
  format: 'gltf',
  nodes: {
  "Blueprint": "blueprint"
}
} as const;

const ToolsBlueprintStacked = {
  id: 'blueprint_stacked',
  path: 'tools/gltf/blueprint_stacked',
  fullPath: 'pizza/models/tools/gltf/blueprint_stacked.gltf',
  format: 'gltf',
  nodes: {
  "BlueprintStacked": "blueprint_stacked"
}
} as const;

const ToolsBucketMetal = {
  id: 'bucket_metal',
  path: 'tools/gltf/bucket_metal',
  fullPath: 'pizza/models/tools/gltf/bucket_metal.gltf',
  format: 'gltf',
  nodes: {
  "BucketMetal": "bucket_metal",
  "BucketMetalHandle": "bucket_metal_handle"
}
} as const;

const ToolsChisel = {
  id: 'chisel',
  path: 'tools/gltf/chisel',
  fullPath: 'pizza/models/tools/gltf/chisel.gltf',
  format: 'gltf',
  nodes: {
  "Chisel": "chisel"
}
} as const;

const ToolsCompassBase = {
  id: 'compass_base',
  path: 'tools/gltf/compass_base',
  fullPath: 'pizza/models/tools/gltf/compass_base.gltf',
  format: 'gltf',
  nodes: {
  "CompassBase": "compass_base",
  "CompassLid": "compass_lid",
  "CompassNeedle": "compass_needle"
}
} as const;

const ToolsDraftingCompass = {
  id: 'drafting_compass',
  path: 'tools/gltf/drafting_compass',
  fullPath: 'pizza/models/tools/gltf/drafting_compass.gltf',
  format: 'gltf',
  nodes: {
  "DraftingCompass": "drafting_compass",
  "DraftingCompassLegLeft": "drafting_compass_legLeft",
  "DraftingCompassLegRight": "drafting_compass_legRight",
  "DraftingCompassWheel": "drafting_compass_wheel"
}
} as const;

const ToolsFile = {
  id: 'file',
  path: 'tools/gltf/file',
  fullPath: 'pizza/models/tools/gltf/file.gltf',
  format: 'gltf',
  nodes: {
  "File": "file"
}
} as const;

const ToolsGrindstone = {
  id: 'grindstone',
  path: 'tools/gltf/grindstone',
  fullPath: 'pizza/models/tools/gltf/grindstone.gltf',
  format: 'gltf',
  nodes: {
  "Grindstone": "grindstone",
  "GrindstoneWheel": "grindstone_wheel"
}
} as const;

const ToolsHammer = {
  id: 'hammer',
  path: 'tools/gltf/hammer',
  fullPath: 'pizza/models/tools/gltf/hammer.gltf',
  format: 'gltf',
  nodes: {
  "Hammer": "hammer"
}
} as const;

const ToolsHanddrill = {
  id: 'handdrill',
  path: 'tools/gltf/handdrill',
  fullPath: 'pizza/models/tools/gltf/handdrill.gltf',
  format: 'gltf',
  nodes: {
  "Handdrill": "handdrill"
}
} as const;

const ToolsHandplane = {
  id: 'handplane',
  path: 'tools/gltf/handplane',
  fullPath: 'pizza/models/tools/gltf/handplane.gltf',
  format: 'gltf',
  nodes: {
  "Handplane": "handplane"
}
} as const;

const ToolsJournalClosed = {
  id: 'journal_closed',
  path: 'tools/gltf/journal_closed',
  fullPath: 'pizza/models/tools/gltf/journal_closed.gltf',
  format: 'gltf',
  nodes: {
  "JournalClosed": "journal_closed"
}
} as const;

const ToolsJournalOpen = {
  id: 'journal_open',
  path: 'tools/gltf/journal_open',
  fullPath: 'pizza/models/tools/gltf/journal_open.gltf',
  format: 'gltf',
  nodes: {
  "JournalOpen": "journal_open"
}
} as const;

const ToolsKnife = {
  id: 'knife',
  path: 'tools/gltf/knife',
  fullPath: 'pizza/models/tools/gltf/knife.gltf',
  format: 'gltf',
  nodes: {
  "Knife": "knife"
}
} as const;

const ToolsLantern = {
  id: 'lantern',
  path: 'tools/gltf/lantern',
  fullPath: 'pizza/models/tools/gltf/lantern.gltf',
  format: 'gltf',
  nodes: {
  "Lantern": "lantern",
  "LanternHandle": "lantern_handle"
}
} as const;

const ToolsMagnifyingGlass = {
  id: 'magnifying_glass',
  path: 'tools/gltf/magnifying_glass',
  fullPath: 'pizza/models/tools/gltf/magnifying_glass.gltf',
  format: 'gltf',
  nodes: {
  "MagnifyingGlass": "magnifying_glass"
}
} as const;

const ToolsMallet = {
  id: 'mallet',
  path: 'tools/gltf/mallet',
  fullPath: 'pizza/models/tools/gltf/mallet.gltf',
  format: 'gltf',
  nodes: {
  "Mallet": "mallet"
}
} as const;

const ToolsMap = {
  id: 'map',
  path: 'tools/gltf/map',
  fullPath: 'pizza/models/tools/gltf/map.gltf',
  format: 'gltf',
  nodes: {
  "Map": "map"
}
} as const;

const ToolsMapEmpty = {
  id: 'map_empty',
  path: 'tools/gltf/map_empty',
  fullPath: 'pizza/models/tools/gltf/map_empty.gltf',
  format: 'gltf',
  nodes: {
  "MapEmpty": "map_empty"
}
} as const;

const ToolsMapRolled = {
  id: 'map_rolled',
  path: 'tools/gltf/map_rolled',
  fullPath: 'pizza/models/tools/gltf/map_rolled.gltf',
  format: 'gltf',
  nodes: {
  "MapRolled": "map_rolled"
}
} as const;

const ToolsNail = {
  id: 'nail',
  path: 'tools/gltf/nail',
  fullPath: 'pizza/models/tools/gltf/nail.gltf',
  format: 'gltf',
  nodes: {
  "Nail": "nail"
}
} as const;

const ToolsPencilALong = {
  id: 'pencil_A_long',
  path: 'tools/gltf/pencil_A_long',
  fullPath: 'pizza/models/tools/gltf/pencil_A_long.gltf',
  format: 'gltf',
  nodes: {
  "PencilALong": "pencil_A_long"
}
} as const;

const ToolsPencilAShort = {
  id: 'pencil_A_short',
  path: 'tools/gltf/pencil_A_short',
  fullPath: 'pizza/models/tools/gltf/pencil_A_short.gltf',
  format: 'gltf',
  nodes: {
  "PencilAShort": "pencil_A_short"
}
} as const;

const ToolsPencilBLong = {
  id: 'pencil_B_long',
  path: 'tools/gltf/pencil_B_long',
  fullPath: 'pizza/models/tools/gltf/pencil_B_long.gltf',
  format: 'gltf',
  nodes: {
  "PencilBLong": "pencil_B_long"
}
} as const;

const ToolsPencilBShort = {
  id: 'pencil_B_short',
  path: 'tools/gltf/pencil_B_short',
  fullPath: 'pizza/models/tools/gltf/pencil_B_short.gltf',
  format: 'gltf',
  nodes: {
  "PencilBShort": "pencil_B_short"
}
} as const;

const ToolsPickaxe = {
  id: 'pickaxe',
  path: 'tools/gltf/pickaxe',
  fullPath: 'pizza/models/tools/gltf/pickaxe.gltf',
  format: 'gltf',
  nodes: {
  "Pickaxe": "pickaxe"
}
} as const;

const ToolsRopeBundleA = {
  id: 'rope_bundle_A',
  path: 'tools/gltf/rope_bundle_A',
  fullPath: 'pizza/models/tools/gltf/rope_bundle_A.gltf',
  format: 'gltf',
  nodes: {
  "RopeBundleA": "rope_bundle_A"
}
} as const;

const ToolsRopeBundleB = {
  id: 'rope_bundle_B',
  path: 'tools/gltf/rope_bundle_B',
  fullPath: 'pizza/models/tools/gltf/rope_bundle_B.gltf',
  format: 'gltf',
  nodes: {
  "RopeBundleB": "rope_bundle_B"
}
} as const;

const ToolsSaw = {
  id: 'saw',
  path: 'tools/gltf/saw',
  fullPath: 'pizza/models/tools/gltf/saw.gltf',
  format: 'gltf',
  nodes: {
  "Saw": "saw"
}
} as const;

const ToolsScissors = {
  id: 'scissors',
  path: 'tools/gltf/scissors',
  fullPath: 'pizza/models/tools/gltf/scissors.gltf',
  format: 'gltf',
  nodes: {
  "Scissors": "scissors",
  "ScissorsPart": "scissors_part"
}
} as const;

const ToolsScrewdriverALong = {
  id: 'screwdriver_A_long',
  path: 'tools/gltf/screwdriver_A_long',
  fullPath: 'pizza/models/tools/gltf/screwdriver_A_long.gltf',
  format: 'gltf',
  nodes: {
  "ScrewdriverALong": "screwdriver_A_long"
}
} as const;

const ToolsScrewdriverALongColor = {
  id: 'screwdriver_A_long_color',
  path: 'tools/gltf/screwdriver_A_long_color',
  fullPath: 'pizza/models/tools/gltf/screwdriver_A_long_color.gltf',
  format: 'gltf',
  nodes: {
  "ScrewdriverALongColor": "screwdriver_A_long_color"
}
} as const;

const ToolsScrewdriverAShort = {
  id: 'screwdriver_A_short',
  path: 'tools/gltf/screwdriver_A_short',
  fullPath: 'pizza/models/tools/gltf/screwdriver_A_short.gltf',
  format: 'gltf',
  nodes: {
  "ScrewdriverAShort": "screwdriver_A_short"
}
} as const;

const ToolsScrewdriverAShortColor = {
  id: 'screwdriver_A_short_color',
  path: 'tools/gltf/screwdriver_A_short_color',
  fullPath: 'pizza/models/tools/gltf/screwdriver_A_short_color.gltf',
  format: 'gltf',
  nodes: {
  "ScrewdriverAShortColor": "screwdriver_A_short_color"
}
} as const;

const ToolsScrewdriverBLong = {
  id: 'screwdriver_B_long',
  path: 'tools/gltf/screwdriver_B_long',
  fullPath: 'pizza/models/tools/gltf/screwdriver_B_long.gltf',
  format: 'gltf',
  nodes: {
  "ScrewdriverBLong": "screwdriver_B_long"
}
} as const;

const ToolsScrewdriverBLongColor = {
  id: 'screwdriver_B_long_color',
  path: 'tools/gltf/screwdriver_B_long_color',
  fullPath: 'pizza/models/tools/gltf/screwdriver_B_long_color.gltf',
  format: 'gltf',
  nodes: {
  "ScrewdriverBLongColor": "screwdriver_B_long_color"
}
} as const;

const ToolsScrewdriverBShort = {
  id: 'screwdriver_B_short',
  path: 'tools/gltf/screwdriver_B_short',
  fullPath: 'pizza/models/tools/gltf/screwdriver_B_short.gltf',
  format: 'gltf',
  nodes: {
  "ScrewdriverBShort": "screwdriver_B_short"
}
} as const;

const ToolsScrewdriverBShortColor = {
  id: 'screwdriver_B_short_color',
  path: 'tools/gltf/screwdriver_B_short_color',
  fullPath: 'pizza/models/tools/gltf/screwdriver_B_short_color.gltf',
  format: 'gltf',
  nodes: {
  "ScrewdriverBShortColor": "screwdriver_B_short_color"
}
} as const;

const ToolsScrewA = {
  id: 'screw_A',
  path: 'tools/gltf/screw_A',
  fullPath: 'pizza/models/tools/gltf/screw_A.gltf',
  format: 'gltf',
  nodes: {
  "ScrewA": "screw_A"
}
} as const;

const ToolsScrewB = {
  id: 'screw_B',
  path: 'tools/gltf/screw_B',
  fullPath: 'pizza/models/tools/gltf/screw_B.gltf',
  format: 'gltf',
  nodes: {
  "ScrewB": "screw_B"
}
} as const;

const ToolsShovel = {
  id: 'shovel',
  path: 'tools/gltf/shovel',
  fullPath: 'pizza/models/tools/gltf/shovel.gltf',
  format: 'gltf',
  nodes: {
  "Shovel": "shovel"
}
} as const;

const ToolsTongs = {
  id: 'tongs',
  path: 'tools/gltf/tongs',
  fullPath: 'pizza/models/tools/gltf/tongs.gltf',
  format: 'gltf',
  nodes: {
  "Tongs": "tongs",
  "TongsPart": "tongs_part"
}
} as const;

const ToolsTorch = {
  id: 'torch',
  path: 'tools/gltf/torch',
  fullPath: 'pizza/models/tools/gltf/torch.gltf',
  format: 'gltf',
  nodes: {
  "Torch": "torch"
}
} as const;

const ToolsTorchBurnt = {
  id: 'torch_burnt',
  path: 'tools/gltf/torch_burnt',
  fullPath: 'pizza/models/tools/gltf/torch_burnt.gltf',
  format: 'gltf',
  nodes: {
  "TorchBurnt": "torch_burnt"
}
} as const;

const ToolsTrowel = {
  id: 'trowel',
  path: 'tools/gltf/trowel',
  fullPath: 'pizza/models/tools/gltf/trowel.gltf',
  format: 'gltf',
  nodes: {
  "Trowel": "trowel"
}
} as const;

const ToolsWrenchA = {
  id: 'wrench_A',
  path: 'tools/gltf/wrench_A',
  fullPath: 'pizza/models/tools/gltf/wrench_A.gltf',
  format: 'gltf',
  nodes: {
  "WrenchA": "wrench_A"
}
} as const;

const ToolsWrenchB = {
  id: 'wrench_B',
  path: 'tools/gltf/wrench_B',
  fullPath: 'pizza/models/tools/gltf/wrench_B.gltf',
  format: 'gltf',
  nodes: {
  "WrenchB": "wrench_B"
}
} as const;

// Grouped by top-level raw-assets/models folder (the '{...}' tag stripped) — e.g.
// raw-assets/models/characters{m}/... becomes MODELS.Characters.<name>. Files with no
// containing folder land in MODELS.Root.
export const MODELS = {
  Characters: {
    CharacterMedium: CharactersCharacterMedium,
    Digging: CharactersDigging,
    FallingIdle: CharactersFallingIdle,
    Idle: CharactersIdle,
    Idle2: CharactersIdle2,
    Jump: CharactersJump,
    JumpingUp: CharactersJumpingUp,
    Landing: CharactersLanding,
    PickFruit: CharactersPickFruit,
    PlantTree: CharactersPlantTree,
    Roll: CharactersRoll,
    Run: CharactersRun,
    Running: CharactersRunning,
    StandToRoll: CharactersStandToRoll,
    StandingMeleeAttackDownwardCHOP: CharactersStandingMeleeAttackDownwardCHOP,
    StandingPICKAXE: CharactersStandingPICKAXE,
    TestIdle: CharactersTestIdle,
    Watering: CharactersWatering
  },
  Pets: {
    AnimalBeaver: PetsAnimalBeaver,
    AnimalBee: PetsAnimalBee,
    AnimalBunny: PetsAnimalBunny,
    AnimalCat: PetsAnimalCat,
    AnimalCaterpillar: PetsAnimalCaterpillar,
    AnimalChick: PetsAnimalChick,
    AnimalCow: PetsAnimalCow,
    AnimalCrab: PetsAnimalCrab,
    AnimalDeer: PetsAnimalDeer,
    AnimalDog: PetsAnimalDog,
    AnimalElephant: PetsAnimalElephant,
    AnimalFish: PetsAnimalFish,
    AnimalFox: PetsAnimalFox,
    AnimalGiraffe: PetsAnimalGiraffe,
    AnimalHog: PetsAnimalHog,
    AnimalKoala: PetsAnimalKoala,
    AnimalLion: PetsAnimalLion,
    AnimalMonkey: PetsAnimalMonkey,
    AnimalPanda: PetsAnimalPanda,
    AnimalParrot: PetsAnimalParrot,
    AnimalPenguin: PetsAnimalPenguin,
    AnimalPig: PetsAnimalPig,
    AnimalPolar: PetsAnimalPolar,
    AnimalTiger: PetsAnimalTiger
  },
  Pirate: {
    Barrel: PirateBarrel,
    BoatRowLarge: PirateBoatRowLarge,
    BoatRowSmall: PirateBoatRowSmall,
    BottleLarge: PirateBottleLarge,
    Bottle: PirateBottle,
    CannonBall: PirateCannonBall,
    CannonMobile: PirateCannonMobile,
    Cannon: PirateCannon,
    CastleDoor: PirateCastleDoor,
    CastleGate: PirateCastleGate,
    CastleWall: PirateCastleWall,
    CastleWindow: PirateCastleWindow,
    Chest: PirateChest,
    CrateBottles: PirateCrateBottles,
    Crate: PirateCrate,
    FlagHighPennant: PirateFlagHighPennant,
    FlagHigh: PirateFlagHigh,
    FlagPennant: PirateFlagPennant,
    FlagPirateHighPennant: PirateFlagPirateHighPennant,
    FlagPirateHigh: PirateFlagPirateHigh,
    FlagPiratePennant: PirateFlagPiratePennant,
    FlagPirate: PirateFlagPirate,
    Flag: PirateFlag,
    GrassPatch: PirateGrassPatch,
    GrassPlant: PirateGrassPlant,
    Grass: PirateGrass,
    Hole: PirateHole,
    MastRopes: PirateMastRopes,
    Mast: PirateMast,
    PalmBend: PiratePalmBend,
    PalmDetailedBend: PiratePalmDetailedBend,
    PalmDetailedStraight: PiratePalmDetailedStraight,
    PalmStraight: PiratePalmStraight,
    PatchGrassFoliage: PiratePatchGrassFoliage,
    PatchGrass: PiratePatchGrass,
    PatchSandFoliage: PiratePatchSandFoliage,
    PatchSand: PiratePatchSand,
    PlatformPlanks: PiratePlatformPlanks,
    Platform: PiratePlatform,
    RocksA: PirateRocksA,
    RocksB: PirateRocksB,
    RocksC: PirateRocksC,
    RocksSandA: PirateRocksSandA,
    RocksSandB: PirateRocksSandB,
    RocksSandC: PirateRocksSandC,
    ShipGhost: PirateShipGhost,
    ShipLarge: PirateShipLarge,
    ShipMedium: PirateShipMedium,
    ShipPirateLarge: PirateShipPirateLarge,
    ShipPirateMedium: PirateShipPirateMedium,
    ShipPirateSmall: PirateShipPirateSmall,
    ShipSmall: PirateShipSmall,
    ShipWreck: PirateShipWreck,
    StructureFenceSides: PirateStructureFenceSides,
    StructureFence: PirateStructureFence,
    StructurePlatformDockSmall: PirateStructurePlatformDockSmall,
    StructurePlatformDock: PirateStructurePlatformDock,
    StructurePlatformSmall: PirateStructurePlatformSmall,
    StructurePlatform: PirateStructurePlatform,
    StructureRoof: PirateStructureRoof,
    Structure: PirateStructure,
    ToolPaddle: PirateToolPaddle,
    ToolShovel: PirateToolShovel,
    TowerBaseDoor: PirateTowerBaseDoor,
    TowerBase: PirateTowerBase,
    TowerCompleteLarge: PirateTowerCompleteLarge,
    TowerCompleteSmall: PirateTowerCompleteSmall,
    TowerMiddleWindows: PirateTowerMiddleWindows,
    TowerMiddle: PirateTowerMiddle,
    TowerRoof: PirateTowerRoof,
    TowerTop: PirateTowerTop,
    TowerWatch: PirateTowerWatch
  },
  Props: {
    Bridge: PropsBridge,
    BuildingPlatform: PropsBuildingPlatform,
    BuildingRoof: PropsBuildingRoof,
    BuildingStructure: PropsBuildingStructure,
    CharacterArcher: PropsCharacterArcher,
    Fence: PropsFence,
    Flag: PropsFlag,
    Ladder: PropsLadder,
    PatchDirt: PropsPatchDirt,
    PatchGrass: PropsPatchGrass,
    Plant: PropsPlant,
    Platform: PropsPlatform,
    RocksHigh: PropsRocksHigh,
    RocksLow: PropsRocksLow,
    RocksRamp: PropsRocksRamp,
    Stones: PropsStones,
    Target: PropsTarget,
    Tent: PropsTent,
    TreeHigh: PropsTreeHigh,
    Tree: PropsTree,
    WeaponArrow: PropsWeaponArrow,
    WeaponBow: PropsWeaponBow
  },
  Tools: {
    Anvil: ToolsAnvil,
    Axe: ToolsAxe,
    Blueprint: ToolsBlueprint,
    BlueprintStacked: ToolsBlueprintStacked,
    BucketMetal: ToolsBucketMetal,
    Chisel: ToolsChisel,
    CompassBase: ToolsCompassBase,
    DraftingCompass: ToolsDraftingCompass,
    File: ToolsFile,
    Grindstone: ToolsGrindstone,
    Hammer: ToolsHammer,
    Handdrill: ToolsHanddrill,
    Handplane: ToolsHandplane,
    JournalClosed: ToolsJournalClosed,
    JournalOpen: ToolsJournalOpen,
    Knife: ToolsKnife,
    Lantern: ToolsLantern,
    MagnifyingGlass: ToolsMagnifyingGlass,
    Mallet: ToolsMallet,
    Map: ToolsMap,
    MapEmpty: ToolsMapEmpty,
    MapRolled: ToolsMapRolled,
    Nail: ToolsNail,
    PencilALong: ToolsPencilALong,
    PencilAShort: ToolsPencilAShort,
    PencilBLong: ToolsPencilBLong,
    PencilBShort: ToolsPencilBShort,
    Pickaxe: ToolsPickaxe,
    RopeBundleA: ToolsRopeBundleA,
    RopeBundleB: ToolsRopeBundleB,
    Saw: ToolsSaw,
    Scissors: ToolsScissors,
    ScrewdriverALong: ToolsScrewdriverALong,
    ScrewdriverALongColor: ToolsScrewdriverALongColor,
    ScrewdriverAShort: ToolsScrewdriverAShort,
    ScrewdriverAShortColor: ToolsScrewdriverAShortColor,
    ScrewdriverBLong: ToolsScrewdriverBLong,
    ScrewdriverBLongColor: ToolsScrewdriverBLongColor,
    ScrewdriverBShort: ToolsScrewdriverBShort,
    ScrewdriverBShortColor: ToolsScrewdriverBShortColor,
    ScrewA: ToolsScrewA,
    ScrewB: ToolsScrewB,
    Shovel: ToolsShovel,
    Tongs: ToolsTongs,
    Torch: ToolsTorch,
    TorchBurnt: ToolsTorchBurnt,
    Trowel: ToolsTrowel,
    WrenchA: ToolsWrenchA,
    WrenchB: ToolsWrenchB
  }
} as const;

export type ModelGroup = keyof typeof MODELS;
export default MODELS;