// Matchmaking.ts
//
// PLAY ONLINE's window, over the main screen (the arena mode is a fake multiplayer: there's no server, the opponent is
// the arena ladder's robot, given a player's name and face here): a spinner and FINDING OPPONENT… for a few seconds
// (CANCEL goes back), then the opponent — their avatar, name, trophies and tier — VS the player, then the match.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { MobAudio } from '../audio/MobAudio';
import { framePlane, glossyButton, iconSprite, label, makeAvatar, tappable } from './UiParts';

/** Someone in a match: their name, face, colour, trophies, and their tier's name. */
export interface MatchPlayer { name: string; face: string; color: number; trophies: number; tier: string }

const PANEL = { width: 560, height: 470, back: 0x1b1e3a, edge: 0x8a3dff };
const SEARCH = { least: 1.6, most: 3.4, spinner: 150, dots: 12, dotRadius: 13, spin: 1.1, icon: 64 };
const FOUND = { hold: 1.7, avatar: 128, gap: 150, vs: 64 };
const CANCEL = { width: 220, height: 76, y: 160 };

/** The spinner's ring of dots, fading round, drawn once at a high resolution (sharp at any size). */
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
        c.fillStyle = '#c9a8ff';
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
    private readonly searching = new PIXI.Container();
    private readonly found = new PIXI.Container();
    private readonly ring = new PIXI.Sprite(spinner());
    private readonly status = label(34);
    private readonly cancel = glossyButton(CANCEL.width, CANCEL.height, 'CANCEL', 'Button01_l_Gray');
    private dotsTime = 0;
    private done = false;
    private readonly calls: gsap.core.Tween[] = [];

    /** Finds `opponent` for `you`, then `onFound`; CANCEL: `onCancel`. */
    public constructor(you: MatchPlayer, opponent: MatchPlayer, onFound: () => void, onCancel: () => void) {
        super();
        this.dim.eventMode = 'static';
        const back = framePlane('BorderFrame_Round24', PANEL.width, PANEL.height, 1);
        back.tint = PANEL.back;
        back.position.set(-PANEL.width / 2, -PANEL.height / 2);
        const title = label(30, 0xc9a8ff);
        title.text = 'ARENA · ONLINE';
        title.y = -PANEL.height / 2 + 42;
        this.ring.anchor.set(0.5);
        this.ring.width = this.ring.height = SEARCH.spinner;
        this.ring.y = -30;
        const glass = iconSprite('Icon_Search01', SEARCH.icon);
        glass.y = -30;
        gsap.to(glass, { y: -38, duration: 0.45, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        this.status.y = 90;
        this.cancel.y = CANCEL.y;
        tappable(this.cancel, () => {
            if (this.done) return;
            this.done = true;
            onCancel();
        });
        this.searching.addChild(this.ring, glass, this.status, this.cancel);
        this.buildFound(you, opponent);
        this.found.visible = false;
        this.panel.addChild(back, title, this.searching, this.found);
        this.addChild(this.dim, this.panel);
        this.layout();
        gsap.fromTo(this.panel.scale, { x: 0.6, y: 0.6 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2.2)' });
        // A few seconds' search (as if), then them, then the match.
        const search = SEARCH.least + Math.random() * (SEARCH.most - SEARCH.least);
        this.calls.push(gsap.delayedCall(search, () => {
            if (this.done) return;
            this.done = true;
            this.searching.visible = false;
            this.found.visible = true;
            MobAudio.play('confirm');
            gsap.fromTo(this.found.scale, { x: 0.4, y: 0.4 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2.5)' });
            this.calls.push(gsap.delayedCall(FOUND.hold, onFound));
        }));
    }

    /** The opponent found: the player on the left, VS, them on the right, each with their trophies and tier. */
    private buildFound(you: MatchPlayer, opponent: MatchPlayer): void {
        const heading = label(34, 0x9fe6ff);
        heading.text = 'OPPONENT FOUND!';
        heading.y = -120;
        this.found.addChild(heading);
        const side = (who: MatchPlayer, x: number): void => {
            const avatar = makeAvatar({ face: who.face, color: who.color }, FOUND.avatar);
            avatar.position.set(x, 0);
            const name = label(26);
            name.text = who.name;
            name.position.set(x, FOUND.avatar / 2 + 24);
            name.scale.set(Math.min(1, 220 / Math.max(1, name.width)));
            const trophies = label(22, 0xffe066);
            trophies.text = `${who.trophies} TROPHIES`;
            trophies.position.set(x, FOUND.avatar / 2 + 56);
            const tier = label(20, 0xc9a8ff);
            tier.text = who.tier.toUpperCase();
            tier.position.set(x, FOUND.avatar / 2 + 84);
            this.found.addChild(avatar, name, trophies, tier);
        };
        side(you, -FOUND.gap);
        side(opponent, FOUND.gap);
        const vs = label(FOUND.vs, 0xffd23f);
        vs.text = 'VS';
        this.found.addChild(vs);
    }

    public layout(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const { topLeft, center, width, height } = screen;
        this.dim.clear().beginFill(0x0b1030, 0.75).drawRect(topLeft.x, topLeft.y, width, height).endFill();
        this.panel.position.copyFrom(center);
        this.panel.scale.set(Math.min(1, (width - 30) / PANEL.width));
    }

    /** The spinner turning, FINDING OPPONENT's dots counting. */
    public update(dt: number): void {
        this.ring.rotation += dt * SEARCH.spin * Math.PI * 2;
        this.dotsTime += dt;
        this.status.text = `FINDING OPPONENT${'.'.repeat(1 + (Math.floor(this.dotsTime * 2.5) % 3))}`;
    }

    public override destroy(): void {
        this.calls.forEach((call) => call.kill());
        gsap.killTweensOf([this.panel.scale, this.found.scale]);
        this.searching.children.forEach((child) => gsap.killTweensOf(child));
        super.destroy({ children: true });
    }
}
