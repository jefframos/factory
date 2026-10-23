import * as THREE from 'three';
import type * as PIXI from 'pixi.js';
import SetupThree from '@core/three/SetupThree';
import { BaseComponent } from '@core/runtime/object/BaseComponent';
import { DebugOverlay } from './DebugOverlay';
import type { DebugPanel } from './DebugPanel';

/** What the engine hands over at install (its own internals - not reachable from outside). */
export type PerformanceDiagnosticsHost = {
    /** The Game instance: its fixedUpdate / update / render are timed (wrapped on the instance). */
    game: object;
    /** Root game objects (children are walked from these). */
    gameObjects: () => readonly ProfiledObject[];
    pixiApp?: PIXI.Application;
    /** Shown at the top of the report (e.g. the game's folder). */
    label: string;
};

/** The bits of GameObject / BaseComponent the script profiler touches. */
type ProfiledObject = {
    readonly name?: string;
    readonly isDestroyed?: boolean;
    getAllComponents?(): readonly object[];
    getChildren?(): readonly ProfiledObject[];
};

/** A switch the game offers for A/B testing (post-processing, effects...) - in the panel's Test Switches. */
type DiagnosticsToggle = { label: string; get: () => boolean; set: (on: boolean) => void };

/** A custom report section from the game: rows of label -> value. */
export type DiagnosticsSection = () => Record<string, string | number | boolean | undefined>;

type FrameRecord = {
    /** ms since the previous frame ended (the real frame time). */
    interval: number;
    fixed: number;
    fixedSteps: number;
    update: number;
    render: number;
    pixi: number;
    /** GPU ms, filled in when its timer queries come back (undefined = not measured). */
    gpu?: number;
    calls: number;
    triangles: number;
    lines: number;
    points: number;
    passes: number;
};

type PassRecord = {
    target: string;
    scene: string;
    camera: string;
    calls: number;
    triangles: number;
    cpu: number;
};

type ScriptStat = { total: number; max: number; calls: number };

type TimerQueryExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

type SceneScan = {
    time: number;
    text: string[];
    summary: { objects: number; visibleMeshes: number; instances: number; lights: number; shadowLights: number; textureMb: number };
};

/** Frames kept for the timing stats (~10 s at 60 fps). */
const FRAME_WINDOW = 600;
/** Live readouts use the most recent frames only. */
const LIVE_WINDOW = 60;
/** How often new game objects / components are wrapped for the script profiler (ms). */
const SCRIPT_RESCAN_MS = 1000;
/** Scene scans for the live panel are reused for this long (ms). */
const SCAN_CACHE_MS = 1000;
const WRAPPED = Symbol('perfDiagWrapped');
const METHODS = ['preUpdate', 'update', 'fixedUpdate', 'lateUpdate'] as const;

/**
 * The debug overlay's Performance panel: tracks what every frame costs and what the scene holds, to
 * find out why the frame rate is low - and Copy Report puts it all on the clipboard as text.
 *
 * - Frame: fps, 1% lows, frame time percentiles, long frames; CPU split into fixed steps (physics),
 *   update, the 3D render submit and the PIXI render; GPU time per frame when the browser has
 *   EXT_disjoint_timer_query_webgl2.
 * - Renderer: every renderer.render call of a frame (post-processing passes included), with its draw
 *   calls / triangles / CPU time, plus programs, textures, geometries, pixel ratio and buffer size.
 * - Scene: objects, meshes, instances, skinned meshes, lights and shadows, materials, the heaviest
 *   meshes and the biggest textures.
 * - Scripts: CPU ms per frame of every GameObject / component update method, by class.
 * - Sections the game adds (addSection) and its own timers (measure).
 *
 * Installed by the engine only while the debug overlay is on (?debug=1).
 */
export class PerformanceDiagnostics {
    private static active?: PerformanceDiagnostics;
    private static readonly sections = new Map<string, DiagnosticsSection>();
    private static readonly toggles: DiagnosticsToggle[] = [];

    private readonly frames: FrameRecord[] = [];
    private current: FrameRecord = emptyFrame();
    private lastFrameEnd = 0;
    private passes: PassRecord[] = [];
    private lastPasses: PassRecord[] = [];
    private readonly scripts = new Map<string, ScriptStat>();
    private readonly measures = new Map<string, ScriptStat>();
    private scriptFrames = 0;
    private lastScriptScan = 0;
    /** Panel toggle: time every update method (a little overhead while on). */
    private readonly settings = { profileScripts: true, pixelRatio: 0, shadows: true };
    private readonly renderedScenes = new Set<THREE.Scene>();
    /** Every scene rendered so far (not cleared by scans) - for the shadow switch's recompile. */
    private readonly recentScenes = new Set<THREE.Scene>();
    private scan?: SceneScan;
    private readonly startedAt = performance.now();

    private timerExt?: TimerQueryExt;
    private gl?: WebGL2RenderingContext;
    private queryActive = false;
    private readonly pendingQueries: { query: WebGLQuery; frame: FrameRecord; pass: string }[] = [];
    /** GPU ms per render pass (by position + target + scene), averaged since the last reset. */
    private readonly passGpu = new Map<string, { total: number; count: number }>();
    /** The panel's Test Switches folder (game toggles added after install land here too). */
    private switchFolder?: ReturnType<DebugPanel['folder']>;

    private constructor(private readonly host: PerformanceDiagnosticsHost) {}

