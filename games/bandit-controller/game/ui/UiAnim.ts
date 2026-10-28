// UiAnim.ts
//
// Small shared gsap helpers that give the PIXI UI its "juice": popups that pop instead of
// appearing, staggered entrances, idle pulses on primary buttons, confetti, and count-ups.
// Every helper returns the gsap animations it creates so the owning scene can kill them on
// destroy (tweening a destroyed PIXI object throws).

import gsap from 'gsap';
import * as PIXI from 'pixi.js';

export type UiTween = gsap.core.Animation;

const CONFETTI_COLORS = [0xffd84a, 0xff6b9a, 0x5ad1ff, 0x7dea6a, 0xffffff, 0xff9f43];

function killDisplayTweens(target: PIXI.Container): void {
    // A parent destroyed with { children: true } leaves its pieces' scale/position nulled.
    if (target.destroyed) {
        return;
    }
    [target, target.scale, target.position, target.pivot, target.skew].forEach((value) => gsap.killTweensOf(value));
    target.children.forEach((child) => killDisplayTweens(child as PIXI.Container));
}

export const UiAnim = {
    /** Kills every display tween on `target` and its descendants — call before destroying it. */
    kill(target: PIXI.Container): void {
        killDisplayTweens(target);
    },

    /** Dim fades in while the panel springs from small to its current scale. */
    popIn(panel: PIXI.Container, dim?: PIXI.Container, delay = 0): UiTween[] {
        const scale = panel.scale.x || 1;
        const tweens: UiTween[] = [
            gsap.fromTo(panel.scale, { x: scale * 0.55, y: scale * 0.55 }, { x: scale, y: scale, duration: 0.45, delay, ease: 'back.out(1.9)' }),
            gsap.fromTo(panel, { alpha: 0 }, { alpha: 1, duration: 0.18, delay }),
        ];
        if (dim) {
            tweens.push(gsap.fromTo(dim, { alpha: 0 }, { alpha: 1, duration: 0.25 }));
        }
        return tweens;
    },

    /** Reverse of popIn; `onDone` runs once both have faded (usually destroys the modal). */
    popOut(panel: PIXI.Container, dim: PIXI.Container | undefined, onDone: () => void): UiTween[] {
        killDisplayTweens(panel);
        if (dim) {
            killDisplayTweens(dim);
        }
        const scale = panel.scale.x || 1;
        panel.eventMode = 'none';
        const timeline = gsap.timeline({ onComplete: onDone });
        timeline.to(panel.scale, { x: scale * 0.7, y: scale * 0.7, duration: 0.18, ease: 'back.in(2)' }, 0)
            .to(panel, { alpha: 0, duration: 0.18 }, 0);
        if (dim) {
            dim.eventMode = 'none';
            timeline.to(dim, { alpha: 0, duration: 0.2 }, 0);
        }
        return [timeline];
    },

    /** Drops in from above with a bounce (banners, ribbons). */
    dropIn(target: PIXI.Container, distance = 120, delay = 0): UiTween[] {
        const y = target.y;
        return [
            gsap.fromTo(target, { y: y - distance, alpha: 0 }, { y, alpha: 1, duration: 0.55, delay, ease: 'bounce.out' }),
        ];
    },

    /** Each child scales up from zero one after another. */
    staggerPop(children: PIXI.DisplayObject[], delay = 0, step = 0.05, ease = 'back.out(2.2)'): UiTween[] {
        return children.map((child, index) => {
            const scaleX = child.scale.x;
            const scaleY = child.scale.y;
            child.scale.set(0);
            return gsap.to(child.scale, { x: scaleX, y: scaleY, duration: 0.35, delay: delay + index * step, ease });
        });
    },

    /** Each child slides up and fades in, one after another. */
    staggerRise(children: PIXI.DisplayObject[], delay = 0, step = 0.06, distance = 40): UiTween[] {
        return children.map((child, index) => {
            const y = child.y;
            return gsap.fromTo(child, { y: y + distance, alpha: 0 }, { y, alpha: 1, duration: 0.4, delay: delay + index * step, ease: 'back.out(1.6)' });
        });
    },

    /** Gentle endless "breathing" for a primary call-to-action. */
    pulse(target: PIXI.Container, amount = 0.05, duration = 0.7): UiTween[] {
        const scale = target.scale.x || 1;
        return [gsap.to(target.scale, { x: scale * (1 + amount), y: scale * (1 + amount), duration, ease: 'sine.inOut', yoyo: true, repeat: -1 })];
    },

    /** Quick squash-and-spring used as tap feedback. */
    punch(target: PIXI.Container, amount = 0.18): UiTween[] {
        const scale = target.scale.x || 1;
        return [gsap.fromTo(target.scale, { x: scale * (1 + amount), y: scale * (1 - amount * 0.6) }, { x: scale, y: scale, duration: 0.5, ease: 'elastic.out(1.1, 0.35)' })];
    },

    /** Horizontal shake for errors or a dramatic "busted". */
    shake(target: PIXI.Container, strength = 12, duration = 0.45): UiTween[] {
        const x = target.x;
        const state = { t: 0 };
        return [gsap.to(state, {
            t: 1,
            duration,
            ease: 'none',
            onUpdate: () => {
                if (!target.destroyed) {
                    target.x = x + Math.sin(state.t * 40) * strength * (1 - state.t);
                }
            },
            onComplete: () => {
                if (!target.destroyed) {
                    target.x = x;
                }
            },
        })];
    },

    /** Counts a text from `from` to `to`, formatted by `format`. */
    countUp(text: PIXI.Text, from: number, to: number, format: (value: number) => string, duration = 0.8, delay = 0): UiTween[] {
        const state = { value: from };
        text.text = format(from);
        return [gsap.to(state, {
            value: to,
            duration,
            delay,
            ease: 'power2.out',
            onUpdate: () => {
                if (!text.destroyed) {
                    text.text = format(Math.round(state.value));
                }
            },
        })];
    },

    /**
     * Rotating light rays behind a panel, icon or button — the soft-edged Image_Effect_Rotate sprite, so every shine in
     * the game fades out at its tips. Added at the back of `parent`; the returned container can be faded/moved freely.
     */
    rays(parent: PIXI.Container, radius: number, color = 0xfff0a0, intensity = 0.75, periodSec = 14): { rays: PIXI.Container; tweens: UiTween[] } {
        const rays = new PIXI.Container();
        rays.eventMode = 'none';
        const sprite = new PIXI.Sprite(PIXI.Texture.from('Image_Effect_Rotate'));
        sprite.anchor.set(0.5);
        sprite.width = sprite.height = radius * 2;
        sprite.tint = color;
        sprite.alpha = intensity;
        sprite.blendMode = PIXI.BLEND_MODES.ADD;
        rays.addChild(sprite);
        parent.addChildAt(rays, 0);
        return { rays, tweens: [gsap.to(sprite, { rotation: Math.PI * 2, duration: periodSec, ease: 'none', repeat: -1 })] };
    },

    /** Burst of paper confetti from a point; pieces fall, spin, fade and destroy themselves. */
    confetti(parent: PIXI.Container, x: number, y: number, count = 60, spread = 1): UiTween[] {
        const tweens: UiTween[] = [];
        for (let i = 0; i < count; i++) {
            const piece = new PIXI.Graphics();
            const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
            const w = 6 + Math.random() * 7;
            const h = 4 + Math.random() * 5;
            piece.beginFill(color).drawRect(-w / 2, -h / 2, w, h).endFill();
            piece.position.set(x, y);
            piece.rotation = Math.random() * Math.PI;
            piece.eventMode = 'none';
            parent.addChild(piece);
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3 * spread;
            const power = 180 + Math.random() * 260;
            const peakX = x + Math.cos(angle) * power;
            const peakY = y + Math.sin(angle) * power;
            const fall = 220 + Math.random() * 260;
            const duration = 1.4 + Math.random() * 0.9;
            const timeline = gsap.timeline({ onComplete: () => {
                if (piece.destroyed) {
                    return;
                }
                killDisplayTweens(piece);
                piece.destroy();
            } });
            timeline.to(piece, { x: peakX, y: peakY, duration: 0.45, ease: 'power3.out' })
                .to(piece, { y: peakY + fall, x: peakX + (Math.random() - 0.5) * 120, duration, ease: 'sine.in' })
                .to(piece, { alpha: 0, duration: 0.4 }, `-=0.4`);
            tweens.push(timeline, gsap.to(piece, {
                rotation: piece.rotation + (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 8),
                duration: duration + 0.45,
                ease: 'none',
            }));
            tweens.push(gsap.to(piece.scale, { x: 0.2, duration: 0.18 + Math.random() * 0.2, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
        }
        return tweens;
    },

    /** Little star/spark burst (radial lines) used when a star lands or an item is equipped. */
    sparkBurst(parent: PIXI.Container, x: number, y: number, color = 0xffe066, radius = 60): UiTween[] {
        const tweens: UiTween[] = [];
        const count = 10;
        for (let i = 0; i < count; i++) {
            const spark = new PIXI.Graphics();
            spark.beginFill(color).drawPolygon([0, -5, 3, 0, 0, 5, -3, 0]).endFill();
            spark.scale.set(1.6);
            const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
            spark.rotation = angle + Math.PI / 2;
            spark.position.set(x, y);
            spark.eventMode = 'none';
            parent.addChild(spark);
            const distance = radius * (0.7 + Math.random() * 0.5);
            tweens.push(gsap.to(spark, {
                x: x + Math.cos(angle) * distance,
                y: y + Math.sin(angle) * distance,
                alpha: 0,
                duration: 0.55,
                ease: 'power2.out',
                onComplete: () => {
                    if (!spark.destroyed) {
                        spark.destroy();
                    }
                },
            }));
        }
        return tweens;
    },
};
