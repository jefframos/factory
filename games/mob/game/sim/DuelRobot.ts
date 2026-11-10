// DuelRobot.ts
//
// A robot for an arena match (the fake multiplayer: game/data/ArenaConfig): it plays one side — the reds' cannon at the
// far end, or the blues' (the editor's AI-against-AI test, the headless simulator) — through that side's controls only:
// where its cannon's aimed (`aimX`, dragged at a finger's speed), holding or letting go (`firing`), and its unit cards
// once they've charged. Its Skill is the level robot's (Robot.ts, the profiles in Grading.ts: pro, average, casual,
// newbie), so the same names mean the same hands.
//
// Each look at the field (every `think` seconds):
//   - Defending: the other side's mobs coming at its buildings (as far as its `sight` reaches), each weighed by how soon
//     it'll get there against how soon shots fired now could meet it (`slack`: how early it reacts), less what its own
//     mobs already in front of it will do (`coverage`). The bunch most in need, it aims under.
//   - Attacking: otherwise. A planner (`planning`, now and then) goes for the other side's weakest building — through
//     one of its own gates if one's on the way, and feeding its own houses some of the time; the rest aim at their
//     biggest gate, as anyone would at first sight.
//   - Its hand: how far off it aims (`aimNoise`), how fast it drags, how often it wanders off; the best let go before
//     running dry (`burst`), so the cannon never locks.
//   - Cards: played `cardDelay` seconds (on average) after they charge — sometimes forgotten for a while — a giant, a
//     truck or a car at the biggest thing coming at it (or the weakest building), the UFO straight away.

import { BLUE, Battle, Cannon, RED, Target } from '../battle/Battle';
import { ARENA, TUNING } from '../data/MobConfig';
import { cardStat } from '../data/Settings';
import { RobotCard, Skill } from './Robot';

/** Defending: the most hits a mob counts for, the pressure from which it's answered, the least a bunch must weigh. */
const PRESSURE = { hp: 4, from: 0.35, least: 0.4 };
/** How far either side of a mob counts as under it (units). */
const REACH = 1.3;
/** Where shots leave a cannon (from its end), and where its buildings' line is. */
const MUZZLE = 1.1;
const LINE = 0.6;
/** A gate this close (across) to the lane to a building is on the way. */
const ON_THE_WAY = 2.6;
/** How often a planner feeds a house of its own (a share of its attacking looks). */
const FEED = 0.3;

interface CardState extends RobotCard {
    charge: number;
    playAt: number;
    aimingSince: number;
}

export class DuelRobot {
    private aim = 0;
    private nextThink = 0;
    private releaseUntil = 0;
    private readonly cards: CardState[];
    private readonly cannon: Cannon;
    /** Which way its mobs go (z: -1 up the field, the blues; +1 down it, the reds). */
    private readonly forward: number;
    private smart = false;
    private modeUntil = 0;
    private feeding = false;
    /** When it'll press the boost it may use (NaN: it may not now). */
    private boostAt = NaN;

    public constructor(private readonly battle: Battle, private readonly team: number, private readonly skill: Skill, cards: readonly RobotCard[], private readonly random: () => number = Math.random) {
        this.cards = cards.map((card) => ({ ...card, charge: 0, playAt: NaN, aimingSince: NaN }));
        this.cannon = team === BLUE ? battle : battle.red;
        this.forward = team === BLUE ? -1 : 1;
        this.aim = this.cannon.aimX;
    }

    /** Before each battle step: look (now and then), drag the cannon, hold or let go, play cards. */
    public step(dt: number): void {
        const b = this.battle;
        const c = this.cannon;
        if (b.state !== 'playing') return;
        const t = b.time;
        this.chargeCards(dt);
        const card = this.cards.find((entry) => entry.charge >= 1 && t >= entry.playAt) ?? null;
        if (t >= this.nextThink) {
            this.decide(card);
            this.nextThink = t + this.skill.think * (0.7 + this.random() * 0.6);
        }
        const most = this.skill.dragSpeed * dt;
        c.aimX += Math.max(-most, Math.min(most, this.aim - c.aimX));
        if (this.skill.burst && !c.overheated && c.firing && c.energy >= 0 && c.energy < 2) this.releaseUntil = t + TUNING.rechargeDelay + 0.45;
        c.firing = t >= this.releaseUntil;
        if (card) this.tryPlay(card, t);
        // Behind: the boost, once it's noticed (as a card is).
        if (b.canBoost(this.team)) {
            if (Number.isNaN(this.boostAt)) this.boostAt = t + this.skill.cardDelay * (0.5 + this.random());
            if (t >= this.boostAt) {
                b.boost(this.team);
                this.boostAt = NaN;
            }
        } else this.boostAt = NaN;
    }

