// Curtain.ts
//
// The transition between places (the restaurant, the supermarket): a warm curtain drops over the screen with where it's
// going written on it, the scene underneath is swapped, and it lifts again. Lives in the game's popup layer, so it stays
// over both scenes while they swap.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { WARM, iconSprite, label } from './UiParts';
import { RestaurantAudio } from '../audio/RestaurantAudio';

const SECONDS = { drop: 0.45, hold: 0.6, lift: 0.45 };

let busy = false;

/** Covers the screen (`title`, `subtitle`, a pack `icon`), calls `swap`, and uncovers it. */
export function curtain(game: Game, title: string, subtitle: string, icon: string, swap: () => void): void {
    if (busy) return;
    busy = true;
    const screen = Game.overlayScreenData;
    const holder = new PIXI.Container();
    const height = screen.height + 200;
    const cloth = new PIXI.Graphics().beginFill(WARM.tomato).drawRect(screen.topLeft.x - 400, 0, screen.width + 800, height).endFill();
    // A scalloped hem, like an awning.
    const hem = new PIXI.Graphics().beginFill(WARM.tomato);
    for (let x = screen.topLeft.x - 400; x < screen.topLeft.x + screen.width + 400; x += 80) hem.drawCircle(x + 40, height, 40);
    hem.endFill();
    const stripes = new PIXI.Graphics().beginFill(0xffffff, 0.12);
    for (let x = screen.topLeft.x - 400; x < screen.topLeft.x + screen.width + 400; x += 160) stripes.drawRect(x, 0, 80, height);
    stripes.endFill();
    const middle = screen.center.y - screen.topLeft.y + 100;
    const picture = iconSprite(icon, 170);
    picture.position.set(screen.center.x, middle - 130);
    const big = label(84);
    big.text = title;
    big.position.set(screen.center.x, middle + 10);
    const small = label(38, WARM.cream);
    small.text = subtitle;
    small.position.set(screen.center.x, middle + 90);
    holder.addChild(cloth, stripes, hem, picture, big, small);
    holder.eventMode = 'static';
    const top = screen.topLeft.y - 200;
    holder.y = top - height - 60;
    game.popupLayer.addChild(holder);
    RestaurantAudio.play('whoosh');
    gsap.timeline({
        onComplete: () => {
            holder.destroy({ children: true });
            busy = false;
        },
    })
        .to(holder, { y: top, duration: SECONDS.drop, ease: 'bounce.out' })
        .add(() => swap())
        .to({}, { duration: SECONDS.hold })
        .add(() => RestaurantAudio.play('whoosh', 1.2))
        .to(holder, { y: top - height - 60, duration: SECONDS.lift, ease: 'power2.in' });
}
