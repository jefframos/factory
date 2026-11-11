// Robot.ts
//
// A robot player for the level grader (tools/grade-levels.ts): it plays a Battle the way a person would, through the
// same controls — where the cannon is aimed (`aimX`, its finger dragging there at a finger's speed), holding or letting
// go (`firing`), and tapping the unit cards once they've charged — with no peeking at anything a player couldn't see.
//
// How well it plays is its Skill:
//   - Defending: it watches the reds coming down (as far up the field as its `sight` reaches) and works out, for each,
//     whether it'll reach the danger line before shots fired now could meet it (`slack`: how early it reacts), and
//     whether the blues already in front of it are enough (`coverage`: a weak player ignores them and chases every red).
//     The bunch most in need, it aims under.
//   - Multiplying: otherwise it aims where shots do the most. The best players (`planning`) find that out by trying
//     every lane in a quick lookahead battle with no reds (a few shots each: what reaches the buildings, what the gates
//     multiply into, what breaks blocks and locked gates, what feeds a house, what a grinder eats); the rest aim at the
//     gate with the biggest number on it, as anyone would at first sight.
//   - Its hand: how often it looks again (`think`), how far off it aims (`aimNoise`), how fast it drags, and how often
//     it wanders off somewhere random (`wander`). The best let go before running dry (`burst`), so the cannon never
//     locks.
//   - Cards: played `cardDelay` seconds (on average) after they charge — sometimes forgotten for a while
//     (`cardForget`) — the giant, the truck and the car where they're needed most, the UFO straight away.

import { Battle, BLUE, RED } from '../battle/Battle';
import { ARENA, BattleConfig, TUNING, UNITS, needOf } from '../data/MobConfig';
import { CardKind, cardStat } from '../data/Settings';

export interface Skill {
    id: string;
    name: string;
    /** Seconds between looks at the field (each one a new decision). */
    think: number;
    /** How far off the aim lands (units, roughly the spread). */
    aimNoise: number;
    /** How fast the finger drags the cannon (units a second). */
    dragSpeed: number;
    /** How much of the field (from the cannon up) it watches for reds: 1 all of it. */
    sight: number;
    /** 0..1: how often it works out the best lane (the lookahead) rather than going for the biggest number. */
    planning: number;
    /** Seconds between lookaheads (also redone when the field changes: a block broken, a gate unlocked). */
    replan: number;
    /** 0..1: how much it trusts the blues already in front of a red to deal with it. */
    coverage: number;
    /** Seconds early it reacts to a red. */
    slack: number;
    /** Seconds (on average) before a charged card is played, and the chance one's forgotten for a while. */
    cardDelay: number;
    cardForget: number;
    /** Lets go before the cannon runs dry, so it never locks. */
    burst: boolean;
    /** The chance a look ends with it aiming somewhere random. */
    wander: number;
}

/** A card the robot has, at its level. */
export interface RobotCard {
    kind: CardKind;
    level: number;
}

/** The lookahead: shots fired per lane tried, its step, the lanes' spacing (at least), how much a broken block's hit and
 *  a house's blue are worth next to a hit on a building. */
const PROBE = { shots: 4, dt: 1 / 30, spacing: 0.5, most: 25, block: 0.5, house: 0.7 };
/** How far either side of a red counts as under it (units), and the bins blues are counted in. */
const COVER = { reach: 1.3, bin: 0.5 };
/** Defending: the most hits a red counts for, the pressure from which it's watched (its time to answer over its time to
 *  the line), and the least a bunch must weigh to be answered. */
const PRESSURE = { hp: 4, from: 0.35, least: 0.4 };
/** The near end, where shots leave the cannon (Battle's MUZZLE_Z). */
const MUZZLE_Z = -1.1;

interface CardState extends RobotCard {
    charge: number;
    /** When it'll be played (NaN: not charged yet). */
    playAt: number;
    /** When it started waiting for the cannon to be in place. */
    aimingSince: number;
}

