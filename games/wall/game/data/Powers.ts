// Powers.ts
//
// The power-ups the player sets off (ui/wall.json `powers`): two hands (each hit's followed by the other hand's) and auto hit
// (it hits on its own). Each is ready, then on for some seconds, then charging; they run together. Not saved: ready again
// with each session.

import { POWERS, PowerDef, PowerId } from './WallConfig';
import { WallProgress } from './WallProgress';

export interface Power {
    def: PowerDef;
    phase: 'ready' | 'active' | 'charging';
    /** Seconds it's on, or till it's ready. */
    left: number;
}

const all: Power[] = POWERS.map((def) => ({ def, phase: 'ready', left: 0 }));

export const Powers = {
    all,

    /** Reached. */
    there({ def }: Power): boolean {
        return WallProgress.best >= def.wall;
    },

    active(id: PowerId): boolean {
        return all.some(({ def, phase }) => def.id === id && phase === 'active');
    },

    start(power: Power): void {
        power.phase = 'active';
        power.left = power.def.seconds;
    },

    /** How much of its time's left (on), or how charged it is. */
    share({ def, phase, left }: Power): number {
        if (phase === 'ready') return 1;
        return phase === 'active' ? left / def.seconds : 1 - left / def.charge;
    },

    /** Only while there's something to hit. */
    update(delta: number): void {
        for (const power of all) {
            if (power.phase === 'ready') continue;
            power.left -= delta;
            if (power.left > 0) continue;
            power.phase = power.phase === 'active' ? 'charging' : 'ready';
            power.left = power.phase === 'charging' ? power.def.charge : 0;
        }
    },
};
