// RivalDirector.ts
//
// Keeps the rivals fair, watching over them all so a round stays playable:
//
// - Each rival is held to a share of the player's size (`rivals.ratios`): most at or under it, one a bully over it. At its
//   cap it stops eating and idles; if the player's shrunk it eases down to it. So they don't turn into giants out of view.
//   Under its cap by much, it's pulled back up: the player never ends up alone among tiny ones.
// - Only one rival hunts the player at a time, for a while, then none for a while.
// - Nobody hunts for a good while after the player's been eaten, or while the player's holding still.
// - A hunter can only eat the player once it's been on screen a moment: no being eaten by something never seen.
//
// In a level to eat everything (`gentle`) nobody hunts, and all stay small enough for the player to eat.
//
// What isn't hunting keeps its distance if it could eat the player (Rival.ts).

import type * as THREE from 'three';
import { DESIGN } from '../data/UfoConfig';
import type { Rival } from './Rival';
import type { Saucer } from './Saucer';

export interface Directed {
    saucer: Saucer;
    rival: Rival;
    /** Its share of the player's size. */
    ratio: number;
    /** How long it's been on screen, just now. */
    seen: number;
}

export class RivalDirector {
    private hunter: Directed | null = null;
    /** How much longer the hunter hunts, or how long until one may. */
    private huntLeft = 0;
    private restLeft: number;
    private stillFor = 0;

    /** `directed`: the rivals, ratios drawn from the settings, shuffled so the bully isn't always the same. */
    public constructor(private readonly directed: readonly Directed[], private readonly player: Saucer, private readonly gentle = false) {
        this.restLeft = DESIGN.rivals.restSeconds;
    }

    /** `moving`: the player's steering; `onScreen`: whether a saucer's in view. */
    public update(delta: number, input: THREE.Vector2, onScreen: (saucer: Saucer) => boolean): void {
        const { rivals } = DESIGN;
        const { player } = this;
        this.stillFor = input.lengthSq() > 0 ? 0 : this.stillFor + delta;
        const still = this.stillFor >= rivals.stillSeconds;

        for (const entry of this.directed) {
            entry.seen = entry.saucer.isAlive && onScreen(entry.saucer) ? entry.seen + delta : 0;
            const cap = player.targetRadius * (this.gentle ? Math.min(entry.ratio, rivals.gentleShare) : entry.ratio);
            entry.saucer.holdTo(cap, rivals.shrinkPerSecond, delta);
            // The rubber band: nobody gets left far behind.
            entry.saucer.pullUpTo(cap * rivals.floorShare, rivals.catchUp, delta);
            entry.rival.capped = entry.saucer.targetRadius >= cap;
        }

        if (this.gentle) return;
        this.restLeft = Math.max(0, this.restLeft - delta);
        if (this.hunter) {
            this.huntLeft -= delta;
            if (this.huntLeft <= 0 || still || !player.isAlive || !this.hunter.saucer.isAlive || !this.hunter.saucer.canEat(player)) this.stopHunting();
        } else if (this.restLeft <= 0 && !still && player.isAlive) {
            // The nearest that could eat the player.
            let nearest = Infinity;
            for (const entry of this.directed) {
                if (!entry.saucer.canEat(player)) continue;
                const gap = entry.saucer.position.distanceTo(player.position);
                if (gap < nearest) {
                    nearest = gap;
                    this.hunter = entry;
                }
            }
            if (this.hunter) this.huntLeft = rivals.huntSeconds;
        }
        for (const entry of this.directed) entry.rival.huntsPlayer = entry === this.hunter;
    }

    private stopHunting(): void {
        this.hunter = null;
        this.restLeft = DESIGN.rivals.restSeconds;
    }

    /** The player's been eaten: nobody comes after them for a good while. */
    public onPlayerEaten(): void {
        this.hunter = null;
        this.restLeft = DESIGN.rivals.afterEatenSeconds;
    }

    /** Whether this saucer's allowed to eat the player right now. */
    public mayEatPlayer(saucer: Saucer): boolean {
        return this.hunter?.saucer === saucer && this.hunter.seen >= DESIGN.rivals.seenSeconds;
    }

    /** Whether it's coming for the player: its arrow shows it. */
    public isHunting(saucer: Saucer): boolean {
        return this.hunter?.saucer === saucer;
    }
}
