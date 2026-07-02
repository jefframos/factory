import * as PIXI from 'pixi.js';
import { Game } from '@core/Game';

const W  = 200;
const H  = 56;
const PAD = 12;
const ICON_R = 22;

/** Bottom-left HUD: player icon and current value. */
export class PlayerHud extends PIXI.Container {
    private bg        = new PIXI.Graphics();
    private icon      = new PIXI.Graphics();
    private valueText = new PIXI.Text('0', { fontFamily: 'Arial', fontSize: 26, fontWeight: 'bold', fill: 0xffffff });

    constructor() {
        super();
        this.buildLayout();
    }

    private buildLayout(): void {
        // Panel background
        this.bg.beginFill(0x080c1a, 0.82);
        this.bg.lineStyle(1, 0x2244aa, 0.8);
        this.bg.drawRoundedRect(0, 0, W, H, 12);
        this.bg.endFill();
        this.addChild(this.bg);

        // Player dot icon
        this.icon.x = PAD + ICON_R;
        this.icon.y = H / 2;
        this.redrawIcon(2);
        this.addChild(this.icon);

        // Value text (right of icon)
        this.valueText.x = PAD + ICON_R * 2 + 8;
        this.valueText.y = H / 2 - this.valueText.height / 2;
        this.addChild(this.valueText);
    }

    private redrawIcon(value: number): void {
        this.icon.clear();
        // Outer glow ring
        const hue = Math.min(value / 512, 1);
        const col  = lerpColor(0x2266ff, 0xffaa00, hue);
        this.icon.lineStyle(3, col, 0.9);
        this.icon.beginFill(col, 0.2);
        this.icon.drawCircle(0, 0, ICON_R);
        this.icon.endFill();
        // Inner dot
        this.icon.beginFill(col, 0.9);
        this.icon.drawCircle(0, 0, ICON_R * 0.45);
        this.icon.endFill();
    }

    update(value: number): void {
        this.valueText.text = formatValue(value);
        this.redrawIcon(value);
    }

    /**
     * Positions the HUD in the bottom-left, pinned to the real screen edge
     * (via Game.overlayScreenData, which is already scale/letterbox-corrected —
     * NOT window.innerWidth/innerHeight, which are raw screen pixels and don't
     * account for the game's design-resolution scaling).
     */
    reposition(): void {
        const { bottomLeft } = Game.overlayScreenData;
        this.x = bottomLeft.x + 16;
        this.y = bottomLeft.y - H - 16;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatValue(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + 'k';
    return String(n);
}

function lerpColor(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    const r  = Math.round(ar + (br - ar) * t);
    const g  = Math.round(ag + (bg - ag) * t);
    const bv = Math.round(ab + (bb - ab) * t);
    return (r << 16) | (g << 8) | bv;
}
