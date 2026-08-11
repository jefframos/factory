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

    /** Fires with the queue id whenever ANYTHING about its state changes — a task rolling, progress ticking, or a task completing into cooldown. See this file's own doc for why one Signal covers all three. */
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
     */
    static tryRollNextTask(id: string, config: QueueConfig): boolean {
        const state = this.state(id);
        if (state.activeTask) {
            return false;
        }
        if (state.nextTaskAtEpochMs !== undefined && Date.now() < state.nextTaskAtEpochMs) {
            return false;
        }
        if (config.possibleTasks.length === 0) {
            return false;
        }

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
