import data from '../../ui/worldstyles.json';

export type StyleCategory = 'floor' | 'wall' | 'door' | 'window' | 'ground' | 'path';

export interface FloorStyle { name?: string; colorA: string; colorB: string; checkerScale: number }
export interface WallStyle { name?: string; bottomColor: string; topColor: string; bottomHeight: number; height: number; thickness: number }
export interface DoorStyle { name?: string; color: string; opacity: number; model?: string }
export interface WindowStyle { name?: string; color: string; opacity: number }
export interface GroundStyle { name?: string; color: string }
export interface PathStyle { name?: string; color: string }

export interface StyleMap {
    floor: FloorStyle;
    wall: WallStyle;
    door: DoorStyle;
    window: WindowStyle;
    ground: GroundStyle;
    path: PathStyle;
}

/** Style ids a level uses; unset ids fall back to the first style of that category. */
export type LevelStyles = Partial<Record<StyleCategory, string>>;

const sets = data as unknown as { [K in StyleCategory]: Record<string, StyleMap[K]> };

export const WorldStyles = {
    get<K extends StyleCategory>(category: K, id?: string): StyleMap[K] {
        const set = sets[category];
        return (id && set[id]) || Object.values(set)[0];
    },
};
