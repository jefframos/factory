import * as PIXI from 'pixi.js';
import { getLinearConfig, KING_ROOM_INDEX, linearRoomLabel } from '../world/LinearMap';

const W  = 200;
const H  = 88;
const PAD = 12;
const ICON_R = 22;

/** Bottom-left HUD: player icon, current value, progress toward next gate. */
export class PlayerHud extends PIXI.Container {
    private bg        = new PIXI.Graphics();
    private icon      = new PIXI.Graphics();
    private valueText = new PIXI.Text('0',     { fontFamily: 'Arial', fontSize: 26, fontWeight: 'bold', fill: 0xffffff });
    private gateText  = new PIXI.Text('',      { fontFamily: 'Arial', fontSize: 11, fill: 0xaaaacc });
    private roomText  = new PIXI.Text('Room 1',{ fontFamily: 'Arial', fontSize: 11, fill: 0x88aacc });
    private barBg     = new PIXI.Graphics();
    private barFill   = new PIXI.Graphics();

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
        this.valueText.y = PAD - 2;
        this.addChild(this.valueText);

        // Gate text
        this.gateText.x = this.valueText.x;
        this.gateText.y = PAD + 28;
        this.addChild(this.gateText);

        // Room label
        this.roomText.x = PAD + ICON_R * 2 + 8;
        this.roomText.y = H - PAD - 16;
        this.addChild(this.roomText);

        // Progress bar
        const barX = PAD + ICON_R * 2 + 8;
        const barY = H - PAD - 6;
        const barW = W - barX - PAD;

        this.barBg.beginFill(0x222240, 1);
        this.barBg.drawRoundedRect(barX, barY, barW, 5, 3);
        this.barBg.endFill();
        this.addChild(this.barBg);
        this.barFill.x = barX;
        this.barFill.y = barY;
        this.addChild(this.barFill);
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

    update(value: number, nextGate: number, roomIndex: number): void {
        this.valueText.text = formatValue(value);
        this.roomText.text  = linearRoomLabel(roomIndex);
        this.redrawIcon(value);

        if (roomIndex >= KING_ROOM_INDEX) {
            this.gateText.text = '♚ King!';
            this.gateText.style.fill = 0xffd700;
            this.drawBar(1);
        } else {
            // gateValue is what you need to LEAVE this room (the gate on the next one)
            this.gateText.text = `→ gate: ${formatValue(nextGate)}`;
            this.gateText.style.fill = 0xaaaacc;
            this.drawBar(nextGate > 0 ? Math.min(value / nextGate, 1) : 1);
        }
    }

    private drawBar(progress: number): void {
        const barX = PAD + ICON_R * 2 + 8;
        const barW = W - barX - PAD;
        this.barFill.clear();
        if (progress <= 0) return;
        const fillW = Math.max(6, Math.round(barW * progress));
        const col   = progress >= 1 ? 0x44ff88 : 0x3366ff;
        this.barFill.beginFill(col, 0.95);
        this.barFill.drawRoundedRect(0, 0, fillW, 5, 3);
        this.barFill.endFill();
    }

    /** Call on screen resize — positions HUD in bottom-left. */
    reposition(screenW: number, screenH: number): void {
        this.x = 16;
        this.y = screenH - H - 16;
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
