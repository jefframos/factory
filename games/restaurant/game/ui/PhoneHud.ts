// PhoneHud.ts
//
// The phone orders minigame's HUD (scenes/PhoneScene.ts): the call's bubble at the top once the phone's picked up (the
// pizza asked for: its picture, its toppings in words); the boxes to fill (one box picture per pizza, ticked when it's
// boxed); a hint; the tutorial hand (on the ringing phone, the baked pizza); TRASH; the cooking ring over the oven; the
// end card (DELIVER!).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import type { PizzaTopping } from '../data/Recipes';
import { WARM, framePlane, glossyButton, iconSprite, label, popupPanel, tappable } from './UiParts';
import { modelIcon, pizzaIcon } from './Icons';

/** The call's bubble: its size, how far down from the top; the pizza picture in it. The boxes row under it. */
const CALL = { width: 340, height: 170, top: 24, pizza: 110 };
/** The boxes' tray: each box's slot (its size, the gap), how far down; the tray round them (padding, colours). */
const BOXES = { size: 74, gap: 14, top: 18, slot: 92, pad: 14, slotColor: 0xefe3cf, emptyTint: 0x9a8f80 };
const NAMES: Record<string, string> = { pepperoni: 'Pepperoni', ham: 'Ham', mushroom: 'Mushroom', onion: 'Onion', tomato: 'Tomato', pickles: 'Pickles', broccoli: 'Broccoli', pineapple: 'Pineapple', fish: 'Fish' };

type Point = { x: number; y: number };

export class PhoneHud extends PIXI.Container {
    private readonly call = new PIXI.Container();
    private readonly picture = new PIXI.Container();
    private readonly title = label(24);
    private readonly words = label(24);
    private readonly boxes = new PIXI.Container();
    private readonly boxIcons: PIXI.Sprite[] = [];
    private readonly ticks: PIXI.Sprite[] = [];
    private readonly hint = label(30);
    private readonly trashButton = glossyButton(170, 76, 'TRASH', 'Button01_l_Gray');
    private readonly ring = new PIXI.Graphics();
    private readonly hand = iconSprite('tutorial_hand_3', 110);
    private card: PIXI.Container | null = null;

    public constructor(count: number, onTrash: () => void) {
        super();
        // The call: a speech bubble with a little phone in its corner.
        const back = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(-CALL.width / 2, 0, CALL.width, CALL.height, 28).endFill()
            .beginFill(0xffffff).drawPolygon([-30, CALL.height - 2, 10, CALL.height - 2, -40, CALL.height + 34]).endFill();
        back.alpha = 0.95;
        const badge = new PIXI.Graphics().beginFill(0x4cb860).drawCircle(0, 0, 26).endFill().lineStyle(5, 0xffffff).arc(0, 2, 12, Math.PI * 0.15, Math.PI * 0.85);
        badge.position.set(-CALL.width / 2 + 34, 34);
        this.title.position.set(30, 32);
        this.picture.position.set(-CALL.width / 2 + 90, 108);
        this.words.anchor.set(0, 0.5);
        this.words.position.set(-10, 108);
        this.call.addChild(back, badge, this.title, this.picture, this.words);
        this.call.visible = false;

        // The tray (a white card, as the ticket's) with a slot per pizza; a tick on each box filled.
        const trayWidth = count * BOXES.slot + (count - 1) * BOXES.gap + BOXES.pad * 2;
        const tray = framePlane('BasicFrame_Round20', trayWidth, BOXES.slot + BOXES.pad * 2);
        tray.position.set(-trayWidth / 2, -BOXES.slot / 2 - BOXES.pad);
        this.boxes.addChild(tray);
        for (let i = 0; i < count; i++) {
            const x = (i - (count - 1) / 2) * (BOXES.slot + BOXES.gap);
            // Its slot in the tray; the box greyed till it's filled.
            const slot = new PIXI.Graphics().beginFill(BOXES.slotColor).drawRoundedRect(x - BOXES.slot / 2, -BOXES.slot / 2, BOXES.slot, BOXES.slot, 18).endFill();
            this.boxes.addChild(slot);
            const box = modelIcon('pizzabox_closed', BOXES.size);
            box.x = x;
            box.tint = BOXES.emptyTint;
            box.alpha = 0.55;
            const tick = iconSprite('Icon_Check03_l', 40);
            tick.position.set(box.x + 22, 18);
            tick.visible = false;
            this.boxes.addChild(box, tick);
            this.boxIcons.push(box);
            this.ticks.push(tick);
        }
        tappable(this.trashButton, onTrash);
        this.trashButton.visible = false;
        this.hint.alpha = 0;
        this.hand.visible = false;
        // (The boxes are counted by the restaurant HUD's pips now, as the day's customers are: the tray's kept hidden.)
        this.boxes.visible = false;
        this.addChild(this.ring, this.boxes, this.call, this.hint, this.trashButton, this.hand);
        this.reposition();
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const top = screen.topLeft.y;
        this.call.position.set(screen.center.x, top + CALL.top);
        this.boxes.position.set(screen.center.x, top + BOXES.top + BOXES.slot / 2);
        this.hint.position.set(screen.center.x, top + screen.height - 150);
        this.trashButton.position.set(screen.topLeft.x + 110, top + screen.height - 70);
        if (this.card) this.card.position.set(screen.center.x, screen.center.y);
    }

