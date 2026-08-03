// headlessShims.ts
//
// Browser-global stubs so the pizza game's components can be constructed in
// a plain Node process (see scripts/test-*.ts). MUST be imported before
// pixi.js — Pixi captures `document`/`window` through its ADAPTER at module
// init, and PlayerMovementController.awake() builds a real AnalogInput,
// which constructs PIXI.Graphics and touches Texture.WHITE.
//
// Deliberately the bare minimum to let objects CONSTRUCT, not to render:
// nothing in these tests ever draws a frame, so the 2D context only needs
// the handful of members Pixi's white-texture bootstrap actually calls, and
// the GL context is absent entirely (Pixi only reaches for one when a
// Renderer is created, which these tests never do).

/** Every 2D-context member Pixi touches while building Texture.WHITE — all no-ops; nothing here is ever read back. */
function makeContext2D(): any {
    return {
        fillStyle: '#fff',
        strokeStyle: '#fff',
        globalAlpha: 1,
        font: '10px sans-serif',
        fillRect: () => {},
        clearRect: () => {},
        strokeRect: () => {},
        drawImage: () => {},
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4),
            width: w,
            height: h,
        }),
        putImageData: () => {},
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        measureText: (text: string) => ({ width: text.length * 6, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
        fillText: () => {},
        strokeText: () => {},
        save: () => {},
        restore: () => {},
        scale: () => {},
        translate: () => {},
        setTransform: () => {},
        beginPath: () => {},
        closePath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        arc: () => {},
        fill: () => {},
        stroke: () => {},
    };
}

/**
 * A real class, not a plain object literal: Pixi decides which Resource wraps a texture
 * source with `source instanceof globalThis.HTMLCanvasElement` (see
 * @pixi/core's CanvasResource.test / autoDetectResource), so an otherwise
 * canvas-shaped object gets rejected outright with "Unrecognized source type".
 * Registering the constructor as the global HTMLCanvasElement below is what makes that
 * check pass.
 */
class HeadlessCanvas {
    public width: number;
    public height: number;
    public style: Record<string, unknown> = {};

    public constructor(width = 1, height = 1) {
        this.width = width;
        this.height = height;
    }

    // Pixi feature-detects by asking for contexts it may not get — returning null for
    // anything but '2d' is honest here (no GL in this process) and is the same answer a
    // browser gives for an unsupported context type.
    public getContext(type: string): any {
        return type === '2d' ? makeContext2D() : null;
    }

    public addEventListener(): void {}
    public removeEventListener(): void {}
    public toDataURL(): string {
        return 'data:,';
    }
}

function makeCanvas(width = 1, height = 1): any {
    return new HeadlessCanvas(width, height);
}

const documentStub: any = {
    createElement: (tag: string) => (tag === 'canvas' ? makeCanvas() : { style: {}, appendChild: () => {}, addEventListener: () => {}, removeEventListener: () => {} }),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: { appendChild: () => {}, removeChild: () => {}, style: {} },
    head: { appendChild: () => {} },
    documentElement: { style: {} },
};

const globals = globalThis as any;

globals.window ??= {
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    document: documentStub,
};
globals.document ??= documentStub;
globals.self ??= globals.window;
// See HeadlessCanvas's own doc — Pixi's texture-source detection is an `instanceof` check
// against this exact global, so it has to be the same constructor makeCanvas() uses.
globals.HTMLCanvasElement ??= HeadlessCanvas;

/** Imported for side effects only; this keeps `import './headlessShims'` from being elided as unused. */
export const HEADLESS_SHIMS_INSTALLED = true;
