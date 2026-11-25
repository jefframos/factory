// Fight.ts
//
// What waits behind a wall (ui/wall.json `enemies`): some minions, or, behind every few walls, a boss. A boss has to go down
// before its time runs out; if it doesn't, it vanishes and minions come instead, wave after wave (they pay), until the player
// calls it back. All of it can be switched off (WallConfig's enemiesOn): then there's never one.

import * as THREE from 'three';
import { ENEMIES, EnemyKind, bossAt, bossKind, fightAt, minionKind, wallAt } from '../data/WallConfig';
import { WallProgress } from '../data/WallProgress';
import { Enemies, Enemy, EnemySpec } from './Enemies';

/** Over, the fight's done after this long (seconds); a boss that's left, its minions come after this long. */
const AFTER = { won: 0.75, lost: 1.1 };
/** Where they stand: across the gate, two rows. */
/** Debug's line-up: how small, how far apart. */
const LINE_UP = { size: 0.31, across: 1.18, up: 2.25 };
const ROWS = { x: 1.15, z: -0.5, back: 0.75 };

export interface FightActions {
    /** It's over: on to the next wall. */
    won(boss: boolean): void;
    /** The boss's time ran out. */
    lost(): void;
    /** A boss comes. */
    bossComes(name: string): void;
}

/** A boss as what's spawned: one, or its pair (their health shared out), `size` times as big. */
function bossSpecs(kind: EnemyKind, hp: number, home: THREE.Vector3, size = 1): EnemySpec[] {
    const ones = kind.pair ?? [kind];
    return ones.map((one) => ({
        model: one.model, height: one.height * size, float: one.float, tint: one.tint, bright: one.bright, coat: one.coat, pace: one.pace ?? 0.8, boss: true,
        hp: hp / ones.length, home: home.clone().setX(home.x + (one.x ?? 0) * size),
    }));
}

export class Fight {
    public kind?: 'boss' | 'minions';
    /** The boss got away: minions, until it's called back. */
    public farming = false;
    /** Seconds the boss has left. */
    public timeLeft = 0;
    private number = 0;
    private total = 1;
    /** The boss (a pair's two). */
    private bosses: Enemy[] = [];
    private wait = 0;
    private over = false;

    public constructor(public readonly enemies: Enemies, private readonly actions: FightActions) {}

    public get on(): boolean {
        return this.kind !== undefined;
    }

    /** The boss is there to be hit. */
    public get bossThere(): boolean {
        return this.bosses.some((boss) => boss.alive);
    }

    /** What's left of them (1 all, 0 none). */
    public get share(): number {
        if (this.total <= 0) return 0;
        return this.enemies.all.reduce((sum, enemy) => sum + (enemy.alive ? enemy.hp : 0), 0) / this.total;
    }

    /** Their health: what's left, and all of it. */
    public get life(): { left: number; total: number } {
        return { left: this.share * this.total, total: this.total };
    }

    public get timeShare(): number {
        return Math.max(0, this.timeLeft / ENEMIES.boss.seconds);
    }

    public get title(): string {
        if (this.kind === 'boss' && !this.farming) return bossKind(this.number, WallProgress.rewinds).name;
        if (this.farming) return 'MINIONS!';
        return `${minionKind(this.number).name} x${this.enemies.alive.length}`;
    }

    /** Wall `number`'s fight begins (or goes on: `farming`, its boss got away before). */
    public start(number: number, farming: boolean): void {
        this.stop();
        this.number = number;
        this.kind = fightAt(number);
        this.over = false;
        if (this.kind === 'boss') {
            this.farming = farming;
            if (farming) this.spawnMinions(ENEMIES.farm.count, ENEMIES.farm.hp);
            else this.spawnBoss();
        } else if (this.kind === 'minions') {
            const { count, more, most, hp } = ENEMIES.minions;
            this.spawnMinions(Math.min(most, count + Math.floor(number / more)), hp);
        }
    }

    /** The boss again. */
    public retry(): void {
        if (!this.farming || this.kind !== 'boss') return;
        this.enemies.leave();
        this.farming = false;
        this.over = false;
        this.spawnBoss();
    }

    public stop(): void {
        this.enemies.clear();
        this.kind = undefined;
        this.farming = false;
        this.bosses = [];
        this.over = false;
    }

