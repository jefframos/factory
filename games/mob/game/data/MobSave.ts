// MobSave.ts
//
// What carries over between battles, in localStorage: coins, the cannon's upgrade levels (fire rate, energy capacity,
// recharge speed: MobConfig's UPGRADES), which battle is next (the player's progress), and which one is picked to play
// (the main screen's arrows go back through those already reached, to replay one; progress never goes back). A loss never takes any of it away (the brief:
// permanent progression isn't erased).

import { AVATARS, usernameFrom } from './Profile';
import { ArenaRecord, Ladder, Loadout, afterMatch, freshRecord } from './ArenaLadder';
import { RETRY_EASE, UPGRADES, UpgradeKind } from './MobConfig';
import { PLAY } from './MobLevels';
import { CARD_KINDS, CardKind, SETTINGS, cardCost, cardMaxLevel } from './Settings';
import { ChestKind, Loot, REWARDS, ROAD, RoadStep, copiesFor, rollChest, spreadCopies } from './ArenaRewards';

/** The arena deck's most cards. */
export const DECK_SIZE = 6;

const KEY = 'mob.save';
/**
 * The save's version: a save from before it (a different one, or none) starts the player afresh — once, when the game
 * changed too much for an old save to carry over (the cards, decks, arena and chests). Raised only when that's wanted.
 */
const SAVE_VERSION = 2;

interface SaveData {
    coins: number;
    /** The next battle to beat (0-based): the furthest the player can pick. */
    battle: number;
    /** The battle picked to play (the main screen's, PLAY starts it): `battle` unless an earlier one's been picked. */
    selected: number;
    /** Debug: every level can be picked (to try every area). */
    unlockAll: boolean;
    /** The units' cards the player has (each unlocked by the first level with its house), and each one's level. */
    cards: CardKind[];
    cardLevels: Partial<Record<CardKind, number>>;
    /** The furthest battle reached (1-based; 0 = none yet): for the progress event, sent once per new best. */
    best: number;
    levels: Record<UpgradeKind, number>;
    /** Losses in a row on the picked battle (each makes it RETRY_EASE.step easier); 0 once it's won or another's picked. */
    retries: number;
    /** The first-card tutorial's been done (the battle paused on the first charged card, for the player to tap it). */
    cardTutorial: boolean;
    /** The arena (ArenaLadder): its rating, streak and tally. */
    arena: ArenaRecord;
    /** The player's name in the rankings (made once: Profile), and their avatar. */
    username?: string;
    avatar?: number;
    /** The competition's counts (Ranking.ts), by period key (a day's, a week's: only the current ones are kept), and the
     *  quests claimed (`id@periodKey`). */
    stats: Record<string, Partial<Record<RankStat, number>>>;
    claimed: string[];
    /** Gems: the premium currency (the competition's quests and the arena's chests pay them; cards' levels cost them). */
    gems: number;
    /** Each card's copies (a level costs some: ArenaRewards.copiesFor). */
    copies: Partial<Record<CardKind, number>>;
    /** The cards taken out of the battle deck (the deck: the rest the player has, the first DECK_SIZE). */
    benched?: CardKind[];
    /** The battle deck's DECK_SIZE slots, each a card or empty (null): what the player picked to bring to battles. */
    slots: (CardKind | null)[];
    /** Chests won in the arena, to open back on the main screen; where in the chest cycle the next win is; when the
     *  free (video) chest is ready (ms since 1970). */
    pending: ChestKind[];
    chestCycle: number;
    adChestAt: number;
    /** The trophy road's steps claimed (their trophies). */
    road: number[];
    /** The cards the player's looked at (one not looked at yet: NEW). */
    seen: CardKind[];
    /** The profile's: the most trophies ever, and the matches won with all three crowns. */
    bestTrophies: number;
    threeCrowns: number;
    /** The arenas whose opening has been shown (NEW ARENA!). */
    arenasSeen: string[];
    /** The versus mode's tutorial done (the first match started from it). */
    arenaTutorial: boolean;
}

