// QueueStorage.ts
//
// Global, entity-independent queue task progression — same "static class +
// Signal + PlatformHandler persistence" shape as BuildingStorage.ts, but
// keyed by a plain STRING id (whatever's drawn on the Tiled map — see
// WorldObjectRegistry.getAllOfType()/QueueTypes.ts's own doc) rather than a
// fixed enum. Tracks, per queue id: the currently active task (if any) and
// progress toward it, or the epoch-ms timestamp the next task becomes
// available at once the current one completes.
//
// One Signal (onTaskChanged) rather than BuildingStorage's separate
// onProgressChanged/onLevelUp pair — a queue's states (task rolled, progress
// ticked, task completed → cooldown started) all resolve to the exact same
// caller reaction (QueueZone.refreshLabel()), so there's no reason to make
// callers distinguish them.
//
// load() must be awaited once at boot (see index.ts) before anything reads
// getState(). Every mutation fires an async persist() (fire-and-forget, same
// convention as every other *Storage.ts here) so a queue's per-unit deposits
// never block on storage I/O.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { QueueConfig, QueueTaskDef } from './QueueTypes';

const STORAGE_KEY = 'PIZZA_QUEUES';

interface QueueState {
    activeTask?: QueueTaskDef;
    /** Progress toward activeTask's amount — reset to 0 whenever a new task rolls. Meaningless while activeTask is undefined. */
    progress: number;
    /** Epoch ms the next task becomes available at — undefined while a task is active, or for a queue that has never completed one yet (see tryRollNextTask(), which treats "never set" the same as "already passed"). */
    nextTaskAtEpochMs?: number;
}

function createDefaultState(): QueueState {
    return { progress: 0 };
}

export class QueueStorage {
    private static readonly states = new Map<string, QueueState>();
    /**
     * Which giver-driven queues currently have their QuestGiverEntity PHYSICALLY AT the queue
     * (see that file's own doc) — in-memory only, deliberately never persisted. Presence is a
     * pure runtime fact the giver re-establishes itself every time the scene builds (it always
     * starts its walk fresh from the far waypoint), not state that should survive a reload —
     * unlike `activeTask`/`progress`, which SHOULD survive one. A queue with no giver at all
     * never touches this Set; see QueueZone's own `autoRollTasks`-gated checks, which only
     * consult isGiverPresent() when it actually has one.
     */
    private static readonly giverPresent = new Set<string>();

    /** Fires with the queue id whenever ANYTHING about its state changes — a task rolling, progress ticking, a task completing into cooldown, or a giver arriving/leaving. See this file's own doc for why one Signal covers all of it. */
    static readonly onTaskChanged: Signal = new Signal();

    /** Call once at boot (see index.ts), before anything reads getState(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed: Record<string, QueueState> = raw ? JSON.parse(raw) : {};
            for (const [id, state] of Object.entries(parsed)) {
                if (state && typeof state.progress === 'number') {
                    this.states.set(id, { activeTask: state.activeTask, progress: state.progress, nextTaskAtEpochMs: state.nextTaskAtEpochMs });
                }
            }
        } catch (e) {
            console.error('QueueStorage: failed to load save data', e);
        }
    }

    private static state(id: string): QueueState {
        let state = this.states.get(id);
        if (!state) {
            state = createDefaultState();
            this.states.set(id, state);
        }
        return state;
    }

    /** Read-only snapshot of `id`'s current state — QueueZone reads this every frame/on every onTaskChanged to decide what its panel should show. */
    static getState(id: string): Readonly<QueueState> {
        return this.state(id);
    }

    /**
     * If `id` has no active task AND its cooldown has passed (or it's never had one at all —
     * a brand-new queue's `nextTaskAtEpochMs` starts undefined, treated the same as "already
     * passed" so it gets a task immediately rather than waiting through a phantom cooldown),
     * rolls a random task from `config.possibleTasks` and makes it active. Returns whether it
     * actually rolled one — cheap enough to call unconditionally every frame (see QueueZone.
     * update()); a no-op the overwhelming majority of those calls.
     *
     * This is the TIME-gated path — for a queue whose pacing is instead driven by a
     * QuestGiverEntity walking a waypoint path in/out (see that file's own doc), use
     * startTaskNow() instead, which ignores `nextTaskAtEpochMs` entirely; QueueZone only calls
     * this one when it has no such giver (see its own `autoRollTasks` constructor param).
     */
    static tryRollNextTask(id: string, config: QueueConfig): boolean {
        const state = this.state(id);
        if (state.activeTask) {
            return false;
        }
        if (state.nextTaskAtEpochMs !== undefined && Date.now() < state.nextTaskAtEpochMs) {
            return false;
        }

        return this.rollTask(id, config);
    }

