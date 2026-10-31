// PowerSurge.ts
//
// The power chest's reward (ui/dig.json chests.power; it fades in ahead of the miner once per player:
// PowerChestSpawner): for a few seconds the miner digs with a better tool than the one they own — `tool` (the Mega
// Drill), or one tier above the tool owned if that's higher — and a little faster. While it lasts nothing goes into the backpack: every block is cashed on the spot,
// so a full bag never cuts the moment short (MiningController). It's the early taste of what the upgrades lead to;
// when it runs out the HUD says which tool to buy to keep it.
//
// Not saved: a reload ends it. The clock only runs while gameplay is active (DigScene), so a menu doesn't eat it.

import { DIG, ToolDef } from '../data/DigConfig';
import { DigProgress } from '../data/DigProgress';

let tool: ToolDef | undefined;
let left = 0;
let total = 0;

export const PowerSurge = {
    get active(): boolean {
        return tool !== undefined;
    },

    /** The surge's tool (undefined when none is running). */
    get tool(): ToolDef | undefined {
        return tool;
    },

    /** What the miner digs with right now: the surge's tool, or the one owned. */
    get digTool(): ToolDef {
        return tool ?? DigProgress.tool;
    },

    /** Seconds between hits right now (the owned tool's boosts and bonuses apply to the surge's too). */
    get hitInterval(): number {
        if (!tool) return DigProgress.hitInterval;
        return DigProgress.hitInterval * (tool.hitInterval / DigProgress.tool.hitInterval) / DIG.chests.power.speedMultiplier;
    },

    get secondsLeft(): number {
        return left;
    },

    /** 1 at the start, 0 when it runs out. */
    get fraction(): number {
        return total > 0 ? left / total : 0;
    },

    /** The tool a power chest would give now: one tier above the one owned, at least chests.power.tool. */
    nextTool(): ToolDef {
        const config = DIG.chests.power;
        const floor = Math.max(0, DIG.tools.findIndex((t) => t.id === config.tool));
        return DIG.tools[Math.min(DIG.tools.length - 1, Math.max(floor, DigProgress.toolLevel + 1))];
    },

    /** Starts (or restarts) a surge; returns its tool. */
    start(): ToolDef {
        tool = this.nextTool();
        total = left = DIG.chests.power.seconds;
        return tool;
    },

    /** Runs the clock; returns the surge's tool on the step it runs out. */
    update(delta: number): ToolDef | undefined {
        if (!tool) return undefined;
        left -= delta;
        if (left > 0) return undefined;
        const ended = tool;
        tool = undefined;
        left = total = 0;
        return ended;
    },

    /** Ends it at once without a word (leaving the mine). */
    clear(): void {
        tool = undefined;
        left = total = 0;
    },
};
