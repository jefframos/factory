import { CollapsiblePanel } from '@core/dom-ui/CollapsiblePanel';
import { DomUiRoot } from '@core/dom-ui/DomUiRoot';

export type LeaderboardEntry = { name: string; value: number; score: number };

const TOP_COUNT = 3;

/**
 * Production in-game leaderboard — collapsed by default (top 3 + your own
 * rank if you're not already in the top 3); the panel header's built-in
 * toggle (see CollapsiblePanel) expands it to the full sorted population.
 */
export class LeaderboardPanel {
    private readonly panel = new CollapsiblePanel({ corner: 'bottom-right', title: 'Leaderboard', defaultExpanded: false });
    private lastEntries: LeaderboardEntry[] = [];

    constructor() {
        DomUiRoot.instance.mount(this.panel.element);
        this.panel.onToggle(() => this.render());
    }

    update(entries: LeaderboardEntry[]): void {
        this.lastEntries = entries;
        this.render();
    }

    private render(): void {
        const sorted = [...this.lastEntries].sort((a, b) => b.score - a.score);
        const youIndex = sorted.findIndex(e => e.name === 'You');

        this.panel.setBodyContent(container => {
            if (this.panel.isExpanded) {
                sorted.forEach((entry, i) => container.appendChild(this.row(i + 1, entry)));
                return;
            }

            sorted.slice(0, TOP_COUNT).forEach((entry, i) => container.appendChild(this.row(i + 1, entry)));

            if (youIndex >= TOP_COUNT) {
                container.appendChild(this.separator());
                container.appendChild(this.row(youIndex + 1, sorted[youIndex]));
            }
        });
    }

    private row(rank: number, entry: LeaderboardEntry): HTMLDivElement {
        const isYou = entry.name === 'You';
        const row = document.createElement('div');
        row.textContent = `${rank}. ${entry.name} — ${entry.score}`;
        Object.assign(row.style, {
            padding: '2px 0',
            fontWeight: isYou ? 'bold' : 'normal',
            color: isYou ? '#ffd75e' : '#fff',
            whiteSpace: 'nowrap',
        });
        return row;
    }

    private separator(): HTMLDivElement {
        const sep = document.createElement('div');
        sep.textContent = '···';
        Object.assign(sep.style, { opacity: '0.5', textAlign: 'center' });
        return sep;
    }

    destroy(): void {
        DomUiRoot.instance.unmount(this.panel.element);
        this.panel.destroy();
    }
}
