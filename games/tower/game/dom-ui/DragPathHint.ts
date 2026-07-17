import handIcon from './images/handHud.png';

const LOOP_SECONDS = 3;   // time for one full figure-eight lap
const PATH_WIDTH = 100;    // px — half-width of the lemniscate (the `a` in the parametric formula below)
const PATH_HEIGHT = 80;   // px — half-height. Close to PATH_WIDTH on purpose: the raw Bernoulli-lemniscate formula's natural proportions (x/y sharing one scale) read as noticeably flatter/wider than a typical "∞" glyph, so height is boosted well past the "natural" ratio to look like one.
const HAND_SIZE = 40;     // px

// handHud.png is a pointing hand, not a symmetric icon — its fingertip (the
// point that should actually trace the path) sits well up-and-left of the
// image's geometric center. These are that tip's position as a fraction of
// the icon's own width/height, eyeballed against the source art, used to
// offset the placement transform so the FINGERTIP rides the curve instead of
// the icon's bounding-box center (which reads as "anchored top-left" — the
// bug this fixes).
const FINGERTIP_X_RATIO = 0.22;
const FINGERTIP_Y_RATIO = 0.16;

/**
 * Standalone "how to move" visual — not wired into anything on its own;
 * exposes a plain `element` (no self-positioning, no self-mounting) for
 * whoever wants to embed it, e.g. MovementHint stacks it below its own
 * label. Draws a faint dashed infinity-symbol (Bernoulli lemniscate) track
 * via SVG, plus a handHud.png icon continuously animated along that same
 * track — driven by requestAnimationFrame rather than CSS `offset-path`,
 * since this game ships inside a range of platform webviews (see
 * core/platforms/PlatformFactory) and a hand-rolled position() is one less
 * thing to worry about browser support for.
 *
 * Usage: `const hint = new DragPathHint(); container.appendChild(hint.element);
 * hint.show();` starts the loop; `hint.hide()` stops it (element stays
 * mounted wherever the caller put it — only the loop pauses).
 */
export class DragPathHint {
    readonly element: HTMLDivElement;
    private readonly hand: HTMLImageElement;
    private rafHandle: number | null = null;
    private startTime: number | null = null;
    private readonly cx = PATH_WIDTH + HAND_SIZE / 2;
    private readonly cy = PATH_HEIGHT + HAND_SIZE / 2;

    constructor() {
        const size = { w: PATH_WIDTH * 2 + HAND_SIZE, h: PATH_HEIGHT * 2 + HAND_SIZE };

        this.element = document.createElement('div');
        Object.assign(this.element.style, {
            position: 'relative',
            width: `${size.w}px`,
            height: `${size.h}px`,
            pointerEvents: 'none',
        });

        // Faint dashed guide — drawn once as a static SVG path; only the hand icon animates.
        const svgNs = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('width', String(size.w));
        svg.setAttribute('height', String(size.h));
        Object.assign(svg.style, { position: 'absolute', inset: '0' });

        const path = document.createElementNS(svgNs, 'path');
        path.setAttribute('d', this.buildLemniscatePath());
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'rgba(255,255,255,0.4)');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-dasharray', '4 6');
        svg.appendChild(path);
        this.element.appendChild(svg);

        this.hand = document.createElement('img');
        this.hand.src = handIcon;
        Object.assign(this.hand.style, {
            position: 'absolute',
            width: `${HAND_SIZE}px`,
            height: `${HAND_SIZE}px`,
            left: '0',
            top: '0',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
        });
        this.element.appendChild(this.hand);
        this.placeHandAt(0);
    }

    /** Starts (or resumes) the animation loop. */
    show(): void {
        this.startTime = null;
        if (this.rafHandle === null) this.rafHandle = requestAnimationFrame(this.tick);
    }

    /** Pauses the animation loop — element stays exactly where it is (and mounted wherever the caller put it). */
    hide(): void {
        if (this.rafHandle !== null) {
            cancelAnimationFrame(this.rafHandle);
            this.rafHandle = null;
        }
    }

    destroy(): void {
        this.hide();
        this.element.remove();
    }

    private tick = (now: number): void => {
        if (this.startTime === null) this.startTime = now;
        const elapsed = (now - this.startTime) / 1000;
        const t = (elapsed / LOOP_SECONDS) * Math.PI * 2;
        this.placeHandAt(t);
        this.rafHandle = requestAnimationFrame(this.tick);
    };

    private placeHandAt(t: number): void {
        const { x, y } = this.position(t);
        // Offsets by the fingertip's own position within the icon (see
        // FINGERTIP_X_RATIO/Y_RATIO) rather than the icon's box center, so
        // the fingertip itself — not the whole icon — rides the curve.
        const tx = this.cx + x - HAND_SIZE * FINGERTIP_X_RATIO;
        const ty = this.cy + y - HAND_SIZE * FINGERTIP_Y_RATIO;
        this.hand.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`;
    }

    /** Bernoulli lemniscate parametric position, t=0 starting at center moving right — https://en.wikipedia.org/wiki/Lemniscate_of_Bernoulli. */
    private position(t: number): { x: number; y: number } {
        const denom = 1 + Math.sin(t) * Math.sin(t);
        return {
            x: (PATH_WIDTH * Math.cos(t)) / denom,
            y: (PATH_HEIGHT * Math.sin(t) * Math.cos(t)) / denom,
        };
    }

    /** Traces position() around a full lap to build the static SVG guide path. */
    private buildLemniscatePath(): string {
        const steps = 64;
        let d = '';
        for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * Math.PI * 2;
            const { x, y } = this.position(t);
            d += `${i === 0 ? 'M' : 'L'} ${(this.cx + x).toFixed(1)} ${(this.cy + y).toFixed(1)} `;
        }
        return d;
    }
}
