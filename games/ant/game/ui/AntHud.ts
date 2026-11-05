// AntHud.ts
//
// The 2D layer over the board, laid out like the reference: pause (blue, top-left: the pause popup, PausePopup.ts, with
// sound, retry and home), "Level N" (top), x2 (green,
// top-right), the item belt along the bottom (BoosterBelt: the extra slot, once a level, and the power-ups to come), the
// celebration when a picture is done (celebrate(): turning rays, confetti, the finished picture, three stars, NEXT) and
// the card when it's lost ("No moves left" with TRY AGAIN, and +1 SLOT to play on while the power-up is unused). Drawn with plain shapes and text for now (no atlas).
// Laid out on the visible screen (Game.overlayScreenData), so it hugs the edges on any aspect.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { LevelData, pixelsOf } from '../data/Levels';
import { BoosterBelt } from './BoosterBelt';
import { PausePopup } from './PausePopup';
import { FONT, buttonParts, roundButton, tappable } from './UiParts';
import { AntAudio } from '../audio/AntAudio';

/** The pause button's size (design units, 720 wide) and its distance from the corner. */
const PAUSE = { size: 64, margin: 46 };
/** The x2 button: the pack's glossy button, green, yellow while it's on. */
const SPEED = { width: 116, height: 58, x: 74 };
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

/** One of the pack's glossy buttons (`frame`: Button01_l_<Colour>) with its words. */
function button(text: string, frame: string, width: number, onTap: () => void): PIXI.Container {
    const holder = new PIXI.Container();
    holder.addChild(...buttonParts(width, 66, text, frame));
    tappable(holder, onTap);
    return holder;
}

export class AntHud extends PIXI.Container {
    /** "Level N": the reference's plain brown title. */
    private readonly title = new PIXI.Text('', { fontFamily: FONT, fontSize: 46, fill: 0x7b4a28, fontWeight: '900', lineJoin: 'round' });
    private readonly pause: PIXI.Container;
    private pausePopup: PausePopup | null = null;
    /** The 2x speed toggle (Game.timeScale): green, yellow while on. */
    private readonly speed = new PIXI.Container();
    private readonly speedOff = new PIXI.Container();
    private readonly speedOn = new PIXI.Container();
    /** The item belt; its first power-up is the extra slot (one more slot, once a level). */
    private readonly belt: BoosterBelt;
    private extraUsed = false;
    private readonly card = new PIXI.Container();
    private readonly dim = new PIXI.Graphics();
    /** The celebration's turning rays and falling confetti (behind / over the card). */
    private readonly rays = new PIXI.Container();
    private readonly confetti = new PIXI.Container();

    /** `onPause` from the pause button, `onExtraSlot` from the power-up (on the belt or the lost card). */
    public constructor(private readonly onPause: () => void, private readonly onExtraSlot: () => void) {
        super();
        this.title.anchor.set(0.5);
        // The pack's blue round button with the pause sign, the reference's top-left button.
        this.pause = roundButton('Button_Round02_Blue', 'PictoIcon_Pause_1', PAUSE.size);
        tappable(this.pause, () => this.onPause(), null);
        this.buildSpeed();
        this.belt = new BoosterBelt((id) => {
            if (id === 'slot' && !this.extraUsed) this.onExtraSlot();
        });
        this.dim.eventMode = 'static';
        this.dim.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.dim.visible = false;
        this.card.visible = false;
        this.rays.visible = false;
        this.addChild(this.title, this.speed, this.belt, this.pause, this.dim, this.rays, this.card, this.confetti);
        this.reposition();
    }

    /** "▶▶ x2" on the pack's glossy button (as the game's other buttons): doubles the game's speed (every update's
     *  delta: Game.timeScale) until tapped again. */
    private buildSpeed(): void {
        const sign = (holder: PIXI.Container) => {
            // Two small play triangles, white with a dark outline, then x2.
            const g = new PIXI.Graphics().lineStyle(4, 0x10123a, 1, 1, false);
            for (const x of [-40, -24]) g.beginFill(0xffffff).drawPolygon([x, -12, x + 16, -2, x, 8]).endFill();
            const words = holder.getChildAt(1) as PIXI.Text;
            words.x = 16;
            holder.addChild(g);
        };
        this.speedOff.addChild(...buttonParts(SPEED.width, SPEED.height, 'x2', 'Button01_l_Green'));
        this.speedOn.addChild(...buttonParts(SPEED.width, SPEED.height, 'x2', 'Button01_l_Yellow'));
        sign(this.speedOff);
        sign(this.speedOn);
        this.speed.addChild(this.speedOff, this.speedOn);
        this.drawSpeed();
        tappable(this.speed, () => {
            Game.timeScale = Game.timeScale > 1 ? 1 : 2;
            this.drawSpeed();
        }, 'toggle');
    }

    private drawSpeed(): void {
        const on = Game.timeScale > 1;
        this.speedOn.visible = on;
        this.speedOff.visible = !on;
    }

    /** The power-up ready (a new level) or spent. */
    public setExtraSlot(available: boolean): void {
        this.extraUsed = !available;
        this.belt.setCount('slot', available ? 1 : 0);
    }

