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

const FoodAdvocadoHalf = {
  id: 'advocado-half',
  path: 'food/advocado-half',
  fullPath: 'pizza/models/food/advocado-half.glb',
  format: 'glb',
  nodes: {
  "AdvocadoHalf": "advocado-half",
  "Pit": "pit"
}
} as const;

const FoodAppleHalf = {
  id: 'apple-half',
  path: 'food/apple-half',
  fullPath: 'pizza/models/food/apple-half.glb',
  format: 'glb',
  nodes: {
  "AppleHalf": "apple-half"
}
} as const;

const FoodApple = {
  id: 'apple',
  path: 'food/apple',
  fullPath: 'pizza/models/food/apple.glb',
  format: 'glb',
  nodes: {
  "Apple": "apple"
}
} as const;

const FoodAvocado = {
  id: 'avocado',
  path: 'food/avocado',
  fullPath: 'pizza/models/food/avocado.glb',
  format: 'glb',
  nodes: {
  "Avocado": "avocado"
}
} as const;

const FoodBaconRaw = {
  id: 'bacon-raw',
  path: 'food/bacon-raw',
  fullPath: 'pizza/models/food/bacon-raw.glb',
  format: 'glb',
  nodes: {
  "BaconRaw": "bacon-raw"
}
} as const;

const FoodBacon = {
  id: 'bacon',
  path: 'food/bacon',
  fullPath: 'pizza/models/food/bacon.glb',
  format: 'glb',
  nodes: {
  "Bacon": "bacon"
}
} as const;

const FoodBagFlat = {
  id: 'bag-flat',
  path: 'food/bag-flat',
  fullPath: 'pizza/models/food/bag-flat.glb',
  format: 'glb',
  nodes: {
  "BagFlat": "bag-flat"
}
} as const;

const FoodBag = {
  id: 'bag',
  path: 'food/bag',
  fullPath: 'pizza/models/food/bag.glb',
  format: 'glb',
  nodes: {
  "Bag": "bag"
}
} as const;

const FoodBanana = {
  id: 'banana',
  path: 'food/banana',
  fullPath: 'pizza/models/food/banana.glb',
  format: 'glb',
  nodes: {
  "Banana": "banana"
}
} as const;

const FoodBarrel = {
  id: 'barrel',
  path: 'food/barrel',
  fullPath: 'pizza/models/food/barrel.glb',
  format: 'glb',
  nodes: {
  "Barrel": "barrel"
}
} as const;

const FoodBeet = {
  id: 'beet',
  path: 'food/beet',
  fullPath: 'pizza/models/food/beet.glb',
  format: 'glb',
  nodes: {
  "Beet": "beet"
}
} as const;

const FoodBottleKetchup = {
  id: 'bottle-ketchup',
  path: 'food/bottle-ketchup',
  fullPath: 'pizza/models/food/bottle-ketchup.glb',
  format: 'glb',
  nodes: {
  "BottleKetchup": "bottle-ketchup"
}
} as const;

const FoodBottleMusterd = {
  id: 'bottle-musterd',
  path: 'food/bottle-musterd',
  fullPath: 'pizza/models/food/bottle-musterd.glb',
  format: 'glb',
  nodes: {
  "BottleMusterd": "bottle-musterd"
}
} as const;

const FoodBottleOil = {
  id: 'bottle-oil',
  path: 'food/bottle-oil',
  fullPath: 'pizza/models/food/bottle-oil.glb',
  format: 'glb',
  nodes: {
  "BottleOil": "bottle-oil"
}
} as const;

const FoodBowlBroth = {
  id: 'bowl-broth',
  path: 'food/bowl-broth',
  fullPath: 'pizza/models/food/bowl-broth.glb',
  format: 'glb',
  nodes: {
  "BowlBroth": "bowl-broth",
  "Group": "Group"
}
} as const;

const FoodBowlCereal = {
  id: 'bowl-cereal',
  path: 'food/bowl-cereal',
  fullPath: 'pizza/models/food/bowl-cereal.glb',
  format: 'glb',
  nodes: {
  "BowlCereal": "bowl-cereal"
}
} as const;

const FoodBowlSoup = {
  id: 'bowl-soup',
  path: 'food/bowl-soup',
  fullPath: 'pizza/models/food/bowl-soup.glb',
  format: 'glb',
  nodes: {
  "BowlSoup": "bowl-soup"
}
} as const;

const FoodBowl = {
  id: 'bowl',
  path: 'food/bowl',
  fullPath: 'pizza/models/food/bowl.glb',
  format: 'glb',
  nodes: {
  "Bowl": "bowl"
}
} as const;

const FoodBread = {
  id: 'bread',
  path: 'food/bread',
  fullPath: 'pizza/models/food/bread.glb',
  format: 'glb',
  nodes: {
  "Bread": "bread"
}
} as const;

const FoodBroccoli = {
  id: 'broccoli',
  path: 'food/broccoli',
  fullPath: 'pizza/models/food/broccoli.glb',
  format: 'glb',
  nodes: {
  "Broccoli": "broccoli"
}
} as const;

const FoodBurgerCheeseDouble = {
  id: 'burger-cheese-double',
  path: 'food/burger-cheese-double',
  fullPath: 'pizza/models/food/burger-cheese-double.glb',
  format: 'glb',
  nodes: {
  "BurgerCheeseDouble": "burger-cheese-double",
  "BunBottom": "bun-bottom",
  "BunMiddle": "bun-middle",
  "BunTop": "bun-top",
  "Cheese": "cheese",
  "Patty": "patty"
}
} as const;

const FoodBurgerCheese = {
  id: 'burger-cheese',
  path: 'food/burger-cheese',
  fullPath: 'pizza/models/food/burger-cheese.glb',
  format: 'glb',
  nodes: {
  "BurgerCheese": "burger-cheese",
  "BunBottom": "bun-bottom",
  "BunTop": "bun-top",
  "Cheese": "cheese",
  "Patty": "patty"
}
} as const;

const FoodBurgerDouble = {
  id: 'burger-double',
  path: 'food/burger-double',
  fullPath: 'pizza/models/food/burger-double.glb',
  format: 'glb',
  nodes: {
  "BurgerDouble": "burger-double",
  "BunBottom": "bun-bottom",
  "BunMiddle": "bun-middle",
  "BunTop": "bun-top",
  "Cheese": "cheese",
  "Patty": "patty",
  "Salad": "salad",
  "Tomato": "tomato"
}
} as const;

const FoodBurger = {
  id: 'burger',
  path: 'food/burger',
  fullPath: 'pizza/models/food/burger.glb',
  format: 'glb',
  nodes: {
  "Burger": "burger",
  "BunBottom": "bun-bottom",
  "BunTop": "bun-top",
  "Cheese": "cheese",
  "Patty": "patty",
  "Salad": "salad",
  "Tomato": "tomato"
}
} as const;

const FoodCabbage = {
  id: 'cabbage',
  path: 'food/cabbage',
  fullPath: 'pizza/models/food/cabbage.glb',
  format: 'glb',
  nodes: {
  "Cabbage": "cabbage"
}
} as const;

const FoodCakeBirthday = {
  id: 'cake-birthday',
  path: 'food/cake-birthday',
  fullPath: 'pizza/models/food/cake-birthday.glb',
  format: 'glb',
  nodes: {
  "Slice": "slice"
}
} as const;

const FoodCakeSlicer = {
  id: 'cake-slicer',
  path: 'food/cake-slicer',
  fullPath: 'pizza/models/food/cake-slicer.glb',
  format: 'glb',
  nodes: {
  "CakeSlicer": "cake-slicer"
}
} as const;

const FoodCake = {
  id: 'cake',
  path: 'food/cake',
  fullPath: 'pizza/models/food/cake.glb',
  format: 'glb',
  nodes: {
  "Slice": "slice"
}
} as const;

const FoodCanOpen = {
  id: 'can-open',
  path: 'food/can-open',
  fullPath: 'pizza/models/food/can-open.glb',
  format: 'glb',
  nodes: {
  "CanOpen": "can-open"
}
} as const;

const FoodCanSmall = {
  id: 'can-small',
  path: 'food/can-small',
  fullPath: 'pizza/models/food/can-small.glb',
  format: 'glb',
  nodes: {
  "CanSmall": "can-small",
  "Group": "Group"
}
} as const;

