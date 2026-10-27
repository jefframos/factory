// RadialTransition.ts
//
// Full-screen circular wipe played between scene changes (royal blue with a gold rim, and a
// spinning gold star while the incoming scene loads). Every scene here
// loads asynchronously (the player's FBX character + animation clips, via
// MainPlayer.loadCharacter()) — without this, switching scenes would show
// the new scene's floor/gates for a beat with no visible character before
// popping in. cover() hides the outgoing scene; index.ts then swaps scenes
// and awaits the new one's own load, and only once it's actually ready
// does reveal() play.
//
// Added to game.popupLayer — the topmost PIXI layer (see core/Game.ts's own
// doc on layer order), itself stacked above the THREE canvas
// (core/scene/SetupThree.ts sets its z-index below PIXI's) — so this covers
// BOTH the 3D world and any 2D UI, regardless of which scene is showing.
//
// Both phases animate one circle radius, 0 -> a half-diagonal big enough to
// reach every corner from screen-center, so they read as one continuous
// motion rather than two visually distinct halves:
//   cover()  — a SOLID circle grows from a point at screen-center outward.
//              Nothing is drawn outside it, so the outgoing scene stays
//              visible everywhere the circle hasn't reached yet — it
//              disappears from the center out, last visible at the corners.
//   reveal() — the mirror: a circular HOLE cut out of a full black rect
//              grows from screen-center outward. The incoming scene
//              appears from the center out, fully revealed once the hole
//              reaches the corners.
// Redrawing a plain PIXI.Graphics (via Graphics.beginHole()/endHole() for
// the hole) every animation frame is simpler and more broadly compatible
// here than a custom shader/filter, and this only runs for a fraction of a
// second per scene change.
//
// The host rect a hole is cut from must be drawn LARGER than the screen —
// PIXI's own Graphics.beginHole() doc is explicit that "holes must be fully
// inside a shape to work," and the hole's radius grows to a half-diagonal
// (to reach the corners), which exceeds the screen rect's own half-width/
// half-height well before the animation finishes. A hole poking outside
// its host shape's bounds is what read as a glitch/flicker partway through
// reveal() (this shipped once with the host rect sized exactly to the
// screen — don't go back to that). HOST_MARGIN_SCALE draws the host rect
// comfortably larger than the hole ever grows, so it's always still "fully
// inside." The extra area beyond the visible screen is simply clipped by
// the renderer/viewport as normal — no visual or perf downside.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';

const DURATION_SEC = 0.5;
const EASE = 'power2.inOut';
/** How much bigger than maxRadius the reveal's host rect's own half-size is — see this file's own doc on why the hole must stay strictly inside its host shape. */
const HOST_MARGIN_SCALE = 2;
/** Branded wipe: royal blue fill with a gold rim, matching the shop palette. */
const FILL_COLOR = 0x1a43a8;
const RIM_COLOR = 0xffd43b;
const RIM_WIDTH = 14;

export default class RadialTransition {
    private readonly graphics = new PIXI.Graphics();
    /** Spinning gold star shown while the screen is covered (the next scene is loading). */
    private readonly badge = new PIXI.Container();
    private badgeTweens: gsap.core.Tween[] = [];

    public constructor(game: Game) {
        this.graphics.eventMode = 'none';
        this.badge.eventMode = 'none';
        this.badge.visible = false;
        game.popupLayer.addChild(this.graphics, this.badge);
    }

    private showBadge(): void {
        if (this.badge.children.length === 0) {
            const ring = new PIXI.Graphics();
            ring.beginFill(0x0b1840, 0.5).drawCircle(0, 0, 54).endFill();
            ring.lineStyle(6, RIM_COLOR).drawCircle(0, 0, 54);
            const star = PIXI.Sprite.from('ItemIcon_Star_Gold');
            star.anchor.set(0.5);
            star.name = 'star';
            star.height = 64;
            star.scale.x = star.scale.y;
            this.badge.addChild(ring, star);
        }
        const star = this.badge.getChildByName('star') as PIXI.Sprite;
        const { x, y } = this.center;
        this.badge.position.set(x, y);
        this.badge.visible = true;
        this.killBadge();
        this.badge.scale.set(0);
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

    /** Half-diagonal of the current design-space screen size — the smallest radius, centered on screen, guaranteed to reach every corner. Read fresh per call rather than cached, so a resize mid-transition (rare, but possible) doesn't leave a corner uncovered. */
    private get maxRadius(): number {
        const screen = Game.overlayScreenData;
        return Math.hypot(screen.width, screen.height) / 2;
    }

    private get center(): PIXI.Point {
        return Game.overlayScreenData.center;
    }

    /** Grows a solid black circle from screen-center until it covers every corner. Resolves once fully covered. */
    public cover(): Promise<void> {
        const { x, y } = this.center;
        const maxRadius = this.maxRadius;
        const progress = { radius: 0 };

        return new Promise((resolve) => {
            gsap.to(progress, {
                radius: maxRadius,
                duration: DURATION_SEC,
                ease: EASE,
                onUpdate: () => {
                    this.graphics.clear();
                    this.graphics.beginFill(FILL_COLOR);
                    this.graphics.drawCircle(x, y, progress.radius);
                    this.graphics.endFill();
                    this.graphics.lineStyle(RIM_WIDTH, RIM_COLOR).drawCircle(x, y, progress.radius).lineStyle(0);
                },
                onComplete: () => {
                    this.graphics.clear().beginFill(FILL_COLOR).drawCircle(x, y, maxRadius + RIM_WIDTH).endFill();
                    this.showBadge();
                    resolve();
                },
            });
        });
    }

    /** Cuts a growing hole, centered on screen, out of a black rect drawn larger than the screen (see this file's own doc) — reveals the (now-ready) scene from the center outward. Resolves once fully revealed. */
    public reveal(): Promise<void> {
        const { x, y } = this.center;
        const maxRadius = this.maxRadius;
        const hostHalfSize = maxRadius * HOST_MARGIN_SCALE;
        const progress = { radius: 0 };

        this.hideBadge();
        return new Promise((resolve) => {
            gsap.to(progress, {
                radius: maxRadius + RIM_WIDTH,
                duration: DURATION_SEC,
                ease: EASE,
                onUpdate: () => {
                    this.graphics.clear();
                    this.graphics.beginFill(FILL_COLOR);
                    this.graphics.drawRect(x - hostHalfSize, y - hostHalfSize, hostHalfSize * 2, hostHalfSize * 2);
                    this.graphics.beginHole();
                    this.graphics.drawCircle(x, y, progress.radius);
                    this.graphics.endHole();
                    this.graphics.endFill();
                    if (progress.radius > 1) {
                        this.graphics.lineStyle(RIM_WIDTH, RIM_COLOR).drawCircle(x, y, progress.radius).lineStyle(0);
                    }
                },
                onComplete: () => {
                    this.graphics.clear();
                    resolve();
                },
            });
        });
    }

    public destroy(): void {
        gsap.killTweensOf(this.graphics);
        this.killBadge();
        this.graphics.destroy();
        this.badge.destroy({ children: true });
    }
}
