// BoosterBelt.ts
//
// The item belt along the bottom of the screen, like the reference: a blue checked cloth with round cream buttons on
// it, one per power-up, each with a green count badge. A power-up unlocks at its level (BOOSTERS): before that it
// shows a padlock and "Level N". Only the extra slot does something for now; the others are there, waiting for their
// effect (tapping one gives a little bounce).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';

const FONT = 'Arial Rounded MT Bold, Arial Black, Arial, sans-serif';
const BROWN = 0x6b3f22;

export type BoosterId = 'slot' | 'shuffle' | 'magnet' | 'flower';

/** The power-ups in belt order, and the level each unlocks at. */
export const BOOSTERS: { id: BoosterId; unlock: number }[] = [
    { id: 'slot', unlock: 1 },
    { id: 'shuffle', unlock: 6 },
    { id: 'magnet', unlock: 9 },
    { id: 'flower', unlock: 16 },
];

/** A button's radius, the gap between button middles (at most), and the cloth's height. */
const RADIUS = 78;
const GAP = 232;
const CLOTH = 190;

function text(value: string, size: number, stroke = BROWN): PIXI.Text {
    const t = new PIXI.Text(value, {
        fontFamily: FONT, fontSize: size, fill: 0xffffff, fontWeight: '900', stroke, strokeThickness: Math.round(size * 0.2), lineJoin: 'round',
    });
    t.anchor.set(0.5);
    return t;
}

/** A tray of white cards with a green plus: one more slot. */
function slotIcon(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.beginFill(0x7a4a26).drawRoundedRect(-42, -4, 84, 40, 12).endFill();
    g.beginFill(0xb5763f).drawRoundedRect(-42, -8, 84, 36, 12).endFill();
    g.beginFill(0x8c5730).drawRoundedRect(-34, -4, 68, 22, 8).endFill();
    for (const [x, y, r] of [[-6, -18, -0.12], [0, -24, 0.08]] as const) {
        const card = new PIXI.Graphics()
            .beginFill(0xc9c9d4).drawRoundedRect(-26, -20, 52, 40, 8).endFill()
            .beginFill(0xfafaff).drawRoundedRect(-26, -23, 52, 40, 8).endFill();
        card.position.set(x, y);
        card.rotation = r;
        g.addChild(card);
    }
    const plus = new PIXI.Graphics()
        .beginFill(0x2f7a24).drawRoundedRect(-9, -24, 18, 50, 7).drawRoundedRect(-25, -8, 50, 18, 7).endFill()
        .beginFill(0x6fd34a).drawRoundedRect(-7, -22, 14, 44, 6).drawRoundedRect(-23, -6, 46, 14, 6).endFill();
    plus.position.set(24, 22);
    g.addChild(plus);
    return g;
}

/** Two crossing arrows, pink and blue: shuffle. */
function shuffleIcon(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    const arrow = (color: number, dark: number, from: [number, number], c1: [number, number], c2: [number, number], to: [number, number], angle: number) => {
        for (const [width, tint] of [[22, dark], [14, color]] as const) {
            g.lineStyle(width, tint, 1, 0.5).moveTo(...from).bezierCurveTo(...c1, ...c2, ...to);
        }
        g.lineStyle(0);
        const head = (size: number, tint: number) => {
            const points = [0, -size, size * 1.1, 0, 0, size];
            const rotated: number[] = [];
            for (let i = 0; i < points.length; i += 2) {
                const x = points[i];
                const y = points[i + 1];
                rotated.push(to[0] + x * Math.cos(angle) - y * Math.sin(angle), to[1] + x * Math.sin(angle) + y * Math.cos(angle));
            }
            g.beginFill(tint).drawPolygon(rotated).endFill();
        };
        head(22, dark);
        head(16, color);
    };
    arrow(0x5aa0f0, 0x2a5fb0, [-42, 20], [-10, 20], [0, -6], [30, 4], 0.3);
    arrow(0xd884e8, 0x8a3fa8, [-30, 34], [-20, 0], [10, -30], [30, -34], -0.6);
    return g;
}

