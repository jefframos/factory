// SpatialAudio.ts
//
// Sounds placed in the world, heard from where the player stands: each emitter is a gain (its loudness by distance)
// into a Web Audio PannerNode (only the direction: left / right of the screen), through Howler's master gain, so mute,
// the platform's mute and MowAudio's pause silence it like every other sound. The listener is the player facing up the
// screen (the camera's forward on the ground), so a car on the right of the screen is heard on the right.
//
//  - Sound zones (levels/town.json `sounds`, boxes edited in the editor's town: the sea on every side of the island):
//    a loop at full `volume` inside its box, fading out `fade` units from it, heard from the box's nearest point.
//    Zones with the same sound share one loop (the loudest wins).
//  - The cars (`soundSettings.cars`): each car near enough runs its own engine (EngineSound's `car` voice) at its
//    position, rising with its speed; it starts as it comes in range and lets go once it's gone.

import { Howler } from 'howler';
import { SoundSettings, SoundZone, TOWN } from '../data/MowConfig';
import { EngineSound } from './EngineSound';
import { MowAudio } from './MowAudio';

const DEFAULT_SETTINGS: SoundSettings = { cars: { volume: 0.35, near: 3, far: 14 } };
/** Car voices stop this far past `far` (no flapping at the edge). */
const CAR_RELEASE = 3;

/** The loops the zones play (MowAudio leaves these to SpatialAudio). */
export const zoneSounds = (): Set<string> => new Set((TOWN.sounds ?? []).map((zone) => zone.sound));

/** 1 at `near`, 0 from `far`, eased between. */
function proximity(distance: number, near: number, far: number): number {
    const t = Math.min(1, Math.max(0, (far - distance) / Math.max(1e-3, far - near)));
    return t * t * (3 - 2 * t);
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

/** Sets an AudioParam smoothly, or calls `fallback` where the browser has no such param (old Safari). */
function setParam(param: AudioParam | undefined, value: number, time: number, fallback?: () => void): void {
    if (param) param.setTargetAtTime(value, time, 0.05);
    else fallback?.();
}

interface Loop {
    zones: SoundZone[];
    emitter: Emitter;
    source?: AudioBufferSourceNode;
}

export class SpatialAudio {
    private readonly ctx?: BaseAudioContext;
    private readonly master?: AudioNode;
    private readonly settings: SoundSettings = { ...DEFAULT_SETTINGS, ...TOWN.soundSettings };
    private readonly loops: Loop[] = [];
    private readonly cars = new Map<number, { emitter: Emitter; engine: EngineSound }>();
    private destroyed = false;

    public constructor() {
        this.ctx = Howler.ctx as BaseAudioContext | undefined;
        this.master = (Howler as unknown as { masterGain?: AudioNode }).masterGain;
        if (!this.ctx || !this.master) return;
        for (const sound of zoneSounds()) {
            const loop: Loop = { zones: (TOWN.sounds ?? []).filter((zone) => zone.sound === sound), emitter: new Emitter(this.ctx, this.master) };
            this.loops.push(loop);
            void this.load(loop, sound);
        }
    }

    private async load(loop: Loop, sound: string): Promise<void> {
        try {
            const response = await fetch(MowAudio.url(`${sound}.mp3`));
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

    /** Each frame: the listener at (x, z) facing (forwardX, forwardZ) (the screen's up, on the ground), and the cars (Traffic.carSounds()). */
    public update(x: number, z: number, forwardX: number, forwardZ: number,
        cars: readonly { id: number; x: number; z: number; speed: number }[], delta: number): void {
        const ctx = this.ctx;
        if (!ctx || this.destroyed) return;
        const listener = ctx.listener;
        const t = ctx.currentTime;
        setParam(listener.positionX, x, t, () => listener.setPosition(x, 0, z));
        setParam(listener.positionY, 0, t);
        setParam(listener.positionZ, z, t);
        setParam(listener.forwardX, forwardX, t, () => listener.setOrientation(forwardX, 0, forwardZ, 0, 1, 0));
        setParam(listener.forwardY, 0, t);
        setParam(listener.forwardZ, forwardZ, t);
        setParam(listener.upX, 0, t);
        setParam(listener.upY, 1, t);
        setParam(listener.upZ, 0, t);
        this.updateZones(x, z);
        this.updateCars(ctx, x, z, cars, delta);
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

    private updateCars(ctx: BaseAudioContext, x: number, z: number, cars: readonly { id: number; x: number; z: number; speed: number }[], delta: number): void {
        const { volume, near, far } = this.settings.cars;
        const seen = new Set<number>();
        for (const car of cars) {
            const d = Math.hypot(car.x - x, car.z - z);
            let voice = this.cars.get(car.id);
            if (!voice && d < far && volume > 0) {
                const emitter = new Emitter(ctx, this.master!);
                const engine = new EngineSound();
                engine.start('car', ctx, emitter.input);
                voice = { emitter, engine };
                this.cars.set(car.id, voice);
            }
            if (!voice || d > far + CAR_RELEASE) continue;
            seen.add(car.id);
            voice.emitter.place(car.x, car.z, volume * proximity(d, near, far));
            voice.engine.update(car.speed, delta);
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