const FoodCan = {
  id: 'can',
  path: 'food/can',
  fullPath: 'pizza/models/food/can.glb',
  format: 'glb',
  nodes: {
  "Can": "can"
}
} as const;

const FoodCandyBarWrapper = {
  id: 'candy-bar-wrapper',
  path: 'food/candy-bar-wrapper',
  fullPath: 'pizza/models/food/candy-bar-wrapper.glb',
  format: 'glb',
  nodes: {
  "CandyBarWrapper": "candy-bar-wrapper"
}
} as const;

const FoodCandyBar = {
  id: 'candy-bar',
  path: 'food/candy-bar',
  fullPath: 'pizza/models/food/candy-bar.glb',
  format: 'glb',
  nodes: {
  "CandyBar": "candy-bar"
}
} as const;

const FoodCarrot = {
  id: 'carrot',
  path: 'food/carrot',
  fullPath: 'pizza/models/food/carrot.glb',
  format: 'glb',
  nodes: {
  "Carrot": "carrot"
}
} as const;

const FoodCartonSmall = {
  id: 'carton-small',
  path: 'food/carton-small',
  fullPath: 'pizza/models/food/carton-small.glb',
  format: 'glb',
  nodes: {
  "CartonSmall": "carton-small"
}
} as const;

const FoodCarton = {
  id: 'carton',
  path: 'food/carton',
  fullPath: 'pizza/models/food/carton.glb',
  format: 'glb',
  nodes: {
  "Carton": "carton"
}
} as const;

const FoodCauliflower = {
  id: 'cauliflower',
  path: 'food/cauliflower',
  fullPath: 'pizza/models/food/cauliflower.glb',
  format: 'glb',
  nodes: {
  "Cauliflower": "cauliflower"
}
} as const;

const FoodCeleryStick = {
  id: 'celery-stick',
  path: 'food/celery-stick',
  fullPath: 'pizza/models/food/celery-stick.glb',
  format: 'glb',
  nodes: {
  "CeleryStick": "celery-stick"
}
} as const;

const FoodCheeseCut = {
  id: 'cheese-cut',
  path: 'food/cheese-cut',
  fullPath: 'pizza/models/food/cheese-cut.glb',
  format: 'glb',
  nodes: {
  "CheeseCut": "cheese-cut"
}
} as const;

const FoodCheeseSlicer = {
  id: 'cheese-slicer',
  path: 'food/cheese-slicer',
  fullPath: 'pizza/models/food/cheese-slicer.glb',
  format: 'glb',
  nodes: {
  "CheeseSlicer": "cheese-slicer"
}
} as const;

const FoodCheese = {
  id: 'cheese',
  path: 'food/cheese',
  fullPath: 'pizza/models/food/cheese.glb',
  format: 'glb',
  nodes: {
  "Wedge": "wedge"
}
} as const;

const FoodCherries = {
  id: 'cherries',
  path: 'food/cherries',
  fullPath: 'pizza/models/food/cherries.glb',
  format: 'glb',
  nodes: {
  "Cherries": "cherries"
}
} as const;

const FoodChinese = {
  id: 'chinese',
  path: 'food/chinese',
  fullPath: 'pizza/models/food/chinese.glb',
  format: 'glb',
  nodes: {
  "Chinese": "chinese",
  "Chopstick": "chopstick"
}
} as const;

const FoodChocolateWrapper = {
  id: 'chocolate-wrapper',
  path: 'food/chocolate-wrapper',
  fullPath: 'pizza/models/food/chocolate-wrapper.glb',
  format: 'glb',
  nodes: {
  "ChocolateWrapper": "chocolate-wrapper"
}
} as const;

const FoodChocolate = {
  id: 'chocolate',
  path: 'food/chocolate',
  fullPath: 'pizza/models/food/chocolate.glb',
  format: 'glb',
  nodes: {
  "Chocolate": "chocolate"
}
} as const;

const FoodChopsticDecorative = {
  id: 'chopstic-decorative',
  path: 'food/chopstic-decorative',
  fullPath: 'pizza/models/food/chopstic-decorative.glb',
  format: 'glb',
  nodes: {
  "ChopsticDecorative": "chopstic-decorative"
}
} as const;

const FoodChopstick = {
  id: 'chopstick',
  path: 'food/chopstick',
  fullPath: 'pizza/models/food/chopstick.glb',
  format: 'glb',
  nodes: {
  "Chopstick": "chopstick"
}
} as const;

const FoodCocktail = {
  id: 'cocktail',
  path: 'food/cocktail',
  fullPath: 'pizza/models/food/cocktail.glb',
  format: 'glb',
  nodes: {
  "Cocktail": "cocktail",
  "Straw": "straw",
  "Lemon": "lemon"
}
} as const;

const FoodCoconutHalf = {
  id: 'coconut-half',
  path: 'food/coconut-half',
  fullPath: 'pizza/models/food/coconut-half.glb',
  format: 'glb',
  nodes: {
  "CoconutHalf": "coconut-half"
}
} as const;

const FoodCoconut = {
  id: 'coconut',
  path: 'food/coconut',
  fullPath: 'pizza/models/food/coconut.glb',
  format: 'glb',
  nodes: {
  "Coconut": "coconut"
}
} as const;

const FoodCookieChocolate = {
  id: 'cookie-chocolate',
  path: 'food/cookie-chocolate',
  fullPath: 'pizza/models/food/cookie-chocolate.glb',
  format: 'glb',
  nodes: {
  "CookieChocolate": "cookie-chocolate"
}
} as const;

const FoodCookie = {
  id: 'cookie',
  path: 'food/cookie',
  fullPath: 'pizza/models/food/cookie.glb',
  format: 'glb',
  nodes: {
  "Cookie": "cookie"
}
} as const;

const FoodCookingFork = {
  id: 'cooking-fork',
  path: 'food/cooking-fork',
  fullPath: 'pizza/models/food/cooking-fork.glb',
  format: 'glb',
  nodes: {
  "CookingFork": "cooking-fork"
}
} as const;

const FoodCookingKnifeChopping = {
  id: 'cooking-knife-chopping',
  path: 'food/cooking-knife-chopping',
  fullPath: 'pizza/models/food/cooking-knife-chopping.glb',
  format: 'glb',
  nodes: {
  "CookingKnifeChopping": "cooking-knife-chopping"
}
} as const;

const FoodCookingKnife = {
  id: 'cooking-knife',
  path: 'food/cooking-knife',
  fullPath: 'pizza/models/food/cooking-knife.glb',
  format: 'glb',
  nodes: {
  "CookingKnife": "cooking-knife"
}
} as const;

const FoodCookingSpatula = {
  id: 'cooking-spatula',
  path: 'food/cooking-spatula',
  fullPath: 'pizza/models/food/cooking-spatula.glb',
  format: 'glb',
  nodes: {
  "CookingSpatula": "cooking-spatula"
}
} as const;

const FoodCookingSpoon = {
  id: 'cooking-spoon',
  path: 'food/cooking-spoon',
  fullPath: 'pizza/models/food/cooking-spoon.glb',
  format: 'glb',
  nodes: {
  "CookingSpoon": "cooking-spoon"
}
} as const;

const FoodCornDog = {
  id: 'corn-dog',
  path: 'food/corn-dog',
  fullPath: 'pizza/models/food/corn-dog.glb',
  format: 'glb',
  nodes: {
  "CornDog": "corn-dog",
  "Dog": "dog"
}
} as const;

const FoodCorn = {
  id: 'corn',
  path: 'food/corn',
  fullPath: 'pizza/models/food/corn.glb',
  format: 'glb',
  nodes: {
  "Corn": "corn"
}
} as const;

const FoodCroissant = {
  id: 'croissant',
  path: 'food/croissant',
  fullPath: 'pizza/models/food/croissant.glb',
  format: 'glb',
  nodes: {
  "Croissant": "croissant"
}
} as const;

const FoodCupCoffee = {
  id: 'cup-coffee',
  path: 'food/cup-coffee',
  fullPath: 'pizza/models/food/cup-coffee.glb',
  format: 'glb',
  nodes: {
  "CupCoffee": "cup-coffee"
}
} as const;