/** What the competition counts (Ranking.ts): crowns, arena matches won, story levels won, enemy towers destroyed. */
export type RankStat = 'crowns' | 'arenaWins' | 'levels' | 'towers';

const KINDS = Object.keys(UPGRADES) as UpgradeKind[];
const emptySlots = (): (CardKind | null)[] => Array.from({ length: DECK_SIZE }, () => null);
/** The deck's slots as stored (an older save: its cards less the ones taken out, the first DECK_SIZE). */
function deckSlots(stored: Partial<SaveData>): (CardKind | null)[] {
    const slots = emptySlots();
    const owned = (stored.cards ?? []).filter((kind) => CARD_KINDS.includes(kind));
    const from = stored.slots ?? owned.filter((kind) => !(stored.benched ?? []).includes(kind));
    from.slice(0, DECK_SIZE).forEach((kind, i) => { slots[i] = kind && owned.includes(kind) ? kind : null; });
    return slots;
}
const freshLevels = (): Record<UpgradeKind, number> => Object.fromEntries(KINDS.map((kind) => [kind, 1])) as Record<UpgradeKind, number>;

function load(): SaveData {
    try {
        const raw = window.localStorage.getItem(KEY);
        const stored = JSON.parse(raw ?? '{}') as Partial<SaveData> & { fireLevel?: number; version?: number };
        // An older version's save: a fresh start (the world map's progress too).
        if (raw && stored.version !== SAVE_VERSION) {
            window.localStorage.removeItem('mob.mapSeen');
            throw new Error('old save');
        }
        const levels = freshLevels();
        for (const kind of KINDS) {
            // Older saves had only the fire rate, as `fireLevel`.
            const level = stored.levels?.[kind] ?? (kind === 'fire' ? stored.fireLevel : undefined) ?? 1;
            levels[kind] = Math.min(UPGRADES[kind].max, Math.max(1, Math.floor(level)));
        }
        const battle = Math.max(0, stored.battle ?? 0);
        return {
            coins: Math.max(0, stored.coins ?? SETTINGS.startCoins), battle, selected: Math.max(0, Math.floor(stored.selected ?? battle)),
            unlockAll: !!stored.unlockAll, cards: (stored.cards ?? []).filter((kind) => CARD_KINDS.includes(kind)), cardLevels: stored.cardLevels ?? {}, best: Math.max(0, stored.best ?? 0), levels, retries: Math.max(0, Math.floor(stored.retries ?? 0)), cardTutorial: !!stored.cardTutorial,
            arena: { ...freshRecord(), ...(stored.arena ?? {}) },
            username: stored.username, avatar: stored.avatar, stats: stored.stats ?? {}, claimed: stored.claimed ?? [],
            gems: Math.max(0, Math.floor(stored.gems ?? 0)),
            copies: stored.copies ?? {}, slots: deckSlots(stored),
            pending: (stored.pending ?? []).filter((kind) => !!REWARDS.chests[kind]), adChestAt: Math.max(0, stored.adChestAt ?? 0), chestCycle: Math.max(0, Math.floor(stored.chestCycle ?? 0)), road: stored.road ?? [],
            seen: stored.seen ?? [...(stored.cards ?? [])], bestTrophies: Math.max(0, stored.bestTrophies ?? stored.arena?.rating ?? 0), threeCrowns: Math.max(0, stored.threeCrowns ?? 0),
            arenasSeen: stored.arenasSeen ?? [],
            arenaTutorial: !!stored.arenaTutorial || (stored.arena?.played ?? 0) > 0,
        };
    } catch {
        return {
            coins: SETTINGS.startCoins, battle: 0, selected: 0, unlockAll: false, cards: [], cardLevels: {}, best: 0, levels: freshLevels(), retries: 0, cardTutorial: false, arena: freshRecord(), stats: {}, claimed: [], gems: 0,
            copies: {}, slots: emptySlots(), pending: [], adChestAt: 0, chestCycle: 0, road: [], seen: [], bestTrophies: 0, threeCrowns: 0, arenasSeen: [], arenaTutorial: false,
        };
    }
}

