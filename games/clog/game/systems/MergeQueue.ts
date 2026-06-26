interface MergeTask {
    duration: number;
    elapsed: number;
    /** Called once when the task becomes active, before the first onProgress call. */
    onStart?: (task: MergeTask) => void;
    onProgress: (t: number) => void;
    onDone: () => void;
}

/**
 * Frame-update-driven sequential task queue for merge animations.
 *
 * - Tasks run one at a time, advancing via `update(delta)`.
 * - `clear()` snaps all queued and active tasks to completion (t=1),
 *   which also resolves any cascades triggered in `onDone` callbacks.
 * - `destroy()` discards everything without firing any callbacks.
 */
export class MergeQueue {
    private queue: MergeTask[] = [];
    private active: MergeTask | null = null;

    enqueue(task: Omit<MergeTask, "elapsed">): void {
        this.queue.push({ ...task, elapsed: 0 });
        if (!this.active) this.next();
    }

    update(delta: number): void {
        if (!this.active) return;
        this.active.elapsed += delta;
        const t = Math.min(1, this.active.elapsed / this.active.duration);
        this.active.onProgress(t);
        if (t >= 1) {
            this.active.onDone();
            this.active = null;
            this.next();
        }
    }

    /**
     * Snap all pending merges to their final state synchronously.
     * Cascades triggered by `onDone` callbacks are also resolved.
     */
    clear(): void {
        while (this.active || this.queue.length > 0) {
            if (this.active) {
                const task = this.active;
                this.active = null;
                task.onProgress(1);
                task.onDone(); // may enqueue more tasks → next() sets this.active
            }
            // drain any non-active queue items
            while (this.queue.length > 0 && !this.active) {
                const task = this.queue.shift()!;
                task.onStart?.(task); // initialize before snapping
                task.onProgress(1);
                task.onDone();
            }
        }
    }

    /** Discard everything without invoking any callbacks. */
    destroy(): void {
        this.active = null;
        this.queue = [];
    }

    get isEmpty(): boolean {
        return !this.active && this.queue.length === 0;
    }

    private next(): void {
        if (this.queue.length > 0) {
            this.active = this.queue.shift()!;
            this.active.onStart?.(this.active);
        }
    }
}