    /** Starts tracking and adds the Performance panel. Once only; no-op while the overlay is off. */
    public static install(host: PerformanceDiagnosticsHost): void {
        if (PerformanceDiagnostics.active || !DebugOverlay.instance.isEnabled) {
            return;
        }

        const diagnostics = new PerformanceDiagnostics(host);

        PerformanceDiagnostics.active = diagnostics;
        diagnostics.wrapGameLoop();
        diagnostics.wrapPixi();
        diagnostics.buildPanel(DebugOverlay.instance.panel('Performance', { id: 'engine.performance', minimized: true, persist: false }));
    }

    /**
     * A switch for A/B testing what costs the frame (an effect, a feature) - shown in the panel's
     * Test Switches and listed in the report. Flipping any switch resets the stats, so the numbers
     * after it are for the new setup only.
     */
    public static addToggle(label: string, get: () => boolean, set: (on: boolean) => void): void {
        const toggle = { label, get, set };

        PerformanceDiagnostics.toggles.push(toggle);
        PerformanceDiagnostics.active?.addSwitch(toggle);
    }

    /** A game's own section in the report (physics bodies, pools...) - read when the report is made. */
    public static addSection(title: string, read: DiagnosticsSection): void {
        PerformanceDiagnostics.sections.set(title, read);
    }

    /** Times fn under label (shown with the scripts). Just runs it when diagnostics are off. */
    public static measure<T>(label: string, fn: () => T): T {
        const diagnostics = PerformanceDiagnostics.active;

        if (!diagnostics) {
            return fn();
        }

        const start = performance.now();

        try {
            return fn();
        } finally {
            addStat(diagnostics.measures, label, performance.now() - start);
        }
    }

    /** The full text report (also what Copy Report copies). */
    public static report(): string {
        return PerformanceDiagnostics.active?.buildReport() ?? 'Performance diagnostics are off (open the game with ?debug=1).';
    }

    // ------------------------------------------------------------------ hooks

    /** Wraps the Game instance's fixedUpdate / update / render, and the Three renderer's render. */
    private wrapGameLoop(): void {
        const game = this.host.game as Record<string, (...args: unknown[]) => unknown>;
        const fixedUpdate = game.fixedUpdate.bind(game);
        const update = game.update.bind(game);
        const render = game.render.bind(game);

        game.fixedUpdate = (...args) => {
            const start = performance.now();

            fixedUpdate(...args);
            this.current.fixed += performance.now() - start;
            this.current.fixedSteps++;
        };

        game.update = (...args) => {
            const start = performance.now();

            this.maybeWrapScripts(start);
            update(...args);
            this.current.update += performance.now() - start;
        };

        game.render = (...args) => {
            const start = performance.now();

            render(...args);
            this.current.render += performance.now() - start;
            this.endFrame();
        };

        this.wrapThreeRenderer();
    }

    private wrapThreeRenderer(): void {
        const renderer = SetupThree.renderer;

        if (!renderer) {
            return;
        }

        const gl = renderer.getContext();

        if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) {
            this.gl = gl;
            this.timerExt = (gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null) ?? undefined;
        }

        const original = renderer.render.bind(renderer);

