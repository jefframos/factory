// RadialTransition.ts
//
// The screen transition (the UFO game's circular wipe, games/ufo/game/ui/RadialTransition.ts, in Ant's colours): drawn
// in the game's top PIXI layer (game.popupLayer, over the 3D world and all the UI).
//   cover()  — a peach circle with a cream rim and a white ring inside it grows from the screen's middle out to the
//              corners; then where the player's going pops in: the level's picture (small, pixel by pixel), its title
//              and name.
//   reveal() — the mirror: a hole grows from the middle out, the new screen appearing from the centre.
// A change of screen or level: cover(), the new one built underneath, reveal(), destroy() — or all of it: go().
//
// The rect the reveal's hole is cut from is drawn much larger than the screen: PIXI's holes must stay inside their shape.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { LevelData, pixelsOf } from '../data/Levels';
import { AntAudio } from '../audio/AntAudio';
import { label } from './UiParts';

const DURATION_SEC = 0.5;
const EASE = 'power2.inOut';
const HOST_MARGIN_SCALE = 2;
/** The floor's deeper peach, a cream rim, a white ring inside it. */
const FILL_COLOR = 0xe9a36f;
const RIM_COLOR = 0xfff1de;
const RIM_WIDTH = 14;
const RING_COLOR = 0xffffff;
const RING_WIDTH = 5;
/** The badge: the picture's size (design units), the plate under it, where the words go. */
const BADGE = { picture: 150, plate: 0xfff4e6, plateEdge: 0xb87a4b, titleY: 122, subtitleY: 168 };
/** reveal() waits for this many frames in a row under SMOOTH_MS (a freshly built scene stalls its first frames: the
 *  wipe would run during the stall and just pop), MAX_WAIT_MS at most. */
const SMOOTH_FRAMES = 6;
const SMOOTH_MS = 45;
const MAX_WAIT_MS = 2500;

/** A level's picture as flat rounded squares, `size` across its longer side, on a cream plate. */
function miniPicture(level: LevelData, size: number): PIXI.Graphics {
    const pixels = pixelsOf(level);
    const cell = size / Math.max(level.width, level.height);
    const width = cell * level.width;
    const height = cell * level.height;
    const g = new PIXI.Graphics();
    g.beginFill(BADGE.plateEdge).drawRoundedRect(-width / 2 - 14, -height / 2 - 10, width + 28, height + 28, 20).endFill();
    g.beginFill(BADGE.plate).drawRoundedRect(-width / 2 - 14, -height / 2 - 14, width + 28, height + 28, 20).endFill();
    for (let i = 0; i < pixels.length; i++) {
        if (pixels[i] < 0) continue;
        const x = -width / 2 + (i % level.width) * cell;
        const y = -height / 2 + Math.floor(i / level.width) * cell;
        g.beginFill(new PIXI.Color(level.palette[pixels[i]]).toNumber()).drawRoundedRect(x + 0.4, y + 0.4, cell - 0.8, cell - 0.8, cell * 0.25).endFill();
    }
    return g;
}

export class RadialTransition {
    private readonly graphics = new PIXI.Graphics();
    private readonly badge = new PIXI.Container();
    private badgeTweens: gsap.core.Animation[] = [];

    public constructor(game: Game) {
        this.graphics.eventMode = 'static';
        this.graphics.visible = false;
        this.badge.eventMode = 'none';
        this.badge.visible = false;
        game.popupLayer.addChild(this.graphics, this.badge);
    }

    /** Covers the screen, runs `swap` (the new screen or level built underneath), reveals it, and cleans up. */
    public static async go(game: Game, title: string, subtitle: string, level: LevelData | null, swap: () => void): Promise<void> {
        const transition = new RadialTransition(game);
        AntAudio.play('whoosh');
        await transition.cover(title, subtitle, level);
        swap();
        await transition.reveal();
        transition.destroy();
    }

    private get maxRadius(): number {
        const screen = Game.overlayScreenData;
        return Math.hypot(screen.width, screen.height) / 2;
    }

    private get center(): PIXI.Point {
        return Game.overlayScreenData.center;
    }

    private drawCircle(radius: number): void {
        const { x, y } = this.center;
        this.graphics.clear().beginFill(FILL_COLOR).drawCircle(x, y, radius).endFill();
        if (radius > RIM_WIDTH) {
            this.graphics.lineStyle(RING_WIDTH, RING_COLOR).drawCircle(x, y, radius - RIM_WIDTH / 2 - RING_WIDTH)
                .lineStyle(RIM_WIDTH, RIM_COLOR).drawCircle(x, y, radius).lineStyle(0);
        }
    }

