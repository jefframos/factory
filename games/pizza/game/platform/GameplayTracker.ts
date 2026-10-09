// GameplayTracker.ts
//
// The one place that tells the platform when the player is actually PLAYING — Poki's
// gameplayStart() / gameplayStop() (the platform wrappers skip a repeated call themselves).
//
// Gameplay is active once the player has interacted at least once (first tap/click/key after
// the game scene loads — see init()) AND nothing is blocking it: an open popup (PopupManager —
// setPopupOpen()), a tap-to-continue notification (UpgradeNotificationManager), an ad break
// (commercialBreak()) — each reports through setBlocked(). So: first interaction -> start;
// something blocks -> stop; the last blocker goes -> start.
// Camera trips (a build/gate/zone reveal briefly freezing movement) count as gameplay.

import PlatformHandler from 'core/platforms/PlatformHandler';

const INTERACTION_EVENTS = ['pointerdown', 'touchstart', 'keydown'] as const;

export class GameplayTracker {
    private static interacted = false;
    /** Whatever is stopping gameplay right now — see setBlocked(). */
    private static readonly blockers = new Set<string>();
    private static active = false;
    private static listening = false;

    private static readonly handleFirstInteraction = (): void => {
        GameplayTracker.stopListening();
        GameplayTracker.interacted = true;
        GameplayTracker.refresh();
    };

    /** Call once the game scene is up (see PizzaScene's constructor) — gameplay starts on the next tap/click/key. */
    static init(): void {
        if (this.interacted || this.listening) {
            return;
        }
        this.listening = true;
        for (const type of INTERACTION_EVENTS) {
            window.addEventListener(type, this.handleFirstInteraction, { capture: true });
        }
    }

    /** PopupManager: a popup opened (true) / the last one closed (false). */
    static setPopupOpen(open: boolean): void {
        this.setBlocked('popup', open);
    }

    /** Something (`reason`) stops gameplay (true) / no longer does (false) — gameplay resumes once no reason is left. */
    static setBlocked(reason: string, blocked: boolean): void {
        if (blocked) {
            this.blockers.add(reason);
        } else {
            this.blockers.delete(reason);
        }
        this.refresh();
    }

    /**
     * A natural break — the platform may show an ad (Poki commercialBreak(); the platform decides
     * whether one actually plays, and how often). Gameplay is reported stopped for its whole
     * length, as the platform requires. Never throws; resolves once the game may continue.
     */
    static async commercialBreak(): Promise<void> {
        const platform = PlatformHandler.instance.platform;
        if (!platform) {
            return;
        }
        this.setBlocked('commercialBreak', true);
        try {
            await platform.showCommercialBreak();
        } catch (e) {
            console.warn('[GameplayTracker] commercial break failed', e);
        } finally {
            this.setBlocked('commercialBreak', false);
        }
    }

    /** Scene teardown — stops listening and reports gameplay stopped. */
    static destroy(): void {
        this.stopListening();
        this.interacted = false;
        this.refresh();
    }

    private static stopListening(): void {
        if (!this.listening) {
            return;
        }
        this.listening = false;
        for (const type of INTERACTION_EVENTS) {
            window.removeEventListener(type, this.handleFirstInteraction, { capture: true });
        }
    }

    private static refresh(): void {
        const shouldBeActive = this.interacted && this.blockers.size === 0;
        if (shouldBeActive === this.active) {
            return;
        }
        this.active = shouldBeActive;
        const platform = PlatformHandler.instance.platform;
        if (!platform) {
            return;
        }
        PlatformHandler.instance.isGameplayActive = shouldBeActive;
        const call = shouldBeActive ? platform.gameplayStart() : platform.gameplayStop();
        void call?.catch?.(e => console.warn('[GameplayTracker] platform gameplay call failed', e));
    }
}
