// UfoHud.ts
//
// Two layouts. Competition: the round's clock and the leaderboard. Standard: a ring timer, a points bar, the goal, a kill
// count and small coloured arrows to the other saucers. Both: the size bar under the saucer, points popping up, a short
// message when something's too big, a
// hint that stays until it's done, the leaderboard, rivals' name tags and the markers at the screen's edges pointing to
// those out of view, the mute button, the start menu and the end screen. Sprites from the UI library (ui{tps} atlas).

import * as PIXI from 'pixi.js';
import { MoveHint } from './MoveHint';
import gsap from 'gsap';
import { Game } from 'core/Game';
import SoundToggleButton from 'core/ui/SoundToggleButton';
import { UfoAudio } from '../audio/UfoAudio';
import { BakedShape } from './BakedShape';
import { DARK } from './UiParts';
import { EndOptions, EndReveal } from './EndReveal';
import { PlayerLook, PlayerRow, ROW, fitPill, iconSprite, label, pill, placeScale, strokedArrow, tappable } from './UiParts';

export { label };

const BAR = { width: 320, height: 26, top: 44 };
const MUTE_SIZE = 56;
/** The trophy on the end of the top bar, in standard mode: what it's filling up to. */
const TROPHY = { size: 54, overhang: 14 };
/** The tutorial's goal coming in: from this small, this long, overshooting this much. */
const GOAL_POP = { from: 0.2, seconds: 0.5, ease: 'back.out(2.6)' };
/** How to fly: where it is, as a share of the screen's height. */
const MOVE_HINT_Y = 0.72;
const HOME_GAP = 10;
/** The icon's share of the button; the icons are 128 wide. */
const MUTE_ICON = 0.55 / 128;
const MARGIN = 16;
const COLORS = { back: 0x10123a, fill: 0x59e6c8, rim: 0xffffff, you: 0xffe27a, danger: 0xff5a5a, safe: 0x5fe87a, neutral: 0xe8ecf4, markerIcon: 0x10123a };
const MESSAGE_SECONDS = 1.3;
const BOARD = { rows: 6, gap: 4, narrowScale: 0.8 };
/** Below this width the leaderboard's smaller, in the top right corner, and the clock and size shrink to fit beside it. */
const NARROW = 760;
/** The clock's text, shrunk with its bar: never smaller than this on screen (px). */
const CLOCK_TEXT_MIN = 14;
/** The standard layout's top: the ring timer's size and line, how far the goal's banner and the kill count sit. */
const RING = { size: 92, line: 8, colorBack: 0x2c6be0, colorLine: 0xffc83a, killsY: 68, bannerY: 176 };
/** The ring's picture: drawn once per step of its line, this many times its size, and kept. */
const RING_BAKE = { scale: 3, steps: 120 };
const ringTextures = new Map<number, PIXI.Texture>();

