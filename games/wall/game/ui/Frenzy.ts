// Frenzy.ts
//
// A frenzy on (a bolt tapped: Floater): its time left on a bar under the wall's, and a still glow round the screen's edges.

import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import { fx } from '../config/Effects';
import { FLOATING } from '../data/WallConfig';
import { WallProgress } from '../data/WallProgress';
import { HudBar } from './HudBar';
import { sprite, text, write } from './parts';

const BAR = { width: 260, height: 32, color: 0x3fb8ff };
const GLOW = { color: '70,190,255', strength: 0.55, size: 256, fade: 0.5 };

/** Clear in the middle, coloured at the edges. */
function edges(): PIXI.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = GLOW.size;
    const context = canvas.getContext('2d')!;
    const half = GLOW.size / 2;
    const fill = context.createRadialGradient(half, half, half * 0.62, half, half, half * 1.3);
    fill.addColorStop(0, `rgba(${GLOW.color},0)`);
    fill.addColorStop(1, `rgba(${GLOW.color},${GLOW.strength})`);
    context.fillStyle = fill;
    context.fillRect(0, 0, GLOW.size, GLOW.size);
    return PIXI.Texture.from(canvas);
}

export class Frenzy extends PIXI.Container {
    public readonly glow = new PIXI.Sprite(edges());
    private readonly bar = new HudBar(BAR.width, BAR.height, BAR.color);
    private readonly words = text('', 24, 0xffffff, 0x0a2238, 6);
    private left = 0;

    public constructor() {
        super();
        this.eventMode = 'none';
        this.glow.eventMode = 'none';
        this.glow.visible = this.visible = false;
        this.bar.x = -BAR.width / 2;
        this.words.y = -1;
        const bolt = sprite('ItemIcon_Energy_Blue', 56);
        bolt.x = -BAR.width / 2 + 2;
        this.addChild(this.bar, this.words, bolt);
    }

    public start(): void {
        this.left = FLOATING.frenzy.seconds;
        WallProgress.setFrenzy(FLOATING.frenzy.mult);
    }

    /** `playing`: its time runs (there's something to hit); `open`: nothing's over the wall. */
    public update(delta: number, playing: boolean, open: boolean): void {
        if (this.left <= 0) return;
        if (playing && open) this.left -= delta;
        if (this.left <= 0) {
            this.left = 0;
            WallProgress.setFrenzy(1);
        }
        this.visible = open && this.left > 0;
        this.glow.visible = this.visible && fx('frenzyGlow') > 0;
        if (!this.visible) return;
        this.bar.setShare(this.left / FLOATING.frenzy.seconds);
        write(this.words, `x${FLOATING.frenzy.mult} DAMAGE  ${Math.ceil(this.left)}s`);
        this.glow.alpha = fx('frenzyGlow') * Math.min(1, this.left / GLOW.fade, (FLOATING.frenzy.seconds - this.left) / GLOW.fade);
    }

    public reposition(x: number, y: number): void {
        this.position.set(x, y);
        const screen = Game.overlayScreenData;
        if (!screen) return;
        this.glow.position.copyFrom(screen.topLeft);
        this.glow.width = screen.width;
        this.glow.height = screen.height;
    }
}
