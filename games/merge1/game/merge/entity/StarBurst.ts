// particles/StarBurst.ts
import * as PIXI from "pixi.js";

export class StarBurst extends PIXI.ParticleContainer {
    private particles: { sprite: PIXI.Sprite, vx: number, vy: number, friction: number, va: number }[] = [];
    private isActive: boolean = false;

    constructor(texture: PIXI.Texture, count: number = 20) {
        super(count, { scale: true, position: true, rotation: true, alpha: true });
        for (let i = 0; i < count; i++) {
            const p = new PIXI.Sprite(texture);
            p.anchor.set(0.5);
            this.particles.push({
                sprite: p,
                vx: 0, vy: 0,
                friction: 0.93, // Slows them down for the "smoke" effect
                va: (Math.random() - 0.5) * 0.2
            });
            this.addChild(p);
        }
        this.visible = false;
    }

    public burst(): void {
        this.isActive = true;
        this.visible = true;
        this.particles.forEach(p => {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 15 + 10;
            p.sprite.position.set(0, 0);
            p.sprite.alpha = 1;
            p.sprite.scale.set(Math.random() * 0.5 + 0.5);
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed;
        });
    }

    public update(delta: number): void {
        if (!this.isActive) return;
        let anyVisible = false;
        this.particles.forEach(p => {
            p.sprite.x += p.vx * delta;
            p.sprite.y += p.vy * delta;
            p.vx *= p.friction; // Applying friction
            p.vy *= p.friction;
            p.sprite.rotation += p.va * delta;
            p.sprite.alpha -= 0.015 * delta;
            if (p.sprite.alpha > 0) anyVisible = true;
        });
        if (!anyVisible) {
            this.isActive = false;
            this.visible = false;
        }
    }
}