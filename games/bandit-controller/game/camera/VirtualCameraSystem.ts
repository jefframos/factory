// VirtualCameraSystem.ts
//
// A small Cinemachine-style camera system: named "virtual cameras" (plain
// CameraSettings data — see GameSettings.ts) that the scene's real camera
// blends between instead of snapping. register() defines each one,
// cutTo()/blendTo() switch which is active, and update(delta) — call once
// per frame — advances any blend in progress. `current` always holds the
// live, fully-resolved settings the scene's actual camera should read from
// every frame (see WorldEnvironment.updateCamera() in
// game/scenes/shared/WorldEnvironment.ts); nothing else needs to know a
// blend is even happening.

import { CameraSettings } from '../data/GameSettings';

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/** Shortest-path angle interpolation — a naive lerp() would spin the long way around when e.g. blending from 170deg to -170deg (a 20deg turn) instead of the correct short hop. */
function lerpAngleDeg(a: number, b: number, t: number): number {
    const delta = (((b - a) % 360) + 540) % 360 - 180;
    return a + delta * t;
}

function cloneCameraSettings(settings: CameraSettings): CameraSettings {
    return { ...settings, offset: { ...settings.offset } };
}

function copyCameraSettings(out: CameraSettings, source: CameraSettings): void {
    out.yawDeg = source.yawDeg;
    out.pitchDeg = source.pitchDeg;
    out.distance = source.distance;
    out.followSpeed = source.followSpeed;
    out.offset.x = source.offset.x;
    out.offset.y = source.offset.y;
    out.offset.z = source.offset.z;
}

function lerpCameraSettingsInto(out: CameraSettings, from: CameraSettings, to: CameraSettings, t: number): void {
    out.yawDeg = lerpAngleDeg(from.yawDeg, to.yawDeg, t);
    out.pitchDeg = lerp(from.pitchDeg, to.pitchDeg, t);
    out.distance = lerp(from.distance, to.distance, t);
    out.followSpeed = lerp(from.followSpeed, to.followSpeed, t);
    out.offset.x = lerp(from.offset.x, to.offset.x, t);
    out.offset.y = lerp(from.offset.y, to.offset.y, t);
    out.offset.z = lerp(from.offset.z, to.offset.z, t);
}

export default class VirtualCameraSystem {
    /** Live, continuously-updated settings — read this every frame from the scene's actual camera (see WorldEnvironment.updateCamera()). A private clone, never one of the registered CameraSettings objects themselves, so blending never mutates a preset's own data. */
    public readonly current: CameraSettings;

    private readonly cameras = new Map<string, CameraSettings>();
    private activeId?: string;

    /** Blend in progress, if any — cleared once elapsed reaches duration. */
    private blendToId?: string;
    private readonly blendFrom: CameraSettings = cloneCameraSettings({ yawDeg: 0, pitchDeg: 0, distance: 1, followSpeed: 1, offset: { x: 0, y: 0, z: 0 } });
    private blendDuration = 0;
    private blendElapsed = 0;

    /** `initial` becomes `current`'s starting value — typically the "standard" mode (see GameSettings.ts) — before any register()/cutTo() call. */
    public constructor(initial: CameraSettings) {
        this.current = cloneCameraSettings(initial);
    }

    /** Defines (or redefines) a named virtual camera. Registering over the currently active or mid-blend id does NOT retroactively change `current` — only a later cutTo()/blendTo() call picks up the new values. */
    public register(id: string, settings: CameraSettings): void {
        this.cameras.set(id, settings);
    }

    public has(id: string): boolean {
        return this.cameras.has(id);
    }

    /** The virtual camera `current` was last cut/blended to reach — undefined if a blend is still in flight (use getBlendTargetId() for that) or nothing has been activated yet. */
    public getActiveId(): string | undefined {
        return this.activeId;
    }

    /** The virtual camera a blend is currently heading toward, if any. */
    public getBlendTargetId(): string | undefined {
        return this.blendToId;
    }

    public isBlending(): boolean {
        return this.blendToId !== undefined;
    }

    /** Instantly snaps `current` to `id`'s settings, cancelling any blend in progress. No-op (with a console warning) if `id` was never register()ed. */
    public cutTo(id: string): void {
        const target = this.cameras.get(id);
        if (!target) {
            console.warn(`VirtualCameraSystem: cutTo("${id}") — no virtual camera registered with that id`);
            return;
        }

        copyCameraSettings(this.current, target);
        this.activeId = id;
        this.blendToId = undefined;
    }

    /**
     * Starts blending `current` from wherever it is RIGHT NOW toward `id`'s
     * settings over `durationSec` — call update(delta) every frame to
     * advance it. Retargeting mid-blend blends from the current
     * (already-partway) state, not a jump back to whatever the previous
     * blend's start was — so rapid switches never pop.
     */
    public blendTo(id: string, durationSec: number): void {
        const target = this.cameras.get(id);
        if (!target) {
            console.warn(`VirtualCameraSystem: blendTo("${id}") — no virtual camera registered with that id`);
            return;
        }

        if (durationSec <= 0) {
            this.cutTo(id);
            return;
        }

        copyCameraSettings(this.blendFrom, this.current);
        this.blendToId = id;
        this.blendDuration = durationSec;
        this.blendElapsed = 0;
    }

    /** Advances any blend in progress — no-op if `current` is already settled on its active virtual camera. */
    public update(delta: number): void {
        if (!this.blendToId) {
            return;
        }

        this.blendElapsed += delta;
        const t = Math.min(1, this.blendElapsed / this.blendDuration);
        const target = this.cameras.get(this.blendToId)!;
        lerpCameraSettingsInto(this.current, this.blendFrom, target, t);

        if (t >= 1) {
            this.activeId = this.blendToId;
            this.blendToId = undefined;
        }
    }
}
