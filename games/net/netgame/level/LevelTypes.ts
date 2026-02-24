

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
    view3d?: View3DDefinition;
    physics?: PhysicsDefinition;
    interaction?: InteractionDefinition;
}

export interface WorldDefinition {
    id: string;
    name: string;
    icon: string;
    background: string;
    enabled: boolean;
    levelFile: string;
    customData: any;
    levels?: LevelConfig[]; // Populated during load
}

export interface PaletteSet {
    id: string; // The Name: e.g., "Main", "Desert"
    colors: number[]; // Exactly 8 hex numbers
}
export interface PaletteColor {
    id: string;
    hex: number;
    name: string;
}

export interface LevelManifest {
    worlds: WorldDefinition[];
    palettes: PaletteSet[]; // List of available sets
    activePaletteId: string; // Which one is currently "Live"
}

export interface LevelSnapshot {
    totalTime: number;
    levelId: string;
    // Future fields like: starCount: number, damageTaken: number, etc.
}

export interface InteractionDefinition {
    trigger: ModifierTrigger;
    type: 'scale_bounce' | 'color_flash' | 'none';
    targetScale?: number; // e.g., 1.2 for a 20% grow
    duration?: number;    // in ms
}

export interface PhysicsDefinition {
    isStatic: boolean;
    isSensor: boolean;
    mass?: number;
    friction?: number;
    restitution?: number; // Bounciness
    density?: number;
}

export interface View3DDefinition {
    color?: number;
    colorId?: string;
    colorSlot?: number;
    isSmooth?: boolean;
    opacity?: number;
    // Add textures or glossiness here later
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