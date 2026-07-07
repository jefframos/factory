import * as PIXI from 'pixi.js';
import { DomUiRoot } from '@core/dom-ui/DomUiRoot';

export type LeaderboardEntry = { name: string; value: number; score: number };

const WINDOW_SIZE = 5;
const AHEAD = 3;   // preferred count of better-ranked rows shown above you
const BEHIND = 1;  // preferred count of worse-ranked rows shown below you

/**
 * Production in-game leaderboard — pinned top-right, always showing a
 * fixed-size sliding window of 5 rows centered on the player (3 ranks
 * ahead + you + 1 behind by default), clamped at either end of the full
 * ranked list so it still always shows 5 total (more behind if you're
 * near the top, more ahead if you're near the bottom/last).
 */
export class LeaderboardPanel {
    readonly element: HTMLDivElement;
    private readonly bodyEl: HTMLDivElement;
    private lastEntries: LeaderboardEntry[] = [];

    constructor() {
        const isMobile = PIXI.isMobile.any;

        this.element = document.createElement('div');
        Object.assign(this.element.style, {
            position: 'fixed',
            top: isMobile ? '8px' : '12px',
            right: isMobile ? '8px' : '12px',
            width: isMobile ? '150px' : '220px',
            background: 'rgba(16, 20, 30, 0.55)',
            borderRadius: '10px',
            padding: isMobile ? '2px 0' : '4px 0',
            fontFamily: 'inherit',
            fontSize: isMobile ? '10px' : '13px',
            color: '#fff',
            boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
        });

        this.bodyEl = document.createElement('div');
        this.element.appendChild(this.bodyEl);

        DomUiRoot.instance.mount(this.element);
        this.hide(); // shown once via show() on the initial server join — see BaseDemoScene.handleJoinServer
    }

    /** Shown once on the initial server join, not on every death/respawn — see BaseDemoScene. */
    show(): void {
        this.element.style.display = '';
    }

    hide(): void {
        this.element.style.display = 'none';
    }

    update(entries: LeaderboardEntry[]): void {
        this.lastEntries = entries;
        this.render();
    }

    private render(): void {
        const sorted = [...this.lastEntries].sort((a, b) => b.score - a.score);
        const youIndex = sorted.findIndex(e => e.name === 'You');
        const { start, end } = windowAround(sorted.length, youIndex, WINDOW_SIZE, AHEAD, BEHIND);

        this.bodyEl.innerHTML = '';
        for (let i = start; i <= end; i++) {
            this.bodyEl.appendChild(leaderboardRow(i, sorted[i]));
        }
    }

    destroy(): void {
        DomUiRoot.instance.unmount(this.element);
    }
}

/** Shared row renderer — used by both the live in-game panel and the static End Game rank list (see PlayerFlowController.renderEndGame). */
export function leaderboardRow(index: number, entry: LeaderboardEntry): HTMLDivElement {
    const isYou = entry.name === 'You';
    const row = document.createElement('div');
    Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        padding: '4px 12px',
        background: isYou ? 'rgba(78, 205, 196, 0.16)' : (index % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'transparent'),
    });

    const left = document.createElement('div');
    Object.assign(left.style, { display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' });

    const marker = document.createElement('span');
    marker.textContent = isYou ? '▸' : '';
    Object.assign(marker.style, { color: '#ff6b5e', fontSize: '11px', width: '8px', flexShrink: '0' });

    const label = document.createElement('span');
    label.textContent = `${index + 1}. ${entry.name}`;
    Object.assign(label.style, {
        color: isYou ? '#4ecdc4' : '#fff',
        fontWeight: isYou ? 'bold' : 'normal',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    });

    left.appendChild(marker);
    left.appendChild(label);

    const score = document.createElement('span');
    score.textContent = `${entry.score}`;
    Object.assign(score.style, {
        color: isYou ? '#4ecdc4' : '#fff',
        fontWeight: isYou ? 'bold' : 'normal',
        flexShrink: '0',
    });

    row.appendChild(left);
    row.appendChild(score);
    return row;
}

/**
 * Clamps a [start, end] window of `size` indices into [0, total-1], biased
 * toward `ahead` entries above `centerIndex` and `behind` below it — sliding
 * the whole window toward whichever side has room when the other side runs
 * out (near the top or bottom of the list), so it always covers `size`
 * entries unless the list itself is smaller than that.
 */
export function windowAround(total: number, centerIndex: number, size: number, ahead: number, behind: number): { start: number; end: number } {
    if (total <= size || centerIndex < 0) return { start: 0, end: Math.max(0, total - 1) };

    let start = centerIndex - ahead;
    let end = centerIndex + behind;

    if (start < 0) {
        end += -start;
        start = 0;
    }
    if (end > total - 1) {
        start -= end - (total - 1);
        end = total - 1;
    }

    return { start: Math.max(0, start), end: Math.min(total - 1, end) };
}