const FoodCupSaucer = {
  id: 'cup-saucer',
  path: 'food/cup-saucer',
  fullPath: 'pizza/models/food/cup-saucer.glb',
  format: 'glb',
  nodes: {
  "CupSaucer": "cup-saucer"
}
} as const;

const FoodCupTea = {
  id: 'cup-tea',
  path: 'food/cup-tea',
  fullPath: 'pizza/models/food/cup-tea.glb',
  format: 'glb',
  nodes: {
  "CupTea": "cup-tea"
}
} as const;

const FoodCup = {
  id: 'cup',
  path: 'food/cup',
  fullPath: 'pizza/models/food/cup.glb',
  format: 'glb',
  nodes: {
  "Cup": "cup"
}
} as const;

const FoodCupcake = {
  id: 'cupcake',
  path: 'food/cupcake',
  fullPath: 'pizza/models/food/cupcake.glb',
  format: 'glb',
  nodes: {
  "Cupcake": "cupcake",
  "Cherry": "cherry",
  "Cake": "cake"
}
} as const;

const FoodCuttingBoardJapanese = {
  id: 'cutting-board-japanese',
  path: 'food/cutting-board-japanese',
  fullPath: 'pizza/models/food/cutting-board-japanese.glb',
  format: 'glb',
  nodes: {
  "CuttingBoardJapanese": "cutting-board-japanese"
}
} as const;

const FoodCuttingBoardRound = {
  id: 'cutting-board-round',
  path: 'food/cutting-board-round',
  fullPath: 'pizza/models/food/cutting-board-round.glb',
  format: 'glb',
  nodes: {
  "CuttingBoardRound": "cutting-board-round"
}
} as const;

const FoodCuttingBoard = {
  id: 'cutting-board',
  path: 'food/cutting-board',
  fullPath: 'pizza/models/food/cutting-board.glb',
  format: 'glb',
  nodes: {
  "CuttingBoard": "cutting-board"
}
} as const;

const FoodDimSum = {
  id: 'dim-sum',
  path: 'food/dim-sum',
  fullPath: 'pizza/models/food/dim-sum.glb',
  format: 'glb',
  nodes: {
  "DimSum": "dim-sum"
}
} as const;

const FoodDonutChocolate = {
  id: 'donut-chocolate',
  path: 'food/donut-chocolate',
  fullPath: 'pizza/models/food/donut-chocolate.glb',
  format: 'glb',
  nodes: {
  "DonutChocolate": "donut-chocolate"
}
} as const;

const FoodDonutSprinkles = {
  id: 'donut-sprinkles',
  path: 'food/donut-sprinkles',
  fullPath: 'pizza/models/food/donut-sprinkles.glb',
  format: 'glb',
  nodes: {
  "DonutSprinkles": "donut-sprinkles"
}
} as const;

const FoodDonut = {
  id: 'donut',
  path: 'food/donut',
  fullPath: 'pizza/models/food/donut.glb',
  format: 'glb',
  nodes: {
  "Donut": "donut"
}
} as const;

const FoodEggCooked = {
  id: 'egg-cooked',
  path: 'food/egg-cooked',
  fullPath: 'pizza/models/food/egg-cooked.glb',
  format: 'glb',
  nodes: {
  "EggCooked": "egg-cooked"
}
} as const;

const FoodEggCup = {
  id: 'egg-cup',
  path: 'food/egg-cup',
  fullPath: 'pizza/models/food/egg-cup.glb',
  format: 'glb',
  nodes: {
  "EggCup": "egg-cup"
}
} as const;

const FoodEggHalf = {
  id: 'egg-half',
  path: 'food/egg-half',
  fullPath: 'pizza/models/food/egg-half.glb',
  format: 'glb',
  nodes: {
  "EggHalf": "egg-half"
}
} as const;

const FoodEgg = {
  id: 'egg',
  path: 'food/egg',
  fullPath: 'pizza/models/food/egg.glb',
  format: 'glb',
  nodes: {
  "Egg": "egg"
}
} as const;

const FoodEggplant = {
  id: 'eggplant',
  path: 'food/eggplant',
  fullPath: 'pizza/models/food/eggplant.glb',
  format: 'glb',
  nodes: {
  "Eggplant": "eggplant"
}
} as const;

const FoodFishBones = {
  id: 'fish-bones',
  path: 'food/fish-bones',
  fullPath: 'pizza/models/food/fish-bones.glb',
  format: 'glb',
  nodes: {
  "FishBones": "fish-bones"
}
} as const;

const FoodFish = {
  id: 'fish',
  path: 'food/fish',
  fullPath: 'pizza/models/food/fish.glb',
  format: 'glb',
  nodes: {
  "Fish": "fish"
}
} as const;

const FoodFrappe = {
  id: 'frappe',
  path: 'food/frappe',
  fullPath: 'pizza/models/food/frappe.glb',
  format: 'glb',
  nodes: {
  "Frappe": "frappe"
}
} as const;

const FoodFriesEmpty = {
  id: 'fries-empty',
  path: 'food/fries-empty',
  fullPath: 'pizza/models/food/fries-empty.glb',
  format: 'glb',
  nodes: {
  "FriesEmpty": "fries-empty"
}
} as const;

const FoodFries = {
  id: 'fries',
  path: 'food/fries',
  fullPath: 'pizza/models/food/fries.glb',
  format: 'glb',
  nodes: {
  "Fries": "fries"
}
} as const;

const FoodFrikandelSpeciaal = {
  id: 'frikandel-speciaal',
  path: 'food/frikandel-speciaal',
  fullPath: 'pizza/models/food/frikandel-speciaal.glb',
  format: 'glb',
  nodes: {
  "FrikandelSpeciaal": "frikandel-speciaal",
  "Frikandel": "frikandel",
  "SauceOnions": "sauce-onions"
}
} as const;

const FoodFryingPanLid = {
  id: 'frying-pan-lid',
  path: 'food/frying-pan-lid',
  fullPath: 'pizza/models/food/frying-pan-lid.glb',
  format: 'glb',
  nodes: {
  "FryingPanLid": "frying-pan-lid",
  "Ignore": "(%ignore)"
}
} as const;

const FoodFryingPan = {
  id: 'frying-pan',
  path: 'food/frying-pan',
  fullPath: 'pizza/models/food/frying-pan.glb',
  format: 'glb',
  nodes: {
  "FryingPan": "frying-pan"
}
} as const;

const FoodGingerBreadCutter = {
  id: 'ginger-bread-cutter',
  path: 'food/ginger-bread-cutter',
  fullPath: 'pizza/models/food/ginger-bread-cutter.glb',
  format: 'glb',
  nodes: {
  "GingerBreadCutter": "ginger-bread-cutter"
}
} as const;

const FoodGingerBread = {
  id: 'ginger-bread',
  path: 'food/ginger-bread',
  fullPath: 'pizza/models/food/ginger-bread.glb',
  format: 'glb',
  nodes: {
  "GingerBread": "ginger-bread"
}
} as const;

const FoodGlassWine = {
  id: 'glass-wine',
  path: 'food/glass-wine',
  fullPath: 'pizza/models/food/glass-wine.glb',
  format: 'glb',
  nodes: {
  "GlassWine": "glass-wine"
}
} as const;

const FoodGlass = {
  id: 'glass',
  path: 'food/glass',
  fullPath: 'pizza/models/food/glass.glb',
  format: 'glb',
  nodes: {
  "Glass": "glass"
}
} as const;

const FoodGrapes = {
  id: 'grapes',
  path: 'food/grapes',
  fullPath: 'pizza/models/food/grapes.glb',
  format: 'glb',
  nodes: {
  "Grapes": "grapes"
}
} as const;

const FoodHoney = {
  id: 'honey',
  path: 'food/honey',
  fullPath: 'pizza/models/food/honey.glb',
  format: 'glb',
  nodes: {
  "Honey": "honey"
}
} as const;

const FoodHotDogRaw = {
  id: 'hot-dog-raw',
  path: 'food/hot-dog-raw',
  fullPath: 'pizza/models/food/hot-dog-raw.glb',
  format: 'glb',
  nodes: {
  "HotDogRaw": "hot-dog-raw"
}
} as const;