        renderer.render = (scene: THREE.Object3D, camera: THREE.Camera) => {
            const info = renderer.info;
            const before = { calls: info.render.calls, triangles: info.render.triangles, lines: info.render.lines, points: info.render.points };
            const target = renderer.getRenderTarget();
            const targetLabel = target ? `${target.width}x${target.height}` : 'screen';
            const sceneLabel = describeScene(scene);
            const query = this.beginGpuQuery();
            const start = performance.now();

            original(scene, camera);

            const cpu = performance.now() - start;

            this.endGpuQuery(query, passKey(this.passes.length, targetLabel, sceneLabel));

            // autoReset (the default) zeroes the counters at the start of every render call.
            const reset = info.autoReset;
            const calls = info.render.calls - (reset ? 0 : before.calls);
            const triangles = info.render.triangles - (reset ? 0 : before.triangles);

            this.current.calls += calls;
            this.current.triangles += triangles;
            this.current.lines += info.render.lines - (reset ? 0 : before.lines);
            this.current.points += info.render.points - (reset ? 0 : before.points);
            this.current.passes++;

            this.passes.push({
                target: targetLabel,
                scene: sceneLabel,
                camera: camera.type,
                calls,
                triangles,
                cpu,
            });

            if ((scene as THREE.Scene).isScene) {
                this.renderedScenes.add(scene as THREE.Scene);
                this.recentScenes.add(scene as THREE.Scene);
            }
        };
    }

    private wrapPixi(): void {
        const renderer = this.host.pixiApp?.renderer as { render: (...args: unknown[]) => void } | undefined;

        if (!renderer) {
            return;
        }

        const original = renderer.render.bind(renderer);

        renderer.render = (...args) => {
            const start = performance.now();

            original(...args);
            // PIXI draws on its own ticker - after the game's frame ended, so it's counted in the next.
            this.current.pixi += performance.now() - start;
        };
    }

    private beginGpuQuery(): WebGLQuery | undefined {
        if (!this.timerExt || !this.gl || this.queryActive) {
            return undefined;
        }

        const query = this.gl.createQuery();

        if (!query) {
            return undefined;
        }

        this.gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, query);
        this.queryActive = true;

        return query;
    }

    private endGpuQuery(query: WebGLQuery | undefined, pass: string): void {
        if (!query || !this.gl || !this.timerExt) {
            return;
        }

        this.gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
        this.queryActive = false;
        this.current.gpu ??= 0;
        this.pendingQueries.push({ query, frame: this.current, pass });
    }

    /** GPU timings come back a few frames later - collected here. */
    private collectGpuQueries(): void {
        const gl = this.gl;
        const ext = this.timerExt;

        if (!gl || !ext) {
            return;
        }

        const disjoint = Boolean(gl.getParameter(ext.GPU_DISJOINT_EXT));

        while (this.pendingQueries.length > 0) {
            const { query, frame, pass } = this.pendingQueries[0];

            if (!disjoint && !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
                break;
            }

            this.pendingQueries.shift();

            if (disjoint) {
                frame.gpu = undefined;
            } else if (frame.gpu !== undefined) {
                const ms = (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6;
                const stat = this.passGpu.get(pass) ?? { total: 0, count: 0 };

                frame.gpu += ms;
                stat.total += ms;
                stat.count++;
                this.passGpu.set(pass, stat);
            }

            gl.deleteQuery(query);
        }
    }

    private endFrame(): void {
        const now = performance.now();

        this.current.interval = this.lastFrameEnd > 0 ? now - this.lastFrameEnd : 0;
        this.lastFrameEnd = now;

        if (this.current.interval > 0) {
            this.frames.push(this.current);

            if (this.frames.length > FRAME_WINDOW) {
                this.frames.shift();
            }
        }

        this.lastPasses = this.passes;
        this.passes = [];
        this.current = emptyFrame();

        if (this.settings.profileScripts) {
            this.scriptFrames++;
        }

        this.collectGpuQueries();
    }

    // ------------------------------------------------------------------ script profiler

    /** Wraps the update methods of game objects / components not wrapped yet (every SCRIPT_RESCAN_MS). */
    private maybeWrapScripts(now: number): void {
        if (!this.settings.profileScripts || now - this.lastScriptScan < SCRIPT_RESCAN_MS) {
            return;
        }

        this.lastScriptScan = now;

        const visit = (object: ProfiledObject): void => {
            this.wrapScript(object);

            for (const component of object.getAllComponents?.() ?? []) {
                this.wrapScript(component);
            }

            for (const child of object.getChildren?.() ?? []) {
                visit(child);
            }
        };

        for (const root of this.host.gameObjects()) {
            visit(root);
        }
    }

    /** Times this object's own update methods (not its components' / children's - those are wrapped themselves). */
    private wrapScript(target: object): void {
        const record = target as Record<string | symbol, unknown>;

        if (record[WRAPPED]) {
            return;
        }

        record[WRAPPED] = true;

        const className = target.constructor?.name || 'Anonymous';

        for (const method of METHODS) {
            const original = record[method];

            // Only methods the class actually defines (not BaseComponent's empty ones).
            if (typeof original !== 'function' || original === BaseComponent.prototype[method]) {
                continue;
            }

            const label = `${className}.${method}`;

            record[method] = (...args: unknown[]) => {
                if (!this.settings.profileScripts) {
                    return (original as (...a: unknown[]) => unknown).apply(target, args);
                }

                const start = performance.now();

                try {
                    return (original as (...a: unknown[]) => unknown).apply(target, args);
                } finally {
                    addStat(this.scripts, label, performance.now() - start);
                }
            };
        }
    }

    // ------------------------------------------------------------------ panel

    private buildPanel(panel: DebugPanel): void {
        const live = () => this.frames.slice(-LIVE_WINDOW);

        panel.buttons([
            { label: 'Copy Report', variant: 'accent', action: () => void this.copyReport() },
            { label: 'Reset Stats', action: () => this.reset() },
        ]);

        panel.monitor('FPS', () => {
            const frames = live();
            return frames.length ? `${fmt(fpsOf(frames), 0)} (1% low ${fmt(lowFps(frames), 0)})` : '-';
        });
        panel.monitor('Frame ms', () => {
            const intervals = live().map((frame) => frame.interval);
            return intervals.length ? `${fmt(avg(intervals))} avg / ${fmt(percentile(intervals, 0.95))} p95` : '-';
        });
        panel.monitor('CPU ms', () => {
            const frames = live();
            return frames.length
                ? `${fmt(avg(frames.map(cpuOf)))} (fixed ${fmt(avg(frames.map((f) => f.fixed)))} x${fmt(avg(frames.map((f) => f.fixedSteps)), 1)}, upd ${fmt(avg(frames.map((f) => f.update)))}, 3D ${fmt(avg(frames.map((f) => f.render)))}, 2D ${fmt(avg(frames.map((f) => f.pixi)))})`
                : '-';
        });
        panel.monitor('GPU ms', () => {
            if (!this.timerExt) {
                return 'n/a (no timer query)';
            }

            const gpu = live().map((frame) => frame.gpu).filter((value): value is number => value !== undefined);
            return gpu.length ? fmt(avg(gpu)) : '-';
        });
        panel.monitor('Draw calls', () => fmt(avg(live().map((f) => f.calls)), 0));
        panel.monitor('Triangles', () => fmtCount(avg(live().map((f) => f.triangles))));
        panel.monitor('Render passes', () => `${this.lastPasses.length}`);
        panel.monitor('Resolution', () => {
            const renderer = SetupThree.renderer;
            const size = renderer?.getDrawingBufferSize(new THREE.Vector2());
            return renderer && size ? `${size.x}x${size.y} @ ${fmt(renderer.getPixelRatio(), 2)}x` : '-';
        });
        panel.monitor('Programs / Tex / Geo', () => {
            const info = SetupThree.renderer?.info;
            return info ? `${info.programs?.length ?? 0} / ${info.memory.textures} / ${info.memory.geometries}` : '-';
        });
        panel.monitor('Scene', () => {
            const scan = this.getScan(false);
            const s = scan.summary;
            return `${s.objects} obj, ${s.visibleMeshes} meshes, ${fmtCount(s.instances)} inst, ${s.lights} lights (${s.shadowLights} shadow)`;
        });
        panel.monitor('Top scripts', () => this.topScripts(3).map((row) => `${row.label} ${fmt(row.perFrame)}`).join(' | ') || '-');

        panel.monitor('GPU main / post', () => {
            const main = this.passGpuAverage(0);
            const total = sum(this.lastPasses.map((pass, index) => this.passGpuAverage(index, pass) ?? 0));
            return main === undefined ? (this.timerExt ? '-' : 'n/a') : `${fmt(main)} / ${fmt(total - main)} ms`;
        });

        panel.toggle(this.settings, 'profileScripts', { label: 'Profile Scripts' });

        // A/B tests: flip one, watch GPU ms (the stats restart on every flip).
        const switches = panel.folder('Test Switches');
        const renderer = SetupThree.renderer;

        this.switchFolder = switches;
        switches.select(this.settings, 'pixelRatio', { Auto: 0, '2.0': 2, '1.5': 1.5, '1.0': 1, '0.75': 0.75, '0.5': 0.5 }, {
            label: 'Pixel Ratio',
            onChange: () => {
                renderer?.setPixelRatio(this.settings.pixelRatio || SetupThree.getCurrentPixelRatio());
                this.resetStats();
            },
        });

        if (renderer) {
            this.settings.shadows = renderer.shadowMap.enabled;
            switches.toggle(this.settings, 'shadows', {
                label: 'Shadows',
                onChange: () => {
                    renderer.shadowMap.enabled = this.settings.shadows;
                    // Shadow use is compiled into the shaders: recompile them.
                    this.forEachRenderedMaterial((material) => {
                        material.needsUpdate = true;
                    });
                    this.resetStats();
                },
            });
        }

        for (const toggle of PerformanceDiagnostics.toggles) {
            this.addSwitch(toggle);
        }
    }

    private addSwitch(toggle: DiagnosticsToggle): void {
        const state = { on: toggle.get() };

        this.switchFolder?.toggle(state, 'on', {
            label: toggle.label,
            onChange: () => {
                toggle.set(state.on);
                this.resetStats();
            },
        });
    }

    private forEachRenderedMaterial(visit: (material: THREE.Material) => void): void {
        const seen = new Set<THREE.Material>();

        for (const scene of this.recentScenes) {
            scene.traverse((object) => {
                const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;

                for (const each of Array.isArray(material) ? material : material ? [material] : []) {
                    if (!seen.has(each)) {
                        seen.add(each);
                        visit(each);
                    }
                }
            });
        }
    }

    /** Average GPU ms of pass index (matched by its target / scene in the last frame). */
    private passGpuAverage(index: number, pass: PassRecord | undefined = this.lastPasses[index]): number | undefined {
        if (!pass) {
            return undefined;
        }

        const stat = this.passGpu.get(passKey(index, pass.target, pass.scene));

        return stat && stat.count > 0 ? stat.total / stat.count : undefined;
    }

    private reset(): void {
        this.resetStats();
        DebugOverlay.instance.toast('Performance stats reset');
    }

    private resetStats(): void {
        this.frames.length = 0;
        this.scripts.clear();
        this.measures.clear();
        this.passGpu.clear();
        this.scriptFrames = 0;
    }

    private async copyReport(): Promise<void> {
        const text = this.buildReport();

        // eslint-disable-next-line no-console
        console.info(text);

        if (await copyText(text)) {
            DebugOverlay.instance.toast(`Performance report copied (${Math.round(text.length / 1024)} KB)`);
        } else {
            DebugOverlay.instance.toast('Clipboard blocked - the report is in the console', true);
        }
    }

    private topScripts(count: number): { label: string; perFrame: number; max: number; callsPerFrame: number }[] {
        const frames = Math.max(this.scriptFrames, 1);

        return [...this.scripts.entries(), ...[...this.measures.entries()].map(([label, stat]) => [`[measure] ${label}`, stat] as const)]
            .map(([label, stat]) => ({ label, perFrame: stat.total / frames, max: stat.max, callsPerFrame: stat.calls / frames }))
            .sort((left, right) => right.perFrame - left.perFrame)
            .slice(0, count);
    }

    // ------------------------------------------------------------------ report

    private buildReport(): string {
        const lines: string[] = [];
        const push = (...rows: string[]) => lines.push(...rows);
        const frames = this.frames;

        push(`# Performance report - ${this.host.label} - ${new Date().toISOString()}`);
        push(`Tracked ${frames.length} frames (${fmt(sum(frames.map((f) => f.interval)) / 1000, 1)} s), session ${fmt((performance.now() - this.startedAt) / 1000, 0)} s`);
        push('');

        push('## Device');
        push(...this.deviceLines());
        push('');

        push('## Frame timing');

        if (frames.length > 0) {
            const intervals = frames.map((f) => f.interval);
            const gpu = frames.map((f) => f.gpu).filter((value): value is number => value !== undefined);

            push(`FPS: avg ${fmt(fpsOf(frames), 1)}, 1% low ${fmt(lowFps(frames), 1)}, min ${fmt(1000 / Math.max(...intervals), 1)}`);
            push(`Frame ms: avg ${fmt(avg(intervals))}, p50 ${fmt(percentile(intervals, 0.5))}, p95 ${fmt(percentile(intervals, 0.95))}, p99 ${fmt(percentile(intervals, 0.99))}, max ${fmt(Math.max(...intervals))}`);
            push(`Long frames: >20ms ${intervals.filter((v) => v > 20).length}, >33ms ${intervals.filter((v) => v > 33.4).length}, >50ms ${intervals.filter((v) => v > 50).length}, >100ms ${intervals.filter((v) => v > 100).length}`);
            push(`CPU ms/frame: total ${fmt(avg(frames.map(cpuOf)))} (p95 ${fmt(percentile(frames.map(cpuOf), 0.95))})`);
            push(`  fixed steps: ${fmt(avg(frames.map((f) => f.fixed)))} ms, ${fmt(avg(frames.map((f) => f.fixedSteps)), 2)} steps/frame (max ${Math.max(...frames.map((f) => f.fixedSteps))})`);
            push(`  update (+late): ${fmt(avg(frames.map((f) => f.update)))} ms`);
            push(`  3D render submit: ${fmt(avg(frames.map((f) => f.render)))} ms`);
            push(`  2D (PIXI) render: ${fmt(avg(frames.map((f) => f.pixi)))} ms`);
            push(`  not in CPU work (GPU / vsync / browser): ${fmt(avg(frames.map((f) => Math.max(f.interval - cpuOf(f), 0))))} ms`);
            push(`GPU ms/frame: ${this.timerExt ? (gpu.length ? `avg ${fmt(avg(gpu))}, p95 ${fmt(percentile(gpu, 0.95))}, max ${fmt(Math.max(...gpu))}` : 'no results yet') : 'unavailable (EXT_disjoint_timer_query_webgl2 not supported)'}`);
        } else {
            push('(no frames yet)');
        }

        push('');
        push('## Renderer');
        push(...this.rendererLines());
        push('');

        push('## Render passes (last frame; GPU ms = average since reset)');
        push('#  target      scene                       camera              calls  triangles  cpu ms  gpu ms');
        this.lastPasses.forEach((pass, index) => {
            const gpu = this.passGpuAverage(index, pass);

            push(`${String(index).padEnd(2)} ${pass.target.padEnd(11)} ${pass.scene.slice(0, 27).padEnd(27)} ${pass.camera.padEnd(19)} ${String(pass.calls).padStart(5)}  ${fmtCount(pass.triangles).padStart(9)}  ${fmt(pass.cpu).padStart(6)}  ${gpu === undefined ? '     -' : fmt(gpu).padStart(6)}`);
        });

        const gpuMain = this.passGpuAverage(0);

        if (gpuMain !== undefined) {
            const gpuAll = sum(this.lastPasses.map((pass, index) => this.passGpuAverage(index, pass) ?? 0));
            const fullScreen = this.lastPasses.filter((pass, index) => index > 0 && pass.target === this.lastPasses[0].target);

            push(`GPU split: main scene ${fmt(gpuMain)} ms, everything after it (post-processing) ${fmt(gpuAll - gpuMain)} ms; ${fullScreen.length} later passes at full size`);
        }

        push('');
        push('## Test switches');
        push(`Pixel ratio: ${this.settings.pixelRatio ? `forced ${this.settings.pixelRatio}` : 'auto'}`);
        push(`Shadows: ${SetupThree.renderer?.shadowMap.enabled ? 'on' : 'off'}`);

        for (const toggle of PerformanceDiagnostics.toggles) {
            push(`${toggle.label}: ${toggle.get() ? 'on' : 'off'}`);
        }
        push('');

        push('## Scene');
        push(...this.getScan(true).text);
        push('');

        push('## Shader programs');
        push(...this.programLines());
        push('');

        push(`## Scripts (CPU ms per frame, over ${this.scriptFrames} frames${this.settings.profileScripts ? '' : ', profiling off'})`);
        push('ms/frame  max ms  calls/frame  method');
        for (const row of this.topScripts(30)) {
            push(`${fmt(row.perFrame, 3).padStart(8)}  ${fmt(row.max).padStart(6)}  ${fmt(row.callsPerFrame, 2).padStart(11)}  ${row.label}`);
        }
        push('');

        push('## Engine');
        push(...this.engineLines());

        for (const [title, read] of PerformanceDiagnostics.sections) {
            push('');
            push(`## ${title}`);

            try {
                for (const [key, value] of Object.entries(read())) {
                    push(`${key}: ${value === undefined ? '-' : String(value)}`);
                }
            } catch (error) {
                push(`(failed: ${String(error)})`);
            }
        }

        return lines.join('\n');
    }

    private deviceLines(): string[] {
        const lines: string[] = [];
        const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string } };
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;

        lines.push(`User agent: ${nav.userAgent}`);
        lines.push(`CPU threads: ${nav.hardwareConcurrency ?? '?'}, device memory: ${nav.deviceMemory ?? '?'} GB, touch points: ${nav.maxTouchPoints ?? 0}`);
        lines.push(`Window: ${window.innerWidth}x${window.innerHeight} CSS px, devicePixelRatio ${window.devicePixelRatio}, screen ${screen.width}x${screen.height}`);
        lines.push(`Page visible: ${document.visibilityState}, focused: ${document.hasFocus()}`);

        if (memory) {
            lines.push(`JS heap: ${mb(memory.usedJSHeapSize)} MB used / ${mb(memory.totalJSHeapSize)} MB total / ${mb(memory.jsHeapSizeLimit)} MB limit`);
        }

        const gl = SetupThree.renderer?.getContext();

        if (gl) {
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
            const gpu = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
            const attributes = gl.getContextAttributes();

            lines.push(`GPU: ${gpu} (${vendor})`);
            lines.push(`WebGL: ${gl instanceof WebGL2RenderingContext ? '2' : '1'}, max texture ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}, antialias ${attributes?.antialias}, powerPreference ${attributes?.powerPreference ?? '?'}`);

            if (/swiftshader|llvmpipe|software|basic render/i.test(String(gpu))) {
                lines.push('WARNING: software renderer - the GPU is not being used (hardware acceleration off?)');
            }
        }

        return lines;
    }

    private rendererLines(): string[] {
        const renderer = SetupThree.renderer;

        if (!renderer) {
            return ['(no Three renderer)'];
        }

        const frames = this.frames;
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        const info = renderer.info;

        return [
            `Drawing buffer: ${size.x}x${size.y} (${fmt((size.x * size.y) / 1e6, 2)} MP), pixel ratio ${fmt(renderer.getPixelRatio(), 2)}`,
            `Per frame avg: ${fmt(avg(frames.map((f) => f.calls)), 1)} draw calls (max ${Math.max(0, ...frames.map((f) => f.calls))}), ${fmtCount(avg(frames.map((f) => f.triangles)))} triangles (max ${fmtCount(Math.max(0, ...frames.map((f) => f.triangles)))}), ${fmtCount(avg(frames.map((f) => f.lines)))} lines, ${fmtCount(avg(frames.map((f) => f.points)))} points, ${fmt(avg(frames.map((f) => f.passes)), 1)} render calls`,
            `Memory: ${info.memory.geometries} geometries, ${info.memory.textures} textures, ${info.programs?.length ?? 0} programs`,
            `Shadows: ${renderer.shadowMap.enabled ? `on, type ${shadowTypeName(renderer.shadowMap.type)}, autoUpdate ${renderer.shadowMap.autoUpdate}` : 'off'}`,
            `Tone mapping: ${renderer.toneMapping}, exposure ${renderer.toneMappingExposure}, output ${renderer.outputColorSpace}, sortObjects ${renderer.sortObjects}`,
        ];
    }

    private programLines(): string[] {
        const programs = (SetupThree.renderer?.info.programs ?? []) as unknown as { name?: string; usedTimes?: number; cacheKey?: string; type?: string }[];
        const byName = new Map<string, number>();

        for (const program of programs) {
            const name = program.name || program.type || 'unnamed';

            byName.set(name, (byName.get(name) ?? 0) + 1);
        }

        return [
            `${programs.length} compiled programs`,
            ...[...byName.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `  ${count} x ${name}`),
        ];
    }

    private engineLines(): string[] {
        let objects = 0;
        let components = 0;

        const visit = (object: ProfiledObject): void => {
            objects++;
            components += object.getAllComponents?.().length ?? 0;
            (object.getChildren?.() ?? []).forEach(visit);
        };

        this.host.gameObjects().forEach(visit);

        const lines = [`Game objects: ${objects}, components: ${components}`];
        const stage = this.host.pixiApp?.stage;

        if (stage) {
            let display = 0;
            let visible = 0;

            const walk = (node: PIXI.DisplayObject): void => {
                display++;

                if (node.visible) {
                    visible++;
                }

                for (const child of (node as PIXI.Container).children ?? []) {
                    walk(child);
                }
            };

            walk(stage);
            lines.push(`PIXI display objects: ${display} (${visible} visible)`);
        }

        return lines;
    }

    // ------------------------------------------------------------------ scene scan

    /** Scans the scenes rendered recently (cached SCAN_CACHE_MS unless fresh). */
    private getScan(fresh: boolean): SceneScan {
        const now = performance.now();

        if (!fresh && this.scan && now - this.scan.time < SCAN_CACHE_MS) {
            return this.scan;
        }

        this.scan = scanScenes([...this.renderedScenes]);
        this.scan.time = now;
        this.renderedScenes.clear();

        return this.scan;
    }
}

