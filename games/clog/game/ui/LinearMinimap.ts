import * as PIXI from 'pixi.js';
import { getLinearConfig, KING_ROOM_INDEX, linearRoomLabel } from '../world/LinearMap';

const PANEL_W   = 110;
const ROOM_H    = 14;
const ROOM_W    = 72;
const ROW_GAP   = 3;
const VISIBLE   = 9;          // rooms shown at once
const PANEL_PAD = 8;
const PANEL_H   = VISIBLE * (ROOM_H + ROW_GAP) + PANEL_PAD * 2 + 16; // +16 for title

/** Top-right minimap showing the linear room ladder. */
export class LinearMinimap extends PIXI.Container {
    private panel      = new PIXI.Graphics();
    private rooms      = new PIXI.Graphics();
    private labels: PIXI.Text[] = [];
    private title      = new PIXI.Text('MAP', {
        fontFamily: 'Arial', fontSize: 9, fontWeight: 'bold',
        fill: 0x6688bb, letterSpacing: 2,
    });

    constructor() {
        super();
        this.buildPanel();
        this.addChild(this.panel);
        this.addChild(this.rooms);
        this.title.x = PANEL_PAD;
        this.title.y = PANEL_PAD - 2;
        this.addChild(this.title);
    }

    private buildPanel(): void {
        this.panel.beginFill(0x080c1a, 0.82);
        this.panel.lineStyle(1, 0x2244aa, 0.6);
        this.panel.drawRoundedRect(0, 0, PANEL_W, PANEL_H, 10);
        this.panel.endFill();
    }

    update(currentRoomIndex: number): void {
        this.rooms.clear();
        for (const lbl of this.labels) lbl.destroy();
        this.labels = [];

        // Show a window of VISIBLE rooms centred on the current room.
        const halfVis   = Math.floor(VISIBLE / 2);
        const windowEnd = Math.max(VISIBLE - 1, currentRoomIndex + halfVis);
        const windowStart = Math.max(0, windowEnd - VISIBLE + 1);

        for (let slot = 0; slot < VISIBLE; slot++) {
            const roomIdx = windowStart + slot;
            // Draw bottom-up: highest index at top of panel.
            const drawSlot = VISIBLE - 1 - slot;
            const y = PANEL_PAD + 16 + drawSlot * (ROOM_H + ROW_GAP);
            const x = PANEL_PAD;

            const isCurrent = roomIdx === currentRoomIndex;
            const isKing    = roomIdx === KING_ROOM_INDEX;
            const isFuture  = roomIdx > currentRoomIndex;

            // Row background
            this.rooms.lineStyle(isCurrent ? 1.5 : 0, isCurrent ? 0x55aaff : 0, 1);
            this.rooms.beginFill(
                isCurrent ? 0x1a3a7a :
                isKing    ? 0x3a2800 :
                isFuture  ? 0x10152a :
                            0x0c1020,
                0.9,
            );
            this.rooms.drawRoundedRect(x, y, ROOM_W, ROOM_H, 3);
            this.rooms.endFill();

            // King crown dot
            if (isKing) {
                this.rooms.beginFill(0xffd700, 0.9);
                this.rooms.drawCircle(x + 6, y + ROOM_H / 2, 3);
                this.rooms.endFill();
            } else if (isCurrent) {
                // Player dot
                this.rooms.beginFill(0x55aaff, 1);
                this.rooms.drawCircle(x + 6, y + ROOM_H / 2, 3);
                this.rooms.endFill();
            }

            // Label
            const labelText = new PIXI.Text(linearRoomLabel(roomIdx), {
                fontFamily: 'Arial',
                fontSize: 9,
                fontWeight: isCurrent ? 'bold' : 'normal',
                fill: isCurrent ? 0xffffff : isKing ? 0xffd700 : isFuture ? 0x445580 : 0x334466,
            });
            labelText.x = x + 14;
            labelText.y = y + (ROOM_H - labelText.height) / 2;
            this.addChild(labelText);
            this.labels.push(labelText);

            // Gate value badge (right side)
            const nextConfig  = getLinearConfig(roomIdx + 1);
            const gateVal     = nextConfig.gateValue;
            const gateStr     = gateVal === 0 ? '' : formatGate(gateVal);
            if (gateStr) {
                const gLabel = new PIXI.Text(gateStr, {
                    fontFamily: 'Arial', fontSize: 8,
                    fill: isCurrent ? 0x88ccff : 0x334466,
                });
                gLabel.x = x + ROOM_W - gLabel.width - 4;
                gLabel.y = y + (ROOM_H - gLabel.height) / 2;
                this.addChild(gLabel);
                this.labels.push(gLabel);
            }
        }
    }

    /** Call on screen resize — positions panel in top-right. */
    reposition(screenW: number): void {
        this.x = screenW - PANEL_W - 16;
        this.y = 16;
    }
}

function formatGate(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + 'k';
    return String(n);
}
