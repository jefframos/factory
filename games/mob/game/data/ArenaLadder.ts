// ArenaLadder.ts
//
// Who the player meets in the arena (the fake multiplayer): the arena ladder (games/mob/ui/arena-ladder.json, the
// editor's Arena tab). The player has an arena rating (MobSave.arena): a win adds `points.win`, a loss takes
// `points.loss` off (never below 0). The rating picks a tier, and the tier says who the opponent is:
//   - `skill`: the robot's hands (Grading's SKILLS: newbie, casual, average, pro);
//   - `cards`: the cards it may play (only those the player has too: it never has one the player hasn't);
//   - `cardLevel` / `cannon`: how close its cards' levels and its cannon's upgrades come to the player's own, 0 (level 1)
//     to 1 (the same): never above them.
// How the player's doing moves it too: `streak.after` wins in a row and the opponent is `streak.tiers` tier tougher (as
// many losses in a row: easier), so a player who's struggling gets a breather and one who's flying gets a match.
//
// No Vite or browser here (the editor's simulator bundles it for node).

import { CARD_KINDS, CardKind } from './Settings';

export type SkillId = 'newbie' | 'casual' | 'average' | 'pro';

export interface LadderTier {
    /** The rating it starts at. */
    from: number;
    name: string;
    skill: SkillId;
    cards: CardKind[];
    /** 0..1: its cards' levels and its cannon's, from level 1 (0) to the player's own (1). */
    cardLevel: number;
    cannon: number;
}

export interface Ladder {
    points: { win: number; loss: number; draw: number };
    streak: { after: number; tiers: number };
    tiers: LadderTier[];
}

/** The player's arena record. `streak`: wins in a row (+), losses in a row (-). */
export interface ArenaRecord {
    rating: number;
    streak: number;
    played: number;
    won: number;
    lost: number;
}

export const freshRecord = (): ArenaRecord => ({ rating: 0, streak: 0, played: 0, won: 0, lost: 0 });

/** What a side has: its cards (kind: level) and its cannon's upgrade levels. */
export interface Loadout {
    cards: Partial<Record<CardKind, number>>;
    fire: number;
    capacity: number;
    recharge: number;
}

/** An opponent: who plays it, what it has, and the tier it came from (its index too). */
export interface Opponent extends Loadout {
    skill: SkillId;
    tier: LadderTier;
    tierIndex: number;
}

/** The tier for a record: the rating's, moved by the streak. */
export function tierFor(ladder: Ladder, record: Pick<ArenaRecord, 'rating' | 'streak'>): number {
    const tiers = ladder.tiers;
    let index = 0;
    tiers.forEach((tier, i) => {
        if (record.rating >= tier.from) index = i;
    });
    const after = Math.max(1, ladder.streak.after);
    if (record.streak >= after) index += ladder.streak.tiers;
    else if (record.streak <= -after) index -= ladder.streak.tiers;
    return Math.max(0, Math.min(tiers.length - 1, index));
}

/** A level `share` of the way from 1 to the player's `level` (rounded; never above it). */
const towards = (level: number, share: number): number => Math.max(1, Math.min(level, 1 + Math.round((level - 1) * Math.max(0, Math.min(1, share)))));

/** The opponent the player meets now. */
export function opponentFor(ladder: Ladder, record: Pick<ArenaRecord, 'rating' | 'streak'>, player: Loadout): Opponent {
    const tierIndex = tierFor(ladder, record);
    const tier = ladder.tiers[tierIndex];
    const cards: Partial<Record<CardKind, number>> = {};
    for (const kind of CARD_KINDS) {
        const level = player.cards[kind];
        if (level === undefined || !tier.cards.includes(kind)) continue;
        cards[kind] = towards(level, tier.cardLevel);
    }
    return {
        skill: tier.skill, tier, tierIndex, cards,
        fire: towards(player.fire, tier.cannon),
        capacity: towards(player.capacity, tier.cannon),
        recharge: towards(player.recharge, tier.cannon),
    };
}

/** The record after a match. */
export function afterMatch(ladder: Ladder, record: ArenaRecord, result: 'won' | 'lost' | 'draw'): ArenaRecord {
    const points = result === 'won' ? ladder.points.win : result === 'lost' ? -ladder.points.loss : ladder.points.draw;
    return {
        rating: Math.max(0, record.rating + points),
        streak: result === 'won' ? Math.max(0, record.streak) + 1 : result === 'lost' ? Math.min(0, record.streak) - 1 : 0,
        played: record.played + 1,
        won: record.won + (result === 'won' ? 1 : 0),
        lost: record.lost + (result === 'lost' ? 1 : 0),
    };
}