export class Robot {
    private aim = 0;
    private nextThink = 0;
    private releaseUntil = 0;
    private readonly cards: CardState[];
    /** The lookahead's lanes and what each is worth; when it last ran; what the field looked like then. */
    private readonly lanes: number[];
    private laneValues: number[] = [];
    private plannedAt = -Infinity;
    private plannedFor = '';
    /** Working it out (the lookahead) or going for the biggest number, until when. */
    private smart = false;
    private modeUntil = 0;
    private readonly probeConfig: BattleConfig;
    /** Blues counted per x bin, nearer the cannon than each z (a running sum): how well a red is answered. */
    private readonly binsX: number;
    private readonly binsZ: number;
    private readonly cover: Float32Array;

    public constructor(private readonly battle: Battle, private readonly skill: Skill, cards: readonly RobotCard[], private readonly random: () => number = Math.random) {
        this.cards = cards.map((card) => ({ ...card, charge: 0, playAt: NaN, aimingSince: NaN }));
        const range = ARENA.cannonRange;
        const spacing = Math.max(PROBE.spacing, (range * 2) / (PROBE.most - 1));
        this.lanes = [];
        for (let x = -range; x <= range + 1e-6; x += spacing) this.lanes.push(x);
        this.probeConfig = { ...battle.config, redRate: 0, redRateEnd: 0, redGiantEvery: 0 };
        this.binsX = Math.ceil((ARENA.halfWidth * 2) / COVER.bin) + 1;
        this.binsZ = Math.ceil(-ARENA.baseZ) + 4;
        this.cover = new Float32Array(this.binsX * this.binsZ);
        this.aim = battle.aimX;
    }

    /** Before each battle step: look (now and then), drag the cannon, hold or let go, play cards. */
    public step(dt: number): void {
        const b = this.battle;
        if (b.state !== 'playing') return;
        const t = b.time;
        this.chargeCards(dt);
        const card = this.dueCard(t);
        if (t >= this.nextThink) {
            this.decide(card);
            this.nextThink = t + this.skill.think * (0.7 + this.random() * 0.6);
        }
        // The finger drags towards the aim.
        const most = this.skill.dragSpeed * dt;
        b.aimX += Math.max(-most, Math.min(most, this.aim - b.aimX));
        // Holding: the best let go before it runs dry (a short rest tops it up), the rest hold till it locks.
        if (this.skill.burst && !b.overheated && b.firing && b.energy >= 0 && b.energy < 2) this.releaseUntil = t + TUNING.rechargeDelay + 0.45;
        b.firing = t >= this.releaseUntil;
        if (card) this.tryPlay(card, t);
    }

    // ------------------------------------------------------------------ decisions

    private decide(card: CardState | null): void {
        const b = this.battle;
        const range = ARENA.cannonRange;
        let target: number;
        const threat = this.threatAim();
        if (this.random() < this.skill.wander) target = (this.random() * 2 - 1) * range;
        else if (threat !== null) target = threat;
        else if (card && card.kind !== 'saucer') target = this.unitAim();
        else target = this.attackAim();
        const noise = (this.random() + this.random() + this.random() - 1.5) * this.skill.aimNoise * 1.2;
        this.aim = Math.max(-range, Math.min(range, target + noise));
        if (!Number.isFinite(this.aim)) this.aim = b.cannonX;
    }

