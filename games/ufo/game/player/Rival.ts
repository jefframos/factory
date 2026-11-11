// Rival.ts
//
// A computer-played saucer's brain. A few times a second it looks around and decides, in this order: get away from a
// saucer that could eat it; chase one it could eat; head for the best thing to eat nearby (worth more, and closer, is
// better); else wander off somewhere. It steers like the player (an input, the same speed limits), slower by
// `rivals.speed` in ui/ufo.json, and slides off whatever's too tall for it, turning aside for a moment when it hits one.

import * as THREE from 'three';
import { DESIGN } from '../data/UfoConfig';
import type { UfoTown } from '../world/UfoTown';
import type { Saucer } from './Saucer';

/** How often it decides (seconds), jittered so they don't all think in one frame. */
const THINK = 0.45;
/** How far it notices a threat past that saucer's beam, and prey past its own (units; `PerRadius` more per unit of its radius). */
const SIGHT = { threat: 9, prey: 14, perRadius: 1.5 };
/** Where it wanders to, at most this far off. */
const WANDER = 40;
/** How long it turns aside after hitting something, and how far (radians). */
const DODGE = { seconds: 0.7, turn: 1.3 };
/** Now and then it just stops for a moment: at each look, the chance of it, and about how long. */
const REST = { chance: 0.05, seconds: 2 };
/** Close enough to a spot: it stops pushing. */
const ARRIVED = 0.4;

export class Rival {
    public readonly input = new THREE.Vector2();
    private readonly target = new THREE.Vector2();
    private thinking = Math.random() * THINK;
    private dodging = 0;
    private dodgeSide = 1;
    private chasing: Saucer | null = null;
    private readonly toTarget = new THREE.Vector2();
    /** Having a rest, now and then. */
    private resting = 0;
    /** At its size cap: it's stopped eating and just stands by (RivalDirector). */
    public capped = false;
    /** It's the one after the player right now (RivalDirector). */
    public huntsPlayer = false;

    /** `leaveGoal`: the level's goal isn't for it; `speed`: its share of the player's speed (versus: by the tier). */
    public constructor(private readonly me: Saucer, private readonly leaveGoal = false, private readonly speed = DESIGN.rivals.speed) {
        this.target.copy(me.position);
    }

    /** `player`: the one saucer it only goes for when it's told to, and otherwise keeps away from. */
    public update(delta: number, others: readonly Saucer[], town: UfoTown, player: Saucer): void {
        const { me } = this;
        if (!me.isAlive) {
            this.input.set(0, 0);
            return;
        }
        this.thinking -= delta;
        if (this.thinking <= 0) {
            this.thinking = THINK * (0.8 + Math.random() * 0.4);
            this.decide(others, town, player);
        }
        if (this.chasing) {
            if (this.chasing.isAlive) this.target.copy(this.chasing.position);
            else this.chasing = null;
        }
        if (me.bumped) {
            this.dodging = DODGE.seconds;
            this.dodgeSide = Math.random() < 0.5 ? -1 : 1;
        }
        this.toTarget.subVectors(this.target, me.position);
        const distance = this.toTarget.length();
        if (distance < ARRIVED) {
            this.input.set(0, 0);
            return;
        }
        this.toTarget.divideScalar(distance);
        if (this.dodging > 0) {
            this.dodging -= delta;
            this.toTarget.rotateAround(new THREE.Vector2(), DODGE.turn * this.dodgeSide);
        }
        this.input.copy(this.toTarget).multiplyScalar(this.speed);
    }

    private decide(others: readonly Saucer[], town: UfoTown, player: Saucer): void {
        const { me } = this;
        this.resting = Math.max(0, this.resting - THINK);
        const { position, radius, altitude } = me;
        this.chasing = null;
        let threat: Saucer | null = null;
        let prey: Saucer | null = null;
        let threatGap = Infinity;
        let preyGap = Infinity;
        for (const other of others) {
            if (other === me || !other.isAlive) continue;
            const gap = position.distanceTo(other.position);
            // The player's not fair game unless it's been told so: it stays well off instead.
            if (other === player && me.canEat(player) && !this.huntsPlayer) {
                if (gap < radius + DESIGN.rivals.keepAway && gap < threatGap) {
                    threat = other;
                    threatGap = gap;
                }
                continue;
            }
            if (other.canEat(me) && gap < other.radius + SIGHT.threat + SIGHT.perRadius * radius && gap < threatGap) {
                threat = other;
                threatGap = gap;
            } else if (me.canEat(other) && gap < radius + SIGHT.prey + SIGHT.perRadius * radius && gap < preyGap) {
                prey = other;
                preyGap = gap;
            }
        }
        if (threat) {
            // Directly away, far enough that it keeps going till the next look.
            this.target.subVectors(position, threat.position).setLength(WANDER).add(position);
            return;
        }
        // At its cap, or having a rest: it hangs about where it is.
        if (this.capped || this.resting > 0 || Math.random() < REST.chance) {
            if (this.resting <= 0 && !this.capped) this.resting = REST.seconds * (0.6 + Math.random() * 0.8);
            this.target.copy(position);
            return;
        }
        if (prey) {
            this.chasing = prey;
            this.target.copy(prey.position);
            return;
        }
        let best = 0;
        let found = false;
        const now = performance.now() / 1000;
        for (const item of town.items) {
            if (item.height > altitude || item.radius > radius || (this.leaveGoal && item.goal)) continue;
            // It's just pretended to eat this one, out of sight.
            if (item.sparedUntil !== undefined && item.sparedUntil > now) continue;
            const score = Math.sqrt(item.value + 0.5) / (Math.hypot(item.x - position.x, item.z - position.y) + 4);
            if (score <= best) continue;
            best = score;
            found = true;
            this.target.set(item.x, item.z);
        }
        if (found) return;
        const angle = Math.random() * Math.PI * 2;
        const x = position.x + Math.cos(angle) * WANDER;
        const z = position.y + Math.sin(angle) * WANDER;
        if (town.isOverIsland(x, z)) this.target.set(x, z);
    }
}
