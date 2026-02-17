import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';

export class AnimatorUtils {
    /** Animates an array of PIXI.DisplayObject elements by Y offset + bounce down */
    public static revealWithBounce(elements: PIXI.DisplayObject[], offsetY = -100, stagger = 0.1): void {
        // Sort elements by x position
        const sorted = [...elements].sort((a, b) => a.x - b.x);

        sorted.forEach((el, index) => {
            const originalY = el.y;
            el.y += offsetY;
            el.visible = true;

            gsap.to(el, {
                y: originalY,
                ease: 'bounce.out',
                duration: 0.6,
                delay: index * stagger,
            });
        });
    }
}