    public get extraSlotAvailable(): boolean {
        return !this.extraUsed;
    }

    /** The pause popup up (`actions` from its buttons and its close cross), or down. */
    public showPause(actions: { resume: () => void; retry: () => void; home: () => void }): void {
        if (this.pausePopup) return;
        this.pausePopup = new PausePopup(actions);
        this.addChild(this.pausePopup);
    }

    public hidePause(): void {
        this.pausePopup?.destroy();
        this.pausePopup = null;
    }

    public setLevel(number: number): void {
        this.title.text = `Level ${number}`;
        this.belt.setLevel(number);
    }

    /** The end-of-level card: `won` shows NEXT, otherwise TRY AGAIN; `onButton` from its button. Lost with the
     *  power-up unused, +1 SLOT is offered too (it plays on). */
    public showResult(won: boolean, onButton: () => void): void {
        this.card.removeChildren().forEach((child) => child.destroy({ children: true }));
        const offer = !won && !this.extraUsed;
        const extraHeight = offer ? 84 : 0;
        const back = new PIXI.Graphics()
            .beginFill(0x8a5530).drawRoundedRect(-230, -150, 460, 310 + extraHeight, 36).endFill()
            .beginFill(0xfff4e6).drawRoundedRect(-230, -158, 460, 306 + extraHeight, 36).endFill();
        const heading = label(won ? 'PICTURE DONE!' : 'NO MOVES LEFT', 46, won ? 0x7ed957 : 0xff8a7a);
        heading.y = -80;
        const line = label(won ? 'The ants carried it all home.' : 'Every slot is waiting on a colour\nthe ants can\'t reach.', 24, BROWN);
        line.style.stroke = 0xffffff;
        line.style.strokeThickness = 0;
        line.y = -10;
        if (!won) AntAudio.play('lose');
        const action = button(won ? 'NEXT' : 'TRY AGAIN', won ? 'Button01_l_Green' : 'Button01_l_Yellow', 260, () => {
            this.hideResult();
            onButton();
        });
        action.y = 80;
        this.card.addChild(back, heading, line, action);
        if (offer) {
            // The power-up first: one more slot, and the ants carry on.
            const more = button('+1 SLOT', 'Button01_l_Sky', 260, () => {
                this.hideResult();
                this.onExtraSlot();
            });
            more.y = 80;
            action.y = 164;
            this.card.addChild(more);
        }
        this.dim.visible = true;
        this.card.visible = true;
        gsap.fromTo(this.card.scale, { x: 0.6, y: 0.6 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2)' });
        gsap.fromTo(this.dim, { alpha: 0 }, { alpha: 1, duration: 0.3 });
    }

    /**
     * A picture is done: the screen dims behind slowly turning golden rays, confetti in the picture's colours bursts
     * over it, and the card pops in — LEVEL COMPLETE!, the finished picture, three stars landing one after another, NEXT.
     */
    public celebrate(level: LevelData, onNext: () => void): void {
        this.card.removeChildren().forEach((child) => child.destroy({ children: true }));
        const back = new PIXI.Graphics()
            .beginFill(0x8a5530).drawRoundedRect(-250, -300, 500, 610, 40).endFill()
            .beginFill(0xfff4e6).drawRoundedRect(-250, -308, 500, 606, 40).endFill();
        const heading = label('LEVEL COMPLETE!', 50, 0xffd23f);
        heading.y = -248;
        const picture = this.miniPicture(level, 300);
        picture.y = -50;
        const name = label(level.name.toUpperCase(), 28, BROWN);
        name.style.stroke = 0xffffff;
        name.style.strokeThickness = 6;
        name.y = 126;
        const stars = new PIXI.Container();
        stars.y = -180;
        [-1, 0, 1].forEach((n, i) => {
            const star = this.star(n === 0 ? 46 : 36);
            star.position.set(n * 96, n === 0 ? -6 : 8);
            star.scale.set(0);
            stars.addChild(star);
            gsap.to(star.scale, { x: 1, y: 1, duration: 0.45, delay: 0.35 + i * 0.22, ease: 'back.out(3)' });
        });
        AntAudio.play('win');
        AntAudio.play('applause');
        const next = button('NEXT', 'Button01_l_Green', 280, () => {
            this.hideResult();
            onNext();
        });
        next.y = 222;
        this.card.addChild(back, heading, stars, picture, name, next);
        this.dim.visible = true;
        this.card.visible = true;
        gsap.fromTo(this.card.scale, { x: 0.5, y: 0.5 }, { x: 1, y: 1, duration: 0.5, ease: 'back.out(1.8)' });
        gsap.fromTo(this.dim, { alpha: 0 }, { alpha: 1, duration: 0.3 });
        this.showRays();
        this.burstConfetti(level.palette);
    }

    /** The finished picture, `size` px across its longer side: one rounded square per pixel. */
    private miniPicture(level: LevelData, size: number): PIXI.Container {
        const holder = new PIXI.Container();
        const pixels = pixelsOf(level);
        const cell = size / Math.max(level.width, level.height);
        const width = cell * level.width;
        const height = cell * level.height;
        const g = new PIXI.Graphics();
        g.beginFill(0xd9b79a).drawRoundedRect(-width / 2 - 12, -height / 2 - 12, width + 24, height + 24, 18).endFill();
        for (let i = 0; i < pixels.length; i++) {
            if (pixels[i] < 0) continue;
            const x = -width / 2 + (i % level.width) * cell;
            const y = -height / 2 + Math.floor(i / level.width) * cell;
            g.beginFill(new PIXI.Color(level.palette[pixels[i]]).toNumber()).drawRoundedRect(x + 0.5, y + 0.5, cell - 1, cell - 1, cell * 0.25).endFill();
        }
        holder.addChild(g);
        return holder;
    }

    /** A gold star with a darker rim. */
    private star(radius: number): PIXI.Graphics {
        const points = (r: number) => Array.from({ length: 10 }, (_, i) => {
            const a = -Math.PI / 2 + (i * Math.PI) / 5;
            const d = i % 2 === 0 ? r : r * 0.46;
            return [Math.cos(a) * d, Math.sin(a) * d];
        }).flat();
        return new PIXI.Graphics()
            .beginFill(0xc98a12).drawPolygon(points(radius + 6)).endFill()
            .beginFill(0xffd23f).drawPolygon(points(radius)).endFill();
    }

    /** Golden rays behind the card, turning slowly. */
    private showRays(): void {
        this.rays.removeChildren().forEach((child) => child.destroy());
        const g = new PIXI.Graphics();
        const count = 16;
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            const b = a + Math.PI / count;
            g.beginFill(0xffe27a, 0.22).moveTo(0, 0).lineTo(Math.cos(a) * 900, Math.sin(a) * 900).lineTo(Math.cos(b) * 900, Math.sin(b) * 900).closePath().endFill();
        }
        this.rays.addChild(g);
        this.rays.visible = true;
        gsap.fromTo(this.rays, { alpha: 0 }, { alpha: 1, duration: 0.5 });
        gsap.to(this.rays, { rotation: Math.PI * 2, duration: 24, ease: 'none', repeat: -1 });
    }