const FoodHotDog = {
  id: 'hot-dog',
  path: 'food/hot-dog',
  fullPath: 'pizza/models/food/hot-dog.glb',
  format: 'glb',
  nodes: {
  "HotDog": "hot-dog",
  "Sauce": "sauce",
  "Sausage": "sausage"
}
} as const;

const FoodIceCreamCne = {
  id: 'ice-cream-cne',
  path: 'food/ice-cream-cne',
  fullPath: 'pizza/models/food/ice-cream-cne.glb',
  format: 'glb',
  nodes: {
  "IceCreamCne": "ice-cream-cne"
}
} as const;

const FoodIceCreamCup = {
  id: 'ice-cream-cup',
  path: 'food/ice-cream-cup',
  fullPath: 'pizza/models/food/ice-cream-cup.glb',
  format: 'glb',
  nodes: {
  "IceCreamCup": "ice-cream-cup"
}
} as const;

const FoodIceCreamScoopChocolate = {
  id: 'ice-cream-scoop-chocolate',
  path: 'food/ice-cream-scoop-chocolate',
  fullPath: 'pizza/models/food/ice-cream-scoop-chocolate.glb',
  format: 'glb',
  nodes: {
  "IceCreamScoopChocolate": "ice-cream-scoop-chocolate"
}
} as const;

const FoodIceCreamScoopMint = {
  id: 'ice-cream-scoop-mint',
  path: 'food/ice-cream-scoop-mint',
  fullPath: 'pizza/models/food/ice-cream-scoop-mint.glb',
  format: 'glb',
  nodes: {
  "IceCreamScoopMint": "ice-cream-scoop-mint"
}
} as const;

const FoodIceCream = {
  id: 'ice-cream',
  path: 'food/ice-cream',
  fullPath: 'pizza/models/food/ice-cream.glb',
  format: 'glb',
  nodes: {
  "IceCream": "ice-cream",
  "Group": "Group"
}
} as const;

const FoodKnifeBlock = {
  id: 'knife-block',
  path: 'food/knife-block',
  fullPath: 'pizza/models/food/knife-block.glb',
  format: 'glb',
  nodes: {
  "KnifeBlock": "knife-block",
  "CookingKnife": "cooking-knife"
}
} as const;

const FoodLeek = {
  id: 'leek',
  path: 'food/leek',
  fullPath: 'pizza/models/food/leek.glb',
  format: 'glb',
  nodes: {
  "Leek": "leek"
}
} as const;

const FoodLemonHalf = {
  id: 'lemon-half',
  path: 'food/lemon-half',
  fullPath: 'pizza/models/food/lemon-half.glb',
  format: 'glb',
  nodes: {
  "LemonHalf": "lemon-half"
}
} as const;

const FoodLemon = {
  id: 'lemon',
  path: 'food/lemon',
  fullPath: 'pizza/models/food/lemon.glb',
  format: 'glb',
  nodes: {
  "Lemon": "lemon"
}
} as const;

const FoodLoafBaguette = {
  id: 'loaf-baguette',
  path: 'food/loaf-baguette',
  fullPath: 'pizza/models/food/loaf-baguette.glb',
  format: 'glb',
  nodes: {
  "LoafBaguette": "loaf-baguette"
}
} as const;

const FoodLoafRound = {
  id: 'loaf-round',
  path: 'food/loaf-round',
  fullPath: 'pizza/models/food/loaf-round.glb',
  format: 'glb',
  nodes: {
  "LoafRound": "loaf-round"
}
} as const;

const FoodLoaf = {
  id: 'loaf',
  path: 'food/loaf',
  fullPath: 'pizza/models/food/loaf.glb',
  format: 'glb',
  nodes: {
  "Loaf": "loaf"
}
} as const;

const FoodLollypop = {
  id: 'lollypop',
  path: 'food/lollypop',
  fullPath: 'pizza/models/food/lollypop.glb',
  format: 'glb',
  nodes: {
  "Lollypop": "lollypop"
}
} as const;

const FoodMakiRoe = {
  id: 'maki-roe',
  path: 'food/maki-roe',
  fullPath: 'pizza/models/food/maki-roe.glb',
  format: 'glb',
  nodes: {
  "MakiRoe": "maki-roe"
}
} as const;

const FoodMakiSalmon = {
  id: 'maki-salmon',
  path: 'food/maki-salmon',
  fullPath: 'pizza/models/food/maki-salmon.glb',
  format: 'glb',
  nodes: {
  "MakiSalmon": "maki-salmon"
}
} as const;

const FoodMakiVegetable = {
  id: 'maki-vegetable',
  path: 'food/maki-vegetable',
  fullPath: 'pizza/models/food/maki-vegetable.glb',
  format: 'glb',
  nodes: {
  "MakiVegetable": "maki-vegetable"
}
} as const;

const FoodMeatCooked = {
  id: 'meat-cooked',
  path: 'food/meat-cooked',
  fullPath: 'pizza/models/food/meat-cooked.glb',
  format: 'glb',
  nodes: {
  "MeatCooked": "meat-cooked"
}
} as const;

const FoodMeatPatty = {
  id: 'meat-patty',
  path: 'food/meat-patty',
  fullPath: 'pizza/models/food/meat-patty.glb',
  format: 'glb',
  nodes: {
  "MeatPatty": "meat-patty"
}
} as const;

const FoodMeatRaw = {
  id: 'meat-raw',
  path: 'food/meat-raw',
  fullPath: 'pizza/models/food/meat-raw.glb',
  format: 'glb',
  nodes: {
  "MeatRaw": "meat-raw"
}
} as const;

const FoodMeatRibs = {
  id: 'meat-ribs',
  path: 'food/meat-ribs',
  fullPath: 'pizza/models/food/meat-ribs.glb',
  format: 'glb',
  nodes: {
  "MeatRibs": "meat-ribs"
}
} as const;

const FoodMeatSausage = {
  id: 'meat-sausage',
  path: 'food/meat-sausage',
  fullPath: 'pizza/models/food/meat-sausage.glb',
  format: 'glb',
  nodes: {
  "MeatSausage": "meat-sausage"
}
} as const;

const FoodMeatTenderizer = {
  id: 'meat-tenderizer',
  path: 'food/meat-tenderizer',
  fullPath: 'pizza/models/food/meat-tenderizer.glb',
  format: 'glb',
  nodes: {
  "MeatTenderizer": "meat-tenderizer"
}
} as const;

const FoodMincemeatPie = {
  id: 'mincemeat-pie',
  path: 'food/mincemeat-pie',
  fullPath: 'pizza/models/food/mincemeat-pie.glb',
  format: 'glb',
  nodes: {
  "MincemeatPie": "mincemeat-pie"
}
} as const;

const FoodMortarPestle = {
  id: 'mortar-pestle',
  path: 'food/mortar-pestle',
  fullPath: 'pizza/models/food/mortar-pestle.glb',
  format: 'glb',
  nodes: {
  "MortarPestle": "mortar-pestle"
}
} as const;

const FoodMortar = {
  id: 'mortar',
  path: 'food/mortar',
  fullPath: 'pizza/models/food/mortar.glb',
  format: 'glb',
  nodes: {
  "Mortar": "mortar"
}
} as const;

const FoodMuffin = {
  id: 'muffin',
  path: 'food/muffin',
  fullPath: 'pizza/models/food/muffin.glb',
  format: 'glb',
  nodes: {
  "Muffin": "muffin"
}
} as const;

const FoodMug = {
  id: 'mug',
  path: 'food/mug',
  fullPath: 'pizza/models/food/mug.glb',
  format: 'glb',
  nodes: {
  "Mug": "mug"
}
} as const;

const FoodMushroomHalf = {
  id: 'mushroom-half',
  path: 'food/mushroom-half',
  fullPath: 'pizza/models/food/mushroom-half.glb',
  format: 'glb',
  nodes: {
  "MushroomHalf": "mushroom-half"
}
} as const;

const FoodMushroom = {
  id: 'mushroom',
  path: 'food/mushroom',
  fullPath: 'pizza/models/food/mushroom.glb',
  format: 'glb',
  nodes: {
  "Mushroom": "mushroom"
}
} as const;

