// Board.ts
//
// The game's rules, with no drawing: the picture as a grid of colours that ants eat away.
//
// - A pixel is **exposed** when it's on the picture's edge (any side: the ants walk round the tray) or next to (left,
//   right, above or below) a pixel already taken: the picture is eaten from its outline inwards.
// - An ant takes one exposed pixel of its colour; it **claims** it first (so two ants never go for the same one) and
//   it's gone once the ant reaches it, which may expose the ones around it.
//
// The deck (dealDeck) — the coloured tiles under the slots, each a colour and how many ants (pixels) it holds — is made
// by playing the picture out with these same rules: each tile takes pixels of a colour that can actually be reached by
// then. So taking the tiles in the order they were dealt always clears the picture; the slots give room to play them in
// another order, and the wrong order is how a level is lost.

/** One coloured tile: its palette colour and how many pixels (ants) it holds. */
export interface Tile {
    color: number;
    count: number;
    /** A hidden tile (level 8 on): face down, a ?, until it reaches the front row. */
    hidden?: boolean;
    /** A locked tile (level 12 on): it can't be taken until this many tiles have been, in all. */
    lockAt?: number;
}

export class Board {
    /** Each pixel's palette colour, or -1 once taken. */
    public readonly colors: Int8Array;
    /** Pixels an ant is on its way to. */
    public readonly claimed: Uint8Array;
    public remaining: number;

    public constructor(public readonly width: number, public readonly height: number, pixels: Int8Array) {
        this.colors = Int8Array.from(pixels);
        this.claimed = new Uint8Array(pixels.length);
        // Empty cells (a transparent part of the picture: -1) count as taken from the start: open ground for the ants.
        this.remaining = pixels.reduce((count, c) => count + (c >= 0 ? 1 : 0), 0);
    }

    public clone(): Board {
        return new Board(this.width, this.height, this.colors);
    }

    /** On the picture's edge, or next to a pixel already taken. */
    public exposed(i: number): boolean {
        if (this.colors[i] < 0) return false;
        const x = i % this.width;
        const y = Math.floor(i / this.width);
        if (this.onEdge(i)) return true;
        return (x > 0 && this.colors[i - 1] < 0) || (x < this.width - 1 && this.colors[i + 1] < 0)
            || (y > 0 && this.colors[i - this.width] < 0) || this.colors[i + this.width] < 0;
    }

    /** Exposed pixels of a colour no ant is on its way to. */
    public claimable(color: number): number[] {
        const found: number[] = [];
        for (let i = 0; i < this.colors.length; i++) {
            if (this.colors[i] === color && !this.claimed[i] && this.exposed(i)) found.push(i);
        }
        return found;
    }

    public claim(i: number): void {
        this.claimed[i] = 1;
    }

    /** An ant reached it: the pixel is gone. */
    public take(i: number): void {
        if (this.colors[i] < 0) return;
        this.colors[i] = -1;
        this.claimed[i] = 0;
        this.remaining--;
    }

    /**
     * The pixels of a colour that can be taken, in order, by taking only that colour from now on (each one taken may
     * expose more of the same colour): how far a tile of that colour can get on its own.
     */
    public reachable(color: number): number[] {
        const board = this.clone();
        const order: number[] = [];
        let frontier = board.claimable(color);
        while (frontier.length) {
            const next = new Set<number>();
            for (const i of frontier) {
                board.take(i);
                order.push(i);
            }
            for (const i of frontier) {
                for (const n of board.neighbours(i)) if (board.colors[n] === color && board.exposed(n)) next.add(n);
            }
            frontier = [...next];
        }
        return order;
    }

    /** On the picture's outline (any side). */
    public onEdge(i: number): boolean {
        const x = i % this.width;
        const y = Math.floor(i / this.width);
        return x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1;
    }

    /**
     * The way from a pixel out of the picture, as straight as it can be: straight down when every cell under it is
     * taken; else the shortest straight line out to another side; else the shortest way through cells already taken to
     * the outline (every taken cell was exposed when it went, so they always connect to it). Returns the cells from the
     * pixel to an outline cell, the pixel first — just the pixel when it's on the outline itself.
     */
    public pathOut(pixel: number): number[] {
        if (this.onEdge(pixel)) return [pixel];
        const straight = [this.width, -1, 1, -this.width]
            .map((step) => this.straightOut(pixel, step))
            .filter((line): line is number[] => !!line);
        // Down first (the way to the anthill), then the shortest.
        if (straight.length) return straight.find((line) => line[1] === pixel + this.width) ?? straight.sort((a, b) => a.length - b.length)[0];
        const came = new Map<number, number>([[pixel, -1]]);
        const queue = [pixel];
        let exit = -1;
        while (queue.length) {
            const i = queue.shift()!;
            if (this.onEdge(i)) {
                exit = i;
                break;
            }
            for (const n of this.neighbours(i)) {
                if (came.has(n) || this.colors[n] >= 0) continue;
                came.set(n, i);
                queue.push(n);
            }
        }
        if (exit < 0) return [pixel];
        const path: number[] = [];
        for (let i = exit; i >= 0; i = came.get(i)!) path.push(i);
        return path.reverse();
    }

    /** The cells from a pixel straight to the outline in one direction (`step`), if every one after it is taken. */
    private straightOut(pixel: number, step: number): number[] | undefined {
        const line = [pixel];
        let i = pixel;
        while (!this.onEdge(i)) {
            const x = i % this.width;
            if ((step === -1 && x === 0) || (step === 1 && x === this.width - 1)) break;
            i += step;
            if (this.colors[i] >= 0) return undefined;
            line.push(i);
        }
        return line;
    }

    private neighbours(i: number): number[] {
        const x = i % this.width;
        const list: number[] = [];
        if (x > 0) list.push(i - 1);
        if (x < this.width - 1) list.push(i + 1);
        if (i >= this.width) list.push(i - this.width);
        if (i + this.width < this.colors.length) list.push(i + this.width);
        return list;
    }
}

/** A seeded random number generator (mulberry32): the same level always deals the same deck. */
export function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A string's hash, for a level's seed. */
export function hashString(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
}

/**
 * Deals a level's tiles by playing the picture out: again and again, a colour that has pixels reachable now (picked
 * at random, the more reachable the likelier) gets a tile of `min..max` of them (all that's left of a smaller run, so
 * no tiny leftovers), and those pixels are taken. Every tile can be cleared when its turn comes in this order.
 */
export function dealDeck(start: Board, seed: number, min: number, max: number): Tile[] {
    const board = start.clone();
    const random = seeded(seed);
    const colors = new Set<number>();
    for (const c of board.colors) if (c >= 0) colors.add(c);
    const deck: Tile[] = [];
    while (board.remaining > 0) {
        const options = [...colors].map((color) => ({ color, reach: board.reachable(color) })).filter((o) => o.reach.length > 0);
        // The bottom edge always shows something, so there's always an option while pixels remain.
        const total = options.reduce((sum, o) => sum + o.reach.length, 0);
        let pick = random() * total;
        const chosen = options.find((o) => (pick -= o.reach.length) < 0) ?? options[options.length - 1];
        let count = Math.min(chosen.reach.length, min + Math.floor(random() * (max - min + 1)));
        if (chosen.reach.length - count < min) count = chosen.reach.length;
        for (const i of chosen.reach.slice(0, count)) board.take(i);
        deck.push({ color: chosen.color, count });
    }
    return deck;
}
