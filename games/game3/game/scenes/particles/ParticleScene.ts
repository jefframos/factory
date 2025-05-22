import { Game } from '@core/Game';
import * as PIXI from 'pixi.js';
import BaseDemoScene from "../BaseDemoScene";
import { ParticleDescriptor } from './ParticleDescriptor';
import { ParticleEmitter } from './ParticleEmitter';

export default class ParticleScene extends BaseDemoScene {
    private emitters: ParticleEmitter[] = [];

    constructor() {
        super();
    }

    public async build(): Promise<void> {
        this.destroyEmitters();

        const descriptor: ParticleDescriptor = {
            texture: PIXI.Texture.from('particle.png'),
            blendMode: PIXI.BLEND_MODES.OVERLAY,
            anchor: { x: 0.5, y: 0.5 },
            spawnShape: { type: 'circle', radius: 8 },
            scaleStartRange: [0.3, 0.6],
            alphaTransition: 0.05,
            maxLifeRange: [2, 2.5],
            speedRange: [20, 30],
            angleRange: [260, 280],
            alphaCurve: [
                { time: 0, value: [0] },
                { time: 0.1, value: [0.5] },
                { time: 0.5, value: [0.8, 1] },
                { time: 1, value: [0, 0] }
            ],
            scaleCurve: [
                { time: 0, value: [0.5] },
                { time: 0.75, value: [1.5, 1] },
                { time: 1, value: [0.5] }
            ],
            gradientCurve: [
                { time: 0, value: [0xffcc00, 0xffff00] },
                { time: 0.5, value: [0xff0000, 0x990000] },
                { time: 1, value: [0] }
            ]
        };

        // Create first emitter
        const emitter1 = new ParticleEmitter(descriptor, 10, 0.2);
        emitter1.scale.set(3);
        emitter1.position.set(Game.DESIGN_WIDTH / 2 - 100, Game.DESIGN_HEIGHT / 2);
        this.addChild(emitter1);
        this.emitters.push(emitter1);

        const desc1 = new PIXI.Text('10x', {
            fontFamily: 'LEMONMILK-Bold',
            fontSize: 24,
            fill: 0xffffff,
        });
        this.addChild(desc1);
        desc1.anchor.set(0.5)
        desc1.position.copyFrom(emitter1.position)


        // Create second emitter
        const emitter2 = new ParticleEmitter(descriptor, 50, 0.05);
        emitter2.scale.set(3);
        emitter2.position.set(Game.DESIGN_WIDTH / 2 + 100, Game.DESIGN_HEIGHT / 2 + 120);
        this.addChild(emitter2);
        this.emitters.push(emitter2);

        const desc2 = new PIXI.Text('50x', {
            fontFamily: 'LEMONMILK-Bold',
            fontSize: 24,
            fill: 0xffffff,
        });
        this.addChild(desc2);
        desc2.anchor.set(0.5)
        desc2.position.copyFrom(emitter2.position)



        // Create second emitter
        const emitter3 = new ParticleEmitter(descriptor, 120, 0.05);
        emitter3.scale.set(4);
        emitter3.position.set(Game.DESIGN_WIDTH / 2, Game.DESIGN_HEIGHT / 2 - 120);
        this.addChild(emitter3);
        this.emitters.push(emitter3);

        const desc3 = new PIXI.Text('120x', {
            fontFamily: 'LEMONMILK-Bold',
            fontSize: 24,
            fill: 0xffffff,
        });
        this.addChild(desc3);
        desc3.anchor.set(0.5)
        desc3.position.copyFrom(emitter3.position)
    }

    public destroy(): void {
        this.destroyEmitters();
        super.destroy();
    }

    private destroyEmitters(): void {
        for (const emitter of this.emitters) {
            emitter.removeFromParent();
            emitter.destroy({ children: true });
        }
        this.emitters.length = 0;
    }

    public update(delta: number): void {
        super.update(delta);
        for (const emitter of this.emitters) {
            emitter.update(delta);
        }
    }
}