/** A blue claw with a grey cap: the magnet. */
function magnetIcon(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.lineStyle(24, 0x2a5fb0).arc(0, 6, 28, 0, Math.PI).lineStyle(16, 0x5aa0f0).arc(0, 6, 28, 0, Math.PI);
    g.lineStyle(0);
    for (const x of [-28, 28]) {
        g.beginFill(0x2a5fb0).drawRoundedRect(x - 12, -18, 24, 28, 6).endFill();
        g.beginFill(0x5aa0f0).drawRoundedRect(x - 8, -16, 16, 26, 5).endFill();
    }
    g.beginFill(0x9aa6b8).drawRoundedRect(-16, -44, 32, 30, 8).endFill();
    g.beginFill(0xdfe6f0).drawRoundedRect(-13, -44, 26, 24, 7).endFill();
    g.beginFill(0x2a5fb0).drawRoundedRect(-6, -18, 12, 20, 4).endFill();
    return g;
}

/** A blue flower with a pink middle. */
function flowerIcon(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        g.beginFill(0x2a5fb0).drawCircle(Math.cos(a) * 24, Math.sin(a) * 24, 21).endFill();
    }
    for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        g.beginFill(0x8fc0f8).drawCircle(Math.cos(a) * 24, Math.sin(a) * 24, 17).endFill();
    }
    g.beginFill(0xa83f9a).drawCircle(0, 0, 18).endFill();
    g.beginFill(0xf08ad8).drawCircle(0, -1, 15).endFill();
    g.beginFill(0xffffff).drawCircle(-3, -4, 6).endFill();
    return g;
}

const ICONS: Record<BoosterId, () => PIXI.Graphics> = { slot: slotIcon, shuffle: shuffleIcon, magnet: magnetIcon, flower: flowerIcon };

interface BeltButton {
    id: BoosterId;
    unlock: number;
    holder: PIXI.Container;
    icon: PIXI.Graphics;
    badge: PIXI.Container;
    count: PIXI.Text;
    lock: PIXI.Container;
}

export class BoosterBelt extends PIXI.Container {
    private readonly cloth = new PIXI.Graphics();
    private readonly buttons: BeltButton[] = [];
    private level = 1;
    /** How many of each the player has (for now: one extra slot a level, one of each other). */
    private readonly counts: Record<BoosterId, number> = { slot: 1, shuffle: 1, magnet: 1, flower: 1 };

    /** `onUse` when an unlocked power-up with some left is tapped. */
    public constructor(private readonly onUse: (id: BoosterId) => void) {
        super();
        this.cloth.eventMode = 'static';
        this.cloth.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.addChild(this.cloth);
        for (const { id, unlock } of BOOSTERS) this.buttons.push(this.buildButton(id, unlock));
    }

