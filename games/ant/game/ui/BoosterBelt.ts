// BoosterBelt.ts
//
// The item belt along the bottom of the screen, like the reference (shown once the first power-up's unlocked: AntHud): a blue checked cloth with round buttons on it, one
// per power-up, each with a green count badge — the UI pack's blue round button and white icons (UiParts). A power-up
// unlocks at its level (BOOSTERS): before that it's a dark button with a padlock and its level. The badge is how many
// the player has (AntSave: bought in the power-ups' shop); none, no badge. Only the extra slot does something for now
// (once a level); the others are there, waiting for their effect (tapping one gives a little bounce).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { framePlane, iconSprite, label, roundButton } from './UiParts';
import { AntAudio } from '../audio/AntAudio';
import { AntSave } from '../data/AntSave';

export type BoosterId = 'slot' | 'shuffle' | 'pickup' | 'vacuum';

/** The power-ups in belt order, their icon, and the level each unlocks at (design.txt): the extra slot (a sixth slot),
 *  shuffle (the tiles not taken yet, mixed), pick up (a slot's tile back to the rack), vacuum (every block of a colour,
 *  gone). */
export const BOOSTERS: { id: BoosterId; icon: string; unlock: number }[] = [
    { id: 'slot', icon: 'PictoIcon_Plus_1', unlock: 3 },
    { id: 'shuffle', icon: 'PictoIcon_Change', unlock: 4 },
    { id: 'pickup', icon: 'PictoIcon_Hammer_Claw', unlock: 6 },
    { id: 'vacuum', icon: 'PictoIcon_Bomb_1', unlock: 9 },
];

/** Design units (720 wide): a button's size, the gap between button middles, the cloth's height and checks, the badge. */
const BUTTON = 74;
const GAP = 118;
const CLOTH = { height: 74, square: 22, light: 0x7397dc, dark: 0x6488d0, line: 0x2b2d4d };
const BADGE = { size: 30, x: 27, y: 25, color: 0x4cc23a, text: 18 };
const LOCK = { icon: 34, iconY: -8, text: 13, textY: 22 };

interface BeltButton {
    id: BoosterId;
    /** A gold glow behind it while it's in play (waiting for its target). */
    glow: PIXI.Sprite;
    unlock: number;
    holder: PIXI.Container;
    open: PIXI.Container;
    locked: PIXI.Container;
    badge: PIXI.Container;
    count: PIXI.Text;
}

export class BoosterBelt extends PIXI.Container {
    private readonly cloth = new PIXI.Graphics();
    private readonly buttons: BeltButton[] = [];
    private level = 1;
    /** Power-ups already used this level (greyed out: once a level). */
    private readonly used = new Set<BoosterId>();

    /** `onUse` when an unlocked power-up with some left is tapped. */
    public constructor(private readonly onUse: (id: BoosterId) => void) {
        super();
        this.cloth.eventMode = 'static';
        this.cloth.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.addChild(this.cloth);
        for (const { id, icon, unlock } of BOOSTERS) this.buttons.push(this.buildButton(id, icon, unlock));
    }