const FoodMusselOpen = {
  id: 'mussel-open',
  path: 'food/mussel-open',
  fullPath: 'pizza/models/food/mussel-open.glb',
  format: 'glb',
  nodes: {
  "MusselOpen": "mussel-open"
}
} as const;

const FoodMussel = {
  id: 'mussel',
  path: 'food/mussel',
  fullPath: 'pizza/models/food/mussel.glb',
  format: 'glb',
  nodes: {
  "Mussel": "mussel"
}
} as const;

const FoodOnionHalf = {
  id: 'onion-half',
  path: 'food/onion-half',
  fullPath: 'pizza/models/food/onion-half.glb',
  format: 'glb',
  nodes: {
  "OnionHalf": "onion-half"
}
} as const;

const FoodOnion = {
  id: 'onion',
  path: 'food/onion',
  fullPath: 'pizza/models/food/onion.glb',
  format: 'glb',
  nodes: {
  "Onion": "onion"
}
} as const;

const FoodOrange = {
  id: 'orange',
  path: 'food/orange',
  fullPath: 'pizza/models/food/orange.glb',
  format: 'glb',
  nodes: {
  "Orange": "orange"
}
} as const;

const FoodPanStew = {
  id: 'pan-stew',
  path: 'food/pan-stew',
  fullPath: 'pizza/models/food/pan-stew.glb',
  format: 'glb',
  nodes: {
  "PanStew": "pan-stew"
}
} as const;

const FoodPan = {
  id: 'pan',
  path: 'food/pan',
  fullPath: 'pizza/models/food/pan.glb',
  format: 'glb',
  nodes: {
  "Pan": "pan"
}
} as const;

const FoodPancakes = {
  id: 'pancakes',
  path: 'food/pancakes',
  fullPath: 'pizza/models/food/pancakes.glb',
  format: 'glb',
  nodes: {
  "Pancakes": "pancakes",
  "Butter": "butter",
  "Pancake": "pancake"
}
} as const;

const FoodPaprikaSlice = {
  id: 'paprika-slice',
  path: 'food/paprika-slice',
  fullPath: 'pizza/models/food/paprika-slice.glb',
  format: 'glb',
  nodes: {
  "PaprikaSlice": "paprika-slice"
}
} as const;

const FoodPaprika = {
  id: 'paprika',
  path: 'food/paprika',
  fullPath: 'pizza/models/food/paprika.glb',
  format: 'glb',
  nodes: {
  "Paprika": "paprika"
}
} as const;

const FoodPeanutButter = {
  id: 'peanut-butter',
  path: 'food/peanut-butter',
  fullPath: 'pizza/models/food/peanut-butter.glb',
  format: 'glb',
  nodes: {
  "PeanutButter": "peanut-butter"
}
} as const;

const FoodPearHalf = {
  id: 'pear-half',
  path: 'food/pear-half',
  fullPath: 'pizza/models/food/pear-half.glb',
  format: 'glb',
  nodes: {
  "PearHalf": "pear-half"
}
} as const;

const FoodPear = {
  id: 'pear',
  path: 'food/pear',
  fullPath: 'pizza/models/food/pear.glb',
  format: 'glb',
  nodes: {
  "Pear": "pear"
}
} as const;

const FoodPepperMill = {
  id: 'pepper-mill',
  path: 'food/pepper-mill',
  fullPath: 'pizza/models/food/pepper-mill.glb',
  format: 'glb',
  nodes: {
  "PepperMill": "pepper-mill"
}
} as const;

const FoodPepper = {
  id: 'pepper',
  path: 'food/pepper',
  fullPath: 'pizza/models/food/pepper.glb',
  format: 'glb',
  nodes: {
  "Pepper": "pepper"
}
} as const;

const FoodPie = {
  id: 'pie',
  path: 'food/pie',
  fullPath: 'pizza/models/food/pie.glb',
  format: 'glb',
  nodes: {
  "Pie": "pie"
}
} as const;

const FoodPineapple = {
  id: 'pineapple',
  path: 'food/pineapple',
  fullPath: 'pizza/models/food/pineapple.glb',
  format: 'glb',
  nodes: {
  "Pineapple": "pineapple"
}
} as const;

const FoodPizzaBox = {
  id: 'pizza-box',
  path: 'food/pizza-box',
  fullPath: 'pizza/models/food/pizza-box.glb',
  format: 'glb',
  nodes: {
  "PizzaBox": "pizza-box",
  "Lid": "lid"
}
} as const;

const FoodPizzaCutter = {
  id: 'pizza-cutter',
  path: 'food/pizza-cutter',
  fullPath: 'pizza/models/food/pizza-cutter.glb',
  format: 'glb',
  nodes: {
  "PizzaCutter": "pizza-cutter"
}
} as const;

const FoodPizza = {
  id: 'pizza',
  path: 'food/pizza',
  fullPath: 'pizza/models/food/pizza.glb',
  format: 'glb',
  nodes: {
  "Slice6": "slice6",
  "Slice1": "slice1",
  "Slice2": "slice2",
  "Slice3": "slice3",
  "Slice4": "slice4",
  "Slice5": "slice5",
  "Slice7": "slice7",
  "Slice8": "slice8"
}
} as const;

const FoodPlateBroken = {
  id: 'plate-broken',
  path: 'food/plate-broken',
  fullPath: 'pizza/models/food/plate-broken.glb',
  format: 'glb',
  nodes: {
  "Piece": "piece"
}
} as const;

const FoodPlateDeep = {
  id: 'plate-deep',
  path: 'food/plate-deep',
  fullPath: 'pizza/models/food/plate-deep.glb',
  format: 'glb',
  nodes: {
  "PlateDeep": "plate-deep"
}
} as const;

const FoodPlateDinner = {
  id: 'plate-dinner',
  path: 'food/plate-dinner',
  fullPath: 'pizza/models/food/plate-dinner.glb',
  format: 'glb',
  nodes: {
  "PlateDinner": "plate-dinner"
}
} as const;

const FoodPlateRectangle = {
  id: 'plate-rectangle',
  path: 'food/plate-rectangle',
  fullPath: 'pizza/models/food/plate-rectangle.glb',
  format: 'glb',
  nodes: {
  "PlateRectangle": "plate-rectangle"
}
} as const;

const FoodPlateSauerkraut = {
  id: 'plate-sauerkraut',
  path: 'food/plate-sauerkraut',
  fullPath: 'pizza/models/food/plate-sauerkraut.glb',
  format: 'glb',
  nodes: {
  "PlateSauerkraut": "plate-sauerkraut"
}
} as const;

const FoodPlate = {
  id: 'plate',
  path: 'food/plate',
  fullPath: 'pizza/models/food/plate.glb',
  format: 'glb',
  nodes: {
  "Plate": "plate"
}
} as const;

const FoodPopsicleChocolate = {
  id: 'popsicle-chocolate',
  path: 'food/popsicle-chocolate',
  fullPath: 'pizza/models/food/popsicle-chocolate.glb',
  format: 'glb',
  nodes: {
  "PopsicleChocolate": "popsicle-chocolate"
}
} as const;

const FoodPopsicleStick = {
  id: 'popsicle-stick',
  path: 'food/popsicle-stick',
  fullPath: 'pizza/models/food/popsicle-stick.glb',
  format: 'glb',
  nodes: {
  "PopsicleStick": "popsicle-stick"
}
} as const;

const FoodPopsicle = {
  id: 'popsicle',
  path: 'food/popsicle',
  fullPath: 'pizza/models/food/popsicle.glb',
  format: 'glb',
  nodes: {
  "Popsicle": "popsicle"
}
} as const;

const FoodPotLid = {
  id: 'pot-lid',
  path: 'food/pot-lid',
  fullPath: 'pizza/models/food/pot-lid.glb',
  format: 'glb',
  nodes: {
  "PotLid": "pot-lid"
}
} as const;

const FoodPotStewLid = {
  id: 'pot-stew-lid',
  path: 'food/pot-stew-lid',
  fullPath: 'pizza/models/food/pot-stew-lid.glb',
  format: 'glb',
  nodes: {
  "PotStewLid": "pot-stew-lid",
  "Ignore": "(%ignore)"
}
} as const;

const FoodPotStew = {
  id: 'pot-stew',
  path: 'food/pot-stew',
  fullPath: 'pizza/models/food/pot-stew.glb',
  format: 'glb',
  nodes: {
  "PotStew": "pot-stew"
}
} as const;

