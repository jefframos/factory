// ScreenFade.ts
//
// The screen transition between mines: a full-screen layer in the page itself (over both the THREE and the Pixi
// canvases, so it outlives the scene being torn down and rebuilt underneath) fades to the mine's dark, shows where
// the player is going ("MINE #2" and the mine's name, in the game's font), waits for the new mine to be drawn, and
// fades back out. Taps are swallowed while it's up.

import { UiKit } from './UiKit';

const FADE_IN_MS = 380;
const FADE_OUT_MS = 520;
/** The title stays at least this long, even when the new mine is ready sooner. */
const HOLD_MS = 650;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

let busy = false;

export const ScreenFade = {
    /** A transition is playing (a second request is ignored). */
    get busy(): boolean {
        return busy;
    },

    /**
     * Fades out, shows `title` / `subtitle`, runs `swap` (which rebuilds the scene and returns a promise for when
     * it's ready), then fades back in.
     */
    async through(title: string, subtitle: string, swap: () => Promise<void> | void): Promise<void> {
        if (busy) return;
        busy = true;
        const layer = document.createElement('div');
        Object.assign(layer.style, {
            position: 'fixed', inset: '0', zIndex: '9999', background: 'radial-gradient(circle at 50% 45%, #2b2140 0%, #0d0a12 75%)',
            opacity: '0', transition: `opacity ${FADE_IN_MS}ms ease-in`, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: '10px', pointerEvents: 'all', userSelect: 'none',
        } satisfies Partial<CSSStyleDeclaration>);
        const font = `${UiKit.fontFamily('primary')}, sans-serif`;
        const line = (text: string, size: string, color: string) => {
            const el = document.createElement('div');
            el.textContent = text;
            Object.assign(el.style, {
                fontFamily: font, fontSize: size, color, letterSpacing: '2px', textAlign: 'center', padding: '0 16px',
                textShadow: '0 4px 0 #1d140e, 0 0 18px rgba(0,0,0,0.6)', transform: 'scale(0.8)', opacity: '0',
                transition: 'transform 420ms cubic-bezier(.2,1.6,.4,1), opacity 260ms ease-out',
            } satisfies Partial<CSSStyleDeclaration>);
            layer.appendChild(el);
            return el;
        };
        const heading = line(title, 'clamp(34px, 9vw, 64px)', '#ffe27a');
        const sub = line(subtitle, 'clamp(18px, 4.5vw, 28px)', '#d8c8ff');
        for (const event of ['pointerdown', 'pointerup', 'click', 'touchstart']) layer.addEventListener(event, (e) => e.stopPropagation());
        document.body.appendChild(layer);
        try {
            await frame();
            layer.style.opacity = '1';
            await wait(FADE_IN_MS);
            for (const el of [heading, sub]) {
                el.style.opacity = '1';
                el.style.transform = 'scale(1)';
            }
            const shown = wait(HOLD_MS);
            await swap();
            await shown;
            // Let the rebuilt scene draw a frame or two behind the layer before revealing it.
            await frame();
            await frame();
            layer.style.transition = `opacity ${FADE_OUT_MS}ms ease-out`;
            layer.style.opacity = '0';
            await wait(FADE_OUT_MS);
        } finally {
            layer.remove();
            busy = false;
        }
    },
};