    /** The call: the pizza they want (shown till the next call; null: none). */
    public showOrder(toppings: readonly PizzaTopping[] | null, number = 1, of = 1): void {
        if (!toppings) {
            this.call.visible = false;
            return;
        }
        this.picture.removeChildren().forEach((child) => child.destroy());
        this.picture.addChild(pizzaIcon(toppings, CALL.pizza));
        this.title.text = `ORDER ${number}/${of}`;
        this.words.text = toppings.length ? `Pizza with\n${toppings.map((t) => NAMES[t] ?? t).join('\n')}` : 'Cheese\npizza';
        this.words.scale.set(1);
        this.words.scale.set(Math.min(1, 160 / Math.max(1, this.words.width)));
        this.call.visible = true;
        this.trashButton.visible = true;
        gsap.fromTo(this.call.scale, { x: 0.4, y: 0.4 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2.5)' });
    }

    /** Box `index` filled: lit, ticked. */
    public boxFilled(index: number): void {
        const box = this.boxIcons[index];
        const tick = this.ticks[index];
        if (box) {
            box.alpha = 1;
            box.tint = 0xffffff;
            const s = box.scale.x;
            gsap.fromTo(box.scale, { x: s * 1.3, y: s * 1.3 }, { x: s, y: s, duration: 0.35, ease: 'back.out(3)' });
        }
        if (tick) {
            tick.visible = true;
            gsap.from(tick.scale, { x: 0.1, y: 0.1, duration: 0.3, ease: 'back.out(3)' });
        }
    }

    /** A word (null: none); `seconds`: for that long (0: till the next). */
    public showHint(text: string | null, seconds = 2): void {
        gsap.killTweensOf(this.hint);
        if (!text) {
            this.hint.alpha = 0;
            return;
        }
        this.hint.text = text;
        this.hint.alpha = 1;
        if (seconds > 0) gsap.to(this.hint, { alpha: 0, duration: 0.4, delay: seconds });
    }

    /** The hand pointing up at `at` (screen; null: hidden), bobbing. */
    public pointAt(at: Point | null): void {
        this.hand.visible = Boolean(at);
        if (!at) return;
        const local = this.toLocal(new PIXI.Point(at.x, at.y));
        const bob = (Math.sin(performance.now() / 140) * 0.5 + 0.5) * 18;
        this.hand.position.set(local.x + 30, local.y + 50 + bob);
    }

    /** The oven's ring (0..1 of the bake, at `at` on screen; null: hidden). */
    public setCooking(progress: number | null, at: Point | null): void {
        this.ring.clear();
        if (progress === null || !at) return;
        const local = this.toLocal(new PIXI.Point(at.x, at.y));
        this.ring.lineStyle(10, 0x000000, 0.35).drawCircle(local.x, local.y - 70, 30);
        this.ring.lineStyle(10, 0xffb43a).arc(local.x, local.y - 70, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    }

    /** All boxed and out of the window: the card, then on (`onContinue`). */
    public showDone(count: number, onContinue: () => void): void {
        this.trashButton.visible = false;
        this.call.visible = false;
        this.hand.visible = false;
        const card = new PIXI.Container();
        const shade = new PIXI.Graphics().beginFill(0x000000, 0.5).drawRect(-3000, -3000, 6000, 6000).endFill();
        shade.eventMode = 'static';
        const back = popupPanel(560, 480, 'ALL BOXED!');
        const stack = modelIcon('pizzabox_stacked', 170);
        stack.y = -30;
        const words = label(30, WARM.cream);
        words.text = `${count} pizzas ready to deliver`;
        words.y = 80;
        const button = glossyButton(320, 92, 'DELIVER!', 'Button01_l_Green');
        button.y = 170;
        tappable(button, () => {
            gsap.to(card, { alpha: 0, duration: 0.2, onComplete: () => { card.destroy({ children: true }); this.card = null; onContinue(); } });
        });
        card.addChild(shade, back, stack, words, button);
        this.card = card;
        this.addChild(card);
        this.reposition();
        gsap.from(card.scale, { x: 0.4, y: 0.4, duration: 0.4, ease: 'back.out(2)' });
    }

    public override destroy(): void {
        gsap.killTweensOf([this.hint, this.call.scale]);
        super.destroy({ children: true });
    }
}
