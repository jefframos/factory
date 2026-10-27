export const PROGRESSION_STORAGE_KEYS = [
    'bandit-controller.levelProgress',
    'bandit-controller.completedLevels',
    'bandit-controller.unlockAll',
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

/** Reloads into Home (dropping ?level/?scene/?minigame) so every cached value restarts from storage. */
export function reloadToHome(): void {
    const url = new URL(window.location.href);
    for (const key of ['level', 'scene', 'minigame']) {
        url.searchParams.delete(key);
    }
    window.location.assign(url.href);
}