    /** Confetti in the picture's colours (and gold), bursting up from the card and fluttering down. */
    private burstConfetti(palette: string[]): void {
        return
        const colors = [...palette.map((hex) => new PIXI.Color(hex).toNumber()), 0xffd23f, 0xffffff];
        const screen = Game.overlayScreenData;
        const floor = screen ? screen.topLeft.y + screen.height + 40 : 1200;
        for (let n = 0; n < 90; n++) {
            const piece = new PIXI.Graphics().beginFill(colors[n % colors.length]).drawRect(-6, -4, 12, 8).endFill();
            piece.position.set(this.card.x, this.card.y - 120);
            piece.rotation = Math.random() * Math.PI;
            this.confetti.addChild(piece);
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
            const speed = 380 + Math.random() * 420;
            const upX = piece.x + Math.cos(angle) * speed;
            const upY = piece.y + Math.sin(angle) * speed;
            gsap.timeline({ onComplete: () => piece?.destroy() })
                .to(piece, { x: upX, y: upY, duration: 0.55, ease: 'power2.out' })
                .to(piece, { x: upX + (Math.random() - 0.5) * 160, y: floor, duration: 1.8 + Math.random() * 1.2, ease: 'power1.in' })
                .to(piece, { rotation: piece.rotation + (Math.random() - 0.5) * 18, duration: 2.6, ease: 'none' }, 0);
        }
    }

    public hideResult(): void {
        this.dim.visible = false;
        this.card.visible = false;
        this.rays.visible = false;
        gsap.killTweensOf(this.rays);
        this.confetti.children.forEach((piece) => gsap.killTweensOf(piece));
        this.confetti.removeChildren().forEach((child) => child.destroy());
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        this.title.position.set(screen.center.x, screen.topLeft.y + PAUSE.margin);
        // Pause top-left, the title in the middle, x2 top-right (the reference's corners).
        this.pause.position.set(screen.topLeft.x + PAUSE.margin, screen.topLeft.y + PAUSE.margin);
        this.pausePopup?.reposition();
        this.speed.position.set(screen.topLeft.x + screen.width - SPEED.x, screen.topLeft.y + PAUSE.margin);
        this.belt.layout(screen.topLeft.x, screen.topLeft.y + screen.height, screen.width);
        this.card.position.set(screen.center.x, screen.center.y);
        this.rays.position.set(screen.center.x, screen.center.y);
        this.dim.clear().beginFill(0x2a1a10, 0.45).drawRect(screen.topLeft.x, screen.topLeft.y, screen.width, screen.height).endFill();
    }

    public override destroy(): void {
        gsap.killTweensOf(this.card.scale);
        this.hideResult();
        gsap.killTweensOf(this.speed.scale);
        gsap.killTweensOf(this.pause.scale);
        this.hidePause();
        gsap.killTweensOf(this.dim);
        super.destroy({ children: true });
    }
}
