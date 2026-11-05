// Ranking.ts
//
// The competition's daily and weekly rankings, and the goals that pay coins. A round pays stars by where you came. There's
// no server: the other players are made up, their scores worked out from ui/ufo.json `ranking` so that the top always looks
// within reach. A share (`falloff`) of the players stay ahead with every star you earn, so each star climbs the ranking, fast
// at first; the same sum gives what each of the top places has.

import { DESIGN } from './UfoConfig';
import { hashWords, usernameFrom } from './Profile';
import { UfoProgress } from './UfoProgress';

export type RankingPeriod = 'daily' | 'weekly';

export interface RankingGoal {
    id: string;
    period: RankingPeriod;
    type: 'stars' | 'rank';
    /** So many stars, or at least this place. */
    value: number;
    reward: number;
}

export interface RankingRow {
    rank: number;
    name: string;
    face: string;
    color: number;
    stars: number;
    you: boolean;
}

const COLORS = [0xff7ab8, 0x6fc3ff, 0xffb347, 0xb98cff, 0x4fe0d0, 0xff6b6b, 0xffe066, 0x5fe87a];
const FACE_COUNT = 8;

const settings = () => DESIGN.ranking;
const playersIn = (period: RankingPeriod) => (period === 'daily' ? settings().dailyPlayers : settings().weeklyPlayers);
const falloffIn = (period: RankingPeriod) => (period === 'daily' ? settings().dailyFalloff : settings().weeklyFalloff);

/** The day this is, as a key. */
const dayKey = (date = new Date()) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

/** The Monday this week began on. */
function weekStart(date = new Date()): Date {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return monday;
}

export const periodKey = (period: RankingPeriod): string => (period === 'daily' ? dayKey() : `w${dayKey(weekStart())}`);

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

export const starsFor = (place: number): number => [settings().starsGold, settings().starsSilver, settings().starsBronze][place - 1] ?? 0;

export const starsIn = (period: RankingPeriod): number => UfoProgress.starsIn(period, periodKey(period));

/** The place this many stars gets. */
export function placeWith(stars: number, period: RankingPeriod): number {
    return Math.max(1, Math.ceil(playersIn(period) * falloffIn(period) ** stars));
}

export const placeIn = (period: RankingPeriod): number => placeWith(starsIn(period), period);

/** How many stars it takes to be at this place. */
function starsAt(rank: number, period: RankingPeriod): number {
    return Math.ceil(Math.log(rank / playersIn(period)) / Math.log(falloffIn(period)));
}

/** The top places, with you in them if you've got there. */
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
        // Different people in each ranking, and all period the same ones; nobody twice.
        let seed = hashWords(`${period}:${key}:${other}`);
        let name = usernameFrom(seed);
        for (let salt = 1; rows.some((row) => row.name === name); salt++) {
            seed = hashWords(`${period}:${key}:${other}:${salt}`);
            name = usernameFrom(seed);
        }
        rows.push({
            rank, name, face: `ProfileFace_s_0${seed % FACE_COUNT}`, color: COLORS[(seed >>> 8) % COLORS.length],
            stars: starsAt(rank, period), you: false,
        });
    }
    return rows;
}

export function yourRow(period: RankingPeriod): RankingRow {
    const { face, color } = UfoProgress.avatarLook;
    return { rank: placeIn(period), name: UfoProgress.username, face, color, stars: starsIn(period), you: true };
}

export const goals = (): RankingGoal[] => settings().goals as RankingGoal[];

export function goalTitle(goal: RankingGoal): string {
    const when = goal.period === 'daily' ? 'TODAY' : 'THIS WEEK';
    if (goal.type === 'stars') return `GET ${goal.value} STARS ${when}`;
    return goal.value === 1 ? `REACH 1ST ${when}` : `REACH TOP ${goal.value} ${when}`;
}

/** How far along it is, as words. */
export function goalProgress(goal: RankingGoal): string {
    if (goal.type === 'stars') return `${Math.min(starsIn(goal.period), goal.value)}/${goal.value}`;
    return `PLACE ${placeIn(goal.period)}`;
}

export const goalDone = (goal: RankingGoal): boolean =>
    (goal.type === 'stars' ? starsIn(goal.period) >= goal.value : placeIn(goal.period) <= goal.value);

export const goalClaimed = (goal: RankingGoal): boolean => UfoProgress.isGoalClaimed(goal.id, periodKey(goal.period));

export const goalClaimable = (goal: RankingGoal): boolean => goalDone(goal) && !goalClaimed(goal);

export const anyClaimable = (): boolean => goals().some(goalClaimable);

export function claimGoal(goal: RankingGoal): void {
    if (!goalClaimable(goal)) return;
    UfoProgress.claimGoal(goal.id, periodKey(goal.period));
    UfoProgress.addCoins(goal.reward);
}

/** A round's stars, in both rankings; how many it was. */
export function awardRound(place: number): number {
    const stars = starsFor(place);
    if (stars > 0) {
        for (const period of ['daily', 'weekly'] as RankingPeriod[]) UfoProgress.addStars(period, periodKey(period), stars);
    }
    return stars;
}