const data = load();
// (Written at once: a fresh start after an old version's save sticks, versioned.)
save();

function save(): void {
    try {
        window.localStorage.setItem(KEY, JSON.stringify({ ...data, version: SAVE_VERSION }));
    } catch {
        // Private mode: it lasts this session.
    }
}

export const MobSave = {
    get coins(): number { return data.coins; },
    /** The next battle to beat (0-based, counting up forever: battleConfig() loops the presets): the progress. */
    get battle(): number { return data.battle; },
    /** The battle picked to play (PLAY starts it; the battle scene plays it). */
    get selected(): number { return Math.min(data.selected, MobSave.furthest); },
    /** The furthest battle that can be picked: the next to beat, or (debug) the last level of every area. */
    get furthest(): number { return Math.max(data.battle, data.unlockAll ? PLAY.length - 1 : 0); },
    get unlockAll(): boolean { return data.unlockAll; },
    get fireLevel(): number { return data.levels.fire; },
    get best(): number { return data.best; },
    /** How much easier the next battle is played (0 .. RETRY_EASE.most): RETRY_EASE.step a loss in a row on it. */
    get ease(): number { return Math.min(RETRY_EASE.most, data.retries * RETRY_EASE.step); },

    /** Lost the picked battle: its next try is easier. */
    lost(): void {
        data.retries++;
        save();
    },

    /** Picks battle `index` to play (the main screen's arrows; the debug picker can pick any). */
    select(index: number): void {
        const next = Math.max(0, Math.floor(index));
        if (next !== data.selected) data.retries = 0;
        data.selected = next;
        save();
    },

    /** Won battle `index`: on to the one after it; past the furthest, that's progress. */
    won(index: number): void {
        data.selected = index + 1;
        data.battle = Math.max(data.battle, index + 1);
        data.retries = 0;
        save();
    },

    /** The arena record (rating, streak, tally: ArenaLadder). */
    get arena(): ArenaRecord { return { ...data.arena }; },
    /** An arena match ended: the record after it (the ladder's points). */
    arenaResult(ladder: Ladder, result: 'won' | 'lost' | 'draw'): ArenaRecord {
        data.arena = afterMatch(ladder, data.arena, result);
        data.bestTrophies = Math.max(data.bestTrophies, data.arena.rating);
        save();
        return { ...data.arena };
    },
    /** What the player brings to the arena: their deck's cards' levels and their cannon's. */
    arenaLoadout(): Loadout {
        const cards: Loadout['cards'] = {};
        for (const kind of MobSave.deck) cards[kind] = MobSave.cardLevel(kind);
        return { cards, fire: data.levels.fire, capacity: data.levels.capacity, recharge: data.levels.recharge };
    },
    /** Debug: the arena record set (to try a rating). */
    setArena(record: Partial<ArenaRecord>): void {
        data.arena = { ...data.arena, ...record };
        save();
    },

    /** The player's name in the rankings (made the first time it's asked for), and their avatar (an AVATARS index). */
    get username(): string {
        if (!data.username) {
            data.username = usernameFrom(Math.floor(Math.random() * 2 ** 32));
            data.avatar = Math.floor(Math.random() * AVATARS.length);
            save();
        }
        return data.username;
    },
    get avatar(): number { return data.avatar ?? 0; },
    setAvatar(index: number): void {
        data.avatar = Math.max(0, Math.floor(index));
        save();
    },

    /** A competition count in a period (its key: Ranking.periodKey). */
    stat(stat: RankStat, key: string): number {
        return data.stats[key]?.[stat] ?? 0;
    },
    /** Adds to a count in each of the periods `keys` (the day's and the week's); older periods are dropped. */
    addStat(stat: RankStat, amount: number, keys: string[]): void {
        if (amount <= 0) return;
        for (const key of Object.keys(data.stats)) if (!keys.includes(key)) delete data.stats[key];
        data.claimed = data.claimed.filter((entry) => keys.some((key) => entry.endsWith(`@${key}`)));
        for (const key of keys) {
            const counts = (data.stats[key] ??= {});
            counts[stat] = (counts[stat] ?? 0) + amount;
        }
        save();
    },
    isClaimed(id: string, key: string): boolean {
        return data.claimed.includes(`${id}@${key}`);
    },
    claim(id: string, key: string): void {
        if (!data.claimed.includes(`${id}@${key}`)) data.claimed.push(`${id}@${key}`);
        save();
    },

    /** Whether the first-card tutorial's been done. */
    get cardTutorial(): boolean { return data.cardTutorial; },
    cardTutorialDone(): void {
        data.cardTutorial = true;
        save();
    },

    /** Whether the player has `kind`'s card. */
    hasCard(kind: CardKind): boolean {
        return data.cards.includes(kind);
    },

    /** A level with `kind`'s house was reached: its card is the player's; whether it's new. */
    unlockCard(kind: CardKind): boolean {
        if (data.cards.includes(kind)) return false;
        data.cards.push(kind);
        // Into the deck if it has an empty slot.
        const at = data.slots.indexOf(null);
        if (at >= 0) data.slots[at] = kind;
        save();
        return true;
    },

    /** `kind`'s card's level (1 to its top). */
    cardLevel(kind: CardKind): number {
        return Math.min(cardMaxLevel(kind), Math.max(1, data.cardLevels[kind] ?? 1));
    },

    /** The price of `kind`'s card's next level, in gems (null at the top). */
    cardCost(kind: CardKind): number | null {
        return cardCost(kind, MobSave.cardLevel(kind));
    },

    /** `kind`'s copies, and how many its next level needs (null at the top). */
    copies(kind: CardKind): number {
        return data.copies[kind] ?? 0;
    },
    copiesNeeded(kind: CardKind): number | null {
        const level = MobSave.cardLevel(kind);
        return level >= cardMaxLevel(kind) ? null : copiesFor(level);
    },

    /** Whether `kind`'s next level has its copies (the gems aside), and whether it can be bought now (the gems too). */
    upgradeReady(kind: CardKind): boolean {
        const need = MobSave.copiesNeeded(kind);
        return data.cards.includes(kind) && need !== null && MobSave.copies(kind) >= need;
    },
    canUpgrade(kind: CardKind): boolean {
        const cost = MobSave.cardCost(kind);
        return MobSave.upgradeReady(kind) && cost !== null && data.gems >= cost;
    },

    /** Buys `kind`'s card's next level (its copies and its gems); whether it did. */
    buyCard(kind: CardKind): boolean {
        if (!MobSave.canUpgrade(kind)) return false;
        data.gems -= MobSave.cardCost(kind)!;
        data.copies[kind] = MobSave.copies(kind) - MobSave.copiesNeeded(kind)!;
        data.cardLevels[kind] = MobSave.cardLevel(kind) + 1;
        save();
        return true;
    },

    /** Copies added (a chest, the road, a story win). */
    addCopies(cards: Partial<Record<CardKind, number>>): void {
        for (const [kind, count] of Object.entries(cards) as [CardKind, number][]) data.copies[kind] = MobSave.copies(kind) + count;
        save();
    },

    /** A story level won: copies of one of the player's cards (fewer on a replay); what they were (null: no cards yet). */
    storyCopies(first: boolean): { kind: CardKind; count: number } | null {
        const count = first ? REWARDS.story.first : REWARDS.story.replay;
        if (!data.cards.length || count <= 0) return null;
        const kind = data.cards[Math.floor(Math.random() * data.cards.length)];
        MobSave.addCopies({ [kind]: count });
        return { kind, count };
    },

    /** The battle deck (every battle's, story and arena): the cards in its slots, in order (the empty ones skipped). */
    get deck(): CardKind[] {
        return data.slots.filter((kind): kind is CardKind => !!kind && data.cards.includes(kind));
    },
    /** The deck's slots as they are (null: empty). */
    get deckSlots(): (CardKind | null)[] {
        return [...data.slots];
    },
    /** The cards the player has that aren't in the deck. */
    get bench(): CardKind[] {
        const deck = MobSave.deck;
        return data.cards.filter((kind) => !deck.includes(kind));
    },
    /** `kind` into the deck: the first empty slot (none: `instead`'s, the card it takes the place of). */
    useCard(kind: CardKind, instead?: CardKind): void {
        if (data.slots.includes(kind)) return;
        let at = data.slots.indexOf(null);
        if (at < 0 && instead) at = data.slots.indexOf(instead);
        if (at < 0) return;
        data.slots[at] = kind;
        save();
    },
    /** `kind` out of the deck, its slot left empty (never the last card). */
    removeCard(kind: CardKind): boolean {
        const at = data.slots.indexOf(kind);
        if (at < 0 || MobSave.deck.length <= 1) return false;
        data.slots[at] = null;
        save();
        return true;
    },

    /** Whether the player's looked at `kind` since getting it (not: NEW on it), and looked at now. */
    isNew(kind: CardKind): boolean {
        return data.cards.includes(kind) && !data.seen.includes(kind);
    },
    markSeen(kind: CardKind): void {
        if (data.seen.includes(kind)) return;
        data.seen.push(kind);
        save();
    },

    /** An arena win: the cycle's next chest, kept to open back on the main screen; which it is. */
    winChest(): ChestKind {
        const kind = REWARDS.cycle[data.chestCycle % REWARDS.cycle.length] ?? 'wood';
        data.chestCycle++;
        data.pending.push(kind);
        save();
        return kind;
    },
    /** The next chest won and not opened yet: opened (what it held, added); null: none. */
    openPending(): { kind: ChestKind; loot: Loot } | null {
        const kind = data.pending.shift();
        if (!kind) return null;
        const loot = rollChest(kind, data.cards);
        MobSave.addLoot(loot);
        return { kind, loot };
    },
    /** When the free (video) chest is ready (ms since 1970; past: it is). */
    get adChestAt(): number { return data.adChestAt; },
    /** The free chest opened (its video watched): what it held, added; the next one's in REWARDS.adChest.seconds. */
    openAdChest(now = Date.now()): { kind: ChestKind; loot: Loot } | null {
        if (data.adChestAt > now) return null;
        const { kind, seconds } = REWARDS.adChest;
        data.adChestAt = now + seconds * 1000;
        const loot = rollChest(kind, data.cards);
        MobSave.addLoot(loot);
        return { kind, loot };
    },
    /** Loot added: its coins, gems and copies. */
    addLoot(loot: Loot): void {
        data.coins += loot.coins;
        data.gems += loot.gems;
        MobSave.addCopies(loot.cards);
    },

    /** Whether the road's step at `trophies` has been claimed. */
    roadClaimed(trophies: number): boolean {
        return data.road.includes(trophies);
    },
    /** The road's steps reached and not claimed yet. */
    get roadWaiting(): RoadStep[] {
        return ROAD.filter((step) => step.trophies <= data.bestTrophies && !data.road.includes(step.trophies));
    },
    /** Claims the road's step (if reached): what it gave (a chest's: opened there and then). */
    claimRoad(step: RoadStep): { chest?: ChestKind; card?: CardKind; loot: Loot } | null {
        if (step.trophies > data.bestTrophies || data.road.includes(step.trophies)) return null;
        data.road.push(step.trophies);
        const { reward } = step;
        // A card: the player's now (one they have already: some copies of it instead).
        if (reward.card) {
            const fresh = MobSave.unlockCard(reward.card);
            const loot: Loot = { coins: 0, gems: 0, cards: fresh ? {} : { [reward.card]: 5 } };
            MobSave.addLoot(loot);
            return { card: fresh ? reward.card : undefined, loot };
        }
        const loot: Loot = reward.chest
            ? rollChest(reward.chest, data.cards)
            : { coins: reward.coins ?? 0, gems: reward.gems ?? 0, cards: spreadCopies(reward.copies ?? 0, data.cards) };
        if (!reward.chest && reward.copies && !data.cards.length) loot.coins += reward.copies * 5;
        MobSave.addLoot(loot);
        return { chest: reward.chest, loot };
    },

    /** The profile's: the most trophies ever, the three-crown wins. */
    get bestTrophies(): number { return data.bestTrophies; },
    get threeCrowns(): number { return data.threeCrowns; },
    addThreeCrown(): void {
        data.threeCrowns++;
        save();
    },

    /** Whether the versus mode's tutorial's been done; done now. */
    get arenaTutorial(): boolean { return data.arenaTutorial; },
    finishArenaTutorial(): void {
        data.arenaTutorial = true;
        save();
    },

    /** Whether arena `id`'s opening has been shown; shown now. */
    arenaSeen(id: string): boolean {
        return data.arenasSeen.includes(id);
    },
    markArenaSeen(id: string): void {
        if (data.arenasSeen.includes(id)) return;
        data.arenasSeen.push(id);
        save();
    },

    /** Debug: a card given or taken away. */
    setCard(kind: CardKind, on: boolean): void {
        if (on) MobSave.unlockCard(kind);
        else {
            data.cards = data.cards.filter((card) => card !== kind);
            data.slots = data.slots.map((card) => (card === kind ? null : card));
        }
        save();
    },

    /** Debug: every level can be picked (or back to the player's own progress). */
    setUnlockAll(on: boolean): void {
        data.unlockAll = on;
        save();
    },

    /** Battle `number` (1-based) was reached: remembered if it's the furthest yet. */
    reach(number: number): void {
        if (number <= data.best) return;
        data.best = number;
        save();
    },

    /** An upgrade's level (1 .. its max). */
    level(kind: UpgradeKind): number {
        return data.levels[kind];
    },

    /** What its next level costs, or null at the top. */
    cost(kind: UpgradeKind): number | null {
        const upgrade = UPGRADES[kind];
        return data.levels[kind] >= upgrade.max ? null : upgrade.cost[data.levels[kind] - 1];
    },

    /** Buys its next level if affordable; whether it did. */
    buy(kind: UpgradeKind): boolean {
        const cost = MobSave.cost(kind);
        if (cost === null || data.coins < cost) return false;
        data.coins -= cost;
        data.levels[kind]++;
        save();
        return true;
    },

    get gems(): number { return data.gems; },
    addGems(amount: number): void {
        data.gems = Math.max(0, data.gems + amount);
        save();
    },

    addCoins(amount: number): void {
        data.coins = Math.max(0, data.coins + amount);
        save();
    },

    /** Debug: play battle `index` (the level picker), whatever's been reached. */
    setBattle(index: number): void {
        data.selected = Math.max(0, Math.floor(index));
        data.battle = Math.max(data.battle, data.selected);
        data.retries = 0;
        save();
    },

    /** Debug: back to a new player. */
    reset(): void {
        data.coins = SETTINGS.startCoins;
        data.battle = 0;
        data.selected = 0;
        data.unlockAll = false;
        data.cards = [];
        data.cardLevels = {};
        data.best = 0;
        // The world map's tiles shown filled in (WorldMapView): none now.
        try {
            window.localStorage.removeItem('mob.mapSeen');
        } catch {
            // No storage.
        }
        data.levels = freshLevels();
        data.retries = 0;
        data.arena = freshRecord();
        data.stats = {};
        data.claimed = [];
        data.gems = 0;
        data.copies = {};
        data.slots = emptySlots();
        data.pending = [];
        data.adChestAt = 0;
        data.chestCycle = 0;
        data.road = [];
        data.seen = [];
        data.bestTrophies = 0;
        data.threeCrowns = 0;
        data.arenasSeen = [];
        data.arenaTutorial = false;
        save();
    },
};
