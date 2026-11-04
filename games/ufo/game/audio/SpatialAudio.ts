// SpatialAudio.ts
//
// Sounds placed in the world, heard from over the saucer (the mow game's, for one level at a time): each emitter is a
// gain (its loudness by distance) into a Web Audio PannerNode (only the direction: left or right of the screen), through
// Howler's master gain, so mute and pausing silence it like every other sound.
//
//  - Sound zones (a level's `sounds`, boxes edited in the editor's Town tab: the sea, the parks): a loop at full `volume`
//    inside its box, fading out `fade` units from it, heard from the box's nearest point. Zones with the same sound share
//    one loop (the loudest wins).
//  - The cars (a level's `soundSettings.cars`): each car near enough runs its own engine at its position, rising with its
//    speed; it starts as it comes in range and lets go once it's gone (or eaten).

import { Howler } from 'howler';
import { Level, SoundSettings, SoundZone } from '../data/UfoConfig';
import { CarEngine } from './CarEngine';
import { UfoAudio } from './UfoAudio';

const DEFAULT_CARS: SoundSettings['cars'] = { volume: 0.35, near: 3, far: 14 };
/** Car voices stop this far past `far` (no flapping at the edge). */
const CAR_RELEASE = 3;
/** The camera never turns: up the screen is always -Z, so a car on the right of the screen is heard on the right. */
const FORWARD = { x: 0, z: -1 };

export interface CarSound {
    id: number;
    x: number;
    z: number;
    /** 0..1 of its cruising speed. */
    speed: number;
}

/** 1 at `near`, 0 from `far`, eased between. */
function proximity(distance: number, near: number, far: number): number {
    const t = Math.min(1, Math.max(0, (far - distance) / Math.max(1e-3, far - near)));
    return t * t * (3 - 2 * t);
}

/** Sets an AudioParam smoothly, or calls `fallback` where the browser has no such param (old Safari). */
function setParam(param: AudioParam | undefined, value: number, time: number, fallback?: () => void): void {
    if (param) param.setTargetAtTime(value, time, 0.05);
    else fallback?.();
}

class Emitter {
    public readonly input: GainNode;
    private readonly panner: PannerNode;

    public constructor(private readonly ctx: BaseAudioContext, destination: AudioNode) {
        this.input = ctx.createGain();
        this.input.gain.value = 0;
        this.panner = ctx.createPanner();
        this.panner.panningModel = 'equalpower';
        // The loudness is the gain's; the panner only places it.
        this.panner.rolloffFactor = 0;
        this.input.connect(this.panner).connect(destination);
    }

    public place(x: number, z: number, level: number): void {
        const t = this.ctx.currentTime;
        setParam(this.panner.positionX, x, t, () => this.panner.setPosition(x, 0, z));
        setParam(this.panner.positionZ, z, t);
        this.input.gain.setTargetAtTime(level, t, 0.1);
    }

    public destroy(): void {
        this.input.disconnect();
        this.panner.disconnect();
    }
}

interface Loop {
    zones: SoundZone[];
    emitter: Emitter;
    source?: AudioBufferSourceNode;
}

export class SpatialAudio {
    private readonly ctx?: BaseAudioContext;
    private readonly master?: AudioNode;
    private readonly carSettings: SoundSettings['cars'];
    private readonly loops: Loop[] = [];
    private readonly cars = new Map<number, { emitter: Emitter; engine: CarEngine }>();
    private destroyed = false;

    public constructor(level: Level) {
        this.carSettings = level.soundSettings?.cars ?? DEFAULT_CARS;
        this.ctx = Howler.ctx as BaseAudioContext | undefined;
        this.master = (Howler as unknown as { masterGain?: AudioNode }).masterGain;
        if (!this.ctx || !this.master) return;
        const zones = level.sounds ?? [];
        for (const sound of new Set(zones.map((zone) => zone.sound))) {
            const loop: Loop = { zones: zones.filter((zone) => zone.sound === sound), emitter: new Emitter(this.ctx, this.master) };
            this.loops.push(loop);
            void this.load(loop, sound);
        }
    }