// ---------------------------------------------------------------------- scene scan

function scanScenes(scenes: THREE.Scene[]): SceneScan {
    const text: string[] = [];
    const summary = { objects: 0, visibleMeshes: 0, instances: 0, lights: 0, shadowLights: 0, textureMb: 0 };
    // Full-screen post-processing quads first out: the real scenes have more in them.
    const sorted = scenes.map((scene) => ({ scene, count: countObjects(scene) })).sort((a, b) => b.count - a.count);
    const textures = new Map<THREE.Texture, { users: number }>();
    const heavy: { path: string; triangles: number; instances: number; type: string; material: string; flags: string }[] = [];

    for (const { scene, count } of sorted) {
        if (count <= 2) {
            continue;
        }

        const stats = {
            visibleObjects: 0,
            meshes: 0,
            visibleMeshes: 0,
            instanced: 0,
            instances: 0,
            skinned: 0,
            bones: 0,
            points: 0,
            lines: 0,
            sprites: 0,
            transparent: 0,
            noCulling: 0,
            castShadow: 0,
            receiveShadow: 0,
            triangles: 0,
            vertices: 0,
        };
        const lights = new Map<string, number>();
        const shadowMaps: string[] = [];
        const materials = new Map<string, Set<THREE.Material>>();
        const geometries = new Set<THREE.BufferGeometry>();

        scene.traverse((object) => {
            summary.objects++;

            const visible = isVisible(object);

            if (visible) {
                stats.visibleObjects++;
            }

            const light = object as THREE.Light & { shadow?: THREE.LightShadow };

            if (light.isLight) {
                lights.set(light.type, (lights.get(light.type) ?? 0) + 1);
                summary.lights++;

                if (light.castShadow && light.shadow) {
                    summary.shadowLights++;
                    shadowMaps.push(`${light.type} ${light.name || ''} ${light.shadow.mapSize.x}x${light.shadow.mapSize.y}${visible ? '' : ' (hidden)'}`.replace(/\s+/g, ' '));
                }
            }

            const mesh = object as THREE.Mesh & { isPoints?: boolean; isLine?: boolean; isSprite?: boolean };

            if ((object as THREE.Bone).isBone) {
                stats.bones++;
            }

            if (mesh.isPoints) {
                stats.points++;
            } else if (mesh.isLine) {
                stats.lines++;
            } else if (mesh.isSprite) {
                stats.sprites++;
            }

            if (!mesh.isMesh && !mesh.isPoints && !mesh.isLine && !mesh.isSprite) {
                return;
            }

            stats.meshes++;

            const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
            const instanced = object as THREE.InstancedMesh;
            const instances = instanced.isInstancedMesh ? instanced.count : 1;
            const triangles = geometry ? triangleCount(geometry) : 0;
            const materialList = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean) as THREE.Material[];

            if (geometry) {
                geometries.add(geometry);
            }

            for (const material of materialList) {
                const set = materials.get(material.type) ?? new Set();

                set.add(material);
                materials.set(material.type, set);

                for (const value of Object.values(material)) {
                    if (value && (value as THREE.Texture).isTexture) {
                        const entry = textures.get(value as THREE.Texture) ?? { users: 0 };

                        entry.users++;
                        textures.set(value as THREE.Texture, entry);
                    }
                }

                const uniforms = (material as THREE.ShaderMaterial).uniforms;

                for (const uniform of Object.values(uniforms ?? {})) {
                    if (uniform?.value && (uniform.value as THREE.Texture).isTexture) {
                        const entry = textures.get(uniform.value as THREE.Texture) ?? { users: 0 };

                        entry.users++;
                        textures.set(uniform.value as THREE.Texture, entry);
                    }
                }
            }

            if (!visible) {
                return;
            }

            stats.visibleMeshes++;
            summary.visibleMeshes++;
            stats.triangles += triangles * instances;
            stats.vertices += (geometry?.getAttribute('position')?.count ?? 0) * instances;
            stats.castShadow += mesh.castShadow ? 1 : 0;
            stats.receiveShadow += mesh.receiveShadow ? 1 : 0;
            stats.noCulling += mesh.frustumCulled ? 0 : 1;
            stats.transparent += materialList.some((material) => material.transparent) ? 1 : 0;

            if (instanced.isInstancedMesh) {
                stats.instanced++;
                stats.instances += instances;
                summary.instances += instances;
            }

            if ((object as THREE.SkinnedMesh).isSkinnedMesh) {
                stats.skinned++;
            }

            heavy.push({
                path: objectPath(object),
                triangles: triangles * instances,
                instances,
                type: object.type,
                material: materialList.map((material) => material.type).join('+'),
                flags: [
                    mesh.castShadow ? 'castShadow' : '',
                    mesh.frustumCulled ? '' : 'noCull',
                    materialList.some((material) => material.transparent) ? 'transparent' : '',
                ].filter(Boolean).join(','),
            });
        });

        text.push(`### ${describeScene(scene)}`);
        text.push(`Objects ${count} (${stats.visibleObjects} visible), drawables ${stats.meshes} (${stats.visibleMeshes} visible)`);
        text.push(`Visible: ${stats.instanced} instanced (${fmtCount(stats.instances)} instances), ${stats.skinned} skinned (${stats.bones} bones in scene), ${stats.points} points, ${stats.lines} lines, ${stats.sprites} sprites`);
        text.push(`Visible geometry: ${fmtCount(stats.triangles)} triangles, ${fmtCount(stats.vertices)} vertices (before culling), ${geometries.size} unique geometries`);
        text.push(`Visible flags: ${stats.transparent} transparent, ${stats.noCulling} frustumCulled=false, ${stats.castShadow} cast shadow, ${stats.receiveShadow} receive shadow`);
        text.push(`Lights: ${[...lights.entries()].map(([type, n]) => `${n} ${type}`).join(', ') || 'none'}`);
        text.push(`Shadow maps: ${shadowMaps.join('; ') || 'none'}`);
        text.push(`Materials: ${[...materials.entries()].map(([type, set]) => `${set.size} ${type}`).join(', ')}`);
        text.push(`Background: ${scene.background ? ((scene.background as THREE.Texture).isTexture ? 'texture' : 'colour') : 'none'}, environment: ${scene.environment ? 'yes' : 'no'}, fog: ${scene.fog ? 'yes' : 'no'}`);
    }

    heavy.sort((a, b) => b.triangles - a.triangles);
    text.push('');
    text.push('Heaviest visible drawables (triangles incl. instances):');
    for (const row of heavy.slice(0, 20)) {
        text.push(`  ${fmtCount(row.triangles).padStart(8)}  ${row.type}${row.instances > 1 ? ` x${row.instances}` : ''}  ${row.material}  ${row.flags ? `[${row.flags}] ` : ''}${row.path}`);
    }

    const textureRows = [...textures.keys()].map((texture) => {
        const image = texture.image as { width?: number; height?: number; data?: unknown } | undefined;
        const width = image?.width ?? 0;
        const height = image?.height ?? 0;
        const isCube = (texture as THREE.CubeTexture).isCubeTexture;
        const bytes = width * height * 4 * (texture.generateMipmaps ? 1.33 : 1) * (isCube ? 6 : 1);

        return { name: texture.name || texture.constructor.name, width, height, bytes, type: texture.constructor.name };
    }).sort((a, b) => b.bytes - a.bytes);

    summary.textureMb = sum(textureRows.map((row) => row.bytes)) / 1048576;
    text.push('');
    text.push(`Textures used by scene materials: ${textureRows.length}, ~${fmt(summary.textureMb, 1)} MB (RGBA estimate)`);
    for (const row of textureRows.slice(0, 12)) {
        text.push(`  ${`${row.width}x${row.height}`.padStart(11)}  ${fmt(row.bytes / 1048576, 1).padStart(6)} MB  ${row.type}  ${row.name}`);
    }

    return { time: 0, text, summary };
}

