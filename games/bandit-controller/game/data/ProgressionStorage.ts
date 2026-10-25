export const PROGRESSION_STORAGE_KEYS = [
    'bandit-controller.levelProgress',
    'bandit-controller.completedLevels',
    'bandit-controller.stars',
    'bandit-controller.money',
    'bandit-controller.wardrobe',
    'bandit-controller.squadLook',
    'bandit-controller.daily',
] as const;

/** Reload after resetting so cached money and equipped squad looks return to their defaults. */
export function resetProgressionData(storage: Pick<Storage, 'removeItem'> = window.localStorage): void {
    for (const key of PROGRESSION_STORAGE_KEYS) {
        storage.removeItem(key);
    }
}
