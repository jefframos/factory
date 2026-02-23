export interface LevelObject {
    type: 'box' | 'polygon' | 'sensor' | 'circle';
    x: number;
    y: number;
    radius?: number;
    width?: number;  // For boxes/sensors
    height?: number; // For boxes/sensors
    vertices?: { x: number, y: number }[]; // For polygons
    isStatic?: boolean;
    label?: string;
    color?: number;
    debugColor?: number;
    modifier?: ModifierDescriptor;
    layer?: number;
}

export interface LevelSnapshot {
    totalTime: number;
    levelId: string;
    // Future fields like: starCount: number, damageTaken: number, etc.
}


export enum ModifierTrigger {
    ON_START = 'start',   // Once when entering
    ON_ACTIVE = 'active', // Every frame while inside
    ON_END = 'end'        // Once when leaving
}

export interface ModifierDescriptor {
    trigger: ModifierTrigger;
    // How the force is applied
    mode: 'add' | 'set' | 'multiply';
    // The force vector to apply
    force: { x: number; y: number };
    // If true, we calculate the direction from the center of the modifier to the player
    useRadialDirection?: boolean;
    // Optional multiplier for specific triggers (like your old 10x kick)
    multiplier?: number;
}

export interface LevelConfig {
    id: string;
    name: string;
    spawnPoint: { x: number, y: number };
    objects: LevelObject[];
}