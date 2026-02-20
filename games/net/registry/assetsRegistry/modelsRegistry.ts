// Auto-generated file - DO NOT EDIT
export type ModelFormat = 'glb' | 'gltf' | 'fbx' | 'obj';
export interface ModelDefinition {
  readonly id: string;
  readonly path: string;
  readonly fullPath: string;
  readonly format: ModelFormat;
  readonly nodes: Record<string, string>;
}

const Armor = {
  id: 'armor',
  path: 'cars/armor',
  fullPath: 'net/models/cars/armor.glb',
  format: 'glb',
  nodes: {
  "Van": "van",
  "Wheels010": "wheels.010",
  "Wheels011": "wheels.011",
  "Wheels048": "wheels.048",
  "Wheels049": "wheels.049"
}
} as const;

const Coupe = {
  id: 'coupe',
  path: 'cars/coupe',
  fullPath: 'net/models/cars/coupe.glb',
  format: 'glb',
  nodes: {
  "Coupe": "coupe",
  "Wheels024": "wheels.024",
  "Wheels025": "wheels.025",
  "Wheels034": "wheels.034",
  "Wheels035": "wheels.035"
}
} as const;

const Fenyr = {
  id: 'fenyr',
  path: 'cars/fenyr',
  fullPath: 'net/models/cars/fenyr.glb',
  format: 'glb',
  nodes: {
  "Fenyr": "fenyr",
  "Wheels020": "wheels.020",
  "Wheels021": "wheels.021",
  "Wheels038": "wheels.038",
  "Wheels039": "wheels.039"
}
} as const;

const Ghini = {
  id: 'ghini',
  path: 'cars/ghini',
  fullPath: 'net/models/cars/ghini.glb',
  format: 'glb',
  nodes: {
  "Ghini": "ghini",
  "Wheels008": "wheels.008",
  "Wheels009": "wheels.009",
  "Wheels050": "wheels.050",
  "Wheels051": "wheels.051"
}
} as const;

const Italia = {
  id: 'italia',
  path: 'cars/italia',
  fullPath: 'net/models/cars/italia.glb',
  format: 'glb',
  nodes: {
  "Italia": "italia",
  "Wheels022": "wheels.022",
  "Wheels023": "wheels.023",
  "Wheels036": "wheels.036",
  "Wheels037": "wheels.037"
}
} as const;

const Jeep = {
  id: 'jeep',
  path: 'cars/jeep',
  fullPath: 'net/models/cars/jeep.glb',
  format: 'glb',
  nodes: {
  "Jeep": "jeep",
  "Wheels016": "wheels.016",
  "Wheels017": "wheels.017",
  "Wheels042": "wheels.042",
  "Wheels043": "wheels.043"
}
} as const;

const Kamaro = {
  id: 'kamaro',
  path: 'cars/kamaro',
  fullPath: 'net/models/cars/kamaro.glb',
  format: 'glb',
  nodes: {
  "Kamaro": "kamaro",
  "Wheels002": "wheels.002",
  "Wheels003": "wheels.003",
  "Wheels058": "wheels.058",
  "Wheels059": "wheels.059"
}
} as const;

const Lamb = {
  id: 'lamb',
  path: 'cars/lamb',
  fullPath: 'net/models/cars/lamb.glb',
  format: 'glb',
  nodes: {
  "Lamb": "lamb",
  "Wheels": "wheels",
  "Wheels001": "wheels.001",
  "Wheels056": "wheels.056",
  "Wheels057": "wheels.057"
}
} as const;

const Mobil = {
  id: 'mobil',
  path: 'cars/mobil',
  fullPath: 'net/models/cars/mobil.glb',
  format: 'glb',
  nodes: {
  "CarBase002": "car_base.002",
  "Wheel1003": "wheel1.003",
  "Wheel1007": "wheel1.007",
  "Wheel2001": "wheel2.001",
  "Wheel2003": "wheel2.003"
}
} as const;

const Police = {
  id: 'police',
  path: 'cars/police',
  fullPath: 'net/models/cars/police.glb',
  format: 'glb',
  nodes: {
  "WheelBackLeft": "wheel-back-left",
  "WheelFrontLeft": "wheel-front-left",
  "WheelBackRight": "wheel-back-right",
  "Body": "body",
  "Grill": "grill",
  "WheelFrontRight": "wheel-front-right"
}
} as const;

const PoliceKenney = {
  id: 'policeKenney',
  path: 'cars/policeKenney',
  fullPath: 'net/models/cars/policeKenney.glb',
  format: 'glb',
  nodes: {
  "WheelBackLeft": "wheel-back-left",
  "WheelFrontLeft": "wheel-front-left",
  "WheelBackRight": "wheel-back-right",
  "Body": "body",
  "Grill": "grill",
  "WheelFrontRight": "wheel-front-right"
}
} as const;

const PoliceOld = {
  id: 'policeOld',
  path: 'cars/policeOld',
  fullPath: 'net/models/cars/policeOld.glb',
  format: 'glb',
  nodes: {
  "Police": "police",
  "Wheels028": "wheels.028",
  "Wheels029": "wheels.029",
  "Wheels030": "wheels.030",
  "Wheels031": "wheels.031"
}
} as const;

const Rally = {
  id: 'rally',
  path: 'cars/rally',
  fullPath: 'net/models/cars/rally.glb',
  format: 'glb',
  nodes: {
  "Rally": "rally",
  "Wheels018": "wheels.018",
  "Wheels019": "wheels.019",
  "Wheels040": "wheels.040",
  "Wheels041": "wheels.041"
}
} as const;

const Van = {
  id: 'van',
  path: 'cars/van',
  fullPath: 'net/models/cars/van.glb',
  format: 'glb',
  nodes: {
  "Van": "van",
  "Wheel1001": "wheel1.001",
  "Wheel1002": "wheel1.002",
  "Wheel1005": "wheel1.005",
  "Wheel1006": "wheel1.006"
}
} as const;

export const MODELS = {
  Armor,
  Coupe,
  Fenyr,
  Ghini,
  Italia,
  Jeep,
  Kamaro,
  Lamb,
  Mobil,
  Police,
  PoliceKenney,
  PoliceOld,
  Rally,
  Van
} as const;

export type ModelKey = keyof typeof MODELS;
export default MODELS;