import * as PIXI from 'pixi.js';

interface ConfettiParticle {
    sprite: PIXI.Sprite;
    velX: number;
    velY: number;
    rotSpeed: number;
    oscStep: number;
    oscSpeed: number;
}

export class ConfettiEffect extends PIXI.Container {
    private particles: ConfettiParticle[] = [];
    private container: PIXI.ParticleContainer;
    private colors: number[] = [0xff595e, 0xffca3a, 0x8ac926, 0x1982c4, 0x6a4c93, 0xff924c];
    private isRunning: boolean = false;

    constructor(count: number = 100) {
        super();

        // Optimized container for mass sprites
        this.container = new PIXI.ParticleContainer(count, {
            position: true,
            rotation: true,
            scale: true,
            alpha: true,
            tint: true, // Required in PIXI 7 to allow individual tints in ParticleContainer
        });
        this.addChild(this.container);

        for (let i = 0; i < count; i++) {
            const p = new PIXI.Sprite(PIXI.Texture.WHITE);

            p.anchor.set(0.5);
            // Random rectangular shapes
            p.width = Math.random() * 12 + 6;
            p.height = Math.random() * 8 + 4;

            // Assign random color from array
            p.tint = this.colors[Math.floor(Math.random() * this.colors.length)];

            this.container.addChild(p);
            p.alpha = 0;

            this.particles.push({
                sprite: p,
                velX: (Math.random() - 0.5) * 4,
                velY: Math.random() * 500 + 300,
                rotSpeed: (Math.random() - 0.5) * 0.2,
                oscStep: Math.random() * 100,
                oscSpeed: Math.random() * 0.5 + 0.2
            });
        }
    }

    public start(): void {
        const screenW = 1280; // Assuming design width
        this.particles.forEach(p => {
            // Randomize starting position above the view
            p.sprite.x = Math.random() * screenW - screenW / 2;
            p.sprite.y = -(Math.random() * 1200 + 100);
            p.sprite.alpha = 1;
            p.sprite.scale.y = 1; // Reset flip
        });
        this.isRunning = true;
        this.visible = true;
    }

    public update(delta: number): void {
        if (!this.isRunning) return;


        let allHidden = true;

        for (const p of this.particles) {
            // 1. Gravity & Movement
            p.sprite.y += p.velY * delta;
            p.sprite.x += p.velX + Math.cos(p.oscStep) * 2;

            // 2. Rotation & Flutter (flipping effect)
            p.sprite.rotation += p.rotSpeed * delta;
            p.oscStep += p.oscSpeed * delta;

            // This simulates the paper flipping as it falls
            p.sprite.scale.y = Math.sin(p.oscStep);

            // 3. Fade out
            if (p.sprite.y > 500) {
                p.sprite.alpha -= 0.01 * delta;
            }

            if (p.sprite.alpha > 0) allHidden = false;
        }

        if (allHidden) {
            this.isRunning = false;
            this.visible = false;
        }
    }
}