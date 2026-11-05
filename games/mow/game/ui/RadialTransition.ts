// RadialTransition.ts
//
// The screen transition between cities (bandit-controller's circular wipe, in Mow Town's colours): drawn in the
// game's top PIXI layer (game.popupLayer, over the 3D world and every bit of UI).
//   cover()  — a solid circle in the loading screen's blue, a yellow rim and a white ring inside it, grows from the
//              screen's middle out to the corners; then a badge (a spinning star on a ring) and where the player is
//              going (the city's name, its number) pop in.
//   reveal() — the mirror: a hole in a covering rect grows from the middle out, the new city appearing from the centre.
// A city change: cover(), the new city's scene built underneath, reveal(), destroy().
//
// The host rect the reveal's hole is cut from is drawn much larger than the screen: PIXI's holes must stay fully inside
// their shape, and the hole grows to the half-diagonal — sized to the screen, it flickered (bandit-controller's note).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { UiKit } from './UiKit';
import { BakedShape } from './BakedShape';

const DURATION_SEC = 0.5;
const EASE = 'power2.inOut';
const HOST_MARGIN_SCALE = 2;
/** The loading screen's blue (the page's too), its yellow rim (the guide arrows' yellow), a white ring inside it. */
const FILL_COLOR = 0x41a7fa;
const RIM_COLOR = 0xffd23f;
const RIM_WIDTH = 14;
const RING_COLOR = 0xffffff;
const RING_WIDTH = 5;
/** reveal() waits for this many frames in a row under SMOOTH_MS (a freshly built city stalls its first frames: the
 * wipe would run during the stall and just pop), MAX_WAIT_MS at most. */
const SMOOTH_FRAMES = 6;
const SMOOTH_MS = 45;
const MAX_WAIT_MS = 2500;

export class RadialTransition {
    private readonly graphics = new PIXI.Graphics();
    /** While covered: a spinning star on a ring, and the destination under it. */
    private readonly badge = new PIXI.Container();
    private readonly title = UiKit.text('hud', 'toast', { text: '' }, { fontSize: 46, strokeThickness: 9 });
    private readonly subtitle = UiKit.text('hud', 'toast', { text: '' }, { fontSize: 24, strokeThickness: 6, fill: 0xffe27a });
    private badgeTweens: gsap.core.Animation[] = [];

    public constructor(game: Game) {
        this.graphics.eventMode = 'static';
        this.graphics.visible = false;
        this.badge.eventMode = 'none';
        this.badge.visible = false;
        game.popupLayer.addChild(this.graphics, this.badge);
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
    public cover(title: string, subtitle: string): Promise<void> {
        const progress = { radius: 0 };
        this.graphics.visible = true;
        return new Promise((resolve) => {
            gsap.to(progress, {
                radius: this.maxRadius + RIM_WIDTH,
                duration: DURATION_SEC,
                ease: EASE,
                onUpdate: () => this.drawCircle(progress.radius),
                onComplete: () => {
                    this.coverNow(title, subtitle);
                    // A frame drawn covered before the caller's heavy work (the new city's scene) stalls it.
                    requestAnimationFrame(() => resolve());
                },
            });
        });
    }

    /** Covered whole, the destination showing. */
    private coverNow(title: string, subtitle: string): void {
        const { x, y } = this.center;
        this.graphics.visible = true;
        this.graphics.clear().beginFill(FILL_COLOR).drawCircle(x, y, this.maxRadius * HOST_MARGIN_SCALE).endFill();
        this.showBadge(title, subtitle);
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

    /** Opens a hole from the middle out to the corners: the city appears from the centre (once it's drawing smoothly). */
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
                delay: 0.15,
                ease: EASE,
                onUpdate: () => {
                    // A zero-size hole breaks PIXI's triangulation (earcut throws, every frame): solid until it has a size.
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

    private showBadge(title: string, subtitle: string): void {
        if (!this.badge.children.length) {
            const ring = BakedShape.disc(54, { fill: 0x0d4fb0, fillAlpha: 0.45, rim: RIM_COLOR, rimWidth: 6 });
            const star = PIXI.Sprite.from('ItemIcon_Star_Gold');
            star.anchor.set(0.5);
            star.name = 'star';
            star.scale.set(64 / Math.max(star.texture.width, star.texture.height, 1));
            this.title.anchor.set(0.5);
            this.title.y = 100;
            this.subtitle.anchor.set(0.5);
            this.subtitle.y = 146;
            this.badge.addChild(ring, star, this.title, this.subtitle);
        }
        this.title.text = title;
        this.subtitle.text = subtitle;
        this.badge.position.copyFrom(this.center);
        this.badge.y -= 40;
        this.badge.visible = true;
        this.killBadge();
        this.badge.scale.set(0);
        const star = this.badge.getChildByName('star') as PIXI.Sprite;
        this.badgeTweens.push(
            gsap.to(this.badge.scale, { x: 1, y: 1, duration: 0.3, ease: 'back.out(2.5)' }),
            gsap.to(star, { rotation: Math.PI * 2, duration: 1.2, ease: 'none', repeat: -1 }),
        );
    }

    private hideBadge(): void {
        this.killBadge();
        this.badgeTweens.push(gsap.to(this.badge.scale, { x: 0, y: 0, duration: 0.15, ease: 'back.in(2)', onComplete: () => {
            this.badge.visible = false;
        } }));
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