const FoodPot = {
  id: 'pot',
  path: 'food/pot',
  fullPath: 'pizza/models/food/pot.glb',
  format: 'glb',
  nodes: {
  "Pot": "pot"
}
} as const;

const FoodPudding = {
  id: 'pudding',
  path: 'food/pudding',
  fullPath: 'pizza/models/food/pudding.glb',
  format: 'glb',
  nodes: {
  "Pudding": "pudding"
}
} as const;

const FoodPumpkinBasic = {
  id: 'pumpkin-basic',
  path: 'food/pumpkin-basic',
  fullPath: 'pizza/models/food/pumpkin-basic.glb',
  format: 'glb',
  nodes: {
  "PumpkinBasic": "pumpkin-basic"
}
} as const;

const FoodPumpkin = {
  id: 'pumpkin',
  path: 'food/pumpkin',
  fullPath: 'pizza/models/food/pumpkin.glb',
  format: 'glb',
  nodes: {
  "Pumpkin": "pumpkin"
}
} as const;

const FoodRadish = {
  id: 'radish',
  path: 'food/radish',
  fullPath: 'pizza/models/food/radish.glb',
  format: 'glb',
  nodes: {
  "Radish": "radish"
}
} as const;

const FoodRiceBall = {
  id: 'rice-ball',
  path: 'food/rice-ball',
  fullPath: 'pizza/models/food/rice-ball.glb',
  format: 'glb',
  nodes: {
  "RiceBall": "rice-ball"
}
} as const;

const FoodRollingPin = {
  id: 'rollingPin',
  path: 'food/rollingPin',
  fullPath: 'pizza/models/food/rollingPin.glb',
  format: 'glb',
  nodes: {
  "RollingPin": "rollingPin"
}
} as const;

const FoodSalad = {
  id: 'salad',
  path: 'food/salad',
  fullPath: 'pizza/models/food/salad.glb',
  format: 'glb',
  nodes: {
  "Salad": "salad"
}
} as const;

const FoodSandwich = {
  id: 'sandwich',
  path: 'food/sandwich',
  fullPath: 'pizza/models/food/sandwich.glb',
  format: 'glb',
  nodes: {
  "Sandwich": "sandwich",
  "Lettuce": "lettuce",
  "Meat": "meat",
  "Bun": "bun"
}
} as const;

const FoodSausageHalf = {
  id: 'sausage-half',
  path: 'food/sausage-half',
  fullPath: 'pizza/models/food/sausage-half.glb',
  format: 'glb',
  nodes: {
  "SausageHalf": "sausage-half"
}
} as const;

const FoodSausage = {
  id: 'sausage',
  path: 'food/sausage',
  fullPath: 'pizza/models/food/sausage.glb',
  format: 'glb',
  nodes: {
  "Sausage": "sausage"
}
} as const;

const FoodShakerPepper = {
  id: 'shaker-pepper',
  path: 'food/shaker-pepper',
  fullPath: 'pizza/models/food/shaker-pepper.glb',
  format: 'glb',
  nodes: {
  "ShakerPepper": "shaker-pepper"
}
} as const;

const FoodShakerSalt = {
  id: 'shaker-salt',
  path: 'food/shaker-salt',
  fullPath: 'pizza/models/food/shaker-salt.glb',
  format: 'glb',
  nodes: {
  "ShakerSalt": "shaker-salt"
}
} as const;

const FoodSkewerVegetables = {
  id: 'skewer-vegetables',
  path: 'food/skewer-vegetables',
  fullPath: 'pizza/models/food/skewer-vegetables.glb',
  format: 'glb',
  nodes: {
  "SkewerVegetables": "skewer-vegetables",
  "Meat": "meat",
  "Vegetables": "vegetables"
}
} as const;

const FoodSkewer = {
  id: 'skewer',
  path: 'food/skewer',
  fullPath: 'pizza/models/food/skewer.glb',
  format: 'glb',
  nodes: {
  "Skewer": "skewer",
  "Meat": "meat"
}
} as const;

const FoodSodaBottle = {
  id: 'soda-bottle',
  path: 'food/soda-bottle',
  fullPath: 'pizza/models/food/soda-bottle.glb',
  format: 'glb',
  nodes: {
  "SodaBottle": "soda-bottle"
}
} as const;

const FoodSodaCanCrushed = {
  id: 'soda-can-crushed',
  path: 'food/soda-can-crushed',
  fullPath: 'pizza/models/food/soda-can-crushed.glb',
  format: 'glb',
  nodes: {
  "SodaCanCrushed": "soda-can-crushed"
}
} as const;

const FoodSodaCan = {
  id: 'soda-can',
  path: 'food/soda-can',
  fullPath: 'pizza/models/food/soda-can.glb',
  format: 'glb',
  nodes: {
  "SodaCan": "soda-can"
}
} as const;

const FoodSodaGlass = {
  id: 'soda-glass',
  path: 'food/soda-glass',
  fullPath: 'pizza/models/food/soda-glass.glb',
  format: 'glb',
  nodes: {
  "SodaGlass": "soda-glass",
  "Straw": "straw",
  "Lemon": "lemon"
}
} as const;

const FoodSoda = {
  id: 'soda',
  path: 'food/soda',
  fullPath: 'pizza/models/food/soda.glb',
  format: 'glb',
  nodes: {
  "Soda": "soda"
}
} as const;

const FoodSoy = {
  id: 'soy',
  path: 'food/soy',
  fullPath: 'pizza/models/food/soy.glb',
  format: 'glb',
  nodes: {
  "Soy": "soy"
}
} as const;

const FoodSteamer = {
  id: 'steamer',
  path: 'food/steamer',
  fullPath: 'pizza/models/food/steamer.glb',
  format: 'glb',
  nodes: {
  "Lid": "lid",
  "Layer": "layer"
}
} as const;

const FoodStrawberry = {
  id: 'strawberry',
  path: 'food/strawberry',
  fullPath: 'pizza/models/food/strawberry.glb',
  format: 'glb',
  nodes: {
  "Strawberry": "strawberry"
}
} as const;

const FoodStyrofoamDinner = {
  id: 'styrofoam-dinner',
  path: 'food/styrofoam-dinner',
  fullPath: 'pizza/models/food/styrofoam-dinner.glb',
  format: 'glb',
  nodes: {
  "StyrofoamDinner": "styrofoam-dinner",
  "Group": "Group",
  "Lid": "lid"
}
} as const;

const FoodStyrofoam = {
  id: 'styrofoam',
  path: 'food/styrofoam',
  fullPath: 'pizza/models/food/styrofoam.glb',
  format: 'glb',
  nodes: {
  "Styrofoam": "styrofoam",
  "Lid": "lid"
}
} as const;

const FoodSub = {
  id: 'sub',
  path: 'food/sub',
  fullPath: 'pizza/models/food/sub.glb',
  format: 'glb',
  nodes: {
  "Sub": "sub",
  "BunBottom": "bun-bottom",
  "Lettuce": "lettuce",
  "Meat": "meat",
  "Tomato": "tomato",
  "BunTop": "bun-top"
}
} as const;

const FoodSundae = {
  id: 'sundae',
  path: 'food/sundae',
  fullPath: 'pizza/models/food/sundae.glb',
  format: 'glb',
  nodes: {
  "Sundae": "sundae",
  "Cherry": "cherry",
  "Straw": "straw"
}
} as const;

const FoodSushiEgg = {
  id: 'sushi-egg',
  path: 'food/sushi-egg',
  fullPath: 'pizza/models/food/sushi-egg.glb',
  format: 'glb',
  nodes: {
  "SushiEgg": "sushi-egg"
}
} as const;

const FoodSushiSalmon = {
  id: 'sushi-salmon',
  path: 'food/sushi-salmon',
  fullPath: 'pizza/models/food/sushi-salmon.glb',
  format: 'glb',
  nodes: {
  "SushiSalmon": "sushi-salmon"
}
} as const;

const FoodTaco = {
  id: 'taco',
  path: 'food/taco',
  fullPath: 'pizza/models/food/taco.glb',
  format: 'glb',
  nodes: {
  "Taco": "taco"
}
} as const;

