import * as PIXI from "pixi.js";

export class TextPopSystem extends PIXI.Container {
    private readonly pops: TextPop[] = [];

    public show(text: string, x: number, y: number): void {
        const pop = new TextPop(text);
        pop.position.set(x, y);

        this.pops.push(pop);
        this.addChild(pop);
    }

    public update(delta: number): void {
        for (let i = this.pops.length - 1; i >= 0; i--) {
            const pop = this.pops[i];

            pop.update(delta);

            if (pop.isFinished) {
                pop.destroy();
                this.pops.splice(i, 1);
            }
        }
    }
}

class TextPop extends PIXI.Text {
    private lifetime = 0;
    private readonly maxLifetime = 0.8;

    public get isFinished(): boolean {
        return this.lifetime >= this.maxLifetime;
    }

    public constructor(text: string) {
        super(text, new PIXI.TextStyle({
            fontFamily: "LEMONMILK-Bold",
            fontSize: 24,
            fill: 0xffcc00,
            stroke: "#0c0808",
            strokeThickness: 4,
        }));

        this.anchor.set(0.5);
    }

    public update(delta: number): void {
        this.lifetime += delta;

        this.y -= 55 * delta;
        this.alpha = Math.max(0, 1 - this.lifetime / this.maxLifetime);
    }
}
