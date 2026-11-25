// PowerSurge.ts
//
// The rewarded tractor's power (ui/dig.json chests.power; one fixed offer in The Deep per mine:
// PowerChestSpawner): for a few seconds the miner digs with a better tractor than the one they own — `tool`, or one tier
// above the one owned if that's higher — its blades sharper (powerBonus) and a little faster. While it lasts nothing goes into the backpack: every block is cashed on the spot,
// so a full bag never cuts the moment short (MiningController). It's the early taste of what the upgrades lead to;
// when it runs out the HUD says which tool to buy to keep it.
//
// Not saved: a reload ends it. The clock only runs while gameplay is active (DigScene), so a menu doesn't eat it.

import { DIG, ToolDef, toolAt } from '../data/DigConfig';
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

    /** Seconds between hits on foot. */
    get hitInterval(): number {
        return DigProgress.hitInterval;
    },
    /** Digging power right now; and how fast the tractor's blades chew, what they dig across. */
    get power(): number {
        return tool ? tool.power + DigProgress.bladesLevel + DIG.chests.power.powerBonus : DigProgress.power;
    },
    get digRate(): number {
        return DigProgress.digRate * (tool ? ((tool.rate ?? 1) / (DigProgress.tool.rate ?? 1)) * DIG.chests.power.speedMultiplier : 1);
    },
    get width(): number {
        return tool ? tool.width * (DigProgress.width / DigProgress.tool.width) : DigProgress.width;
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
        return toolAt(Math.max(floor, DigProgress.toolLevel + 1));
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
