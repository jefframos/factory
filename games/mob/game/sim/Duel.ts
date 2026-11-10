// Duel.ts
//
// An arena match played headless by two robots (DuelRobot), for the editor's Arena tab (tools/duel-sim.ts): how a
// profile does against another, on an arena as it is. Both play the same way the game's robot does against a person.

import { BLUE, Battle, RED } from '../battle/Battle';
import { ArenaConfig, arenaBattle } from '../data/ArenaConfig';
import { useField } from '../data/MobConfig';
import { CARD_KINDS, CardKind } from '../data/Settings';
import { DuelRobot } from './DuelRobot';
import { SKILLS, seeded } from './Grading';
import { RobotCard } from './Robot';

/** A side of a match: who plays it (a SKILLS id), its cards (kind: level) and its cannon's upgrades. */
export interface MatchSide {
    skill: keyof typeof SKILLS;
    cards: Partial<Record<CardKind, number>>;
    fire: number;
    capacity: number;
    recharge: number;
}

/** How it went, from the blues' side: the result, when it ended, both sides' life left (and at the start). */
export interface MatchResult {
    result: 'won' | 'lost' | 'draw';
    time: number;
    blueHp: number;
    redHp: number;
    blueMax: number;
    redMax: number;
    /** Each side's buildings fallen. */
    blueDown: number;
    redDown: number;
}

const STEP = 1 / 60;

export function sideCards(side: MatchSide): RobotCard[] {
    return CARD_KINDS.filter((kind) => side.cards[kind] !== undefined).map((kind) => ({ kind, level: side.cards[kind]! }));
}

/** Plays `arena` with `blue` against `red`, on the luck `seed` gives (`redFirst`: the reds' robot acts first each step). */
export function playMatch(arena: ArenaConfig, blue: MatchSide, red: MatchSide, seed: number, redFirst = false): MatchResult {
    const random = seeded(seed);
    const before = Math.random;
    Math.random = random;
    try {
        const config = arenaBattle(arena);
        useField(config);
        const battle = new Battle(config, {});
        battle.faces = false;
        battle.fireLevel = blue.fire;
        battle.capacityLevel = blue.capacity;
        battle.rechargeLevel = blue.recharge;
        battle.red.fireLevel = red.fire;
        battle.red.capacityLevel = red.capacity;
        battle.red.rechargeLevel = red.recharge;
        const blueRobot = new DuelRobot(battle, BLUE, SKILLS[blue.skill], sideCards(blue), seeded(seed ^ 0x9e3779b9));
        const redRobot = new DuelRobot(battle, RED, SKILLS[red.skill], sideCards(red), seeded(seed ^ 0x85ebca6b));
        const most = config.duel!.seconds + 5;
        // Who acts first in a step has a small edge (their card's unit is out first): every other match, the other one.
        const [first, second] = redFirst ? [redRobot, blueRobot] : [blueRobot, redRobot];
        while (battle.state === 'playing' && battle.time < most) {
            first.step(STEP);
            second.step(STEP);
            battle.step(STEP);
        }
        const result = battle.state === 'won' ? 'won' : battle.state === 'lost' ? 'lost' : 'draw';
        return {
            result,
            time: Math.round(battle.time * 10) / 10,
            blueHp: battle.ownHp,
            redHp: battle.baseHp,
            blueMax: battle.ownHpMax,
            redMax: battle.baseHpMax,
            blueDown: battle.blueTargets.filter((t) => !t.alive).length,
            redDown: battle.targets.filter((t) => !t.alive).length,
        };
    } finally {
        Math.random = before;
    }
}
