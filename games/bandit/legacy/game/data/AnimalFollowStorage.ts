// AnimalFollowStorage.ts
//
// Global, entity-independent "which animals are following the player" list
// — same static-class-+-Signal-+-PlatformHandler shape as BackpackStorage/
// GlobalResourceStorage, capped at MAX_FOLLOWERS. Persists only WHAT is
// following (a plain AnimalType per slot), not a live entity — same "data
// survives, the actual 3D presence gets reconstructed" split every other
// *Storage.ts here uses (see DynamicResourceStorage.ts's own doc). Whoever
// builds the scene (PizzaScene.ts) is expected to read getFollowers() once
// at boot and spawn one AnimalNode per entry, already in follow mode (see
// AnimalNode.startFollowing()) — this file has no idea how to build one.
//
// ALSO tracks the currently-LIVE follower nodes (registerLiveNode()/
// unregisterLiveNode()), unlike a typical *Storage.ts — needed so
// clearAll() (the dev-GUI "Reset Everything" path) can actually despawn
// whatever's following right now, not just wipe the persisted list out
// from under it. Deliberately typed against a minimal structural interface
// (LiveFollowerNode) instead of importing AnimalNode itself — AnimalNode
// already imports THIS file (to register/unregister itself in
// startFollowing()/destroy()), so importing it back here would be a
// circular dependency; duck-typing the one method this file actually calls
// sidesteps that entirely.
//
// load() must be awaited once at boot (see index.ts), before anything
// reads getFollowers().

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { AnimalType } from '../actions/AnimalTypes';

const STORAGE_KEY = 'PIZZA_ANIMAL_FOLLOWERS';

/** How many animals can follow the player at once — AnimalCatchController.ts refuses to even start a capture attempt once this is reached (see its own hasRoom() check). */
export const MAX_FOLLOWERS = 3;

/** What AnimalFollowStorage needs from a live follower entity — see this file's own doc on why this is a structural interface, not an AnimalNode import. `position` is a plain `{x,y,z}` (not a THREE.Vector3 import) on purpose — this file stays engine-agnostic, same "pure data, no engine imports" convention QuestGiverTypes.ts/LootTableTypes.ts already follow; a THREE.Vector3 satisfies this structurally with no cast needed. */
export interface LiveFollowerNode {
    readonly animalType: AnimalType;
    readonly position: { readonly x: number; readonly y: number; readonly z: number };
    /** Called once, right when this follower is DELIVERED (see deliverOneFollowerOfType()) — plays its own departure (tween out, leave the world), same "the caller doesn't need to wait on it" shape releaseFollowing() already has. */
    deliver(): void;
    releaseFollowing(): void;
}

export class AnimalFollowStorage {
    private static followers: AnimalType[] = [];
    /** Currently-live AnimalNode instances actually following right now — NOT persisted, see this file's own doc. */
    private static readonly liveNodes = new Set<LiveFollowerNode>();

    /** Fires whenever the persisted follower list changes (a catch added one, a reset cleared it) — BackpackUI-style follower UI (not built yet — see PizzaScene's own "we'll do the UI later" note) should subscribe to this. */
    static readonly onChange: Signal = new Signal();

    /** Call once at boot (see index.ts), before anything reads getFollowers(). Drops any persisted value that isn't a current AnimalType, same "a save written before a type got renamed shouldn't crash every later reader" reasoning BackpackStorage.load() uses. */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed: unknown = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(parsed)) {
                return;
            }
            const validTypes: ReadonlySet<string> = new Set(Object.values(AnimalType));
            this.followers = parsed.filter((type): type is AnimalType => typeof type === 'string' && validTypes.has(type)).slice(0, MAX_FOLLOWERS);
        } catch (e) {
            console.error('AnimalFollowStorage: failed to load save data', e);
        }
    }

    /** Every animal type currently following, in the order they were caught — a fresh copy, so a caller can't mutate this storage's own state by holding onto the returned array. */
    static getFollowers(): AnimalType[] {
        return [...this.followers];
    }

    static getCount(): number {
        return this.followers.length;
    }

    static hasRoom(): boolean {
        return this.followers.length < MAX_FOLLOWERS;
    }

    /** Reserves a slot for `type` — returns false (no-op) if already full; callers (AnimalCatchController) are expected to check hasRoom() BEFORE even starting a capture attempt, so this failing in practice would mean two capture attempts somehow completed in the same frame. */
    static addFollower(type: AnimalType): boolean {
        if (!this.hasRoom()) {
            return false;
        }
        this.followers.push(type);
        this.onChange.dispatch();
        void this.persist();
        return true;
    }

    /**
     * QueueZone.ts's own animal-delivery path (see that file's own doc on `findAnimalTypeForResource()`)
     * — atomically picks ONE currently-live follower of `animalType`, removes it from BOTH the
     * live-node tracking and the persisted list, fires its own departure (node.deliver()), and
     * returns the WORLD POSITION it departed from (a plain snapshot, not a live reference —
     * `node.position` keeps moving as the entity tweens out) so the caller can fly a purely
     * cosmetic icon from there to wherever it's delivering TO. Returns undefined (no mutation
     * at all) if nothing of that type is currently following — deliberately conservative: this
     * only ever mutates state once a real live node is actually found and handed off, so a
     * persisted/live-tracking mismatch (shouldn't happen — registerLiveNode()/unregisterLiveNode()
     * are wired symmetrically everywhere) can never silently lose a follower without a caller
     * getting credit for it.
     */
    static deliverOneFollowerOfType(animalType: AnimalType): { x: number; y: number; z: number } | undefined {
        for (const node of this.liveNodes) {
            if (node.animalType !== animalType) {
                continue;
            }

            const departedFrom = { x: node.position.x, y: node.position.y, z: node.position.z };
            this.liveNodes.delete(node);
            node.deliver();

            const index = this.followers.indexOf(animalType);
            if (index !== -1) {
                this.followers.splice(index, 1);
            }
            this.onChange.dispatch();
            void this.persist();
            return departedFrom;
        }

        return undefined;
    }

    /** Registers a live AnimalNode as "currently following" — called from AnimalNode.startFollowing(). Purely in-memory (see this file's own doc); a Set naturally dedups a redundant call. */
    static registerLiveNode(node: LiveFollowerNode): void {
        this.liveNodes.add(node);
    }

    /** Un-registers a live node — called from AnimalNode.destroy() (scene teardown/rebuild) so this doesn't accumulate stale references across a scene switch. Does NOT touch the persisted list — a follower's live entity going away on scene teardown doesn't mean the player stopped having it as a pet. */
    static unregisterLiveNode(node: LiveFollowerNode): void {
        this.liveNodes.delete(node);
    }

    private static async persist(): Promise<void> {
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(this.followers));
    }

    /** Debug/dev + "Clear Data" reset — despawns every currently-live follower (see releaseFollowing()), wipes the persisted list, and removes the save entirely. */
    static async clearAll(): Promise<void> {
        for (const node of this.liveNodes) {
            node.releaseFollowing();
        }
        this.liveNodes.clear();
        this.followers = [];
        this.onChange.dispatch();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
