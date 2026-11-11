// Matchmaking.ts
//
// PLAY ONLINE's window, over the main screen (versus is a fake multiplayer: there's no server, the rivals are computer
// saucers given players' names and faces here), as Mob's: a spinner and FINDING PLAYERS… while the match's slots fill
// one by one (the player's first), CANCEL to go back; once they're all in, MATCH FOUND! and the match.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { UfoAudio } from '../audio/UfoAudio';
import type { VersusPlayer } from '../data/Versus';
import { WINDOW_LOOK, Pattern } from './Pattern';
import { framePlane, glossyButton, iconSprite, label, makeAvatar, tappable } from './UiParts';

const PANEL = { width: 600, height: 690, back: 0x1b1e3a };
/** The spinner (`y`: its middle) and, `statusGap` under it, FINDING PLAYERS. */
const SEARCH = { spinner: 110, dots: 12, dotRadius: 13, spin: 1.1, icon: 50, y: -215, statusGap: 92 };
/** The players' slots: their size, the gap across and down, where the rows start; how soon the first and the rest fill. */
const SLOTS = { avatar: 92, across: 180, down: 150, top: 5, first: 0.5, least: 0.35, most: 1.1 };
const FOUND = { hold: 1.4 };
const CANCEL = { width: 220, height: 76, y: 290 };

/** The spinner's ring of dots, fading round, drawn once. */
let spinnerTexture: PIXI.Texture | null = null;
function spinner(): PIXI.Texture {
    if (spinnerTexture) return spinnerTexture;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const c = canvas.getContext('2d')!;
    for (let k = 0; k < SEARCH.dots; k++) {
        const angle = (k / SEARCH.dots) * Math.PI * 2;
        const r = size / 2 - SEARCH.dotRadius * 2;
        c.globalAlpha = 0.15 + 0.85 * (k / (SEARCH.dots - 1));
        c.fillStyle = '#9fd8ff';
        c.beginPath();
        c.arc(size / 2 + Math.cos(angle) * r, size / 2 + Math.sin(angle) * r, SEARCH.dotRadius * (0.6 + 0.4 * (k / SEARCH.dots)), 0, Math.PI * 2);
        c.fill();
    }
    spinnerTexture = PIXI.Texture.from(canvas);
    return spinnerTexture;
}

export class Matchmaking extends PIXI.Container {
    private readonly dim = new PIXI.Graphics();
    private readonly panel = new PIXI.Container();
    private readonly ring = new PIXI.Sprite(spinner());
    private readonly glass = iconSprite('Icon_Search01', SEARCH.icon);
    private readonly status = label(32);
    private readonly cancel = glossyButton(CANCEL.width, CANCEL.height, 'CANCEL', 'Button01_l_Gray');
    private dotsTime = 0;
    private found = false;
    private done = false;
    private readonly calls: gsap.core.Tween[] = [];

