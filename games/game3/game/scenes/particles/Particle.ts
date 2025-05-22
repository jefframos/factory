import * as PIXI from 'pixi.js';
import { ColorUtils } from './ColorUtils';
import { CurveKeyframe } from './ParticleDescriptor';


export class Particle extends PIXI.Sprite {
    public life = 0;
    public maxLife = 1;
    public velocity = new PIXI.Point();

    private alphaCurve: CurveKeyframe[] = [];
    private colorCurve: CurveKeyframe[] = [];
    private scaleCurve: CurveKeyframe[] = [];
    public reset(
        x: number,
        y: number,
        config: {
            velocity: PIXI.IPointData;
            maxLife: number;
            alphaCurve: CurveKeyframe[];
            colorCurve: CurveKeyframe[];
            scaleCurve: CurveKeyframe[];
        }
    ) {
        this.position.set(x, y);
        this.velocity.copyFrom(config.velocity);
        this.maxLife = config.maxLife;
        this.life = 0;

        this.scale.set(1);
        this.alphaCurve = config.alphaCurve;
        this.colorCurve = config.colorCurve;
        this.scaleCurve = config.scaleCurve;

        this.alpha = this.alphaCurve.length > 0 ? this.alphaCurve[0].value : 1;
        this.visible = true;
    }

    public update(delta: number) {
        if (!this.visible) return;

        this.life += delta;
        const t = this.life / this.maxLife;

        // Interpolate alpha from curve
        if (this.alphaCurve.length > 1) {
            for (let i = 0; i < this.alphaCurve.length - 1; i++) {
                const a = this.alphaCurve[i];
                const b = this.alphaCurve[i + 1];

                if (t >= a.time && t <= b.time) {
                    const localT = (t - a.time) / (b.time - a.time);
                    this.alpha = a.value + (b.value - a.value) * localT;
                    break;
                }
            }
        }
        if (this.scaleCurve.length > 1) {
            for (let i = 0; i < this.scaleCurve.length - 1; i++) {
                const a = this.scaleCurve[i];
                const b = this.scaleCurve[i + 1];

                if (t >= a.time && t <= b.time) {
                    const localT = (t - a.time) / (b.time - a.time);
                    this.scale.set(a.value + (b.value - a.value) * localT);
                    break;
                }
            }
        }

        this.x += this.velocity.x * delta;
        this.y += this.velocity.y * delta;

        if (this.colorCurve.length > 1) {
            for (let i = 0; i < this.colorCurve.length - 1; i++) {
                const a = this.colorCurve[i];
                const b = this.colorCurve[i + 1];

                if (t >= a.time && t <= b.time) {
                    const localT = (t - a.time) / (b.time - a.time);
                    this.tint = ColorUtils.lerpColor(a.value, b.value, localT);

                    break;
                }
            }
        }

        if (this.life > this.maxLife || this.alpha <= 0) {
            this.visible = false;
        }
    }
}

