// BackpackUnlockStorage.ts
//
// Persists two one-time flags for BackpackButton.ts's own "hidden until the player's first
// tool" behavior — same static-class + PlatformHandler persistence shape as
// TutorialProgressStorage.ts, just a plain boolean pair instead of a per-zone count map:
//
// - `unlocked`: the backpack icon itself starts hidden (a brand new player has NO tools —
//   see ItemStorage.ts's own doc — so there's nothing to open the popup FOR yet) and is
//   revealed the first time ItemStorage.hasAny() goes true. Sticky forever once set — even if
//   every tool were somehow lost again, the icon shouldn't vanish, since the player already
//   knows the system exists.
// - `badgeSeen`: the Icon_Exclamation "something new" badge on top of the icon (see
//   BackpackButton.ts) — shown alongside `unlocked` turning true, cleared the first time the
//   player actually opens the popup, and never shown again after that even across reloads.
//
// load() must be awaited once at boot (see index.ts), before BackpackButton reads
// isUnlocked()/hasSeenBadge().

import PlatformHandler from 'core/platforms/PlatformHandler';

const STORAGE_KEY = 'PIZZA_BACKPACK_UNLOCK';

interface BackpackUnlockData {
    unlocked: boolean;
    badgeSeen: boolean;
}

export class BackpackUnlockStorage {
    private static unlocked = false;
    private static badgeSeen = false;

    /** Call once at boot (see index.ts), before anything reads isUnlocked()/hasSeenBadge(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            if (!raw) {
                return;
            }
            const parsed: Partial<BackpackUnlockData> = JSON.parse(raw);
            this.unlocked = parsed.unlocked === true;
            this.badgeSeen = parsed.badgeSeen === true;
        } catch (e) {
            console.error('BackpackUnlockStorage: failed to load save data', e);
        }
    }

    static isUnlocked(): boolean {
        return this.unlocked;
    }

    /** Reveals the backpack icon for good, and arms its "something new" badge — a no-op once already unlocked (see this file's own doc on why it's sticky), so calling it again on a later tool doesn't re-arm the badge. */
    static markUnlocked(): void {
        if (this.unlocked) {
            return;
        }
        this.unlocked = true;
        this.badgeSeen = false;
        void this.persist();
    }

    static hasSeenBadge(): boolean {
        return this.badgeSeen;
    }

    /** Called the first time the player actually opens the backpack popup — permanently dismisses the "something new" badge. */
    static markBadgeSeen(): void {
        if (this.badgeSeen) {
            return;
        }
        this.badgeSeen = true;
        void this.persist();
    }

    private static async persist(): Promise<void> {
        const data: BackpackUnlockData = { unlocked: this.unlocked, badgeSeen: this.badgeSeen };
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /** Debug/dev reset — same convention as every other *Storage.ts's own clearAll(). */
    static async clearAll(): Promise<void> {
        this.unlocked = false;
        this.badgeSeen = false;
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
