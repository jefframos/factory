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
    modifier?: ModifierDescriptor;
    layer?: number;
}

export interface LevelSnapshot {
    totalTime: number;
    levelId: string;
    // Future fields like: starCount: number, damageTaken: number, etc.
}

export type ModifierType = 'boost' | 'trampoline' | 'bouncer';

export enum ModifierTrigger {
    ON_START = 'start',   // Once when entering
    ON_ACTIVE = 'active', // Every frame while inside
    ON_END = 'end'        // Once when leaving
}

export interface ModifierDescriptor {
    type: 'boost' | 'trampoline' | 'bouncer';
    trigger: ModifierTrigger;
    force?: number;
    direction?: { x: number, y: number };
}

export interface LevelConfig {
    id: string;
    spawnPoint: { x: number, y: number };
    objects: LevelObject[];
}