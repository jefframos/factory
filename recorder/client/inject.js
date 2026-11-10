// inject.js
//
// The recorder's hook inside the game's page (the recorder's Vite plugin puts it first in <head>, so it runs before the
// game). Nothing here is game-specific; it works by wrapping browser APIs:
//   - time: requestAnimationFrame, performance.now and Date.now run on a clock the recorder can pause, step a frame at
//     a time and slow down or speed up (games, PIXI, THREE and gsap all read these);
//   - pixels: WebGL canvases keep their drawing buffer (preserveDrawingBuffer), so the recorder can copy them;
//   - device pixel ratio: ?__rec_dpr=N fakes window.devicePixelRatio, so the game renders at the recorded size;
//   - sound: every AudioContext's output is also routed into a stream the recorder can record, and is suspended while
//     paused (as are <audio>/<video> elements playing);
//   - keys: F7 (step), F8 (record), F9 (pause), pressed in the game, go to the recorder.
// The recorder reads it all from window.__recorder.

(() => {
    if (window.__recorder) return;
    const params = new URLSearchParams(location.search);

    // ------------------------------------------------------------------ pixel ratio
    const dpr = parseFloat(params.get('__rec_dpr') ?? '');
    if (dpr > 0) Object.defineProperty(window, 'devicePixelRatio', { get: () => dpr, configurable: true });

    // ------------------------------------------------------------------ canvases
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attributes) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') attributes = { ...(attributes ?? {}), preserveDrawingBuffer: true };
        return getContext.call(this, type, attributes);
    };

    // ------------------------------------------------------------------ the clock
    const realNow = performance.now.bind(performance);
    const realRaf = window.requestAnimationFrame.bind(window);
    const realDateNow = Date.now.bind(Date);
    const dateOffset = realDateNow() - realNow();
    let paused = false;
    let speed = 1;
    // Virtual time: `base` at real time `realBase`, running at `speed`; frozen at `frozen` while paused.
    let base = realNow();
    let realBase = base;
    let frozen = 0;
    const now = () => (paused ? frozen : base + (realNow() - realBase) * speed);
    performance.now = now;
    Date.now = () => Math.round(dateOffset + now());

    const pending = new Map();
    let nextId = 1;
    let scheduled = false;
    const pump = () => {
        scheduled = false;
        if (paused) return;
        flush(now());
    };
    const flush = (time) => {
        const callbacks = [...pending.values()];
        pending.clear();
        for (const callback of callbacks) {
            try {
                callback(time);
            } catch (error) {
                console.error(error);
            }
        }
    };
    const schedule = () => {
        if (scheduled || paused) return;
        scheduled = true;
        realRaf(pump);
    };
    window.requestAnimationFrame = (callback) => {
        const id = nextId++;
        pending.set(id, callback);
        schedule();
        return id;
    };
    window.cancelAnimationFrame = (id) => { pending.delete(id); };

    // ------------------------------------------------------------------ sound
    const contexts = [];
    const media = new Set();
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (Context) {
        class RecordedContext extends Context {
            constructor(...args) {
                super(...args);
                this.__recorderOut = this.createMediaStreamDestination();
                contexts.push(this);
            }
        }
        window.AudioContext = RecordedContext;
        if (window.webkitAudioContext) window.webkitAudioContext = RecordedContext;
        const connect = AudioNode.prototype.connect;
        AudioNode.prototype.connect = function (target, ...rest) {
            const result = connect.call(this, target, ...rest);
            if (target instanceof AudioDestinationNode && this.context.__recorderOut) connect.call(this, this.context.__recorderOut);
            return result;
        };
    }
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
        media.add(this);
        return play.apply(this, args);
    };
    let pausedMedia = [];

    // ------------------------------------------------------------------ the recorder's handle
    const recorder = {
        get paused() { return paused; },
        get speed() { return speed; },
        pause() {
            if (paused) return;
            frozen = now();
            paused = true;
            contexts.forEach((context) => { if (context.state === 'running') void context.suspend(); });
            pausedMedia = [...media].filter((element) => !element.paused);
            pausedMedia.forEach((element) => element.pause());
        },
        resume() {
            if (!paused) return;
            base = frozen;
            realBase = realNow();
            paused = false;
            contexts.forEach((context) => { if (context.state === 'suspended') void context.resume(); });
            pausedMedia.forEach((element) => void play.call(element).catch(() => undefined));
            pausedMedia = [];
            schedule();
        },
        /** Paused: one frame on (1/60 s of game time). */
        step(ms = 1000 / 60) {
            if (!paused) return;
            frozen += ms;
            flush(frozen);
        },
        setSpeed(value) {
            if (!paused) {
                base = now();
                realBase = realNow();
            }
            speed = Math.max(0.05, value);
        },
        /** The page's canvases, back to front (z-index, then their order in the page), with their place and size. */
        canvases() {
            const list = [...document.querySelectorAll('canvas')].map((canvas, order) => {
                const style = getComputedStyle(canvas);
                const rect = canvas.getBoundingClientRect();
                let z = 0;
                for (let node = canvas; node && node !== document.body; node = node.parentElement) {
                    const value = parseInt(getComputedStyle(node).zIndex, 10);
                    if (!Number.isNaN(value)) { z = value; break; }
                }
                const shown = style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
                return { canvas, rect, z, order, shown };
            });
            return list.sort((a, b) => a.z - b.z || a.order - b.order);
        },
        /** The sound's tracks (one for each AudioContext made so far). */
        audioTracks() {
            return contexts.flatMap((context) => context.__recorderOut.stream.getAudioTracks());
        },
    };
    window.__recorder = recorder;

    // ------------------------------------------------------------------ keys
    const KEYS = new Set(['F7', 'F8', 'F9']);
    window.addEventListener('keydown', (event) => {
        if (!KEYS.has(event.key)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
            window.parent?.__recorderKey?.(event.key);
        } catch {
            // Not inside the recorder.
        }
    }, true);
})();