    /**
     * The x to defend, if a red needs answering: each red seen whose time to the line is about what shots fired now
     * need to meet and kill it (plus the skill's slack), less what the blues already in front of it will do; the bunch
     * of them most in need (within COVER.reach of one another). Null when none does.
     */
    private threatAim(): number | null {
        const b = this.battle;
        const s = this.skill;
        this.countCover();
        const sightZ = ARENA.dangerZ + (ARENA.baseZ - ARENA.dangerZ) * s.sight;
        const xs: number[] = [];
        const ws: number[] = [];
        for (let i = 0; i < b.count; i++) {
            if (b.team[i] !== RED || b.leaving[i] > 0) continue;
            const z = b.z[i];
            if (z < sightZ) continue;
            const speed = TUNING.redSpeed * (b.big[i] ? TUNING.giantSpeed : 1);
            const toLine = (ARENA.dangerZ - z) / speed;
            const meet = Math.max(0, -z + MUZZLE_Z) / (TUNING.blueSpeed + speed);
            const hp = b.hp[i];
            // Pressure: the time it'll take to answer over the time there is (past 1: it's late already). Any red
            // over the line loses, so the one about to cross counts most, and a big one only so much more than a
            // plain one (else a giant far off draws every shot while plain reds walk in at the side).
            const window = meet + Math.min(hp, PRESSURE.hp) / b.fireRate + s.slack;
            const pressure = window / Math.max(0.1, toLine);
            if (pressure < PRESSURE.from) continue;
            const left = hp - this.coverAt(b.x[i], z) * s.coverage;
            if (left <= 0) continue;
            xs.push(b.x[i]);
            ws.push(Math.min(left, PRESSURE.hp) * pressure * pressure);
        }
        if (!xs.length) return null;
        let best = -1;
        let bestWeight = 0;
        for (let k = 0; k < xs.length; k++) {
            let weight = 0;
            for (let j = 0; j < xs.length; j++) if (Math.abs(xs[j] - xs[k]) < COVER.reach) weight += ws[j];
            if (weight > bestWeight) {
                bestWeight = weight;
                best = k;
            }
        }
        if (best < 0 || bestWeight < PRESSURE.least) return null;
        let sum = 0;
        let weights = 0;
        for (let j = 0; j < xs.length; j++) {
            if (Math.abs(xs[j] - xs[best]) >= COVER.reach) continue;
            sum += xs[j] * ws[j];
            weights += ws[j];
        }
        return sum / weights;
    }

    /** Blue hits per x bin, summed from the cannon up to each z: cover[xb * binsZ + zb] = those nearer than zb. */
    private countCover(): void {
        const b = this.battle;
        const cover = this.cover;
        cover.fill(0);
        for (let i = 0; i < b.count; i++) {
            if (b.team[i] !== BLUE || b.leaving[i] > 0) continue;
            const xb = this.binX(b.x[i]);
            const zb = Math.min(this.binsZ - 1, Math.max(0, Math.floor(-b.z[i])));
            cover[xb * this.binsZ + zb] += Math.min(b.hp[i], 20);
        }
        // Running sums: each bin then holds the blues nearer the cannon than it (not its own).
        for (let xb = 0; xb < this.binsX; xb++) {
            let sum = 0;
            for (let zb = 0; zb < this.binsZ; zb++) {
                const here = cover[xb * this.binsZ + zb];
                cover[xb * this.binsZ + zb] = sum;
                sum += here;
            }
        }
    }

    private binX(x: number): number {
        return Math.min(this.binsX - 1, Math.max(0, Math.floor((x + ARENA.halfWidth) / COVER.bin)));
    }

    /** The blues in front of a red at (x, z), within COVER.reach either side. */
    private coverAt(x: number, z: number): number {
        const zb = Math.min(this.binsZ - 1, Math.max(0, Math.floor(-z)));
        const from = this.binX(x - COVER.reach);
        const to = this.binX(x + COVER.reach);
        let sum = 0;
        for (let xb = from; xb <= to; xb++) sum += this.cover[xb * this.binsZ + zb];
        return sum;
    }

    /** Where shots do the most: the lookahead's best lane (a planning look), else the biggest number on a gate. */
    private attackAim(): number {
        const b = this.battle;
        if (b.time >= this.modeUntil) {
            this.smart = this.random() < this.skill.planning;
            this.modeUntil = b.time + 3 + this.random() * 2;
        }
        if (this.smart) {
            const lane = this.bestLane();
            if (lane !== null) return lane;
        }
        return this.biggestGate();
    }

