// GsapUtils.ts
//
// Promise-wrapped gsap.delayedCall() — lets an async sequence (BuildingZone's
// level-up camera-focus timeline, etc.) `await` a plain delay instead of
// nesting callbacks, while still running on gsap's own ticker like every
// other tween in this codebase (see e.g. DropZone's/BuildingZone's own
// gsap.delayedCall use) — unlike setTimeout/PromiseUtils.await(), which runs
// on the browser's own clock, independent of gsap's.

import gsap from 'gsap';

export function wait(seconds: number): Promise<void> {
    return new Promise(resolve => {
        gsap.delayedCall(seconds, resolve);
    });
}
