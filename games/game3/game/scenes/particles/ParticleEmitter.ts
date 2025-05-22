import * as PIXI from 'pixi.js';
import { ColorUtils } from './ColorUtils';
import { Particle } from './Particle';
import { ParticleDescriptor } from './ParticleDescriptor';

export class ParticleEmitter extends PIXI.Container {

    public static getDefaultDescriptor(): ParticleDescriptor {
        return {
            texture: PIXI.Texture.WHITE,
            blendMode: PIXI.BLEND_MODES.ADD,
            anchor: { x: 0.5, y: 0.5 },
            spawnShape: { type: 'point' },
            scaleStartRange: [0.3, 0.6],
            alphaTransition: 0.05,
            maxLifeRange: [0.8, 1.5],
            speedRange: [1, 2],
            angleRange: [0, 360],
        };
    }
    private descriptor: ParticleDescriptor;
    private particleCount: number;
    private pool: Particle[] = [];

    private emitDelay: number;
    private emitTimer = 0;

    constructor(descriptor?: Partial<ParticleDescriptor>, maxParticles = 10, emitDelay = 100) {
        super();
        this.descriptor = Object.assign(
            ParticleEmitter.getDefaultDescriptor(),
            descriptor ?? {}
        );
        this.particleCount = maxParticles;
        this.emitDelay = emitDelay;
        this.prewarm();
    }

    private prewarm() {
        for (let i = 0; i < this.particleCount; i++) {
            const p = new Particle(this.descriptor.texture);
            p.anchor.set(this.descriptor.anchor?.x ?? 0.5, this.descriptor.anchor?.y ?? 0.5);
            p.blendMode = this.descriptor.blendMode ?? PIXI.BLEND_MODES.ADD;
            p.visible = false;
            this.pool.push(p);
            this.addChild(p);
        }
    }

    public update(delta: number) {
        this.emitTimer += delta;

        for (const p of this.pool) {
            if (p.visible) p.update(delta);
        }

        if (this.emitTimer >= this.emitDelay) {
            this.emitTimer = 0;
            this.emitParticle();
        }
    }

    private emitParticle() {
        const particle = this.pool.find(p => !p.visible);
        if (!particle) return;

        const d = this.descriptor;

        // position based on spawn shape
        //this could be static function
        let spawnX = 0;
        let spawnY = 0;
        if (d.spawnShape.type === 'point') {
            spawnX = 0;
            spawnY = 0;
        } else if (d.spawnShape.type === 'rect') {
            spawnX = Math.random() * d.spawnShape.width - d.spawnShape.width / 2;
            spawnY = Math.random() * d.spawnShape.height - d.spawnShape.height / 2;
        } else if (d.spawnShape.type === 'circle') {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * d.spawnShape.radius;
            spawnX = Math.cos(a) * r;
            spawnY = Math.sin(a) * r;
        }

        //ngle and speed
        const angleDeg = this.randInRange(d.angleRange);
        const angleRad = angleDeg * (Math.PI / 180);
        const speed = this.randInRange(d.speedRange);
        const velocity = new PIXI.Point(Math.cos(angleRad) * speed, Math.sin(angleRad) * speed);

        const maxLife = this.randInRange(d.maxLifeRange);
        const scaleStart = this.randInRange(d.scaleStartRange);

        particle.scale.set(scaleStart);

        const rawAlphaCurve = d.alphaCurve ?? [
            { time: 0, value: [0.8, 1] },
            { time: 1, value: [0, 0.2] }
        ];

        const alphaCurve = rawAlphaCurve.map(k => ({
            time: k.time,
            value: this.randInRange(k.value)
        }));
        particle.alpha = alphaCurve[0].value;


        const rawScaleCurve = d.scaleCurve ?? [
            { time: 0, value: [1] },
            { time: 1, value: [1] }
        ];
        const scaleCurve = rawScaleCurve.map(k => ({
            time: k.time,
            value: this.randInRange(k.value)
        }));

        particle.scale.set(scaleCurve[0].value)
        particle.alpha = alphaCurve[0].value;

        const rawGradient = d.gradientCurve ?? [
            { time: 0, value: [0xFFFFFF] },
            { time: 1, value: [0xFFFFFF] }
        ];

        const colorCurve = rawGradient.map(k => ({
            time: k.time,
            value: k.value.length === 1 ? k.value[0] : ColorUtils.randomColorBetween(k.value[0], k.value[1])
        }));

        particle.reset(spawnX, spawnY, {
            velocity,
            maxLife,
            alphaCurve,
            colorCurve,
            scaleCurve
        });
    }

    private randInRange(range: [number] | [number, number]): number {
        if (range.length === 1) return range[0];
        const [min, max] = range;
        return min + Math.random() * (max - min);
    }
}