    /** The gate with the biggest number (an open one before a locked one), else the nearest building still standing. */
    private biggestGate(): number {
        const b = this.battle;
        let best: { x: number; score: number } | null = null;
        for (const gate of b.gates) {
            const score = gate.value - (gate.locked ? 100 : 0);
            if (!best || score > best.score) best = { x: gate.nowX, score };
        }
        return best ? best.x : this.buildingAim();
    }

    /** The standing building nearest the cannon (where a unit or a shot with nothing better to do goes). */
    private buildingAim(): number {
        const b = this.battle;
        let best: number | null = null;
        for (const target of b.targets) if (target.alive && (best === null || Math.abs(target.x - b.cannonX) < Math.abs(best - b.cannonX))) best = target.x;
        return best ?? 0;
    }

    /** Where to send a unit card (a giant, a truck, a car): at the bunch of reds most in need (threatAim), else the lane
     *  that's best for shots too if it's worked out, else straight at a building. A good player sends it at a red
     *  giant first. */
    private unitAim(): number {
        // A red giant coming: the unit goes at it (the nearest to the line).
        const b = this.battle;
        let giant = -1;
        for (let i = 0; i < b.count; i++) if (b.team[i] === RED && b.big[i] && b.leaving[i] === 0 && (giant < 0 || b.z[i] > b.z[giant])) giant = i;
        if (giant >= 0 && this.skill.planning >= 0.5) return b.x[giant];
        if (this.skill.planning >= 0.5) {
            const lane = this.bestLane();
            if (lane !== null) return lane;
        }
        return this.buildingAim();
    }

    // ------------------------------------------------------------------ the lookahead

    /** The best lane (worked out again every `replan` seconds, or as soon as the field changes); null if none is worth anything. */
    private bestLane(): number | null {
        const b = this.battle;
        const shape = this.fieldShape();
        if (b.time - this.plannedAt >= this.skill.replan || shape !== this.plannedFor) {
            this.laneValues = this.lanes.map((x) => this.probe(x));
            this.plannedAt = b.time;
            this.plannedFor = shape;
        }
        let best = -1;
        let bestValue = 0;
        const top = Math.max(...this.laneValues);
        this.laneValues.forEach((value, k) => {
            // Near a tie, the one nearer where it's aiming now (no dashing across for nothing).
            const score = value - top * 0.04 * Math.abs(this.lanes[k] - this.aim);
            if (value > 0 && (best < 0 || score > bestValue)) {
                best = k;
                bestValue = score;
            }
        });
        return best < 0 ? null : this.lanes[best];
    }

    /** What changes which lane is best: blocks standing, gates locked, PUSH blocks in, buildings up. */
    private fieldShape(): string {
        const b = this.battle;
        return `${b.blocks.map((block) => (block.alive ? 1 : 0)).join('')}|${b.gates.map((gate) => (gate.locked ? 1 : 0)).join('')}|${b.pushBlocks.map((block) => (block.alive ? 1 : 0)).join('')}|${b.targets.map((target) => (target.alive ? 1 : 0)).join('')}`;
    }

