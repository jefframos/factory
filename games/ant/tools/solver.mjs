// solver.mjs — deals a level's tiles and checks the level can be cleared (used by pixelate-lib.mjs's buildLevel, so
// the editor and `npm run ant:pixelate` bake every level's deck with its check).
//
// The rules are the game's (game/data/Board.ts, game/scenes/AntScene.ts) — keep the two in step:
// - A pixel is exposed on the picture's outline or next to a taken / empty cell. A tile in a slot sends its ants, one
//   per number, each to the exposed pixel of its colour nearest the slots (the bottom of the picture, then the middle).
// - The player taps a column's front tile into a free slot (SLOTS of them, one more with the extra-slot power-up); the
//   tile leaves once all its ants are home. Lost: every slot holds a tile whose colour has nothing exposed.
//
// The solver plays "patiently": after each tap the ants finish all they can (settle) before the next tap — a player can
// always wait, so a level is clearable when some order of taps clears it this way.
//
// bakeDeck() deals the tiles by playing the picture out (each tile takes pixels reachable by then: dealt in order, it
// always works), then — `mix` — swaps some tiles a few places, which hides traps (a colour that can't be reached yet
// at the front of a column); a mixed deck is kept only if the solver can still clear it, else the next try (seeded:
// the same settings always bake the same deck). It reports: clearable, with how many slots; whether the winning taps
// still win whichever pixels the ants pick (robust); and how often a player tapping at random wins (difficulty).

export const SLOTS = 5;
const NODE_LIMIT = 40000;
const PLAYOUTS = 80;
const MIX_TRIES = 10;

/** mulberry32, as Board.ts's seeded(). */
export function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** FNV-1a, as Board.ts's hashString(). */
export function hashString(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
}

/** The picture being eaten: colours (-1 = taken / empty) and, per colour, its exposed pixels. */
class Board {
    constructor(width, height, colors, colorCount) {
        this.width = width;
        this.height = height;
        this.colors = Int8Array.from(colors);
        this.exposedFlag = new Uint8Array(colors.length);
        this.exposed = Array.from({ length: colorCount }, () => new Set());
        this.remaining = 0;
        this.hash = 0;
        if (!Board.keys || Board.keys.length < colors.length) {
            const random = seeded(12345);
            Board.keys = Uint32Array.from({ length: colors.length }, () => Math.floor(random() * 4294967296));
        }
        for (let i = 0; i < colors.length; i++) {
            if (this.colors[i] < 0) continue;
            this.remaining++;
            if (this.isExposed(i)) {
                this.exposedFlag[i] = 1;
                this.exposed[this.colors[i]].add(i);
            }
        }
    }

    clone() {
        const b = Object.create(Board.prototype);
        b.width = this.width;
        b.height = this.height;
        b.colors = Int8Array.from(this.colors);
        b.exposedFlag = Uint8Array.from(this.exposedFlag);
        b.exposed = this.exposed.map((s) => new Set(s));
        b.remaining = this.remaining;
        b.hash = this.hash;
        return b;
    }

    onEdge(i) {
        const x = i % this.width;
        const y = Math.floor(i / this.width);
        return x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1;
    }

    isExposed(i) {
        if (this.onEdge(i)) return true;
        return this.colors[i - 1] < 0 || this.colors[i + 1] < 0 || this.colors[i - this.width] < 0 || this.colors[i + this.width] < 0;
    }

    neighbours(i) {
        const x = i % this.width;
        const list = [];
        if (x > 0) list.push(i - 1);
        if (x < this.width - 1) list.push(i + 1);
        if (i >= this.width) list.push(i - this.width);
        if (i + this.width < this.colors.length) list.push(i + this.width);
        return list;
    }

    take(i) {
        const c = this.colors[i];
        if (c < 0) return;
        this.exposed[c].delete(i);
        this.colors[i] = -1;
        this.remaining--;
        this.hash = (this.hash ^ Board.keys[i]) >>> 0;
        for (const n of this.neighbours(i)) {
            if (this.colors[n] < 0 || this.exposedFlag[n]) continue;
            this.exposedFlag[n] = 1;
            this.exposed[this.colors[n]].add(n);
        }
    }

    /** The pixels a colour can take on its own from here, in the order it takes them (as Board.ts's reachable()). */
    reachable(color) {
        const board = this.clone();
        const order = [];
        let frontier = [...board.exposed[color]].sort((a, b) => a - b);
        while (frontier.length) {
            for (const i of frontier) {
                board.take(i);
                order.push(i);
            }
            frontier = [...board.exposed[color]].sort((a, b) => a - b);
        }
        return order;
    }
}

/** How the ants pick among exposed pixels. 'game': nearest the slots (bottom row first, then the middle) — what the
 *  game does; 'top' and 'random' are there to check a win doesn't hang on that choice. */
