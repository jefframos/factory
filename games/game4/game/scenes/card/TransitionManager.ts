import * as PIXI from 'pixi.js';

interface Transition {
    card: PIXI.DisplayObject;
    from: PIXI.IPointData;
    to: PIXI.IPointData;
    control: PIXI.IPointData;
    duration: number;
    elapsed: number;
    ease?: (t: number) => number;
    onComplete?: () => void;
}

export default class TransitionManager {
    private transitions: Transition[] = [];

    public add(
        card: PIXI.DisplayObject,
        to: PIXI.IPointData,
        duration: number,
        onComplete?: () => void,
        ease?: (t: number) => number // Optional easing function
    ) {
        const from = card.position.clone();

        const noiseY = (Math.random() - 0.5) * 100;
        const control = new PIXI.Point(
            (from.x + to.x) / 2,
            (from.y + to.y) / 2 + noiseY
        );

        this.transitions.push({
            card,
            from,
            to,
            control,
            duration,
            elapsed: 0,
            ease,
            onComplete,
        });
    }

    public update(delta: number) {
        for (let i = this.transitions.length - 1; i >= 0; i--) {
            const t = this.transitions[i];
            t.elapsed += delta;

            const rawProgress = Math.min(t.elapsed / t.duration, 1);
            const progress = t.ease ? t.ease(rawProgress) : rawProgress;

            const x = this.quadraticBezier(t.from.x, t.control.x, t.to.x, progress);
            const y = this.quadraticBezier(t.from.y, t.control.y, t.to.y, progress);

            t.card.position.set(x, y);

            if (rawProgress >= 1) {
                t.onComplete?.();
                this.transitions.splice(i, 1);
            }
        }
    }
    //uing bezier with some easing to add more fun to the cards
    private quadraticBezier(p0: number, p1: number, p2: number, t: number): number {
        const oneMinusT = 1 - t;
        return oneMinusT * oneMinusT * p0 +
            2 * oneMinusT * t * p1 +
            t * t * p2;
    }
}