    /**
     * A few shots fired from x now, in a copy of the field as it is (its blocks, locks, PUSH blocks, houses, moving
     * parts in step) with no reds, played on till they'd have reached the buildings: what they're worth — hits on a
     * building, plus hits on blocks and locked gates, plus blues fed to houses (each a share of the unit it makes).
     */
    private probe(x: number): number {
        const b = this.battle;
        let damage = 0;
        let made = 0;
        const probe = new Battle(this.probeConfig, {
            baseHit: (_x, _z, _hp, hit) => {
                // A unit's hit is counted as it's made (below), not again here.
                if (hit <= 2) damage += hit;
            },
            giant: (team, _x, _z, kind, card) => {
                if (team !== BLUE) return;
                const unit = card === 'bomb' ? 'bomb' : kind === 3 ? 'car' : kind === -1 ? 'saucer' : 'giant';
                made += UNITS[unit].damage * PROBE.house;
            },
        });
        probe.time = b.time;
        probe.fireLevel = b.fireLevel;
        probe.capacityLevel = b.capacityLevel;
        probe.rechargeLevel = b.rechargeLevel;
        b.gates.forEach((gate, k) => {
            probe.gates[k].locked = gate.locked;
            probe.gates[k].swingFrom = gate.swingFrom;
        });
        const blockHp = b.blocks.map((block) => (block.alive ? block.hp : 0));
        b.blocks.forEach((block, k) => {
            probe.blocks[k].alive = block.alive;
            probe.blocks[k].hp = block.hp;
        });
        b.pushBlocks.forEach((block, k) => {
            probe.pushBlocks[k].alive = block.alive;
            probe.pushBlocks[k].nowZ = block.nowZ;
        });
        const padCounts = b.pads.map((pad) => pad.count);
        b.pads.forEach((pad, k) => {
            probe.pads[k].count = pad.count;
        });
        b.targets.forEach((target, k) => {
            probe.targets[k].alive = target.alive;
            probe.targets[k].hp = target.alive ? 1e9 : 0;
        });
        probe.aimX = x;
        probe.cannonX = x;
        probe.energy = PROBE.shots;
        probe.firing = true;
        const horizon = b.time + (-ARENA.baseZ / TUNING.blueSpeed) * 1.5 + 1.5;
        // (Mobs in a pipe aren't on the field: it isn't over while there are some in there.)
        const piped = probe as unknown as { inPipes: unknown[] };
        while (probe.time < horizon) {
            probe.step(PROBE.dt);
            if (probe.overheated && probe.count === 0 && !piped.inPipes.length) break;
        }
        let broken = 0;
        probe.blocks.forEach((block, k) => {
            broken += Math.max(0, blockHp[k] - (block.alive ? block.hp : 0));
        });
        let fed = 0;
        probe.pads.forEach((pad, k) => {
            // What's still in the house towards its next unit (a unit made was counted as made).
            const kind = pad.kind ?? 'giant';
            const now = pad.count - padCounts[k];
            fed += (Math.max(0, now) / needOf(pad)) * UNITS[kind].damage * PROBE.house;
        });
        return damage + broken * PROBE.block + fed + made;
    }

    // ------------------------------------------------------------------ cards

    private chargeCards(dt: number): void {
        const t = this.battle.time;
        for (const card of this.cards) {
            if (card.charge >= 1) continue;
            card.charge = Math.min(1, card.charge + dt / Math.max(0.1, cardStat(card.kind, 'seconds', card.level) ?? 20));
            if (card.charge < 1) continue;
            // Charged: when it'll be noticed and played.
            const forgot = this.random() < this.skill.cardForget ? 10 + this.random() * 20 : 0;
            card.playAt = t + this.skill.cardDelay * (0.5 + this.random()) + forgot;
            card.aimingSince = NaN;
        }
    }

    /** The card due to be played now, if any. */
    private dueCard(t: number): CardState | null {
        return this.cards.find((card) => card.charge >= 1 && t >= card.playAt) ?? null;
    }

    /** A due card: played once the cannon's where it's wanted (a good player waits a moment for that; the UFO goes now). */
    private tryPlay(card: CardState, t: number): void {
        const b = this.battle;
        if (Number.isNaN(card.aimingSince)) card.aimingSince = t;
        const waited = t - card.aimingSince;
        const ready = card.kind === 'saucer' || Math.abs(b.cannonX - this.aim) < 0.5 || waited > 0.4 + this.skill.think * 2;
        if (!ready) return;
        b.spawnUnit(card.kind, { hp: cardStat(card.kind, 'hp', card.level), damage: cardStat(card.kind, 'damage', card.level) });
        card.charge = 0;
        card.playAt = NaN;
    }
}
