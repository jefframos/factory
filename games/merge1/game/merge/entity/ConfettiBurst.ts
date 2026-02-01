// particles/ConfettiBurst.ts
import * as PIXI from "pixi.js";

export class ConfettiBurst extends PIXI.ParticleContainer {
    private particles: { sprite: PIXI.Sprite, vx: number, vy: number, va: number }[] = [];
    private gravity: number = 0.8;
    private isActive: boolean = false;

    constructor(texture: PIXI.Texture, count: number = 30) {
        super(count, { scale: true, position: true, rotation: true, alpha: true });

        for (let i = 0; i < count; i++) {
            const p = new PIXI.Sprite(texture);
            p.anchor.set(0.5);
            p.tint = [0xFF595E, 0xFFCA3A, 0x8AC926, 0x1982C4, 0x6A4C93][Math.floor(Math.random() * 5)];

            this.particles.push({
                sprite: p,
                vx: (Math.random() - 0.5) * 12,
                vy: -(Math.random() * 15 + 10),
                va: (Math.random() - 0.5) * 0.3
            });
            this.addChild(p);
        }
        this.visible = false;
    }

    public burst(): void {
        this.isActive = true;
        this.visible = true;
        this.particles.forEach(p => {
            p.sprite.position.set(0, -20);
            p.sprite.alpha = 1;
            p.sprite.scale.set(Math.random() * 0.4 + 0.3);
            p.vy = -(Math.random() * 15 + 10); // Reset upward force
        });
    }

    public update(delta: number): void {
        if (!this.isActive) return;

        let anyVisible = false;
        this.particles.forEach(p => {
            p.sprite.x += p.vx * delta;
            p.sprite.y += p.vy * delta;
            p.vy += this.gravity * delta;
            p.sprite.rotation += p.va * delta;

            if (p.vy > 0) p.sprite.alpha -= 0.02 * delta;
            if (p.sprite.alpha > 0) anyVisible = true;
        });

        if (!anyVisible) {
            this.isActive = false;
            this.visible = false;
        }
    }
}