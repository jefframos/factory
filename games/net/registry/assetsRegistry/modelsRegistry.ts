// Auto-generated file - DO NOT EDIT

export type ModelFormat = 'glb' | 'gltf' | 'fbx' | 'obj';

/** * This interface remains for documentation or manual typing, 
 * but we rely on 'as const' for the actual registry autocomplete.
 */
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
  "Wheels010": "wheels.010",
  "Wheels011": "wheels.011",
  "Wheels048": "wheels.048",
  "Wheels049": "wheels.049",
  "Van": "van"
}
} as const;

const Coupe = {
  id: 'coupe',
  path: 'cars/coupe',
  fullPath: 'net/models/cars/coupe.glb',
  format: 'glb',
  nodes: {
  "Wheels024": "wheels.024",
  "Wheels025": "wheels.025",
  "Wheels034": "wheels.034",
  "Wheels035": "wheels.035",
  "Coupe": "coupe"
}
} as const;

const Fenyr = {
  id: 'fenyr',
  path: 'cars/fenyr',
  fullPath: 'net/models/cars/fenyr.glb',
  format: 'glb',
  nodes: {
  "Wheels020": "wheels.020",
  "Wheels021": "wheels.021",
  "Wheels038": "wheels.038",
  "Wheels039": "wheels.039",
  "Fenyr": "fenyr"
}
} as const;

const Ghini = {
  id: 'ghini',
  path: 'cars/ghini',
  fullPath: 'net/models/cars/ghini.glb',
  format: 'glb',
  nodes: {
  "Wheels008": "wheels.008",
  "Wheels009": "wheels.009",
  "Wheels050": "wheels.050",
  "Wheels051": "wheels.051",
  "Ghini": "ghini"
}
} as const;

const Italia = {
  id: 'italia',
  path: 'cars/italia',
  fullPath: 'net/models/cars/italia.glb',
  format: 'glb',
  nodes: {
  "Wheels022": "wheels.022",
  "Wheels023": "wheels.023",
  "Wheels036": "wheels.036",
  "Wheels037": "wheels.037",
  "Italia": "italia"
}
} as const;

const Jeep = {
  id: 'jeep',
  path: 'cars/jeep',
  fullPath: 'net/models/cars/jeep.glb',
  format: 'glb',
  nodes: {
  "Wheels016": "wheels.016",
  "Wheels017": "wheels.017",
  "Wheels042": "wheels.042",
  "Wheels043": "wheels.043",
  "Jeep": "jeep"
}
} as const;

const Kamaro = {
  id: 'kamaro',
  path: 'cars/kamaro',
  fullPath: 'net/models/cars/kamaro.glb',
  format: 'glb',
  nodes: {
  "Wheels002": "wheels.002",
  "Wheels003": "wheels.003",
  "Wheels058": "wheels.058",
  "Wheels059": "wheels.059",
  "Kamaro": "kamaro"
}
} as const;

const Lamb = {
  id: 'lamb',
  path: 'cars/lamb',
  fullPath: 'net/models/cars/lamb.glb',
  format: 'glb',
  nodes: {
  "Wheels": "wheels",
  "Wheels001": "wheels.001",
  "Wheels056": "wheels.056",
  "Wheels057": "wheels.057",
  "Lamb": "lamb"
}
} as const;

const Mobil = {
  id: 'mobil',
  path: 'cars/mobil',
  fullPath: 'net/models/cars/mobil.glb',
  format: 'glb',
  nodes: {
  "Wheel1003": "wheel1.003",
  "Wheel1007": "wheel1.007",
  "Wheel2001": "wheel2.001",
  "Wheel2003": "wheel2.003",
  "CarBase002": "car_base.002"
}
} as const;

const Police = {
  id: 'police',
  path: 'cars/police',
  fullPath: 'net/models/cars/police.glb',
  format: 'glb',
  nodes: {
  "Wheels028": "wheels.028",
  "Wheels029": "wheels.029",
  "Wheels030": "wheels.030",
  "Wheels031": "wheels.031",
  "Police": "police"
}
} as const;

const Rally = {
  id: 'rally',
  path: 'cars/rally',
  fullPath: 'net/models/cars/rally.glb',
  format: 'glb',
  nodes: {
  "Wheels018": "wheels.018",
  "Wheels019": "wheels.019",
  "Wheels040": "wheels.040",
  "Wheels041": "wheels.041",
  "Rally": "rally"
}
} as const;

const Van = {
  id: 'van',
  path: 'cars/van',
  fullPath: 'net/models/cars/van.glb',
  format: 'glb',
  nodes: {
  "Wheel1001": "wheel1.001",
  "Wheel1002": "wheel1.002",
  "Wheel1005": "wheel1.005",
  "Wheel1006": "wheel1.006",
  "Van": "van"
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
  Rally,
  Van
} as const;

export type ModelKey = keyof typeof MODELS;
export default MODELS;