    /**
     * Rolls a new task immediately, ignoring `nextTaskAtEpochMs` entirely — the ONLY
     * requirement is that `id` doesn't already have an active task. Used by QuestGiverEntity
     * once it physically arrives at the queue (order-0 waypoint): for a giver-driven queue,
     * ARRIVAL is what makes a task available, not a timer — see this file's own doc and
     * tryRollNextTask()'s. Returns whether it actually rolled one, same convention as
     * tryRollNextTask() (false if a task was already active, or `config.possibleTasks` is
     * empty).
     */
    static startTaskNow(id: string, config: QueueConfig): boolean {
        const state = this.state(id);
        if (state.activeTask) {
            return false;
        }

        return this.rollTask(id, config);
    }

    /**
     * Marks whether `id`'s QuestGiverEntity is physically standing at the queue right now —
     * called from that entity's own arrival/departure handlers, never from QueueZone directly.
     * A queue's task can exist (activeTask set, progress persisted) WITHOUT its giver being
     * present at all — e.g. right after a page reload, before the freshly-respawned giver has
     * finished walking back in — and QueueZone must not let the player deliver into (or even
     * see the panel for) a task the giver hasn't actually brought yet. Fires onTaskChanged so
     * QueueZone's panel visibility updates the instant presence changes, same as every other
     * state change here.
     */
    static setGiverPresent(id: string, present: boolean): void {
        if (present) {
            this.giverPresent.add(id);
        } else {
            this.giverPresent.delete(id);
        }
        this.onTaskChanged.dispatch(id);
    }

    /** See setGiverPresent()'s own doc. Always false for a queue that never calls setGiverPresent() at all (no giver) — QueueZone only consults this when it actually has one. */
    static isGiverPresent(id: string): boolean {
        return this.giverPresent.has(id);
    }

    /** Shared by tryRollNextTask()/startTaskNow() — both have already confirmed `id` has no active task; this just picks one and makes it active. */
    private static rollTask(id: string, config: QueueConfig): boolean {
        if (config.possibleTasks.length === 0) {
            return false;
        }

        const state = this.state(id);
        const task = config.possibleTasks[Math.floor(Math.random() * config.possibleTasks.length)];
        state.activeTask = task;
        state.progress = 0;
        state.nextTaskAtEpochMs = undefined;
        this.onTaskChanged.dispatch(id);
        void this.persist();
        return true;
    }

    /**
     * Credits `amount` toward `id`'s active task, capped so progress never exceeds what the
     * task actually asks for — returns how much was actually accepted (<= amount), same
     * convention as BuildingStorage.addProgress(), so a caller draining a backpack one unit at
     * a time (see QueueZone) knows exactly how much to remove from wherever it came from.
     * No-ops (returns 0) if there's no active task at all.
     */
    static addProgress(id: string, amount: number): number {
        if (amount <= 0) {
            return 0;
        }

        const state = this.state(id);
        const task = state.activeTask;
        if (!task) {
            return 0;
        }

        const accepted = Math.min(amount, task.amount - state.progress);
        if (accepted <= 0) {
            return 0;
        }

        state.progress += accepted;
        this.onTaskChanged.dispatch(id);
        void this.persist();
        return accepted;
    }

    /**
     * Completes `id`'s active task once its full amount has been delivered — clears the
     * active task and starts the cooldown (`nextTaskAtEpochMs = now + config.cooldownSec *
     * 1000`), returning the just-completed task (undefined if it isn't actually fully
     * delivered yet, so a caller can call this unconditionally right after crediting progress
     * and just check the return value — same convention as BuildingStorage.tryCompleteLevel(),
     * just returning the task instead of a bare boolean).
     *
     * Deliberately does NOT credit the reward itself — see QueueZone.flyInResource()'s own
     * doc: the caller flies a money icon to EconomyUI's wallet first and only credits
     * EconomyStorage on ARRIVAL, same "storage mutates when the icon lands, not when it
     * departs" convention every other deposit flow in this game already follows.
     */
    static tryCompleteTask(id: string, config: QueueConfig): QueueTaskDef | undefined {
        const state = this.state(id);
        const task = state.activeTask;
        if (!task || state.progress < task.amount) {
            return undefined;
        }

        state.activeTask = undefined;
        state.progress = 0;
        state.nextTaskAtEpochMs = Date.now() + config.cooldownSec * 1000;
        this.onTaskChanged.dispatch(id);
        void this.persist();
        return task;
    }

    private static async persist(): Promise<void> {
        const data: Record<string, QueueState> = Object.fromEntries(this.states);
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /** Debug/dev reset — wipes every queue back to no-task/no-cooldown, notifies subscribers, and removes the persisted save entirely. */
    static async clearAll(): Promise<void> {
        for (const id of this.states.keys()) {
            this.states.set(id, createDefaultState());
            this.onTaskChanged.dispatch(id);
        }
        this.states.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