/** The ring timer's picture with its line this far round: smooth, unlike PIXI.Graphics here. */
function ringTexture(step: number): PIXI.Texture {
    const cached = ringTextures.get(step);
    if (cached) return cached;
    const size = RING.size * RING_BAKE.scale;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d')!;
    const middle = size / 2;
    const scale = RING_BAKE.scale;
    g.beginPath();
    g.arc(middle, middle, middle - scale, 0, Math.PI * 2);
    g.fillStyle = '#10123a';
    g.fill();
    const fill = g.createLinearGradient(0, 0, 0, size);
    fill.addColorStop(0, '#4f93ff');
    fill.addColorStop(1, '#1f4fc0');
    g.beginPath();
    g.arc(middle, middle, middle - scale * 4, 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
    const radius = middle - scale * 8;
    g.lineWidth = RING.line * scale;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(middle, middle, radius, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(16, 18, 58, 0.55)';
    g.stroke();
    if (step > 0) {
        g.beginPath();
        g.arc(middle, middle, radius, -Math.PI / 2, -Math.PI / 2 + (step / RING_BAKE.steps) * Math.PI * 2);
        g.strokeStyle = '#ffc83a';
        g.stroke();
    }
    const texture = PIXI.Texture.from(canvas, { mipmap: PIXI.MIPMAP_MODES.ON, scaleMode: PIXI.SCALE_MODES.LINEAR });
    ringTextures.set(step, texture);
    return texture;
}
/** The bar under the saucer, and its "Size n". */
const SIZE_BAR = { width: 128, height: 16, labelY: 24 };
/** The points popping up: how far, how long, how many at most. */
const POP = { rise: 70, seconds: 0.8, most: 18 };
/** The arrows to other saucers: their size, and how far inside the screen's edges. */
const ARROW = { size: 30, edge: 28, top: 222 };
const BAR_GREEN = 0x49e04d;
/** The goal's line: its size, its important words' colour, how much its pulse swells. */
const BANNER = { fontSize: 24, green: 0x6dff5a, pulse: 1.08 };
/** A hunter's arrow: its stroke goes this colour. */
const HUNTER_STROKE = 0xff2a2a;
/** The clock's icon: its size, and how far left of the bar's middle: over its left end, so it stays on a phone's screen. */
const TIMER_ICON = { size: 40, x: BAR.width / 2 - 8 };
/**
 * A marker for a rival out of view: a circle (its colour and icon say what it means for the player) with an arrow on its
 * rim, kept this far inside the screen's edges; further down from the top, clear of the bar and the size.
 */
const MARKER = { circle: 52, face: 36, badge: 24, badgeAt: 21, arrow: 22, arrowAt: 34, edge: 46, top: 112, name: 15 };
export type MarkerKind = 'danger' | 'food' | 'neutral';
const MARKER_LOOK: Record<MarkerKind, { color: number; badge: string | null }> = {
    danger: { color: COLORS.danger, badge: 'PictoIcon_Skull' },
    food: { color: COLORS.safe, badge: 'PictoIcon_Target' },
    neutral: { color: COLORS.neutral, badge: null },
};

export interface BoardRow extends PlayerLook {
    size: number;
    you: boolean;
}

interface Marker {
    holder: PIXI.Container;
    circle: PIXI.Sprite;
    face: PIXI.Sprite;
    badgeBack: PIXI.Sprite;
    badge: PIXI.Sprite;
    arrow: PIXI.Sprite;
    arrowFill: PIXI.Sprite;
    name: PIXI.Text;
}

export class UfoHud extends PIXI.Container {
    private readonly bar = new PIXI.Container();
    private readonly trophy = iconSprite('ItemIcon_Trophy_Gold', TROPHY.size);
    private goalPop: gsap.core.Tween | null = null;
    private readonly reveal = new PIXI.Graphics();
    private readonly percent = label(20);
    private missionMode = false;
    private readonly barFill: BakedShape;
    private readonly ring = new PIXI.Container();
    private readonly ringPicture = new PIXI.Sprite(ringTexture(RING_BAKE.steps));
    private ringStep = RING_BAKE.steps;
    private readonly ringText = label(26);
    private readonly kills = new PIXI.Container();
    private readonly killsText = label(22);
    private readonly bannerRow = new PIXI.Container();
    private readonly bannerPill = pill();
    private readonly sizeBar = new PIXI.Container();
    private readonly sizeReveal = new PIXI.Graphics();
    private readonly sizeText = label(20);
    private readonly pops = new PIXI.Container();
    private readonly popPool: PIXI.Text[] = [];
    private readonly arrows = new PIXI.Container();
    private readonly arrowPool: { stroke: PIXI.Sprite; fill: PIXI.Sprite }[] = [];
    private readonly callout = label(56);
    private readonly calloutSkull = iconSprite('ItemIcon_Skull', 96);
    private readonly message = label(30, 0xffe27a);
    private readonly messagePill = pill();
    private readonly hintText = label(28);
    private readonly hintPill = pill();
    /** A hand going round a figure of eight, over the hint: how to fly. */
    private readonly moveHint = new MoveHint();
    private readonly mute = new PIXI.Container();
    private readonly home = new PIXI.Container();
    private readonly board = new PIXI.Container();
    private readonly boardRows: PlayerRow[] = [];
    private youPlace = 0;
    private boardCount = 0;
    /** How far down from the top markers start: under whatever's up there. */
    private markerTop = MARKER.top;
    private readonly tags = new PIXI.Container();
    private readonly tagTexts: PIXI.Text[] = [];
    private readonly markers = new PIXI.Container();
    private readonly markerPool: Marker[] = [];
    private end: EndReveal | null = null;
    private share = -1;
    private label = '';
    private timerIcon!: PIXI.Sprite;

    /** `onRestart`: the end screen's main button. `onHome`: out to the home screen. */
    public constructor(private readonly onRestart: () => void, private readonly onHome: () => void) {
        super();
        const back = new BakedShape(BAR.width, BAR.height, BAR.height / 2, { fill: COLORS.back, fillAlpha: 0.85, rim: COLORS.rim, rimWidth: 3 });
        const fill = new BakedShape(BAR.width - 6, BAR.height - 6, (BAR.height - 6) / 2, { fill: COLORS.fill });
        this.barFill = fill;
        fill.mask = this.reveal;
        this.trophy.x = BAR.width / 2;
        this.trophy.visible = false;
        this.bar.addChild(back, fill, this.reveal, this.percent, this.trophy);
        const timer = iconSprite('Icon_Timer', TIMER_ICON.size);
        timer.x = -TIMER_ICON.x;
        timer.visible = false;
        this.timerIcon = timer;
        this.bar.addChild(timer);
        this.buildMissionParts();
        this.message.alpha = 0;
        this.hintText.visible = false;
        this.messagePill.alpha = 0;
        this.hintPill.visible = false;
        let boardTop = 0;
        for (let i = 0; i < BOARD.rows; i++) {
            const row = new PlayerRow();
            // The top three are bigger: stacked by their real heights, their right edges lined up.
            const height = ROW.height * placeScale(i + 1);
            row.x = -(ROW.width * (placeScale(i + 1) - 1)) / 2;
            row.y = boardTop + height / 2;
            boardTop += height + BOARD.gap;
            this.boardRows.push(row);
            this.board.addChild(row);
        }
        this.board.visible = false;
        this.buildMute();
        this.buildHome();
        this.addChild(this.tags, this.sizeBar, this.pops, this.arrows, this.bar, this.ring, this.kills, this.bannerPill, this.bannerRow, this.callout, this.calloutSkull,
            this.messagePill, this.message, this.hintPill, this.hintText, this.moveHint, this.markers, this.board, this.mute, this.home);
        this.setProgress(0, 'TOWN');
        this.reposition();
    }

    private buildMissionParts(): void {
        this.ringPicture.anchor.set(0.5);
        this.ringPicture.scale.set(1 / RING_BAKE.scale);
        this.ring.addChild(this.ringPicture, this.ringText);
        this.ring.visible = false;
        const skull = iconSprite('ItemIcon_Skull', 40);
        this.killsText.position.set(24, 6);
        this.kills.addChild(skull, this.killsText);
        this.kills.visible = false;
        this.bannerRow.alpha = 0;
        this.bannerPill.alpha = 0;
        const sizeBack = new BakedShape(SIZE_BAR.width, SIZE_BAR.height, SIZE_BAR.height / 2, { fill: COLORS.back, fillAlpha: 0.85, rim: COLORS.back, rimWidth: 3 });
        const sizeFill = new BakedShape(SIZE_BAR.width - 4, SIZE_BAR.height - 4, (SIZE_BAR.height - 4) / 2, { fill: 0xffc83a });
        sizeFill.mask = this.sizeReveal;
        this.sizeText.y = SIZE_BAR.labelY;
        this.sizeBar.addChild(sizeBack, sizeFill, this.sizeReveal, this.sizeText);
        this.sizeBar.visible = false;
        for (const part of [this.callout, this.calloutSkull]) part.alpha = 0;
    }

    /** Standard mode's top, or competition's. */
    public setMission(on: boolean): void {
        this.missionMode = on;
        this.trophy.visible = on;
        this.ring.visible = on;
        this.kills.visible = on;
        if (on) this.barFill.setLook({ fill: BAR_GREEN });
        this.reposition();
    }

    /** The ring timer: its time, and its gold line running out. */
    public setRing(seconds: number, total: number): void {
        const whole = Math.max(0, Math.ceil(seconds));
        const text = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
        if (this.ringText.text !== text) this.ringText.text = text;
        const share = Math.max(0, Math.min(1, seconds / Math.max(total, 1e-3)));
        const step = Math.round(share * RING_BAKE.steps);
        if (step !== this.ringStep) {
            this.ringStep = step;
            this.ringPicture.texture = ringTexture(step);
        }
    }

    public setScoreBar(share: number, text: string): void {
        const clamped = Math.max(0, Math.min(1, share));
        if (clamped !== this.share) {
            this.share = clamped;
            this.drawBar(clamped);
        }
        if (this.percent.text !== text) this.percent.text = text;
    }

    /** No clock (the tutorial). */
    public hideRing(): void {
        this.ring.visible = false;
    }

    /** Nobody to eat. */
    public hideKills(): void {
        this.kills.visible = false;
    }

    public setKills(count: number): void {
        const text = String(count);
        if (this.killsText.text !== text) this.killsText.text = text;
    }

    /** The goal's line, its important parts in green. It stays hidden until flashBanner(). */
    public setBanner(parts: readonly { text: string; green?: boolean }[]): void {
        this.bannerRow.removeChildren().forEach((child) => child.destroy());
        let x = 0;
        for (const part of parts) {
            const text = label(BANNER.fontSize, part.green ? BANNER.green : 0xffffff);
            text.anchor.set(0, 0.5);
            text.text = part.text;
            text.x = x;
            x += text.width;
            this.bannerRow.addChild(text);
        }
        this.bannerRow.children.forEach((child) => { child.x -= x / 2; });
        this.placeBanner();
    }

    /** The tutorial's first step: only how to fly. The top bar waits for showTutorialGoal(). */
    public hideTopBar(): void {
        this.bar.visible = false;
    }

    /** The tutorial's next step, once something's been eaten: the top bar and the goal's line come in, and the line stays. */
    public showTutorialGoal(): void {
        this.bar.visible = true;
        const parts = [this.bar, this.bannerRow, this.bannerPill];
        gsap.killTweensOf(parts);
        gsap.fromTo(this.bar, { alpha: 0 }, { alpha: 1, duration: 0.3 });
        this.placeBanner();
        for (const part of [this.bannerRow, this.bannerPill]) part.alpha = 1;
        // The line and its pill pop together, from their middle.
        const { x, y } = this.bannerRow;
        const size = this.bannerRow.scale.x;
        const { width, height } = this.bannerPill;
        const pop = { scale: GOAL_POP.from };
        const apply = () => {
            this.bannerRow.scale.set(size * pop.scale);
            this.bannerPill.scale.set(pop.scale);
            this.bannerPill.position.set(x - (width * pop.scale) / 2, y - (height * pop.scale) / 2);
        };
        apply();
        this.goalPop = gsap.to(pop, { scale: 1, duration: GOAL_POP.seconds, ease: GOAL_POP.ease, onUpdate: apply });
        const trophyScale = this.trophy.scale.x;
        gsap.fromTo(this.trophy.scale, { x: 0, y: 0 }, { x: trophyScale, y: trophyScale, duration: GOAL_POP.seconds, delay: 0.1, ease: GOAL_POP.ease });
        UfoAudio.milestone();
    }

    /** Shows the goal's line for a while, then it fades; `pulse`: a beat to catch the eye. */

    public flashBanner(seconds: number, pulse: boolean): void {
        const parts = [this.bannerRow, this.bannerPill];
        gsap.killTweensOf(parts);
        gsap.killTweensOf(this.bannerRow.scale);
        gsap.to(parts, { alpha: 1, duration: 0.25 });
        gsap.to(parts, { alpha: 0, duration: 0.4, delay: seconds });
        this.placeBanner();
        if (!pulse) return;
        const size = this.bannerRow.scale.x;
        gsap.fromTo(this.bannerRow.scale, { x: size, y: size }, { x: size * BANNER.pulse, y: size * BANNER.pulse, duration: 0.3, yoyo: true, repeat: 5, ease: 'sine.inOut' });
    }

    private placeBanner(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        // (A resize in the middle of the goal's pop: straight to its end.)
        this.goalPop?.kill();
        this.goalPop = null;
        this.bannerPill.scale.set(1);
        gsap.killTweensOf(this.bannerRow.scale);
        this.bannerRow.scale.set(1);
        this.bannerRow.scale.set(Math.min(1, (screen.width - 56) / Math.max(this.bannerRow.width, 1)));
        this.bannerRow.position.set(screen.center.x, screen.topLeft.y + MARGIN + RING.bannerY);
        fitPill(this.bannerPill, this.bannerRow);
    }

    /** The bar under the saucer: its place on screen (in the HUD's space; null hides it), how far to the next size, and which size. */
    public setSizeBar(at: { x: number; y: number } | null, share: number, size: number): void {
        this.sizeBar.visible = at !== null;
        if (!at) return;
        this.sizeBar.position.set(at.x, at.y);
        const inner = SIZE_BAR.width - 4;
        this.sizeReveal.clear().beginFill(0xffffff).drawRect(-inner / 2, -SIZE_BAR.height / 2, inner * Math.max(0.04, share), SIZE_BAR.height).endFill();
        const text = `Size ${size}`;
        if (this.sizeText.text !== text) this.sizeText.text = text;
    }

    /** Its bar gives a little jump: a new size. */
    public bumpSizeBar(): void {
        gsap.killTweensOf(this.sizeBar.scale);
        gsap.fromTo(this.sizeBar.scale, { x: 1.35, y: 1.35 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(3)' });
    }

    /** A point value rising from a spot (in the HUD's space). */
    public popPoints(x: number, y: number, text: string, big: boolean): void {
        let pop = this.popPool.find((candidate) => !candidate.visible);
        if (!pop) {
            if (this.popPool.length >= POP.most) return;
            pop = label(30);
            this.popPool.push(pop);
            this.pops.addChild(pop);
        }
        gsap.killTweensOf(pop);
        gsap.killTweensOf(pop.scale);
        pop.visible = true;
        pop.text = text;
        pop.alpha = 1;
        pop.position.set(x, y);
        const size = big ? 1.5 : 0.8;
        pop.scale.set(size * 0.6);
        gsap.to(pop.scale, { x: size, y: size, duration: 0.18, ease: 'back.out(3)' });
        gsap.to(pop, { y: y - POP.rise, duration: POP.seconds, ease: 'power1.out' });
        const done = pop;
        gsap.to(pop, { alpha: 0, duration: POP.seconds * 0.4, delay: POP.seconds * 0.6, onComplete: () => { done.visible = false; } });
    }

    /** A kill streak's shout, with a skull over the saucer. */
    public shout(text: string, x: number, y: number): void {
        this.callout.text = text;
        const screen = Game.overlayScreenData;
        this.callout.scale.set(1);
        const fit = screen ? Math.min(1, (screen.width - 40) / Math.max(this.callout.width, 1)) : 1;
        gsap.killTweensOf([this.callout, this.callout.scale, this.calloutSkull, this.calloutSkull.scale]);
        this.callout.alpha = 1;
        this.callout.scale.set(fit * 1.6);
        gsap.to(this.callout.scale, { x: fit, y: fit, duration: 0.25, ease: 'back.out(2.2)' });
        gsap.to(this.callout, { alpha: 0, duration: 0.3, delay: 1.1 });
        this.calloutSkull.position.set(x, y);
        this.calloutSkull.alpha = 1;
        const size = this.calloutSkull.scale.x;
        this.calloutSkull.scale.set(size * 0.3);
        const skullY = y - 90;
        gsap.to(this.calloutSkull.scale, { x: size, y: size, duration: 0.3, ease: 'back.out(3)' });
        gsap.to(this.calloutSkull, { y: skullY, duration: 0.7, ease: 'power2.out' });
        gsap.to(this.calloutSkull, { alpha: 0, duration: 0.3, delay: 0.75 });
    }

    /**
     * A small coloured arrow at the screen's edge, on the line from its middle to `target` (a point in the HUD's space, off
     * screen; null hides it).
     */
    public setArrow(index: number, target: { x: number; y: number } | null, color: number, hunting = false): void {
        const screen = Game.overlayScreenData;
        let arrow = this.arrowPool[index];
        if (!arrow) {
            if (!target) return;
            arrow = strokedArrow(ARROW.size);
            this.arrowPool[index] = arrow;
            this.arrows.addChild(arrow.stroke);
        }
        arrow.stroke.visible = !!target && !!screen;
        if (!target || !screen) return;
        const pin = UfoHud.pinToEdge(screen, target, ARROW.edge, ARROW.top);
        arrow.stroke.position.set(pin.x, pin.y);
        arrow.stroke.rotation = pin.angle;
        arrow.fill.tint = color;
        arrow.stroke.tint = hunting ? HUNTER_STROKE : DARK;
    }

    /** A spot on the line from the screen's middle to `target`, at the edge of a box this far inside the screen. */
    private static pinToEdge(screen: typeof Game.overlayScreenData, target: { x: number; y: number }, edge: number, topEdge: number): { x: number; y: number; angle: number; } {
        const left = screen.topLeft.x + edge;
        const right = screen.topLeft.x + screen.width - edge;
        const top = screen.topLeft.y + topEdge;
        const bottom = screen.topLeft.y + screen.height - edge;
        const middleX = (left + right) / 2;
        const middleY = (top + bottom) / 2;
        const dx = target.x - middleX;
        const dy = target.y - middleY;
        const reach = Math.min(
            dx > 0 ? (right - middleX) / dx : dx < 0 ? (left - middleX) / dx : Infinity,
            dy > 0 ? (bottom - middleY) / dy : dy < 0 ? (top - middleY) / dy : Infinity,
        );
        return { x: middleX + dx * reach, y: middleY + dy * reach, angle: Math.atan2(dx, -dy) };
    }

    /** Under the mute button: leaves the level. */
    private buildHome(): void {
        const back = PIXI.Sprite.from('Button_Round03_Dark');
        back.anchor.set(0.5);
        back.width = back.height = MUTE_SIZE;
        this.home.addChild(back, iconSprite('Icon_MapPoint', MUTE_SIZE * 0.72));
        tappable(this.home, this.onHome);
    }

    private placeHome(): void {
        this.home.position.set(this.mute.x, this.mute.y + MUTE_SIZE + HOME_GAP);
    }

    /** No leaving (the tutorial). */
    public hideHome(): void {
        this.home.visible = false;
    }

    private buildMute(): void {
        const back = PIXI.Sprite.from('Button_Round03_Dark');
        back.anchor.set(0.5);
        back.width = back.height = MUTE_SIZE;
        const icons = new SoundToggleButton('PictoIcon_Sound', 'PictoIcon_Sound_Off');
        icons.scale.set(MUTE_SIZE * MUTE_ICON);
        this.mute.addChild(back, icons);
        this.mute.eventMode = 'static';
        this.mute.cursor = 'pointer';
        // Not a steer of the saucer.
        this.mute.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.mute.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            // The icons do the toggling; a tap on the button round them is passed on to them.
            if (event.target !== icons) icons.emit('pointertap', event);
            UfoAudio.toggle();
            gsap.killTweensOf(this.mute.scale);
            gsap.fromTo(this.mute.scale, { x: 0.86, y: 0.86 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)' });
        });
    }

    private drawBar(share: number): void {
        const inner = BAR.width - 6;
        this.reveal.clear().beginFill(0xffffff).drawRect(-inner / 2, -BAR.height / 2, inner * share, BAR.height).endFill();
    }

    /** `share`: how far along (0..1); `label`: of what. */
    public setProgress(share: number, label: string): void {
        if (share === this.share && label === this.label) return;
        this.share = share;
        this.label = label;
        this.drawBar(share);
        this.percent.text = `${label} ${Math.floor(share * 100)}%`;
    }

    /** The round's clock on the bar. */
    public setClock(seconds: number, total: number): void {
        const whole = Math.max(0, Math.ceil(seconds));
        const share = Math.max(0, seconds / Math.max(total, 1e-3));
        this.timerIcon.visible = true;
        this.drawBar(share);
        const text = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
        if (this.percent.text !== text) this.percent.text = text;
    }

    /** A short line in the middle of the screen (the same one again only keeps it up). */
    public say(text: string): void {
        this.message.text = text;
        this.fitLine(this.message, this.messagePill);
        gsap.killTweensOf([this.message, this.messagePill]);
        this.message.alpha = 1;
        this.messagePill.alpha = 0.9;
        gsap.to([this.message, this.messagePill], { alpha: 0, duration: 0.35, delay: MESSAGE_SECONDS });
    }

    /** A line that stays until it's done (null takes it down). */
    public hint(text: string | null): void {
        this.hintText.visible = text !== null;
        this.hintPill.visible = text !== null;
        if (text !== null && this.hintText.text !== text) {
            this.hintText.text = text;
            this.fitLine(this.hintText, this.hintPill);
        }
    }

    /** The figure of eight with its hand, until the player's flying. */
    public showMoveHand(on: boolean): void {
        if (on) this.moveHint.show();
        else this.moveHint.hide();
    }

    /** The biggest few, always with the player. */
    public setBoard(rows: readonly BoardRow[]): void {
        this.board.visible = rows.length > 0;
        const youAt = rows.findIndex((row) => row.you);
        this.boardRows.forEach((view, i) => {
            const isYouLast = i === BOARD.rows - 1 && youAt >= BOARD.rows;
            const row = isYouLast ? rows[youAt] : rows[i];
            view.visible = !!row;
            if (row) view.set(isYouLast ? youAt + 1 : i + 1, row, row.size, row.you);
        });
        // You climbed: your row gets a little bump.
        const place = youAt + 1;
        if (place > 0 && this.youPlace > 0 && place < this.youPlace) {
            const view = this.boardRows[Math.min(youAt, BOARD.rows - 1)];
            const base = view.baseScale;
            gsap.fromTo(view.scale, { x: base, y: base }, { x: base * 1.08, y: base * 1.08, duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.inOut' });
        }
        this.youPlace = place;
        const count = Math.min(rows.length, BOARD.rows);
        if (count !== this.boardCount) {
            this.boardCount = count;
            this.reposition();
        }
    }

    /** A rival's name over it (`x`, `y` in the HUD's space; null hides it); red if it could eat the player, green if it's food. */
    public setTag(index: number, at: { x: number; y: number } | null, name: string, danger: boolean, food: boolean): void {
        while (this.tagTexts.length <= index) {
            const text = label(18);
            text.anchor.set(0.5, 1);
            this.tagTexts.push(text);
            this.tags.addChild(text);
        }
        const text = this.tagTexts[index];
        text.visible = at !== null;
        if (!at) return;
        text.position.set(at.x, at.y);
        if (text.text !== name) text.text = name;
        text.style.fill = danger ? COLORS.danger : food ? COLORS.safe : 0xffffff;
    }

    /** Whether a point (in the HUD's space) is inside the area the markers keep to: in view, so no marker needed. */
    public isInView(x: number, y: number): boolean {
        const screen = Game.overlayScreenData;
        if (!screen) return true;
        return x >= screen.topLeft.x && x <= screen.topLeft.x + screen.width && y >= screen.topLeft.y && y <= screen.topLeft.y + screen.height;
    }

    private makeMarker(): Marker {
        const holder = new PIXI.Container();
        const circle = iconSprite('BorderFrame_Circle60', MARKER.circle);
        const face = iconSprite('ProfileFace_s_00', MARKER.face);
        const { stroke: arrow, fill: arrowFill } = strokedArrow(MARKER.arrow * 1.25);
        const name = label(MARKER.name);
        const badgeBack = iconSprite('BorderFrame_Circle60', MARKER.badge);
        const badge = iconSprite('PictoIcon_Skull', MARKER.badge * 0.62);
        badge.tint = COLORS.markerIcon;
        badgeBack.position.set(MARKER.badgeAt, MARKER.badgeAt);
        badge.position.set(MARKER.badgeAt, MARKER.badgeAt);
        holder.addChild(arrow, circle, face, badgeBack, badge, name);
        this.markers.addChild(holder);
        const marker = { holder, circle, face, badgeBack, badge, arrow, arrowFill, name };
        this.markerPool.push(marker);
        return marker;
    }

    /**
     * A marker pinned to the screen's edge, on the line from the screen's middle to `target` (a point in the HUD's space,
     * off screen; null hides it), its arrow pointing that way.
     */
    public setMarker(index: number, target: { x: number; y: number } | null, kind: MarkerKind, player: PlayerLook | null): void {
        const screen = Game.overlayScreenData;
        const marker = this.markerPool[index] ?? (target ? this.makeMarker() : null);
        if (!marker) return;
        marker.holder.visible = !!target && !!screen;
        if (!target || !screen || !player) return;
        const { x, y, angle } = UfoHud.pinToEdge(screen, target, MARKER.edge, this.markerTop);
        marker.holder.position.set(x, y);
        marker.arrow.rotation = angle;
        marker.arrow.position.set(Math.sin(angle) * MARKER.arrowAt, -Math.cos(angle) * MARKER.arrowAt);
        const look = MARKER_LOOK[kind];
        marker.circle.tint = look.color;
        marker.arrowFill.tint = look.color;
        const face = PIXI.Texture.from(player.face);
        if (marker.face.texture !== face) {
            marker.face.texture = face;
            marker.face.scale.set(MARKER.face / Math.max(face.width, face.height, 1));
        }
        marker.badge.visible = marker.badgeBack.visible = look.badge !== null;
        if (look.badge) {
            marker.badge.texture = PIXI.Texture.from(look.badge);
            marker.badgeBack.tint = look.color;
        }
        // Its name on the side towards the middle, away from the arrow.
        marker.name.position.set(-Math.sin(angle) * (MARKER.circle / 2 + 12), Math.cos(angle) * (MARKER.circle / 2 + 12));
        if (marker.name.text !== player.name) marker.name.text = player.name;
    }

    /** The end of the level: everything else clears off, and the reveal plays. */
    public showEnd(options: EndOptions): void {
        this.hint(null);
        this.showMoveHand(false);
        gsap.killTweensOf([this.message, this.messagePill]);
        this.message.alpha = 0;
        this.messagePill.alpha = 0;
        this.setBoard([]);
        this.markers.visible = false;
        this.tags.visible = false;
        this.bar.visible = false;
        this.ring.visible = false;
        this.kills.visible = false;
        gsap.killTweensOf([this.bannerRow, this.bannerPill, this.bannerRow.scale]);
        this.bannerRow.visible = false;
        this.bannerPill.visible = false;
        this.sizeBar.visible = false;
        this.arrows.visible = false;
        this.home.visible = false;
        // Lost: going home's an option. (Won, the main button already goes there.)
        this.end = new EndReveal(options, this.onRestart, options.outcome === 'lose' ? this.onHome : undefined);
        this.addChild(this.end);
        this.reposition();
    }

    /** A centred line and its pill, fitted to the screen. */
    private fitLine(text: PIXI.Text, back: PIXI.NineSlicePlane): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        text.scale.set(1);
        text.scale.set(Math.min(1, (screen.width - 56) / Math.max(text.width, 1)));
        fitPill(back, text);
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        // The leaderboard always in the top right corner, the mute button in the top left, and on a narrow screen the clock
        // and size between them, at the top as ever, shrunk if they have to be to fit (these are design units: 720 across).
        const narrow = screen.width < NARROW;
        const boardScale = narrow ? BOARD.narrowScale : 1;
        this.board.scale.set(boardScale);
        const beside = narrow && this.boardCount > 0;
        const muteX = screen.topLeft.x + MARGIN + MUTE_SIZE / 2;
        // (The first row is the widest, by its scale.)
        const left = beside ? muteX + MUTE_SIZE / 2 + MARGIN / 2 : screen.topLeft.x + MARGIN;
        const right = screen.topLeft.x + screen.width - (beside ? ROW.width * boardScale * placeScale(1) + MARGIN * 1.5 : MARGIN);
        const fit = Math.min(1, (right - left) / BAR.width);
        const middle = beside ? (left + right) / 2 : screen.center.x;
        this.bar.scale.set(fit);
        this.bar.position.set(middle, screen.topLeft.y + BAR.top);
        this.percent.scale.set(Math.max(1, CLOCK_TEXT_MIN / (this.percent.style.fontSize as number) / fit));
        // Top left, or under the bar if it reaches that far (narrow, and no leaderboard beside it).
        const clearOfBar = beside || middle - (BAR.width * fit) / 2 >= muteX + MUTE_SIZE / 2 + MARGIN;
        this.mute.position.set(muteX, clearOfBar ? screen.topLeft.y + MARGIN + MUTE_SIZE / 2 : this.bar.y + 34 + MUTE_SIZE / 2);
        this.placeHome();
        this.markerTop = MARKER.top;
        this.board.position.set(screen.topLeft.x + screen.width - MARGIN - (ROW.width * boardScale) / 2, screen.topLeft.y + MARGIN);
        this.message.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.3);
        this.hintText.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.88);
        this.moveHint.position.set(screen.center.x, screen.topLeft.y + screen.height * MOVE_HINT_Y);
        this.fitLine(this.message, this.messagePill);
        this.fitLine(this.hintText, this.hintPill);
        this.placeMissionParts(screen);
        this.callout.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.3);
        this.end?.place(screen.center.x, screen.center.y, screen.width, screen.height);
    }

    /** The standard layout's top row: ring timer, points bar, mute; the kill count and the goal under them. */
    private placeMissionParts(screen: typeof Game.overlayScreenData): void {
        if (!this.missionMode) return;
        const ringX = screen.topLeft.x + MARGIN + RING.size / 2;
        const ringY = screen.topLeft.y + MARGIN + RING.size / 2;
        this.ring.position.set(ringX, ringY);
        const muteX = screen.topLeft.x + screen.width - MARGIN - MUTE_SIZE / 2;
        this.mute.position.set(muteX, ringY);
        this.placeHome();
        const left = ringX + RING.size / 2 + 4;
        const right = muteX - MUTE_SIZE / 2 - 8 - TROPHY.overhang;
        const fit = Math.min(1.25, (right - left) / BAR.width);
        this.bar.scale.set(fit);
        this.bar.position.set((left + right) / 2, ringY);
        this.percent.scale.set(1);
        this.timerIcon.visible = false;
        this.kills.position.set(ringX, ringY + RING.killsY);
        this.placeBanner();
    }

    public override destroy(): void {
        this.goalPop?.kill();
        gsap.killTweensOf(this.trophy.scale);
        gsap.killTweensOf(this.bar);
        gsap.killTweensOf([this.message, this.messagePill]);
        gsap.killTweensOf(this.mute.scale);
        gsap.killTweensOf(this.sizeBar.scale);
        gsap.killTweensOf([this.bannerRow, this.bannerPill, this.bannerRow.scale]);
        gsap.killTweensOf([this.callout, this.callout.scale, this.calloutSkull, this.calloutSkull.scale]);
        this.popPool.forEach((pop) => {
            gsap.killTweensOf(pop);
            gsap.killTweensOf(pop.scale);
        });
        this.boardRows.forEach((row) => gsap.killTweensOf(row.scale));
        super.destroy({ children: true });
    }
}