    /** `you` and the `others` "found" for `arena` (its name), then `onFound`; CANCEL: `onCancel`. */
    public constructor(arena: string, you: VersusPlayer, others: readonly VersusPlayer[], onFound: () => void, onCancel: () => void) {
        super();
        this.dim.eventMode = 'static';
        const back = framePlane('BorderFrame_Round24', PANEL.width, PANEL.height, 1);
        back.tint = PANEL.back;
        back.position.set(-PANEL.width / 2, -PANEL.height / 2);
        // The starfield inside the frame.
        const inset = 8;
        const pattern = new Pattern(WINDOW_LOOK);
        pattern.place(-PANEL.width / 2 + inset, -PANEL.height / 2 + inset, PANEL.width - inset * 2, PANEL.height - inset * 2);
        const mask = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(-PANEL.width / 2 + inset, -PANEL.height / 2 + inset, PANEL.width - inset * 2, PANEL.height - inset * 2, 20).endFill();
        pattern.mask = mask;
        const title = label(30, 0x9fd8ff);
        title.text = `VERSUS · ${arena.toUpperCase()}`;
        title.y = -PANEL.height / 2 + 42;
        this.ring.anchor.set(0.5);
        this.ring.width = this.ring.height = SEARCH.spinner;
        this.ring.y = SEARCH.y;
        this.glass.y = SEARCH.y;
        gsap.to(this.glass, { y: SEARCH.y - 8, duration: 0.45, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        this.status.y = SEARCH.y + SEARCH.statusGap;
        this.cancel.y = CANCEL.y;
        tappable(this.cancel, () => {
            if (this.done || this.found) return;
            this.done = true;
            onCancel();
        });
        this.panel.addChild(back, pattern, mask, title, this.ring, this.glass, this.status, this.cancel);
        this.addChild(this.dim, this.panel);
        // The slots: the player's filled at once, the others as they're "found".
        const everyone = [you, ...others];
        const perRow = everyone.length > 4 ? 3 : 2;
        const slots = everyone.map((player, i) => {
            const row = Math.floor(i / perRow);
            const inRow = Math.min(perRow, everyone.length - row * perRow);
            return this.slot(((i % perRow) - (inRow - 1) / 2) * SLOTS.across, SLOTS.top + row * SLOTS.down, player);
        });
        slots[0].fill();
        let at = SLOTS.first;
        for (let i = 1; i < slots.length; i++) {
            at += SLOTS.least + Math.random() * (SLOTS.most - SLOTS.least);
            this.calls.push(gsap.delayedCall(at, () => {
                if (this.done) return;
                slots[i].fill();
                UfoAudio.eat(0.3);
            }));
        }
        this.calls.push(gsap.delayedCall(at + 0.4, () => {
            if (this.done) return;
            this.found = true;
            this.status.text = 'MATCH FOUND!';
            this.status.style.fill = 0x6dff5a;
            this.ring.visible = false;
            this.glass.visible = false;
            this.cancel.visible = false;
            gsap.fromTo(this.status.scale, { x: 0.4, y: 0.4 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2.5)' });
            UfoAudio.milestone();
            this.calls.push(gsap.delayedCall(FOUND.hold, () => {
                if (this.done) return;
                this.done = true;
                onFound();
            }));
        }));
        this.layout();
        gsap.fromTo(this.panel.scale, { x: this.panel.scale.x * 0.6, y: this.panel.scale.y * 0.6 }, { x: this.panel.scale.x, y: this.panel.scale.y, duration: 0.35, ease: 'back.out(2.2)' });
    }

    /** A player's slot at (x, y): an empty circle, then (fill()) their avatar, name and trophies. */
    private slot(x: number, y: number, player: VersusPlayer): { fill: () => void } {
        const holder = new PIXI.Container();
        holder.position.set(x, y);
        const empty = iconSprite('BorderFrame_Circle60', SLOTS.avatar);
        empty.tint = 0x2c3060;
        const mark = label(40, 0x6a74b0);
        mark.text = '?';
        holder.addChild(empty, mark);
        this.panel.addChild(holder);
        return {
            fill: () => {
                holder.removeChildren().forEach((child) => child.destroy());
                const avatar = makeAvatar({ name: player.name, face: player.face, color: player.color }, SLOTS.avatar);
                const name = label(22, player.you ? 0xffe066 : 0xffffff);
                name.text = player.you ? 'YOU' : player.name;
                name.y = SLOTS.avatar / 2 + 18;
                name.scale.set(Math.min(1, (SLOTS.across - 12) / Math.max(1, name.width)));
                const cup = iconSprite('ItemIcon_Trophy_Gold', 26);
                const trophies = label(20, 0xffe066);
                trophies.anchor.set(0, 0.5);
                trophies.text = `${player.trophies}`;
                const width = 30 + trophies.width;
                cup.position.set(-width / 2 + 13, SLOTS.avatar / 2 + 44);
                trophies.position.set(-width / 2 + 30, SLOTS.avatar / 2 + 44);
                holder.addChild(avatar, name, cup, trophies);
                gsap.fromTo(holder.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2.6)' });
            },
        };
    }

    public layout(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const { topLeft, center, width, height } = screen;
        this.dim.clear().beginFill(0x0b1030, 0.75).drawRect(topLeft.x, topLeft.y, width, height).endFill();
        this.panel.position.copyFrom(center);
        this.panel.scale.set(Math.min(1, (width - 30) / PANEL.width, (height - 30) / PANEL.height));
    }

    /** The spinner turning, FINDING PLAYERS' dots counting. */
    public update(dt: number): void {
        if (this.found) return;
        this.ring.rotation += dt * SEARCH.spin * Math.PI * 2;
        this.dotsTime += dt;
        this.status.text = `FINDING PLAYERS${'.'.repeat(1 + (Math.floor(this.dotsTime * 2.5) % 3))}`;
    }

    public override destroy(): void {
        this.done = true;
        this.calls.forEach((call) => call.kill());
        gsap.killTweensOf([this.panel.scale, this.glass, this.status.scale]);
        this.panel.children.forEach((child) => gsap.killTweensOf(child.scale));
        super.destroy({ children: true });
    }
}
