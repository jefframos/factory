// AntHud.ts
//
// The 2D layer over the board: the level's number and name at the top, a 2x speed toggle, a restart button, and the end-of-level card
// ("Picture done!" with NEXT, or "No moves left" with TRY AGAIN). Drawn with plain shapes and text for now (no atlas).
// Laid out on the visible screen (Game.overlayScreenData), so it hugs the edges on any aspect.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';

const FONT = 'Arial Rounded MT Bold, Arial Black, Arial, sans-serif';
const BROWN = 0x6b3f22;

function label(text: string, size: number, fill = 0xffffff): PIXI.Text {
    // Round joins: a mitred outline spikes out of sharp corners (the tops of M, N, W).
    const t = new PIXI.Text(text, {
        fontFamily: FONT, fontSize: size, fill, fontWeight: '900', stroke: BROWN, strokeThickness: Math.round(size * 0.18),
        lineJoin: 'round', align: 'center',
    });
    t.anchor.set(0.5);
    return t;
}

/** A rounded button: a coloured pill with a darker lip and its text. */
function button(text: string, color: number, width: number, onTap: () => void): PIXI.Container {
    const holder = new PIXI.Container();
    const shape = new PIXI.Graphics()
        .beginFill(new PIXI.Color(color).multiply(0xb0b0b0).toNumber()).drawRoundedRect(-width / 2, -30, width, 66, 30).endFill()
        .beginFill(color).drawRoundedRect(-width / 2, -34, width, 62, 30).endFill();
    holder.addChild(shape, label(text, 30));
    holder.eventMode = 'static';
    holder.cursor = 'pointer';
    holder.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
    holder.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
        event.stopPropagation();
        gsap.fromTo(holder.scale, { x: 0.9, y: 0.9 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)' });
        onTap();
    });
    return holder;
}

export class AntHud extends PIXI.Container {
    private readonly title = label('', 34);
    private readonly restart: PIXI.Container;
    /** The 2x speed toggle (Game.timeScale), green while on. */
    private readonly speed = new PIXI.Container();
    private readonly speedBack = new PIXI.Graphics();
    private readonly card = new PIXI.Container();
    private readonly dim = new PIXI.Graphics();

    /** `onRestart` from the restart button. */
    public constructor(private readonly onRestart: () => void) {
        super();
        this.restart = new PIXI.Container();
        const disc = new PIXI.Graphics().beginFill(0x8a5530).drawCircle(0, 4, 32).endFill().beginFill(0xb0784a).drawCircle(0, 0, 32).endFill();
        this.restart.addChild(disc, label('↻', 40));
        this.restart.eventMode = 'static';
        this.restart.cursor = 'pointer';
        this.restart.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.restart.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            this.onRestart();
        });
        this.buildSpeed();
        this.dim.eventMode = 'static';
        this.dim.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.dim.visible = false;
        this.card.visible = false;
        this.addChild(this.title, this.speed, this.restart, this.dim, this.card);
        this.reposition();
    }

    /** "▶▶ 2x": doubles the game's speed (every update's delta: Game.timeScale) until tapped again. */
    private buildSpeed(): void {
        const text = label('▶▶ 2x', 26);
        this.speed.addChild(this.speedBack, text);
        this.drawSpeed();
        this.speed.eventMode = 'static';
        this.speed.cursor = 'pointer';
        this.speed.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.speed.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            Game.timeScale = Game.timeScale > 1 ? 1 : 2;
            this.drawSpeed();
            gsap.fromTo(this.speed.scale, { x: 0.9, y: 0.9 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)' });
        });
    }

    private drawSpeed(): void {
        const on = Game.timeScale > 1;
        this.speedBack.clear()
            .beginFill(on ? 0x3f9a3d : 0x8a5530).drawRoundedRect(-62, -26, 124, 56, 26).endFill()
            .beginFill(on ? 0x58c35a : 0xb0784a).drawRoundedRect(-62, -30, 124, 56, 26).endFill();
    }

    public setLevel(number: number, name: string): void {
        this.title.text = `LEVEL ${number} · ${name.toUpperCase()}`;
    }

    /** The end-of-level card: `won` shows NEXT, otherwise TRY AGAIN; `onButton` from its button. */
    public showResult(won: boolean, onButton: () => void): void {
        this.card.removeChildren().forEach((child) => child.destroy({ children: true }));
        const back = new PIXI.Graphics()
            .beginFill(0x8a5530).drawRoundedRect(-230, -150, 460, 310, 36).endFill()
            .beginFill(0xfff4e6).drawRoundedRect(-230, -158, 460, 306, 36).endFill();
        const heading = label(won ? 'PICTURE DONE!' : 'NO MOVES LEFT', 46, won ? 0x7ed957 : 0xff8a7a);
        heading.y = -80;
        const line = label(won ? 'The ants carried it all home.' : 'Every slot is waiting on a colour\nthe ants can\'t reach.', 24, BROWN);
        line.style.stroke = 0xffffff;
        line.style.strokeThickness = 0;
        line.y = -10;
        const action = button(won ? 'NEXT' : 'TRY AGAIN', won ? 0x58c35a : 0xff9f0a, 260, () => {
            this.hideResult();
            onButton();
        });
        action.y = 80;
        this.card.addChild(back, heading, line, action);
        this.dim.visible = true;
        this.card.visible = true;
        gsap.fromTo(this.card.scale, { x: 0.6, y: 0.6 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2)' });
        gsap.fromTo(this.dim, { alpha: 0 }, { alpha: 1, duration: 0.3 });
    }

    public hideResult(): void {
        this.dim.visible = false;
        this.card.visible = false;
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        this.title.position.set(screen.center.x, screen.topLeft.y + 52);
        this.restart.position.set(screen.topLeft.x + screen.width - 52, screen.topLeft.y + 52);
        this.speed.position.set(screen.topLeft.x + 82, screen.topLeft.y + 52);
        this.card.position.set(screen.center.x, screen.center.y);
        this.dim.clear().beginFill(0x2a1a10, 0.45).drawRect(screen.topLeft.x, screen.topLeft.y, screen.width, screen.height).endFill();
    }

    public override destroy(): void {
        gsap.killTweensOf(this.card.scale);
        gsap.killTweensOf(this.speed.scale);
        gsap.killTweensOf(this.dim);
        super.destroy({ children: true });
    }
}