function picker(board, policy, random) {
    const middle = (board.width - 1) / 2;
    if (policy === 'random') return (set) => [...set][Math.floor(random() * set.size)];
    const sign = policy === 'top' ? -1 : 1;
    return (set) => {
        let best = -1;
        let bestScore = Infinity;
        for (const i of set) {
            const score = -sign * Math.floor(i / board.width) * 1000 + Math.abs((i % board.width) - middle) * 2 + (i % board.width) / 1000;
            if (score < bestScore) {
                bestScore = score;
                best = i;
            }
        }
        return best;
    };
}

/** The ants do all they can: round after round, each waiting slot takes one exposed pixel of its colour. */
function settle(board, slots, pick) {
    let moved = true;
    while (moved) {
        moved = false;
        for (const slot of slots) {
            if (!slot || slot.left === 0) continue;
            const set = board.exposed[slot.color];
            if (!set.size) continue;
            board.take(pick(set));
            slot.left--;
            moved = true;
        }
    }
    for (let s = 0; s < slots.length; s++) if (slots[s] && slots[s].left === 0) slots[s] = null;
}

/** The deck dealt into columns (round-robin, as the game's TileRack): column c holds tiles c, c + n, c + 2n... */
function toColumns(deck, columns) {
    const out = Array.from({ length: columns }, () => []);
    deck.forEach((tile, i) => out[i % columns].push(tile));
    return out;
}

/** A play from the start: `next` picks the column to tap (or -1); returns won, and the taps. */
function play(start, columns, slotCount, policy, next, seed = 1) {
    const board = start.clone();
    const random = seeded(seed);
    const pick = picker(board, policy, random);
    const fronts = columns.map(() => 0);
    const slots = new Array(slotCount).fill(null);
    const taps = [];
    for (;;) {
        settle(board, slots, pick);
        if (board.remaining === 0) return { won: true, taps };
        const free = slots.indexOf(null);
        const open = columns.map((_, c) => c).filter((c) => fronts[c] < columns[c].length);
        if (free < 0 || !open.length) return { won: false, taps };
        const c = next(open, taps.length, board, random);
        if (c < 0) return { won: false, taps };
        const tile = columns[c][fronts[c]++];
        slots[free] = { color: tile.color, left: tile.count };
        taps.push(c);
    }
}

/** Depth-first search for taps that clear the level (patient play, the game's pick); undefined if none is found. */
function solve(start, columns, slotCount) {
    const pick = picker(start, 'game');
    const seen = new Set();
    let nodes = 0;
    const search = (board, fronts, slots, taps) => {
        settle(board, slots, pick);
        if (board.remaining === 0) return taps;
        if (++nodes > NODE_LIMIT) return undefined;
        const free = slots.indexOf(null);
        if (free < 0) return undefined;
        const key = `${fronts.join(',')}|${slots.map((s) => (s ? `${s.color}:${s.left}` : '-')).sort().join(',')}|${board.hash}`;
        if (seen.has(key)) return undefined;
        seen.add(key);
        // Colours the ants can get at now first (the more the better), then the rest.
        const options = columns.map((_, c) => c).filter((c) => fronts[c] < columns[c].length)
            .map((c) => ({ c, reach: board.exposed[columns[c][fronts[c]].color].size }))
            .sort((a, b) => b.reach - a.reach || a.c - b.c);
        for (const { c } of options) {
            const nextFronts = fronts.slice();
            const tile = columns[c][nextFronts[c]++];
            const nextSlots = slots.map((s) => (s ? { ...s } : null));
            nextSlots[free] = { color: tile.color, left: tile.count };
            const found = search(board.clone(), nextFronts, nextSlots, [...taps, c]);
            if (found) return found;
        }
        return undefined;
    };
    return search(start.clone(), columns.map(() => 0), new Array(slotCount).fill(null), []);
}

/** A deck checked: clearable (with SLOTS, or only with the extra slot), robust, how often random taps win. */
export function check(start, deck, columnCount) {
    const columns = toColumns(deck, columnCount);
    let slots = SLOTS;
    let taps = solve(start, columns, slots);
    if (!taps) {
        slots = SLOTS + 1;
        taps = solve(start, columns, slots);
    }
    if (!taps) return { clearable: false, slots: 0, robust: false, randomWins: 0 };
    const replay = (policy, seed) => play(start, columns, slots, policy, (open, n) => (open.includes(taps[n]) ? taps[n] : -1), seed).won;
    const robust = replay('top') && [1, 2, 3].every((seed) => replay('random', seed));
    let wins = 0;
    for (let n = 0; n < PLAYOUTS; n++) {
        if (play(start, columns, SLOTS, 'game', (open, _, __, random) => open[Math.floor(random() * open.length)], 1000 + n).won) wins++;
    }
    return { clearable: true, slots, robust, randomWins: Math.round((wins / PLAYOUTS) * 100) / 100 };
}

/** How much less likely a colour is when it was the last tile, or among the few before (a row of one colour is dull). */
const REPEAT = { last: 0.08, recent: 0.35, window: 3 };
/** A colour's tiles grow with how much of the picture it is, against the average colour (so a big colour isn't a long
 *  run of tiles): their size range is scaled by its share, between these. */