    private buildButton(id: BoosterId, unlock: number): BeltButton {
        const holder = new PIXI.Container();
        const back = new PIXI.Graphics()
            .beginFill(0x000000, 0.18).drawCircle(0, 8, RADIUS).endFill()
            .beginFill(0xd8bfa2).drawCircle(0, 4, RADIUS).endFill()
            .beginFill(0xfdf1e2).drawCircle(0, 0, RADIUS - 4).endFill()
            .beginFill(0xfff8ee).drawEllipse(0, -RADIUS * 0.45, RADIUS * 0.62, RADIUS * 0.3).endFill();
        const icon = ICONS[id]();
        // A green badge, bottom right, with how many are left.
        const badge = new PIXI.Container();
        badge.addChild(new PIXI.Graphics().beginFill(0x2f7a24).drawCircle(0, 2, 27).endFill().beginFill(0xffffff).drawCircle(0, 0, 26).endFill().beginFill(0x6cc04a).drawCircle(0, 0, 21).endFill());
        const count = text('1', 30, 0x2f7a24);
        badge.addChild(count);
        badge.position.set(RADIUS * 0.68, RADIUS * 0.68);
        // Locked: a padlock over the faded icon, and the level it opens at.
        const lock = new PIXI.Container();
        const padlock = new PIXI.Graphics()
            .lineStyle(10, 0x5c5c6e).arc(0, -6, 16, Math.PI, 0).lineStyle(0)
            .beginFill(0x5c5c6e).drawRoundedRect(-26, -8, 52, 40, 9).endFill()
            .beginFill(0x9898aa).drawRoundedRect(-22, -6, 44, 34, 7).endFill()
            .beginFill(0x4a4a5a).drawCircle(0, 8, 6).drawRect(-2.5, 8, 5, 12).endFill();
        padlock.y = -10;
        const pill = new PIXI.Graphics().beginFill(0x8a5530).drawRoundedRect(-62, -18, 124, 38, 19).endFill().beginFill(0xb87a4b).drawRoundedRect(-60, -19, 120, 34, 17).endFill();
        const levelText = text(`Level ${unlock}`, 22);
        levelText.y = -2;
        const label = new PIXI.Container();
        label.addChild(pill, levelText);
        label.y = RADIUS * 0.82;
        lock.addChild(padlock, label);
        holder.addChild(back, icon, badge, lock);
        holder.eventMode = 'static';
        holder.cursor = 'pointer';
        holder.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        holder.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            this.tap(button);
        });
        this.addChild(holder);
        const button: BeltButton = { id, unlock, holder, icon, badge, count, lock };
        return button;
    }

    private tap(button: BeltButton): void {
        if (this.level < button.unlock) {
            // Locked: a little shake.
            gsap.fromTo(button.holder, { x: button.holder.x - 8 }, { x: button.holder.x, duration: 0.35, ease: 'elastic.out(3, 0.3)' });
            return;
        }
        gsap.fromTo(button.holder.scale, { x: 0.88, y: 0.88 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(3)' });
        if (this.counts[button.id] > 0) this.onUse(button.id);
    }

    /** The level being played: what's unlocked. */
    public setLevel(level: number): void {
        this.level = level;
        this.refresh();
    }

    /** How many of a power-up are left (0: greyed out). */
    public setCount(id: BoosterId, count: number): void {
        this.counts[id] = count;
        this.refresh();
    }

    private refresh(): void {
        for (const b of this.buttons) {
            const locked = this.level < b.unlock;
            const left = this.counts[b.id];
            b.lock.visible = locked;
            b.badge.visible = !locked;
            b.icon.alpha = locked ? 0.25 : left > 0 ? 1 : 0.45;
            b.count.text = String(left);
            b.holder.cursor = locked || left === 0 ? 'default' : 'pointer';
        }
    }

    /** Along the bottom of the visible screen (`left`, `bottom`, `width`): the cloth, the buttons spread over it. */
    public layout(left: number, bottom: number, width: number): void {
        // The cloth: blue checks with a lighter top edge and rounded top corners.
        const top = bottom - CLOTH;
        const g = this.cloth.clear();
        g.beginFill(0x3f62a8).drawRoundedRect(left - 20, top - 6, width + 40, CLOTH + 40, 44).endFill();
        g.beginFill(0x6f92d6).drawRoundedRect(left - 14, top, width + 28, CLOTH + 40, 40).endFill();
        const square = 34;
        for (let y = top + 10; y < bottom; y += square) {
            for (let x = left - 14 + ((y - top) / square) % 2 * square; x < left + width + 14; x += square * 2) {
                const w = Math.min(square, left + width + 14 - x);
                g.beginFill(0x5f82c8).drawRect(x, y, w, Math.min(square, bottom - y)).endFill();
            }
        }
        const gap = Math.min(GAP, width / BOOSTERS.length);
        this.buttons.forEach((b, i) => b.holder.position.set(left + width / 2 + (i - (this.buttons.length - 1) / 2) * gap, top + 10));
    }

    public override destroy(): void {
        for (const b of this.buttons) gsap.killTweensOf([b.holder, b.holder.scale]);
        super.destroy({ children: true });
    }
}
