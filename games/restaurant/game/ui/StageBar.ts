// StageBar.ts
//
// The restaurant's upgrade bar: the stage's name over a bar of coins (how many of its goal), a coin at its start. Coins
// fill it; full, the restaurant's upgraded to the next stage (the bar empties for that one). Drawn at any width: small at
// the top of the restaurant, big on the day's card.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { framePlane, iconSprite, label } from './UiParts';
import { isLastStage, stageSettings } from '../data/Settings';

export class StageBar extends PIXI.Container {
    private readonly fill = new PIXI.Graphics();
    private readonly title: PIXI.Text;
    private readonly amount: PIXI.Text;
    private readonly inner: number;
    private stage = 0;
    private shown = 0;

    public constructor(private readonly barWidth: number, private readonly barHeight: number) {
        super();
        const back = framePlane('ResourceBar_Single_Bg', barWidth, barHeight);
        back.tint = 0x3a2416;
        back.position.set(-barWidth / 2, -barHeight / 2);
        this.inner = barWidth - 10;
        this.title = label(Math.round(barHeight * 0.75));
        this.title.y = -barHeight / 2 - barHeight * 0.45;
        this.amount = label(Math.round(barHeight * 0.62));
        const coin = iconSprite('Icon_Coin', barHeight * 1.5);
        coin.x = -barWidth / 2;
        this.addChild(back, this.fill, this.amount, this.title, coin);
    }

    /** The bar at `progress` coins of stage `stage`. */
    public set(stage: number, progress: number): void {
        this.stage = stage;
        this.title.text = stageSettings(stage).name.toUpperCase();
        this.draw(progress);
    }

    /** Filled to `progress` over `seconds` (same stage). */
    public fillTo(progress: number, seconds = 0.5): Promise<void> {
        const state = { value: this.shown };
        return new Promise((resolve) => {
            gsap.to(state, { value: progress, duration: seconds, ease: 'power1.out', onUpdate: () => this.draw(state.value), onComplete: () => resolve() });
        });
    }

    private draw(progress: number): void {
        this.shown = progress;
        const goal = stageSettings(this.stage).goal;
        const share = Math.max(0, Math.min(1, progress / goal));
        const height = this.barHeight - 10;
        this.fill.clear();
        if (share > 0) this.fill.beginFill(0xffc93c).drawRoundedRect(-this.inner / 2, -height / 2, Math.max(height, this.inner * share), height, height / 2).endFill();
        this.amount.text = isLastStage(this.stage) && progress >= goal ? 'MAX' : `${Math.floor(progress)}/${goal}`;
    }
}
