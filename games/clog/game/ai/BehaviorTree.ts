export enum NodeStatus {
    Success = "success",
    Failure = "failure",
    Running = "running",
}

export interface BTNode<C> {
    tick(ctx: C): NodeStatus;
    /** Called when this node stops being the active branch while Running (e.g. a Selector moved on). Optional cleanup hook. */
    reset?(): void;
}

/**
 * Ticks children in order and returns the first non-Failure result — i.e.
 * "try each option until one works." Fails only if every child fails.
 */
export class Selector<C> implements BTNode<C> {
    private runningChild: BTNode<C> | null = null;

    constructor(private children: BTNode<C>[]) { }

    tick(ctx: C): NodeStatus {
        for (const child of this.children) {
            const status = child.tick(ctx);
            if (status === NodeStatus.Running) {
                if (this.runningChild && this.runningChild !== child) this.runningChild.reset?.();
                this.runningChild = child;
                return NodeStatus.Running;
            }
            if (status === NodeStatus.Success) {
                this.runningChild = null;
                return NodeStatus.Success;
            }
        }
        this.runningChild = null;
        return NodeStatus.Failure;
    }

    reset(): void {
        this.runningChild?.reset?.();
        this.runningChild = null;
    }
}

/**
 * Ticks children in order and requires every one to succeed — i.e. "do this,
 * then this, then this." Fails as soon as one child fails.
 */
export class Sequence<C> implements BTNode<C> {
    private index = 0;

    constructor(private children: BTNode<C>[]) { }

    tick(ctx: C): NodeStatus {
        while (this.index < this.children.length) {
            const status = this.children[this.index].tick(ctx);
            if (status === NodeStatus.Running) return NodeStatus.Running;
            if (status === NodeStatus.Failure) {
                this.index = 0;
                return NodeStatus.Failure;
            }
            this.index++;
        }
        this.index = 0;
        return NodeStatus.Success;
    }

    reset(): void {
        this.children[this.index]?.reset?.();
        this.index = 0;
    }
}

/** Inverts Success <-> Failure; passes Running through unchanged. */
export class Inverter<C> implements BTNode<C> {
    constructor(private child: BTNode<C>) { }

    tick(ctx: C): NodeStatus {
        const status = this.child.tick(ctx);
        if (status === NodeStatus.Success) return NodeStatus.Failure;
        if (status === NodeStatus.Failure) return NodeStatus.Success;
        return NodeStatus.Running;
    }

    reset(): void { this.child.reset?.(); }
}

/** Leaf that evaluates a side-effect-free predicate. Never returns Running. */
export class Condition<C> implements BTNode<C> {
    constructor(private predicate: (ctx: C) => boolean) { }

    tick(ctx: C): NodeStatus {
        return this.predicate(ctx) ? NodeStatus.Success : NodeStatus.Failure;
    }
}

/** Leaf that runs a one-shot or multi-tick action and reports its own status. */
export class Action<C> implements BTNode<C> {
    constructor(private fn: (ctx: C) => NodeStatus) { }

    tick(ctx: C): NodeStatus {
        return this.fn(ctx);
    }
}
