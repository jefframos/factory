// Ranking.ts
//
// The competition (as the UFO game's, after Clash Royale's crowns): crowns rank the player in a daily and a weekly
// ranking, and quests pay coins. Crowns come from a story level won and from what a counted arena match destroyed (each
// enemy tower, the enemy cannon more). There's no server: the other players are made up, their crowns worked out from
// ui/ranking.json so the top always looks within reach — a share of the players (`falloff`) stay ahead with every crown,
// so each crown climbs, fast at first.
//
// Quests (`quests`): earn so many crowns, win so many arena matches, beat so many story levels, destroy so many towers,
// or reach a place, today or this week; each pays its `reward` in gems once, claimed in the panel (RankingPanel).

import settingsFile from '../../ui/ranking.json';
import { AVATARS, hashWords, usernameFrom } from './Profile';
import { MobSave, RankStat } from './MobSave';

export type RankingPeriod = 'daily' | 'weekly';

export interface Quest {
    id: string;
    period: RankingPeriod;
    type: RankStat | 'rank';
    value: number;
    reward: number;
}

export interface RankingRow {
    rank: number;
    name: string;
    face: string;
    color: number;
    crowns: number;
    you: boolean;
}

interface Settings {
    crowns: { story: number; tower: number; cannon: number };
    dailyPlayers: number;
    dailyFalloff: number;
    weeklyPlayers: number;
    weeklyFalloff: number;
    quests: Quest[];
}

const SETTINGS = settingsFile as unknown as Settings;
const COLORS = [0xff7ab8, 0x6fc3ff, 0xffb347, 0xb98cff, 0x4fe0d0, 0xff6b6b, 0xffe066, 0x5fe87a];
const FACE_COUNT = 8;
const PERIODS: RankingPeriod[] = ['daily', 'weekly'];

const playersIn = (period: RankingPeriod) => (period === 'daily' ? SETTINGS.dailyPlayers : SETTINGS.weeklyPlayers);
const falloffIn = (period: RankingPeriod) => (period === 'daily' ? SETTINGS.dailyFalloff : SETTINGS.weeklyFalloff);

const dayKey = (date = new Date()) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

/** The Monday this week began on. */
function weekStart(date = new Date()): Date {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return monday;
}

export const periodKey = (period: RankingPeriod): string => (period === 'daily' ? dayKey() : `w${dayKey(weekStart())}`);
const currentKeys = (): string[] => PERIODS.map(periodKey);

/** How long until this period's ranking starts over, as words. */
export function endsIn(period: RankingPeriod): string {
    const now = new Date();
    const end = period === 'daily' ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) : weekStart(now);
    if (period === 'weekly') end.setDate(end.getDate() + 7);
    const minutes = Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 60000));
    const hours = Math.floor(minutes / 60);
    if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    return `${hours}h ${minutes % 60}m`;
}

export const crownsIn = (period: RankingPeriod): number => MobSave.stat('crowns', periodKey(period));

/** The place this many crowns gets. */
export function placeWith(crowns: number, period: RankingPeriod): number {
    return Math.max(1, Math.ceil(playersIn(period) * falloffIn(period) ** crowns));
}

export const placeIn = (period: RankingPeriod): number => placeWith(crownsIn(period), period);

/** How many crowns it takes to be at this place. */
function crownsAt(rank: number, period: RankingPeriod): number {
    return Math.ceil(Math.log(rank / playersIn(period)) / Math.log(falloffIn(period)));
}

/** The top places, with the player in them if they've got there. */
export function topRows(count: number, period: RankingPeriod): RankingRow[] {
    const key = periodKey(period);
    const you = placeIn(period);
    const rows: RankingRow[] = [];
    let other = 0;
    for (let rank = 1; rank <= count; rank++) {
        if (rank === you) {
            rows.push(yourRow(period));
            continue;
        }
        other++;
        // Different people in each ranking, the same ones all period; nobody twice.
        let seed = hashWords(`mob:${period}:${key}:${other}`);
        let name = usernameFrom(seed);
        for (let salt = 1; rows.some((row) => row.name === name); salt++) {
            seed = hashWords(`mob:${period}:${key}:${other}:${salt}`);
            name = usernameFrom(seed);
        }
        rows.push({ rank, name, face: `ProfileFace_s_0${seed % FACE_COUNT}`, color: COLORS[(seed >>> 8) % COLORS.length], crowns: crownsAt(rank, period), you: false });
    }
    return rows;
}

export function yourRow(period: RankingPeriod): RankingRow {
    const look = AVATARS[MobSave.avatar % AVATARS.length];
    return { rank: placeIn(period), name: MobSave.username, face: look.face, color: look.color, crowns: crownsIn(period), you: true };
}

export const quests = (): Quest[] => SETTINGS.quests;

export function questTitle(quest: Quest): string {
    const when = quest.period === 'daily' ? 'TODAY' : 'THIS WEEK';
    const n = quest.value;
    switch (quest.type) {
        case 'crowns': return `EARN ${n} CROWNS ${when}`;
        case 'arenaWins': return `WIN ${n} ARENA MATCH${n === 1 ? '' : 'ES'} ${when}`;
        case 'levels': return `BEAT ${n} STORY LEVEL${n === 1 ? '' : 'S'} ${when}`;
        case 'towers': return `DESTROY ${n} TOWER${n === 1 ? '' : 'S'} ${when}`;
        default: return n === 1 ? `REACH 1ST ${when}` : `REACH TOP ${n} ${when}`;
    }
}

const questCount = (quest: Quest): number => (quest.type === 'rank' ? placeIn(quest.period) : MobSave.stat(quest.type, periodKey(quest.period)));

/** How far along it is, as words. */
export function questProgress(quest: Quest): string {
    if (quest.type === 'rank') return `PLACE ${placeIn(quest.period)}`;
    return `${Math.min(questCount(quest), quest.value)}/${quest.value}`;
}

/** How far along it is, 0..1. */
export function questShare(quest: Quest): number {
    if (quest.type === 'rank') return Math.min(1, quest.value / Math.max(1, placeIn(quest.period)));
    return Math.min(1, questCount(quest) / Math.max(1, quest.value));
}

export const questDone = (quest: Quest): boolean => (quest.type === 'rank' ? placeIn(quest.period) <= quest.value : questCount(quest) >= quest.value);
export const questClaimed = (quest: Quest): boolean => MobSave.isClaimed(quest.id, periodKey(quest.period));
export const questClaimable = (quest: Quest): boolean => questDone(quest) && !questClaimed(quest);
export const anyClaimable = (): boolean => quests().some(questClaimable);

export function claimQuest(quest: Quest): void {
    if (!questClaimable(quest)) return;
    MobSave.claim(quest.id, periodKey(quest.period));
    MobSave.addGems(quest.reward);
}

/** Counts something for the competition (today's and this week's). */
export function count(stat: RankStat, amount = 1): void {
    MobSave.addStat(stat, amount, currentKeys());
}

/** A story level won: its crowns, and the level counted. */
export function storyWon(): number {
    count('levels');
    count('crowns', SETTINGS.crowns.story);
    return SETTINGS.crowns.story;
}

/** A counted arena match over: what it destroyed counts (towers, crowns), and a win; the crowns it earned. */
export function matchOver(won: boolean, towers: number, cannon: boolean): number {
    const crowns = towers * SETTINGS.crowns.tower + (cannon ? SETTINGS.crowns.cannon : 0);
    count('towers', towers);
    count('crowns', crowns);
    if (won) count('arenaWins');
    return crowns;
}