    // ------------------------------------------------------------------ the field from its side

    /** How far from its own end z is (0 at its cannon, the field's length at the other's). */
    private fromHome(z: number): number {
        return this.team === BLUE ? -z : z - ARENA.baseZ;
    }

    private get length(): number {
        return -ARENA.baseZ;
    }

    /** Its own buildings, and the other side's. */
    private get own(): Target[] {
        return this.team === BLUE ? this.battle.blueTargets : this.battle.targets;
    }

    private get theirs(): Target[] {
        return this.team === BLUE ? this.battle.targets : this.battle.blueTargets;
    }

    // ------------------------------------------------------------------ decisions

    private decide(card: CardState | null): void {
        const range = ARENA.cannonRange;
        let target: number;
        const threat = this.threatAim();
        if (this.random() < this.skill.wander) target = (this.random() * 2 - 1) * range;
        else if (threat !== null) target = threat;
        else if (card && card.kind !== 'saucer') target = this.unitAim();
        else target = this.attackAim();
        const noise = (this.random() + this.random() + this.random() - 1.5) * this.skill.aimNoise * 1.2;
        this.aim = Math.max(-range, Math.min(range, target + noise));
        if (!Number.isFinite(this.aim)) this.aim = this.cannon.cannonX;
    }

    /** The x to defend, if the other side's mobs need answering (see the top); null when none do. */
    private threatAim(): number | null {
        const b = this.battle;
        const s = this.skill;
        const sight = this.length * s.sight;
        const rate = b.fireRateOf(this.cannon);
        const xs: number[] = [];
        const ws: number[] = [];
        // Its own mobs, where they are (to see what's in front of each of theirs).
        const mineX: number[] = [];
        const mineD: number[] = [];
        const mineHp: number[] = [];
        for (let i = 0; i < b.count; i++) {
            if (b.team[i] !== this.team || b.leaving[i] > 0) continue;
            mineX.push(b.x[i]);
            mineD.push(this.fromHome(b.z[i]));
            mineHp.push(Math.min(b.hp[i], 20));
        }
        for (let i = 0; i < b.count; i++) {
            if (b.team[i] === this.team || b.leaving[i] > 0) continue;
            const d = this.fromHome(b.z[i]);
            if (d > sight) continue;
            const speed = TUNING.blueSpeed * (b.big[i] ? TUNING.giantSpeed : 1);
            const toLine = Math.max(0, d - LINE) / speed;
            const meet = Math.max(0, d - (MUZZLE - b.cannonZ)) / (TUNING.blueSpeed + speed);
            const hp = b.hp[i];
            const window = meet + Math.min(hp, PRESSURE.hp) / rate + s.slack;
            const pressure = window / Math.max(0.1, toLine);
            if (pressure < PRESSURE.from) continue;
            let cover = 0;
            for (let k = 0; k < mineX.length; k++) if (mineD[k] < d && Math.abs(mineX[k] - b.x[i]) < REACH) cover += mineHp[k];
            const left = hp - cover * s.coverage;
            if (left <= 0) continue;
            xs.push(b.x[i]);
            ws.push(Math.min(left, PRESSURE.hp) * pressure * pressure);
        }
        if (!xs.length) return null;
        let best = -1;
        let bestWeight = 0;
        for (let k = 0; k < xs.length; k++) {
            let weight = 0;
            for (let j = 0; j < xs.length; j++) if (Math.abs(xs[j] - xs[k]) < REACH) weight += ws[j];
            if (weight > bestWeight) {
                bestWeight = weight;
                best = k;
            }
        }
        if (best < 0 || bestWeight < PRESSURE.least) return null;
        let sum = 0;
        let weights = 0;
        for (let j = 0; j < xs.length; j++) {
            if (Math.abs(xs[j] - xs[best]) >= REACH) continue;
            sum += xs[j] * ws[j];
            weights += ws[j];
        }
        return sum / weights;
    }