    private buildButton(id: BoosterId, icon: string, unlock: number): BeltButton {
        const holder = new PIXI.Container();
        const open = roundButton('Button_Round02_Blue', icon, BUTTON);
        // Locked: the dark button, a padlock, and the level it opens at.
        const locked = new PIXI.Container();
        const dark = framePlane('Button_Round03_Dark', BUTTON, BUTTON, BUTTON / 110);
        dark.position.set(-BUTTON / 2, -BUTTON / 2);
        const padlock = iconSprite('Icon_Lock01_l', LOCK.icon);
        padlock.y = LOCK.iconY;
        const level = label(LOCK.text);
        level.text = `LEVEL ${unlock}`;
        level.y = LOCK.textY;
        locked.addChild(dark, padlock, level);
        // A green badge, bottom right, with how many are left.
        const badge = new PIXI.Container();
        const circle = iconSprite('Alert_Circle_l_Bg', BADGE.size);
        circle.tint = BADGE.color;
        const count = label(BADGE.text);
        count.y = -1;
        badge.addChild(circle, count);
        badge.position.set(BADGE.x, BADGE.y);
        const glow = iconSprite('Glow_Circle01', BUTTON * 2);
        glow.tint = 0xffd23f;
        glow.visible = false;
        holder.addChild(glow, open, locked, badge);
        holder.eventMode = 'static';
        holder.cursor = 'pointer';
        holder.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        holder.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            this.tap(button);
        });
        this.addChild(holder);
        const button: BeltButton = { id, glow, unlock, holder, open, locked, badge, count };
        return button;
    }

    private tap(button: BeltButton): void {
        gsap.killTweensOf([button.holder, button.holder.scale]);
        if (this.level < button.unlock) {
            // Locked: a little shake.
            AntAudio.play('full');
            const x = button.holder.x;
            gsap.fromTo(button.holder, { x: x - 6 }, { x, duration: 0.35, ease: 'elastic.out(3, 0.3)' });
            return;
        }
        gsap.fromTo(button.holder.scale, { x: 0.88, y: 0.88 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(3)' });
        const ready = AntSave.boosters(button.id) > 0 && !this.used.has(button.id);
        AntAudio.play(ready && button.id === 'slot' ? 'slot' : 'click');
        if (ready) this.onUse(button.id);
    }

    /** A power-up in play (waiting for its target: glowing, pulsing), or none. */
    public setActive(id: BoosterId | null): void {
        for (const b of this.buttons) {
            const on = b.id === id;
            b.glow.visible = on;
            gsap.killTweensOf(b.open.scale);
            b.open.scale.set(1);
            if (on) gsap.to(b.open.scale, { x: 1.12, y: 1.12, duration: 0.45, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        }
    }

    /** Where a power-up's button is (this belt's parent's units). */
    public buttonAt(id: BoosterId): PIXI.Point {
        const button = this.buttons.find((b) => b.id === id);
        return new PIXI.Point(this.x + (button?.holder.x ?? 0), this.y + (button?.holder.y ?? 0));
    }

    /** Unlocked at the level being played. */
    public unlocked(id: BoosterId): boolean {
        return this.level >= (BOOSTERS.find((b) => b.id === id)?.unlock ?? Infinity);
    }

    /** The level being played: what's unlocked. */
    public setLevel(level: number): void {
        this.level = level;
        this.refresh();
    }

    /** A power-up used this level (greyed out), or ready again (a new level). */
    public setUsed(id: BoosterId, used: boolean): void {
        if (used) this.used.add(id);
        else this.used.delete(id);
        this.refresh();
    }

    /** The badges and greys as they now are (how many the player has: AntSave). */
    public refresh(): void {
        for (const b of this.buttons) {
            const locked = this.level < b.unlock;
            const left = AntSave.boosters(b.id);
            const ready = left > 0 && !this.used.has(b.id);
            b.open.visible = !locked;
            b.locked.visible = locked;
            // None left: no badge (not a 0).
            b.badge.visible = !locked && left > 0;
            b.open.alpha = ready ? 1 : 0.5;
            b.count.text = String(left);
            b.holder.cursor = locked || !ready ? 'default' : 'pointer';
        }
    }

    /** Along the bottom of the visible screen (`left`, `bottom`, `width`): the cloth, the buttons on its top edge. */
    public layout(left: number, bottom: number, width: number): void {
        const top = bottom - CLOTH.height;
        const g = this.cloth.clear();
        // A dark line along the top (like the pack's bars), then blue checks.
        g.beginFill(CLOTH.line).drawRoundedRect(left - 10, top - 3, width + 20, CLOTH.height + 20, 18).endFill();
        g.beginFill(CLOTH.light).drawRoundedRect(left - 8, top, width + 16, CLOTH.height + 20, 16).endFill();
        const { square } = CLOTH;
        for (let row = 0; top + 6 + row * square < bottom; row++) {
            const y = top + 6 + row * square;
            for (let x = left - 8 + (row % 2) * square; x < left + width + 8; x += square * 2) {
                g.beginFill(CLOTH.dark).drawRect(x, y, Math.min(square, left + width + 8 - x), Math.min(square, bottom - y)).endFill();
            }
        }
        const gap = Math.min(GAP, width / BOOSTERS.length);
        this.buttons.forEach((b, i) => b.holder.position.set(left + width / 2 + (i - (this.buttons.length - 1) / 2) * gap, top + 4));
    }

    public override destroy(): void {
        for (const b of this.buttons) gsap.killTweensOf([b.holder, b.holder.scale, b.open.scale]);
        super.destroy({ children: true });
    }
}