// ---------------------------------------------------------------------- helpers

function passKey(index: number, target: string, scene: string): string {
    return `${index}|${target}|${scene}`;
}

function emptyFrame(): FrameRecord {
    return { interval: 0, fixed: 0, fixedSteps: 0, update: 0, render: 0, pixi: 0, calls: 0, triangles: 0, lines: 0, points: 0, passes: 0 };
}

function cpuOf(frame: FrameRecord): number {
    return frame.fixed + frame.update + frame.render + frame.pixi;
}

function addStat(map: Map<string, ScriptStat>, label: string, ms: number): void {
    const stat = map.get(label);

    if (stat) {
        stat.total += ms;
        stat.calls++;
        stat.max = Math.max(stat.max, ms);
    } else {
        map.set(label, { total: ms, max: ms, calls: 1 });
    }
}

function countObjects(object: THREE.Object3D): number {
    let count = 0;

    object.traverse(() => {
        count++;
    });

    return count;
}

function isVisible(object: THREE.Object3D): boolean {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
        if (!node.visible) {
            return false;
        }
    }

    return true;
}

function triangleCount(geometry: THREE.BufferGeometry): number {
    const index = geometry.getIndex();
    const count = index ? index.count : geometry.getAttribute('position')?.count ?? 0;
    const drawCount = Number.isFinite(geometry.drawRange.count) ? Math.min(geometry.drawRange.count, count) : count;

    return Math.floor(drawCount / 3);
}

