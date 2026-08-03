// Lightweight DOM performance overlay — enable with ?perf in the URL.
// Shows FPS, chunk streaming stats, and triangle count.

export interface PerfStats {
    chunksLoaded: number;
    chunksBuiltThisFrame: number;
    lastBuildMs: number;
    peakBuildMs: number;
    triangles: number;
}

export class PerfOverlay {
    private el: HTMLDivElement;
    private fpsSamples: number[] = [];
    private prevTime = performance.now();

    constructor() {
        this.el = document.createElement('div');
        Object.assign(this.el.style, {
            position:      'fixed',
            bottom:        '8px',
            right:         '8px',
            background:    'rgba(0,0,0,0.65)',
            color:         '#0f0',
            fontFamily:    'monospace',
            fontSize:      '11px',
            lineHeight:    '1.6',
            padding:       '6px 10px',
            borderRadius:  '4px',
            zIndex:        '9999',
            pointerEvents: 'none',
            whiteSpace:    'pre',
            userSelect:    'none',
        } as CSSStyleDeclaration);
        document.body.appendChild(this.el);
    }

    update(stats: PerfStats): void {
        const now = performance.now();
        const dt  = now - this.prevTime;
        this.prevTime = now;

        if (dt > 0) this.fpsSamples.push(1000 / dt);
        if (this.fpsSamples.length > 60) this.fpsSamples.shift();
        const fps = this.fpsSamples.reduce((a, b) => a + b, 0) / (this.fpsSamples.length || 1);

        const fpsColor  = fps < 30 ? '\x1b[31m' : fps < 50 ? '\x1b[33m' : '';
        const fpsStr    = fps.toFixed(1).padStart(6);
        const buildStr  = stats.lastBuildMs.toFixed(1).padStart(6);
        const peakStr   = stats.peakBuildMs.toFixed(1).padStart(6);
        const trisStr   = ((stats.triangles) / 1000).toFixed(0).padStart(6) + 'k';

        // ANSI won't render in div, use color via style per-line instead
        const fpsLine = fps < 30
            ? `FPS  <span style="color:#f55">${fpsStr}</span>`
            : fps < 50
            ? `FPS  <span style="color:#fc0">${fpsStr}</span>`
            : `FPS  <span style="color:#0f0">${fpsStr}</span>`;

        const buildLine = stats.lastBuildMs > 8
            ? `build <span style="color:#fc0">${buildStr} ms</span>  peak <span style="color:#f55">${peakStr} ms</span>`
            : `build <span style="color:#0f0">${buildStr} ms</span>  peak ${peakStr} ms`;

        this.el.innerHTML = [
            fpsLine,
            `chunks  ${String(stats.chunksLoaded).padStart(4)}  built/f ${stats.chunksBuiltThisFrame}`,
            buildLine,
            `tris  ${trisStr}`,
        ].join('\n');
    }

    destroy(): void {
        this.el.parentElement?.removeChild(this.el);
    }
}
