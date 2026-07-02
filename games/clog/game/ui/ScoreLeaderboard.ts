import * as PIXI from 'pixi.js';
import { Game } from '@core/Game';

const W       = 172;
const PAD     = 10;
const ROW_H   = 26;
const TITLE_H = 22;

const RANK_COLORS = [0xffd700, 0xbbbbcc, 0xcd7f32];
const RANK_LABELS = ['1ST', '2ND', '3RD'];

export interface LeaderboardEntry {
    name: string;
    score: number;
    isYou: boolean;
}

/**
 * Bottom-right panel — shows top-3 players by score and "your" rank when outside the top 3.
 * Score = player head value + sum of all tail cube values.
 */
export class ScoreLeaderboard extends PIXI.Container {
    private bg    = new PIXI.Graphics();
    private rows  = new PIXI.Graphics();
    private texts: PIXI.Text[] = [];
    private panelH = 0;
    private title = new PIXI.Text('SCORES', {
        fontFamily: 'Arial', fontSize: 9, fontWeight: 'bold',
        fill: 0x6688bb, letterSpacing: 2,
    });

    constructor() {
        super();
        this.title.x = PAD;
        this.title.y = PAD;
        this.addChild(this.bg);
        this.addChild(this.rows);
        this.addChild(this.title);
    }

    update(entries: LeaderboardEntry[]): void {
        for (const t of this.texts) t.destroy();
        this.texts = [];
        this.bg.clear();
        this.rows.clear();

        if (entries.length === 0) {
            this.panelH = 0;
            return;
        }

        const sorted     = [...entries].sort((a, b) => b.score - a.score);
        const yourRank   = sorted.findIndex(e => e.isYou);
        const topSlice   = sorted.slice(0, 3);
        const showYouRow = yourRank >= 3;

        const panelH = PAD + TITLE_H
            + topSlice.length * ROW_H
            + (showYouRow ? 8 + ROW_H : 0)
            + PAD;
        this.panelH = panelH;

        this.bg.beginFill(0x080c1a, 0.82);
        this.bg.lineStyle(1, 0x2244aa, 0.8);
        this.bg.drawRoundedRect(0, 0, W, panelH, 10);
        this.bg.endFill();

        let y = PAD + TITLE_H;

        for (let i = 0; i < topSlice.length; i++) {
            const e = topSlice[i];
            this.drawRow(
                RANK_LABELS[i] ?? `#${i + 1}`,
                RANK_COLORS[i] ?? 0x556688,
                e.name, e.score, e.isYou, y,
            );
            y += ROW_H;
        }

        if (showYouRow && yourRank >= 0) {
            // Separator
            this.rows.lineStyle(1, 0x2244aa, 0.35);
            this.rows.moveTo(PAD, y + 2);
            this.rows.lineTo(W - PAD, y + 2);
            this.rows.lineStyle(0);
            y += 8;

            const e = sorted[yourRank];
            this.drawRow(`#${yourRank + 1}`, 0x55aaff, e.name, e.score, true, y);
        }
    }

    private drawRow(
        rankLabel: string, rankColor: number,
        name: string, score: number, isYou: boolean, y: number,
    ): void {
        if (isYou) {
            this.rows.beginFill(0x1a3a7a, 0.65);
            this.rows.lineStyle(1, 0x2255aa, 0.5);
            this.rows.drawRoundedRect(PAD, y, W - PAD * 2, ROW_H - 2, 4);
            this.rows.endFill();
            this.rows.lineStyle(0);
        }

        const cy = y + ROW_H / 2;

        // Rank badge
        const rankTxt = new PIXI.Text(rankLabel, {
            fontFamily: 'Arial', fontSize: 9, fontWeight: 'bold', fill: rankColor,
        });
        rankTxt.x = PAD + 4;
        rankTxt.y = cy - rankTxt.height / 2;
        this.addChild(rankTxt);
        this.texts.push(rankTxt);

        // Player name (truncated to keep layout stable)
        const label   = (isYou ? name + ' (you)' : name).slice(0, 14);
        const nameTxt = new PIXI.Text(label, {
            fontFamily: 'Arial', fontSize: 11,
            fontWeight: isYou ? 'bold' : 'normal',
            fill: isYou ? 0x55aaff : 0x8899bb,
        });
        nameTxt.x = PAD + 34;
        nameTxt.y = cy - nameTxt.height / 2;
        this.addChild(nameTxt);
        this.texts.push(nameTxt);

        // Score — right-aligned
        const scoreTxt = new PIXI.Text(formatScore(score), {
            fontFamily: 'Arial', fontSize: 11, fontWeight: 'bold',
            fill: isYou ? 0xffffff : 0x667799,
        });
        scoreTxt.x = W - PAD - scoreTxt.width;
        scoreTxt.y = cy - scoreTxt.height / 2;
        this.addChild(scoreTxt);
        this.texts.push(scoreTxt);
    }

    /**
     * Positions the panel in the bottom-right, pinned to the real screen edge
     * (via Game.overlayScreenData, which is already scale/letterbox-corrected —
     * NOT window.innerWidth/innerHeight, which are raw screen pixels and don't
     * account for the game's design-resolution scaling).
     */
    reposition(): void {
        const { bottomRight } = Game.overlayScreenData;
        this.x = bottomRight.x - W - 16;
        this.y = bottomRight.y - this.panelH - 16;
    }
}

function formatScore(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + 'k';
    return String(n);
}
