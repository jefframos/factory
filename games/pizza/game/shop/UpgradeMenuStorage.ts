// UpgradeMenuStorage.ts
//
// The upgrades menu's own saved flags (see UpgradeMenu.ts) — not the levels themselves, those are
// ShopUpgradeStorage's:
//   unlocked    — the bottom-left backpack button has appeared (sticky: it never hides again);
//   lessonDone  — the first purchase (the backpack) has been made, so the "buy this" hand is gone;
//   seen        — menu entries the player has already seen with the menu open; anything visible
//                 but not in here wears a NEW tag and keeps the button's "!" up.
// Same "static class + PlatformHandler persistence" shape as BackpackUnlockStorage.ts.

import PlatformHandler from 'core/platforms/PlatformHandler';

const STORAGE_KEY = 'PIZZA_UPGRADE_MENU';

interface UpgradeMenuData {
    unlocked: boolean;
    lessonDone: boolean;
    seen: string[];
}

export class UpgradeMenuStorage {
    private static unlocked = false;
    private static lessonDone = false;
    private static readonly seen = new Set<string>();

    /** Call once at boot (see index.ts). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            if (!raw) {
                return;
            }
            const parsed: Partial<UpgradeMenuData> = JSON.parse(raw);
            this.unlocked = parsed.unlocked === true;
            this.lessonDone = parsed.lessonDone === true;
            for (const id of Array.isArray(parsed.seen) ? parsed.seen : []) {
                this.seen.add(String(id));
            }
        } catch (e) {
            console.error('UpgradeMenuStorage: failed to load save data', e);
        }
    }

    static isUnlocked(): boolean {
        return this.unlocked;
    }

    static markUnlocked(): void {
        if (!this.unlocked) {
            this.unlocked = true;
            void this.persist();
        }
    }

    static isLessonDone(): boolean {
        return this.lessonDone;
    }

    static markLessonDone(): void {
        if (!this.lessonDone) {
            this.lessonDone = true;
            void this.persist();
        }
    }

    static hasSeen(shopId: string): boolean {
        return this.seen.has(shopId);
    }

    static markSeen(shopIds: readonly string[]): void {
        const before = this.seen.size;
        shopIds.forEach(id => this.seen.add(id));
        if (this.seen.size !== before) {
            void this.persist();
        }
    }

    private static async persist(): Promise<void> {
        const data: UpgradeMenuData = { unlocked: this.unlocked, lessonDone: this.lessonDone, seen: [...this.seen] };
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /** Debug/dev reset — same convention as every other *Storage.ts's own clearAll(). */
    static async clearAll(): Promise<void> {
        this.unlocked = false;
        this.lessonDone = false;
        this.seen.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
