// Quality.ts
//
// How much the 3D asks of the device. Low (every phone and tablet): the lighter grass clumps and wind, lighting without
// shine (CheapLights), a resolution that starts lower and climbs if it can (AdaptiveResolution). High: the rest.
// `?quality=low` / `?quality=high` picks one (the debug panel's Device > Quality, for trying low end on a computer).

import * as THREE from 'three';
import { CheapLights } from 'core/scene/CheapLights';
import { AdaptiveResolution, PHONE_START, RESOLUTION_STEPS } from 'core/scene/AdaptiveResolution';
import SetupThree from 'core/scene/SetupThree';
import { Game } from 'core/Game';
import { DebugOverlay } from 'core/debug/DebugOverlay';

const PARAM = 'quality';
type Choice = 'auto' | 'low' | 'high';

const chosen = new URLSearchParams(window.location.search).get(PARAM);
const choice: Choice = chosen === 'low' || chosen === 'high' ? chosen : 'auto';
export const IS_TOUCH = !!window.matchMedia?.('(pointer: coarse)').matches;

export const QUALITY = {
    /** The light version of everything. */
    low: choice === 'auto' ? IS_TOUCH : choice === 'low',
};

/** The UI's resolution once the 3D's is at or under this share (a device that slow has no pixels to spare). */
const UI_LOWERED = { from: 0.55, resolution: 1.5 };
/** A screen faster than this many frames a second (a phone's 120 Hz) is drawn at about 60: twice the work for little. */
const FAST_SCREEN_MS = 9.5;
const FRAME_CAP = 65;
const REFRESH_FRAMES = 40;

/** Before the scene's built: what's decided once. */
export function applyQuality(): void {
    if (QUALITY.low) CheapLights.install();
    SetupThree.adaptive ??= new AdaptiveResolution(QUALITY.low ? PHONE_START : 0);
}

/** Each frame: the UI follows the 3D down, once. */
export function updateQuality(game: Game): void {
    const renderer = game.app.renderer;
    if ((SetupThree.adaptive?.scale ?? 1) > UI_LOWERED.from || renderer.resolution <= UI_LOWERED.resolution) return;
    renderer.resolution = UI_LOWERED.resolution;
    renderer.resize(window.innerWidth, window.innerHeight);
}

/** A phone with a fast screen: held to about 60 frames a second (its battery and heat too). Measured on the screen itself. */
export function capFrames(game: Game): void {
    if (!QUALITY.low) return;
    const times: number[] = [];
    let last = 0;
    const frame = (now: number) => {
        if (last) times.push(now - last);
        last = now;
        if (times.length < REFRESH_FRAMES) {
            requestAnimationFrame(frame);
            return;
        }
        times.sort((a, b) => a - b);
        if (times[Math.floor(times.length * 0.3)] < FAST_SCREEN_MS) game.app.ticker.maxFPS = FRAME_CAP;
    };
    requestAnimationFrame(frame);
}

/** The debug panel's Device: the quality, a held resolution, and slowing this computer down to feel like a weak one. */
export function buildQualityPanel(): void {
    const panel = DebugOverlay.instance.panel('Device', { id: 'mow.device', persist: false });
    const state: { quality: Choice; resolution: number } = { quality: choice, resolution: 0 };
    panel.select(state, 'quality', { 'Auto (by device)': 'auto', 'LOW END (phone)': 'low', 'High (computer)': 'high' }, {
        label: 'Quality (reloads)',
        onChange: () => {
            const url = new URL(window.location.href);
            if (state.quality === 'auto') url.searchParams.delete(PARAM);
            else url.searchParams.set(PARAM, state.quality);
            window.location.href = url.toString();
        },
    });
    panel.select(state, 'resolution', { 'Auto': 0, ...Object.fromEntries(RESOLUTION_STEPS.map((share) => [`${Math.round(share * 100)}%`, share])) }, {
        label: 'Resolution',
        onChange: () => {
            if (SetupThree.adaptive) SetupThree.adaptive.forced = state.resolution;
        },
    });
    panel.slider(SLOW, 'cpuMs', 0, 60, 1, 'Slow Processor (ms a frame)');
    panel.slider(SetupThree, 'testDraws', 1, 12, 1, 'Slow Graphics (draws x)');
    panel.monitor('Quality', () => (QUALITY.low ? 'low' : 'high'));
    panel.monitor('FPS', () => Math.round(Game.APP?.ticker.FPS ?? 0));
    panel.monitor('Resolution', () => `${Math.round((SetupThree.adaptive?.scale ?? 1) * 100)}% (${canvasSize()})`);
    panel.monitor('Draw Calls', () => SetupThree.renderer?.info.render.calls ?? 0);
    panel.monitor('Triangles', () => (SetupThree.renderer?.info.render.triangles ?? 0).toLocaleString('en-US'));
}

const SLOW = { cpuMs: 0 };
const size = new THREE.Vector2();

function canvasSize(): string {
    if (!SetupThree.renderer) return '-';
    SetupThree.renderer.getDrawingBufferSize(size);
    return `${size.x}x${size.y}`;
}

/** The debug panel's slow processor: burns that long. */
export function burnDebugTime(): void {
    if (SLOW.cpuMs <= 0) return;
    const until = performance.now() + SLOW.cpuMs;
    while (performance.now() < until) { /* burning */ }
}