    /** Grows the circle over the screen, then the destination pops in. */
    public cover(title: string, subtitle: string, level: LevelData | null): Promise<void> {
        const progress = { radius: 0 };
        this.graphics.visible = true;
        return new Promise((resolve) => {
            gsap.to(progress, {
                radius: this.maxRadius + RIM_WIDTH,
                duration: DURATION_SEC,
                ease: EASE,
                onUpdate: () => this.drawCircle(progress.radius),
                onComplete: () => {
                    const { x, y } = this.center;
                    this.graphics.clear().beginFill(FILL_COLOR).drawCircle(x, y, this.maxRadius * HOST_MARGIN_SCALE).endFill();
                    this.showBadge(title, subtitle, level);
                    // A frame drawn covered before the caller's heavy work (the new scene) stalls it.
                    requestAnimationFrame(() => resolve());
                },
            });
        });
    }

    /** Resolves once frames come smoothly (see SMOOTH_FRAMES), or after MAX_WAIT_MS. */
    private static whenSmooth(): Promise<void> {
        return new Promise((resolve) => {
            const start = performance.now();
            let last = start;
            let smooth = 0;
            const step = (now: number) => {
                smooth = now - last < SMOOTH_MS ? smooth + 1 : 0;
                last = now;
                if (smooth >= SMOOTH_FRAMES || now - start > MAX_WAIT_MS) resolve();
                else requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
    }

    /** Opens a hole from the middle out to the corners: the new screen appears from the centre (once it draws smoothly). */
    public async reveal(): Promise<void> {
        await RadialTransition.whenSmooth();
        const { x, y } = this.center;
        const maxRadius = this.maxRadius;
        const host = maxRadius * HOST_MARGIN_SCALE;
        const progress = { radius: 0 };
        this.hideBadge();
        return new Promise((resolve) => {
            gsap.to(progress, {
                radius: maxRadius + RIM_WIDTH,
                duration: DURATION_SEC,
                delay: 0.35,
                ease: EASE,
                onUpdate: () => {
                    // A zero-size hole breaks PIXI's triangulation: solid until it has a size.
                    this.graphics.clear().beginFill(FILL_COLOR).drawRect(x - host, y - host, host * 2, host * 2);
                    if (progress.radius > 1) this.graphics.beginHole().drawCircle(x, y, progress.radius).endHole();
                    this.graphics.endFill();
                    if (progress.radius > 1) {
                        this.graphics.lineStyle(RING_WIDTH, RING_COLOR).drawCircle(x, y, progress.radius + RIM_WIDTH / 2 + RING_WIDTH)
                            .lineStyle(RIM_WIDTH, RIM_COLOR).drawCircle(x, y, progress.radius).lineStyle(0);
                    }
                },
                onComplete: () => {
                    this.graphics.clear();
                    this.graphics.visible = false;
                    resolve();
                },
            });
        });
    }

    private showBadge(title: string, subtitle: string, level: LevelData | null): void {
        this.badge.removeChildren().forEach((child) => child.destroy({ children: true }));
        if (level) this.badge.addChild(miniPicture(level, BADGE.picture));
        const titleText = label(46);
        titleText.text = title;
        titleText.y = level ? BADGE.titleY : 0;
        const subtitleText = label(26, 0xfff1de);
        subtitleText.text = subtitle;
        subtitleText.y = level ? BADGE.subtitleY : 46;
        this.badge.addChild(titleText, subtitleText);
        this.badge.position.copyFrom(this.center);
        this.badge.y -= 50;
        this.badge.visible = true;
        this.killBadge();
        this.badge.scale.set(0);
        this.badgeTweens.push(gsap.to(this.badge.scale, { x: 1, y: 1, duration: 0.3, ease: 'back.out(2.5)' }));
    }

    private hideBadge(): void {
        this.killBadge();
        this.badgeTweens.push(gsap.to(this.badge.scale, {
            x: 0, y: 0, duration: 0.15, ease: 'back.in(2)', onComplete: () => {
                this.badge.visible = false;
            },
        }));
    }

    private killBadge(): void {
        this.badgeTweens.forEach((tween) => tween.kill());
        this.badgeTweens = [];
    }

    public destroy(): void {
        this.killBadge();
        this.graphics.destroy();
        this.badge.destroy({ children: true });
    }
}