const SHARE_SCALE = { least: 0.8, most: 2.5 };

/**
 * Deals by playing the picture out, as Board.ts's dealDeck(): every tile reachable when its turn comes. The colour is
 * picked at random among the reachable ones — by how much of it is left in the picture (so the small colours are spread
 * through the deck rather than used up first) and much less likely if the last few tiles were that colour — so colours
 * take turns as long as the picture allows.
 */
function deal(start, seed, min, max) {
    const board = start.clone();
    const random = seeded(seed);
    const colors = board.exposed.map((_, c) => c);
    // Pixels of each colour still in the picture.
    const left = colors.map(() => 0);
    for (const c of board.colors) if (c >= 0) left[c]++;
    const deck = [];
    while (board.remaining > 0) {
        const recent = deck.slice(-REPEAT.window).map((t) => t.color);
        const last = recent[recent.length - 1];
        const options = colors.map((color) => ({ color, reach: board.reachable(color) })).filter((o) => o.reach.length > 0)
            .map((o) => ({ ...o, weight: left[o.color] * (o.color === last ? REPEAT.last : recent.includes(o.color) ? REPEAT.recent : 1) }));
        const total = options.reduce((sum, o) => sum + o.weight, 0);
        let pick = random() * total;
        const chosen = options.find((o) => (pick -= o.weight) < 0) ?? options[options.length - 1];
        const present = left.filter((n) => n > 0);
        const average = present.reduce((sum, n) => sum + n, 0) / Math.max(1, present.length);
        const scale = Math.max(SHARE_SCALE.least, Math.min(SHARE_SCALE.most, left[chosen.color] / Math.max(1, average)));
        const low = Math.round(min * Math.max(1, scale));
        const high = Math.max(low, Math.round(max * scale));
        let count = Math.min(chosen.reach.length, low + Math.floor(random() * (high - low + 1)));
        if (chosen.reach.length - count < min) count = chosen.reach.length;
        for (const i of chosen.reach.slice(0, count)) board.take(i);
        left[chosen.color] -= count;
        deck.push({ color: chosen.color, count });
    }
    return deck;
}

/** Some later tiles pulled forward — a colour the ants can't reach yet turning up early, to wait in a slot: `mix`
 *  pulls per 6 tiles, each up to 1 + mix rows ahead. */
function mixDeck(deck, mix, columns, random) {
    const out = deck.slice();
    const pulls = Math.max(1, Math.round((mix * out.length) / 6));
    for (let n = 0; n < pulls; n++) {
        const from = columns + Math.floor(random() * Math.max(1, out.length - columns));
        if (from >= out.length) continue;
        const to = Math.max(0, from - 1 - Math.floor(random() * columns * (1 + mix)));
        out.splice(to, 0, out.splice(from, 1)[0]);
    }
    return out;
}

/** Columns for a level: 3 for small pictures, 4 for medium, 5 for big (or what the settings ask). */
export function columnsFor(pixels, wanted) {
    if (wanted >= 3 && wanted <= 5) return wanted;
    return pixels < 150 ? 3 : pixels < 450 ? 4 : 5;
}

/**
 * Bakes a level's deck: `pixels` (palette indices, -1 empty), its size, how many colours; `id` + `seed` seed the deal,
 * `mix` (0 = dealt order, the easiest; each step more traps), `columns` (0 = by size). Returns the deck, the columns and
 * the check.
 */
export function bakeDeck(pixels, width, height, colorCount, { id, seed = 0, mix = 0, columns = 0 }) {
    const start = new Board(width, height, pixels, colorCount);
    const filled = start.remaining;
    const columnCount = columnsFor(filled, columns);
    if (!filled) return { deck: [], columns: columnCount, check: { clearable: true, slots: SLOTS, robust: true, randomWins: 1 } };
    // Tiles of about 1/90 to 1/25 of the grid (as the game used to deal them).
    const min = Math.max(6, Math.round((width * height) / 90));
    const max = Math.max(min + 6, Math.round((width * height) / 25));
    const dealSeed = (hashString(id) + Math.imul(seed, 0x9e3779b1)) >>> 0;
    const dealt = deal(start, dealSeed, min, max);
    // Mixed: of a few tries, the hardest (random taps win least) that can still be cleared with the usual slots,
    // whichever pixels the ants pick.
    let best = { deck: dealt, columns: columnCount, check: check(start, dealt, columnCount) };
    if (mix > 0) {
        const random = seeded(dealSeed ^ 0x5bd1e995);
        for (let attempt = 0; attempt < MIX_TRIES; attempt++) {
            const deck = mixDeck(dealt, mix, columnCount, random);
            const result = check(start, deck, columnCount);
            if (result.clearable && result.slots === SLOTS && result.robust && result.randomWins < best.check.randomWins) best = { deck, columns: columnCount, check: result };
        }
    }
    return best;
}
