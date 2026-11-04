// UfoHud.ts
//
// How much of the town is gone and how big the saucer is, a short message when something's too big, and the end screen.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { BakedShape } from './BakedShape';

const BAR = { width: 320, height: 26, top: 44 };
const COLORS = { back: 0x10123a, fill: 0x59e6c8, rim: 0xffffff, button: 0x59e6c8, buttonText: '#10123a' };
const MESSAGE_SECONDS = 1.3;
const FONT = 'Baloo2-ExtraBold, sans-serif';

const label = (size: number, fill: string | number = 0xffffff) => {
    const text = new PIXI.Text('', { fontFamily: FONT, fontSize: size, fill, stroke: 0x10123a, strokeThickness: Math.round(size / 5), align: 'center' });
    text.anchor.set(0.5);
    return text;
};

export class UfoHud extends PIXI.Container {
    private readonly bar = new PIXI.Container();
    private readonly reveal = new PIXI.Graphics();
    private readonly percent = label(20);
    private readonly size = label(22);
    private readonly message = label(30, 0xffe27a);
    private readonly end = new PIXI.Container();
    private readonly dim = new PIXI.Sprite(PIXI.Texture.WHITE);
    private readonly endTitle = label(58, 0x9dfff0);
    private readonly endButton = new PIXI.Container();
    private share = -1;

    public constructor(onRestart: () => void) {
        super();
        const back = new BakedShape(BAR.width, BAR.height, BAR.height / 2, { fill: COLORS.back, fillAlpha: 0.85, rim: COLORS.rim, rimWidth: 3 });
        const fill = new BakedShape(BAR.width - 6, BAR.height - 6, (BAR.height - 6) / 2, { fill: COLORS.fill });
        fill.mask = this.reveal;
        this.bar.addChild(back, fill, this.reveal, this.percent);
        this.message.alpha = 0;
        this.dim.tint = 0x0a0a28;
        this.dim.alpha = 0.72;
        this.dim.anchor.set(0.5);
        this.dim.eventMode = 'static';
        this.endTitle.text = 'TOWN ABDUCTED!';
        const buttonBack = new BakedShape(240, 72, 36, { fill: COLORS.button, rim: COLORS.rim, rimWidth: 4 });
        const buttonText = label(32, COLORS.buttonText);
        buttonText.style.strokeThickness = 0;
        buttonText.text = 'PLAY AGAIN';
        this.endButton.addChild(buttonBack, buttonText);
        this.endButton.eventMode = 'static';
        this.endButton.cursor = 'pointer';
        this.endButton.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.endButton.on('pointertap', onRestart);
        this.end.addChild(this.dim, this.endTitle, this.endButton);
        this.end.visible = false;
        this.addChild(this.bar, this.size, this.message, this.end);
        this.setProgress(0);
        this.reposition();
    }

    /** `share`: how much of the town is gone (0..1). */
    public setProgress(share: number): void {
        if (share === this.share) return;
        this.share = share;
        const inner = BAR.width - 6;
        this.reveal.clear().beginFill(0xffffff).drawRect(-inner / 2, -BAR.height / 2, inner * share, BAR.height).endFill();
        this.percent.text = `TOWN ${Math.floor(share * 100)}%`;
    }

    public setSize(radius: number, altitude: number): void {
        this.size.text = `SIZE ${radius.toFixed(1)}   ·   HEIGHT ${altitude.toFixed(1)}`;
    }

    /** A short line in the middle of the screen (the same one again only keeps it up). */
    public say(text: string): void {
        this.message.text = text;
        gsap.killTweensOf(this.message);
        this.message.alpha = 1;
        gsap.to(this.message, { alpha: 0, duration: 0.35, delay: MESSAGE_SECONDS });
    }

    public showEnd(): void {
        this.end.visible = true;
        this.message.alpha = 0;
        this.end.alpha = 0;
        gsap.to(this.end, { alpha: 1, duration: 0.4 });
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        // Portrait: narrower than the bar plus its margins.
        const fit = Math.min(1, (screen.width - 32) / BAR.width);
        this.bar.scale.set(fit);
        this.bar.position.set(screen.center.x, screen.topLeft.y + BAR.top);
        this.size.position.set(screen.center.x, this.bar.y + 38);
        this.message.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.3);
        this.dim.position.copyFrom(screen.center);
        this.dim.width = screen.width + 4;
        this.dim.height = screen.height + 4;
        this.endTitle.position.set(screen.center.x, screen.center.y - 60);
        this.endTitle.scale.set(Math.min(1, (screen.width - 32) / Math.max(this.endTitle.width / this.endTitle.scale.x, 1)));
        this.endButton.position.set(screen.center.x, screen.center.y + 40);
    }

    public override destroy(): void {
        gsap.killTweensOf(this.message);
        gsap.killTweensOf(this.end);
        super.destroy({ children: true });
    }
}
