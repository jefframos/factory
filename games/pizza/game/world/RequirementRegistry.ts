// RequirementRegistry.ts
//
// The centralized piece of the shared requirement system — see
// MilestoneRequirement.ts for the DATA half (what a requirement actually
// checks: a building level, an owned item, a held resource amount). This
// file is the BEHAVIOR half: what happens once a requirement is met, for
// the two shapes that behavior comes in across every gated entity type in
// this game today (queue/shop/building appearing vs. a gate unlocking-and-
// vanishing) — and, by construction, for any FUTURE entity type too,
// without this file (or MilestoneRequirement.ts) ever needing to change.
//
// Two roles, both just (requirement, callback) pairs:
//
//   - SPAWN GATE — the entity doesn't exist in the world yet. Once its
//     requirement is met, spawn() fires exactly once, forever. This is
//     QueueZone's/ShopZone's/BuildingZone's own "should this even appear"
//     check — see PizzaScene.setupQueues()/setupShops()/setupBuildingZone().
//     A spawn gate with no requirement at all fires immediately on
//     registration, so a caller doesn't need an `if (requirement)` branch
//     of its own — registering unconditionally is always correct.
//
//   - UNLOCK GATE — the entity ALREADY exists in the world, blocking
//     something. Once its requirement is met, unlock() fires exactly once
//     (typically an async camera-visit-and-collapse sequence — see
//     Gate.playUnlockSequence()), and the caller is expected to remove the
//     entity from the world inside that same callback. Unlock gates are
//     processed strictly ONE AT A TIME, in registration order, so two
//     unlocking at once never fight over the same camera.
//
// Neither role is checked continuously — recheckAll() is called from
// PizzaScene's WorldProgressionHost implementation (notifyBuildingLevelUp()/
// notifyItemCrafted()), i.e. right after whatever TRIGGERED the milestone
// has already finished its own camera sequence. That ordering (not a timer,
// not a direct Storage subscription here) is what keeps a building's own
// level-up camera trip from ever overlapping a gate's unlock trip — see
// WorldProgressionHost.ts's own doc.
//
// NOT every gated entity type goes through this registry — CraftZone.ts's
// craft tables have their own destroy-and-respawn lifecycle ("Clear Data"
// can wipe a fully-crafted, self-destroyed table back to nothing crafted
// and expects setupCraftTables() to rebuild it), which conflicts with a
// spawn gate's "fires once, forever" contract. PizzaScene.setupCraftTables()
// instead calls MilestoneRequirement.ts's isMilestoneRequirementMet()
// directly, inline, in its own already-idempotent, already-re-callable
// setup loop — same requirement DATA and CHECK function, just without this
// registry's one-shot bookkeeping. See that method's own doc.

import { isMilestoneRequirementMet, MilestoneRequirement } from '../data/MilestoneRequirement';

interface SpawnGateEntry {
    readonly id: string;
    readonly requirement?: MilestoneRequirement;
    readonly spawn: () => void;
    spawned: boolean;
}

interface UnlockGateEntry {
    readonly id: string;
    readonly requirement: MilestoneRequirement;
    readonly unlock: () => Promise<void>;
    unlocked: boolean;
}

export default class RequirementRegistry {
    private readonly spawnGates: SpawnGateEntry[] = [];
    private readonly unlockGates: UnlockGateEntry[] = [];

    /**
     * Registers a spawn gate and immediately tries it — see this file's own doc. `id` is only
     * used for future debugging/logging (e.g. "queue1"); nothing here keys off it. Safe to
     * call for an entity with NO requirement at all (`requirement` undefined) — it just spawns
     * right away, same as if the caller had skipped the registry entirely, so every caller can
     * register unconditionally rather than branching on whether it has a requirement.
     */
    public registerSpawnGate(id: string, requirement: MilestoneRequirement | undefined, spawn: () => void): void {
        const entry: SpawnGateEntry = { id, requirement, spawn, spawned: false };
        this.spawnGates.push(entry);
        this.trySpawn(entry);
    }

    /**
     * Registers an unlock gate — see this file's own doc. Unlike registerSpawnGate(), this
     * does NOT immediately check the requirement: an unlock gate's caller (Gate.ts via
     * PizzaScene.setupGates()) is expected to have already handled the "requirement was
     * already met before this was ever registered" catch-up case itself (unlocking silently,
     * with no camera trip, since there's no live event to dramatize) — see setupGates()'s own
     * doc. Only register here once that catch-up check has already come back false.
     */
    public registerUnlockGate(id: string, requirement: MilestoneRequirement, unlock: () => Promise<void>): void {
        this.unlockGates.push({ id, requirement, unlock, unlocked: false });
    }

    /**
     * The one entry point PizzaScene's WorldProgressionHost implementation calls after any
     * milestone's own event has settled — tries every not-yet-spawned spawn gate (cheap,
     * synchronous), then processes every not-yet-unlocked unlock gate whose requirement is now
     * met, ONE AT A TIME in registration order (see this file's own doc for why sequential
     * matters). A gate that isn't met yet is just skipped, not an error — it'll be tried again
     * on the next call.
     */
    public async recheckAll(): Promise<void> {
        this.trySpawnAll();

        for (const entry of this.unlockGates) {
            if (entry.unlocked || !isMilestoneRequirementMet(entry.requirement)) {
                continue;
            }
            entry.unlocked = true;
            await entry.unlock();
        }
    }

    private trySpawnAll(): void {
        for (const entry of this.spawnGates) {
            this.trySpawn(entry);
        }
    }

    private trySpawn(entry: SpawnGateEntry): void {
        if (entry.spawned || (entry.requirement && !isMilestoneRequirementMet(entry.requirement))) {
            return;
        }
        entry.spawned = true;
        entry.spawn();
    }
}