    private spawnBoss(): void {
        const kind = bossKind(this.number, WallProgress.rewinds);
        const hp = wallAt(this.number).hp * ENEMIES.boss.hp;
        this.total = hp;
        this.timeLeft = ENEMIES.boss.seconds;
        this.bosses = bossSpecs(kind, hp, new THREE.Vector3(0, 0, -1.1)).map((spec) => this.enemies.spawn(spec));
        this.actions.bossComes(kind.name);
    }

    private spawnMinions(count: number, share: number): void {
        const kind = minionKind(this.number);
        const hp = Math.max(1, wallAt(this.number).hp * share);
        for (let i = 0; i < count; i++) {
            const along = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
            const home = new THREE.Vector3(along * ROWS.x + (Math.random() - 0.5) * 0.2, 0, ROWS.z - (i % 2) * ROWS.back);
            // (The flying ones, high and low.)
            const float = kind.float === undefined ? undefined : kind.float + (i % 2) * 0.8;
            this.enemies.spawn({ model: kind.model, height: kind.height * (0.92 + Math.random() * 0.16), float, tint: kind.tint, bright: kind.bright, pace: kind.pace ?? 1, hp, home });
        }
        this.total = hp * count;
        this.bosses = [];
    }

    /** One's hit; what that took off it, and whether it did for it. */
    public damage(enemy: Enemy, damage: number, strong: boolean): { dealt: number; killed: boolean } {
        const dealt = Math.min(enemy.hp, damage);
        return { dealt, killed: this.enemies.hit(enemy, damage, strong) };
    }

    public update(delta: number): void {
        this.enemies.update(delta);
        if (!this.kind || delta <= 0) return;
        const none = this.enemies.alive.length === 0;
        if (this.over) {
            this.wait -= delta;
            if (this.wait > 0) return;
            const boss = this.kind === 'boss';
            this.stop();
            this.actions.won(boss);
            return;
        }
        if (this.kind === 'boss' && !this.farming) {
            if (none) {
                this.over = true;
                this.wait = AFTER.won;
                return;
            }
            // (Its time runs once it's there.)
            if (this.bosses.some((boss) => boss.phase === 'idle')) this.timeLeft -= delta;
            if (this.timeLeft > 0) return;
            this.enemies.leave();
            this.bosses = [];
            this.farming = true;
            this.wait = AFTER.lost;
            WallProgress.setFarming(true);
            this.actions.lost();
            return;
        }
        if (!none) return;
        if (this.farming) {
            this.wait -= delta;
            if (this.wait > 0) return;
            this.wait = ENEMIES.farm.wait;
            this.spawnMinions(ENEMIES.farm.count, ENEMIES.farm.hp);
            return;
        }
        this.over = true;
        this.wait = AFTER.won;
    }

    /** Debug: every one of them done for. */
    public killAll(): void {
        for (const enemy of this.enemies.alive) this.enemies.hit(enemy, Infinity, true);
    }

    /** Debug: the `i`th boss, only to be looked at. */
    public preview(i: number, rewinds: number): EnemyKind {
        this.stop();
        const kind = bossAt(i, rewinds);
        bossSpecs(kind, 1, new THREE.Vector3(0, 0, -1.1)).forEach((spec) => this.enemies.spawn(spec));
        return kind;
    }

    /** Debug: twelve of them from the `i`th on, small, in rows (the next ones over the first). */
    public lineUp(i: number, rewinds: number): void {
        this.stop();
        for (let k = 0; k < 12; k++) {
            const kind = bossAt(i + k, rewinds);
            const home = new THREE.Vector3(((k % 4) - 1.5) * LINE_UP.across, 0, -0.5);
            const up = Math.floor(k / 4) * LINE_UP.up + 0.15;
            bossSpecs(kind, 1, home, LINE_UP.size * (kind.pair ? 0.8 : 1)).forEach((spec) => this.enemies.spawn({ ...spec, float: up / spec.height }));
        }
    }

    /** A spot on the boss, for the weak spot. */
    public weakAt(out: THREE.Vector3): THREE.Vector3 | null {
        const there = this.bosses.filter((boss) => boss.alive);
        const boss = there[Math.floor(Math.random() * there.length)];
        if (!boss) return null;
        const { height } = boss.spec;
        boss.middle(out);
        out.x += (Math.random() - 0.5) * height * 0.4;
        out.y += (Math.random() - 0.4) * height * 0.5;
        return out;
    }
}
