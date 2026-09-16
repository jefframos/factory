// TriggerStorage.ts
//
// Persists WHICH trigger ids (see TriggerTypes.ts/Trigger.ts) the player has ever walked into —
// a plain activated/not-activated set, no config or effect of its own. This is deliberately the
// ONLY thing a Trigger entity itself knows how to do: mark its own id activated. What that
// activation actually MEANS (unlock zone 2, open gate3, ...) lives entirely on the CONSUMER
// side, as a new 'trigger' MilestoneRequirement kind (see MilestoneRequirement.ts) that reads
// isActivated() here — same "requirement DATA is separate from the BEHAVIOR it triggers" split
// RequirementRegistry.ts's own doc describes for every other milestone kind. This is what lets
// a Zone's "Has Requirement" AND a Gate's own requirement both use a trigger interchangeably
// with a building/item/resource/gate requirement, with zero trigger-specific code in either.
//
// Same static-class + PlatformHandler persistence shape as every other *Storage.ts here.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';

const STORAGE_KEY = 'PIZZA_TRIGGERS';

export class TriggerStorage {
    private static activated = new Set<string>();

    /** Dispatches the trigger id the instant activate() actually changes anything (never for an already-activated id re-firing — same "only the real transition" convention GateStorage.onUnlock follows) — ZoneTutorialController's own 'trigger' step subscribes to this for completion, same as it does GateStorage.onUnlock for a 'gate' step. */
    static readonly onActivate: Signal = new Signal();

    /** Call once at boot (see index.ts), before anything reads isActivated(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            if (!raw) {
                return;
            }
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                this.activated = new Set(parsed);
            }
        } catch (e) {
            console.error('TriggerStorage: failed to load save data', e);
        }
    }

    static isActivated(id: string): boolean {
        return this.activated.has(id);
    }

    /** No-op (and doesn't re-persist) if `id` was already activated — same idempotent convention Trigger.ts's own destroyOnTrigger:false re-entry relies on elsewhere. */
    static activate(id: string): void {
        if (this.activated.has(id)) {
            return;
        }
        this.activated.add(id);
        void this.persist();
        this.onActivate.dispatch(id);
    }

    private static async persist(): Promise<void> {
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify([...this.activated]));
    }

    /** Debug/dev reset — see other *Storage.ts's own clearAll(). */
    static async clearAll(): Promise<void> {
        this.activated = new Set();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