const FoodTajineLid = {
  id: 'tajine-lid',
  path: 'food/tajine-lid',
  fullPath: 'pizza/models/food/tajine-lid.glb',
  format: 'glb',
  nodes: {
  "TajineLid": "tajine-lid"
}
} as const;

const FoodTajine = {
  id: 'tajine',
  path: 'food/tajine',
  fullPath: 'pizza/models/food/tajine.glb',
  format: 'glb',
  nodes: {
  "Tajine": "tajine"
}
} as const;

const FoodTomatoSlice = {
  id: 'tomato-slice',
  path: 'food/tomato-slice',
  fullPath: 'pizza/models/food/tomato-slice.glb',
  format: 'glb',
  nodes: {
  "TomatoSlice": "tomato-slice"
}
} as const;

const FoodTomato = {
  id: 'tomato',
  path: 'food/tomato',
  fullPath: 'pizza/models/food/tomato.glb',
  format: 'glb',
  nodes: {
  "Tomato": "tomato"
}
} as const;

const FoodTurkey = {
  id: 'turkey',
  path: 'food/turkey',
  fullPath: 'pizza/models/food/turkey.glb',
  format: 'glb',
  nodes: {
  "Turkey": "turkey",
  "Leg": "leg"
}
} as const;

const FoodUtensilFork = {
  id: 'utensil-fork',
  path: 'food/utensil-fork',
  fullPath: 'pizza/models/food/utensil-fork.glb',
  format: 'glb',
  nodes: {
  "UtensilFork": "utensil-fork"
}
} as const;

const FoodUtensilKnife = {
  id: 'utensil-knife',
  path: 'food/utensil-knife',
  fullPath: 'pizza/models/food/utensil-knife.glb',
  format: 'glb',
  nodes: {
  "UtensilKnife": "utensil-knife"
}
} as const;

const FoodUtensilSpoon = {
  id: 'utensil-spoon',
  path: 'food/utensil-spoon',
  fullPath: 'pizza/models/food/utensil-spoon.glb',
  format: 'glb',
  nodes: {
  "UtensilSpoon": "utensil-spoon"
}
} as const;

const FoodWaffle = {
  id: 'waffle',
  path: 'food/waffle',
  fullPath: 'pizza/models/food/waffle.glb',
  format: 'glb',
  nodes: {
  "Waffle": "waffle"
}
} as const;

const FoodWatermelon = {
  id: 'watermelon',
  path: 'food/watermelon',
  fullPath: 'pizza/models/food/watermelon.glb',
  format: 'glb',
  nodes: {
  "Slice": "slice"
}
} as const;

const FoodWhippedCream = {
  id: 'whipped-cream',
  path: 'food/whipped-cream',
  fullPath: 'pizza/models/food/whipped-cream.glb',
  format: 'glb',
  nodes: {
  "WhippedCream": "whipped-cream"
}
} as const;

const FoodWhisk = {
  id: 'whisk',
  path: 'food/whisk',
  fullPath: 'pizza/models/food/whisk.glb',
  format: 'glb',
  nodes: {
  "Whisk": "whisk"
}
} as const;

const FoodWholeHam = {
  id: 'whole-ham',
  path: 'food/whole-ham',
  fullPath: 'pizza/models/food/whole-ham.glb',
  format: 'glb',
  nodes: {
  "WholeHam": "whole-ham"
}
} as const;

const FoodWholerHam = {
  id: 'wholer-ham',
  path: 'food/wholer-ham',
  fullPath: 'pizza/models/food/wholer-ham.glb',
  format: 'glb',
  nodes: {
  "WholerHam": "wholer-ham"
}
} as const;

const FoodWineRed = {
  id: 'wine-red',
  path: 'food/wine-red',
  fullPath: 'pizza/models/food/wine-red.glb',
  format: 'glb',
  nodes: {
  "WineRed": "wine-red"
}
} as const;