function objectPath(object: THREE.Object3D): string {
    const parts: string[] = [];

    for (let node: THREE.Object3D | null = object; node && parts.length < 5; node = node.parent) {
        parts.unshift(node.name || node.type);
    }

    return parts.join(' > ');
}

function describeScene(scene: THREE.Object3D): string {
    return `${scene.name || scene.type} (${scene.children.length} children)`;
}

function shadowTypeName(type: THREE.ShadowMapType): string {
    return { [THREE.BasicShadowMap]: 'Basic', [THREE.PCFShadowMap]: 'PCF', [THREE.PCFSoftShadowMap]: 'PCFSoft', [THREE.VSMShadowMap]: 'VSM' }[type] ?? String(type);
}

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

function avg(values: number[]): number {
    return values.length ? sum(values) / values.length : 0;
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);

    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function fpsOf(frames: FrameRecord[]): number {
    const total = sum(frames.map((frame) => frame.interval));

    return total > 0 ? (frames.length * 1000) / total : 0;
}

/** FPS of the slowest 1% of frames. */
function lowFps(frames: FrameRecord[]): number {
    const slowest = frames.map((frame) => frame.interval).sort((a, b) => b - a);
    const count = Math.max(1, Math.floor(slowest.length * 0.01));

    return 1000 / avg(slowest.slice(0, count));
}

function fmt(value: number, digits = 2): string {
    return Number.isFinite(value) ? value.toFixed(digits) : '-';
}

function fmtCount(value: number): string {
    if (!Number.isFinite(value)) {
        return '-';
    }

    if (value >= 1e6) {
        return `${(value / 1e6).toFixed(2)}M`;
    }

    if (value >= 1e3) {
        return `${(value / 1e3).toFixed(1)}k`;
    }

    return `${Math.round(value)}`;
}

function mb(bytes: number): string {
    return (bytes / 1048576).toFixed(0);
}

async function copyText(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // Fall through to the textarea copy.
    }

    try {
        const area = document.createElement('textarea');

        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.append(area);
        area.select();

        const copied = document.execCommand('copy');

        area.remove();

        return copied;
    } catch {
        return false;
    }
}
