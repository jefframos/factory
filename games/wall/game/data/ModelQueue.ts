// ModelQueue.ts
//
// The models that come after the game's begun, one at a time (nothing in the way of what's being played): whatever's wanted
// first of what isn't there yet, asked again each time, as what's wanted changes wall by wall.

export interface ModelWant {
    /** What it is: got once. */
    key: string;
    get(): Promise<void>;
}

/** One that can't be had is let go after this many tries. */
const TRIES = 2;

export class ModelQueue {
    private readonly got = new Map<string, Promise<void>>();
    private readonly failed = new Map<string, number>();
    private busy = false;

    /** `wants`: all there's to get, the soonest needed first. */
    public constructor(private readonly wants: () => ModelWant[]) {}

    /** These at once (what's needed before anything's seen). */
    public async now(wants: ModelWant[]): Promise<void> {
        await Promise.all(wants.map((want) => this.take(want)));
    }

    /** On to the next one, if there's one to get. */
    public async check(): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        for (let next = this.next(); next; next = this.next()) await this.take(next);
        this.busy = false;
    }

    private next(): ModelWant | undefined {
        return this.wants().find(({ key }) => !this.got.has(key) && (this.failed.get(key) ?? 0) < TRIES);
    }

    private take({ key, get }: ModelWant): Promise<void> {
        const there = this.got.get(key);
        if (there) return there;
        const taken = get().catch((error) => {
            console.warn(`[ModelQueue] ${key} could not load`, error);
            this.failed.set(key, (this.failed.get(key) ?? 0) + 1);
            this.got.delete(key);
        });
        this.got.set(key, taken);
        return taken;
    }
}