const FoodWineWhite = {
  id: 'wine-white',
  path: 'food/wine-white',
  fullPath: 'pizza/models/food/wine-white.glb',
  format: 'glb',
  nodes: {
  "WineWhite": "wine-white"
}
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

const ResourcesSilverNuggets = {
  id: 'Silver_Nuggets',
  path: 'resources/Silver_Nuggets',
  fullPath: 'pizza/models/resources/Silver_Nuggets.gltf',
  format: 'gltf',
  nodes: {
  "SilverNuggets": "Silver_Nuggets"
}
} as const;

const ResourcesSilverNuggetLarge = {
  id: 'Silver_Nugget_Large',
  path: 'resources/Silver_Nugget_Large',
  fullPath: 'pizza/models/resources/Silver_Nugget_Large.gltf',
  format: 'gltf',
  nodes: {
  "SilverNuggetLarge": "Silver_Nugget_Large"
}
} as const;

const ResourcesSilverNuggetMedium = {
  id: 'Silver_Nugget_Medium',
  path: 'resources/Silver_Nugget_Medium',
  fullPath: 'pizza/models/resources/Silver_Nugget_Medium.gltf',
  format: 'gltf',
  nodes: {
  "SilverNuggetMedium": "Silver_Nugget_Medium"
}
} as const;

const ResourcesSilverNuggetSmall = {
  id: 'Silver_Nugget_Small',
  path: 'resources/Silver_Nugget_Small',
  fullPath: 'pizza/models/resources/Silver_Nugget_Small.gltf',
  format: 'gltf',
  nodes: {
  "SilverNuggetSmall": "Silver_Nugget_Small"
}
} as const;

const ResourcesStoneChunksLarge = {
  id: 'Stone_Chunks_Large',
  path: 'resources/Stone_Chunks_Large',
  fullPath: 'pizza/models/resources/Stone_Chunks_Large.gltf',
  format: 'gltf',
  nodes: {
  "StoneChunksLarge": "Stone_Chunks_Large"
}
} as const;

const ResourcesStoneChunksSmall = {
  id: 'Stone_Chunks_Small',
  path: 'resources/Stone_Chunks_Small',
  fullPath: 'pizza/models/resources/Stone_Chunks_Small.gltf',
  format: 'gltf',
  nodes: {
  "StoneChunksSmall": "Stone_Chunks_Small"
}
} as const;

const ResourcesWoodLogA = {
  id: 'Wood_Log_A',
  path: 'resources/Wood_Log_A',
  fullPath: 'pizza/models/resources/Wood_Log_A.gltf',
  format: 'gltf',
  nodes: {
  "WoodLogA": "Wood_Log_A"
}
} as const;

const ResourcesWoodLogB = {
  id: 'Wood_Log_B',
  path: 'resources/Wood_Log_B',
  fullPath: 'pizza/models/resources/Wood_Log_B.gltf',
  format: 'gltf',
  nodes: {
  "WoodLogB": "Wood_Log_B"
}
} as const;

const ResourcesWoodLogStack = {
  id: 'Wood_Log_Stack',
  path: 'resources/Wood_Log_Stack',
  fullPath: 'pizza/models/resources/Wood_Log_Stack.gltf',
  format: 'gltf',
  nodes: {
  "WoodLogStack": "Wood_Log_Stack"
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
  Food: {
    AdvocadoHalf: FoodAdvocadoHalf,
    AppleHalf: FoodAppleHalf,
    Apple: FoodApple,
    Avocado: FoodAvocado,
    BaconRaw: FoodBaconRaw,
    Bacon: FoodBacon,
    BagFlat: FoodBagFlat,
    Bag: FoodBag,
    Banana: FoodBanana,
    Barrel: FoodBarrel,
    Beet: FoodBeet,
    BottleKetchup: FoodBottleKetchup,
    BottleMusterd: FoodBottleMusterd,
    BottleOil: FoodBottleOil,
    BowlBroth: FoodBowlBroth,
    BowlCereal: FoodBowlCereal,
    BowlSoup: FoodBowlSoup,
    Bowl: FoodBowl,
    Bread: FoodBread,
    Broccoli: FoodBroccoli,
    BurgerCheeseDouble: FoodBurgerCheeseDouble,
    BurgerCheese: FoodBurgerCheese,
    BurgerDouble: FoodBurgerDouble,
    Burger: FoodBurger,
    Cabbage: FoodCabbage,
    CakeBirthday: FoodCakeBirthday,
    CakeSlicer: FoodCakeSlicer,
    Cake: FoodCake,
    CanOpen: FoodCanOpen,
    CanSmall: FoodCanSmall,
    Can: FoodCan,
    CandyBarWrapper: FoodCandyBarWrapper,
    CandyBar: FoodCandyBar,
    Carrot: FoodCarrot,
    CartonSmall: FoodCartonSmall,
    Carton: FoodCarton,
    Cauliflower: FoodCauliflower,
    CeleryStick: FoodCeleryStick,
    CheeseCut: FoodCheeseCut,
    CheeseSlicer: FoodCheeseSlicer,
    Cheese: FoodCheese,
    Cherries: FoodCherries,
    Chinese: FoodChinese,
    ChocolateWrapper: FoodChocolateWrapper,
    Chocolate: FoodChocolate,
    ChopsticDecorative: FoodChopsticDecorative,
    Chopstick: FoodChopstick,
    Cocktail: FoodCocktail,
    CoconutHalf: FoodCoconutHalf,
    Coconut: FoodCoconut,
    CookieChocolate: FoodCookieChocolate,
    Cookie: FoodCookie,
    CookingFork: FoodCookingFork,
    CookingKnifeChopping: FoodCookingKnifeChopping,
    CookingKnife: FoodCookingKnife,
    CookingSpatula: FoodCookingSpatula,
    CookingSpoon: FoodCookingSpoon,
    CornDog: FoodCornDog,
    Corn: FoodCorn,
    Croissant: FoodCroissant,
    CupCoffee: FoodCupCoffee,
    CupSaucer: FoodCupSaucer,
    CupTea: FoodCupTea,
    Cup: FoodCup,
    Cupcake: FoodCupcake,
    CuttingBoardJapanese: FoodCuttingBoardJapanese,
    CuttingBoardRound: FoodCuttingBoardRound,
    CuttingBoard: FoodCuttingBoard,
    DimSum: FoodDimSum,
    DonutChocolate: FoodDonutChocolate,
    DonutSprinkles: FoodDonutSprinkles,
    Donut: FoodDonut,
    EggCooked: FoodEggCooked,
    EggCup: FoodEggCup,
    EggHalf: FoodEggHalf,
    Egg: FoodEgg,
    Eggplant: FoodEggplant,
    FishBones: FoodFishBones,
    Fish: FoodFish,
    Frappe: FoodFrappe,
    FriesEmpty: FoodFriesEmpty,
    Fries: FoodFries,
    FrikandelSpeciaal: FoodFrikandelSpeciaal,
    FryingPanLid: FoodFryingPanLid,
    FryingPan: FoodFryingPan,
    GingerBreadCutter: FoodGingerBreadCutter,
    GingerBread: FoodGingerBread,
    GlassWine: FoodGlassWine,
    Glass: FoodGlass,
    Grapes: FoodGrapes,
    Honey: FoodHoney,
    HotDogRaw: FoodHotDogRaw,
    HotDog: FoodHotDog,
    IceCreamCne: FoodIceCreamCne,
    IceCreamCup: FoodIceCreamCup,
    IceCreamScoopChocolate: FoodIceCreamScoopChocolate,
    IceCreamScoopMint: FoodIceCreamScoopMint,
    IceCream: FoodIceCream,
    KnifeBlock: FoodKnifeBlock,
    Leek: FoodLeek,
    LemonHalf: FoodLemonHalf,
    Lemon: FoodLemon,
    LoafBaguette: FoodLoafBaguette,
    LoafRound: FoodLoafRound,
    Loaf: FoodLoaf,
    Lollypop: FoodLollypop,
    MakiRoe: FoodMakiRoe,
    MakiSalmon: FoodMakiSalmon,
    MakiVegetable: FoodMakiVegetable,
    MeatCooked: FoodMeatCooked,
    MeatPatty: FoodMeatPatty,
    MeatRaw: FoodMeatRaw,
    MeatRibs: FoodMeatRibs,
    MeatSausage: FoodMeatSausage,
    MeatTenderizer: FoodMeatTenderizer,
    MincemeatPie: FoodMincemeatPie,
    MortarPestle: FoodMortarPestle,
    Mortar: FoodMortar,
    Muffin: FoodMuffin,
    Mug: FoodMug,
    MushroomHalf: FoodMushroomHalf,
    Mushroom: FoodMushroom,
    MusselOpen: FoodMusselOpen,
    Mussel: FoodMussel,
    OnionHalf: FoodOnionHalf,
    Onion: FoodOnion,
    Orange: FoodOrange,
    PanStew: FoodPanStew,
    Pan: FoodPan,
    Pancakes: FoodPancakes,
    PaprikaSlice: FoodPaprikaSlice,
    Paprika: FoodPaprika,
    PeanutButter: FoodPeanutButter,
    PearHalf: FoodPearHalf,
    Pear: FoodPear,
    PepperMill: FoodPepperMill,
    Pepper: FoodPepper,
    Pie: FoodPie,
    Pineapple: FoodPineapple,
    PizzaBox: FoodPizzaBox,
    PizzaCutter: FoodPizzaCutter,
    Pizza: FoodPizza,
    PlateBroken: FoodPlateBroken,
    PlateDeep: FoodPlateDeep,
    PlateDinner: FoodPlateDinner,
    PlateRectangle: FoodPlateRectangle,
    PlateSauerkraut: FoodPlateSauerkraut,
    Plate: FoodPlate,
    PopsicleChocolate: FoodPopsicleChocolate,
    PopsicleStick: FoodPopsicleStick,
    Popsicle: FoodPopsicle,
    PotLid: FoodPotLid,
    PotStewLid: FoodPotStewLid,
    PotStew: FoodPotStew,
    Pot: FoodPot,
    Pudding: FoodPudding,
    PumpkinBasic: FoodPumpkinBasic,
    Pumpkin: FoodPumpkin,
    Radish: FoodRadish,
    RiceBall: FoodRiceBall,
    RollingPin: FoodRollingPin,
    Salad: FoodSalad,
    Sandwich: FoodSandwich,
    SausageHalf: FoodSausageHalf,
    Sausage: FoodSausage,
    ShakerPepper: FoodShakerPepper,
    ShakerSalt: FoodShakerSalt,
    SkewerVegetables: FoodSkewerVegetables,
    Skewer: FoodSkewer,
    SodaBottle: FoodSodaBottle,
    SodaCanCrushed: FoodSodaCanCrushed,
    SodaCan: FoodSodaCan,
    SodaGlass: FoodSodaGlass,
    Soda: FoodSoda,
    Soy: FoodSoy,
    Steamer: FoodSteamer,
    Strawberry: FoodStrawberry,
    StyrofoamDinner: FoodStyrofoamDinner,
    Styrofoam: FoodStyrofoam,
    Sub: FoodSub,
    Sundae: FoodSundae,
    SushiEgg: FoodSushiEgg,
    SushiSalmon: FoodSushiSalmon,
    Taco: FoodTaco,
    TajineLid: FoodTajineLid,
    Tajine: FoodTajine,
    TomatoSlice: FoodTomatoSlice,
    Tomato: FoodTomato,
    Turkey: FoodTurkey,
    UtensilFork: FoodUtensilFork,
    UtensilKnife: FoodUtensilKnife,
    UtensilSpoon: FoodUtensilSpoon,
    Waffle: FoodWaffle,
    Watermelon: FoodWatermelon,
    WhippedCream: FoodWhippedCream,
    Whisk: FoodWhisk,
    WholeHam: FoodWholeHam,
    WholerHam: FoodWholerHam,
    WineRed: FoodWineRed,
    WineWhite: FoodWineWhite
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
  Resources: {
    SilverNuggets: ResourcesSilverNuggets,
    SilverNuggetLarge: ResourcesSilverNuggetLarge,
    SilverNuggetMedium: ResourcesSilverNuggetMedium,
    SilverNuggetSmall: ResourcesSilverNuggetSmall,
    StoneChunksLarge: ResourcesStoneChunksLarge,
    StoneChunksSmall: ResourcesStoneChunksSmall,
    WoodLogA: ResourcesWoodLogA,
    WoodLogB: ResourcesWoodLogB,
    WoodLogStack: ResourcesWoodLogStack
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