    /** The other side's weakest building still standing (its cannon only once it's low: it ends the match). */
    private weakest(): Target | null {
        let best: Target | null = null;
        let bestScore = Infinity;
        for (const target of this.theirs) {
            if (!target.alive || target.shielded) continue;
            const score = target.hp * (target.kind === 'cannon' ? 0.7 : 1);
            if (score < bestScore) {
                bestScore = score;
                best = target;
            }
        }
        return best;
    }

    /** Its own gates (unlocked first): x and value. */
    private ownGates(): { x: number; value: number; locked: boolean }[] {
        const red = this.team === RED;
        return this.battle.gates.filter((gate) => (gate.team === 'red') === red).map((gate) => ({ x: gate.nowX, value: gate.value, locked: gate.locked }));
    }

    private attackAim(): number {
        const b = this.battle;
        if (b.time >= this.modeUntil) {
            this.smart = this.random() < this.skill.planning;
            this.feeding = this.smart && this.random() < FEED;
            this.modeUntil = b.time + 3 + this.random() * 2;
        }
        const gates = this.ownGates();
        if (this.smart) {
            // Feeding a house of its own (it makes a unit), now and then.
            if (this.feeding) {
                const red = this.team === RED;
                const pad = b.pads.find((p) => (p.team === 'red') === red);
                if (pad) return pad.x;
            }
            const weak = this.weakest();
            if (weak) {
                // Through a gate on the way there, the best of them, if there's one.
                let best: { x: number; value: number } | null = null;
                for (const gate of gates) {
                    if (gate.locked || Math.abs(gate.x - weak.x) > ON_THE_WAY) continue;
                    if (!best || gate.value > best.value) best = gate;
                }
                return best ? best.x : weak.x;
            }
        }
        let best: { x: number; score: number } | null = null;
        for (const gate of gates) {
            const score = gate.value - (gate.locked ? 100 : 0);
            if (!best || score > best.score) best = { x: gate.x, score };
        }
        return best ? best.x : this.weakest()?.x ?? 0;
    }

    /** Where to send a unit card: at the biggest thing of theirs coming (a good player does), else the weakest building. */
    private unitAim(): number {
        const b = this.battle;
        if (this.skill.planning >= 0.5) {
            let giant = -1;
            for (let i = 0; i < b.count; i++) {
                if (b.team[i] === this.team || !b.big[i] || b.leaving[i] > 0) continue;
                if (this.fromHome(b.z[i]) > this.length * 0.6) continue;
                if (giant < 0 || this.fromHome(b.z[i]) < this.fromHome(b.z[giant])) giant = i;
            }
            if (giant >= 0) return b.x[giant];
        }
        return this.weakest()?.x ?? 0;
    }

    // ------------------------------------------------------------------ cards

    private chargeCards(dt: number): void {
        const t = this.battle.time;
        for (const card of this.cards) {
            if (card.charge >= 1) continue;
            card.charge = Math.min(1, card.charge + dt / Math.max(0.1, cardStat(card.kind, 'seconds', card.level) ?? 20));
            if (card.charge < 1) continue;
            const forgot = this.random() < this.skill.cardForget ? 10 + this.random() * 20 : 0;
            card.playAt = t + this.skill.cardDelay * (0.5 + this.random()) + forgot;
            card.aimingSince = NaN;
        }
    }

    private tryPlay(card: CardState, t: number): void {
        const c = this.cannon;
        if (Number.isNaN(card.aimingSince)) card.aimingSince = t;
        const waited = t - card.aimingSince;
        const ready = card.kind === 'saucer' || Math.abs(c.cannonX - this.aim) < 0.5 || waited > 0.4 + this.skill.think * 2;
        if (!ready) return;
        this.battle.spawnUnit(card.kind, { hp: cardStat(card.kind, 'hp', card.level), damage: cardStat(card.kind, 'damage', card.level) }, this.team);
        card.charge = 0;
        card.playAt = NaN;
    }
}