    private async load(loop: Loop, sound: string): Promise<void> {
        try {
            const response = await fetch(UfoAudio.url(`${sound}.mp3`));
            const buffer = await this.ctx!.decodeAudioData(await response.arrayBuffer());
            if (this.destroyed) return;
            const source = this.ctx!.createBufferSource();
            source.buffer = buffer;
            source.loop = true;
            source.connect(loop.emitter.input);
            source.start(0, Math.random() * buffer.duration);
            loop.source = source;
        } catch (error) {
            console.warn(`[SpatialAudio] could not load ${sound}`, error);
        }
    }

    /** Each frame: the listener at (x, z), and the cars. */
    public update(x: number, z: number, cars: readonly CarSound[]): void {
        const ctx = this.ctx;
        if (!ctx || this.destroyed) return;
        const listener = ctx.listener;
        const t = ctx.currentTime;
        setParam(listener.positionX, x, t, () => listener.setPosition(x, 0, z));
        setParam(listener.positionY, 0, t);
        setParam(listener.positionZ, z, t);
        setParam(listener.forwardX, FORWARD.x, t, () => listener.setOrientation(FORWARD.x, 0, FORWARD.z, 0, 1, 0));
        setParam(listener.forwardY, 0, t);
        setParam(listener.forwardZ, FORWARD.z, t);
        setParam(listener.upX, 0, t);
        setParam(listener.upY, 1, t);
        setParam(listener.upZ, 0, t);
        this.updateZones(x, z);
        this.updateCars(ctx, x, z, cars);
    }

    /** Each loop: its loudest zone sets the level, heard from that zone's nearest point. */
    private updateZones(x: number, z: number): void {
        for (const loop of this.loops) {
            let level = 0;
            let fromX = x;
            let fromZ = z;
            for (const zone of loop.zones) {
                const nearX = Math.min(zone.x + zone.width / 2, Math.max(zone.x - zone.width / 2, x));
                const nearZ = Math.min(zone.z + zone.depth / 2, Math.max(zone.z - zone.depth / 2, z));
                const zoneLevel = zone.volume * proximity(Math.hypot(nearX - x, nearZ - z), 0, zone.fade);
                if (zoneLevel <= level) continue;
                level = zoneLevel;
                fromX = nearX;
                fromZ = nearZ;
            }
            loop.emitter.place(fromX, fromZ, level);
        }
    }

    private updateCars(ctx: BaseAudioContext, x: number, z: number, cars: readonly CarSound[]): void {
        const { volume, near, far } = this.carSettings;
        const seen = new Set<number>();
        for (const car of cars) {
            const d = Math.hypot(car.x - x, car.z - z);
            let voice = this.cars.get(car.id);
            if (!voice && d < far && volume > 0) {
                const emitter = new Emitter(ctx, this.master!);
                voice = { emitter, engine: new CarEngine(ctx, emitter.input) };
                this.cars.set(car.id, voice);
            }
            if (!voice || d > far + CAR_RELEASE) continue;
            seen.add(car.id);
            voice.emitter.place(car.x, car.z, volume * proximity(d, near, far));
            voice.engine.update(car.speed);
        }
        for (const id of [...this.cars.keys()]) if (!seen.has(id)) this.release(id);
    }

    private release(id: number): void {
        const voice = this.cars.get(id);
        if (!voice) return;
        this.cars.delete(id);
        voice.engine.stop();
        window.setTimeout(() => voice.emitter.destroy(), 600);
    }

    public destroy(): void {
        this.destroyed = true;
        for (const id of [...this.cars.keys()]) this.release(id);
        for (const loop of this.loops) {
            loop.emitter.input.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.1);
            window.setTimeout(() => {
                loop.source?.stop();
                loop.emitter.destroy();
            }, 500);
        }
        this.loops.length = 0;
    }
}
