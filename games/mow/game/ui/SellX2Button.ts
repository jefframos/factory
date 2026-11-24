// SellX2Button.ts
//
// The dig game's phone, in the mow game: a pile of cash on its own (no button shape), "SELL x2" under it, the video
// badge on its corner (or, while sales are free, a FREE tag and the pointing hand on the first), a slow rotating shine
// behind it and a gentle pulse. It shows while the bag's full (the scene says when: setShown()); tapping it asks the
// scene to sell the whole bag right there at double (after a rewarded video, once the free ones are used).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { MowAudio } from '../audio/MowAudio';

const SIZE = { width: 112, height: 116, shine: 180 };
/** Drawn this much bigger than that. */
const SCALE = 1.4;

export class SellX2Button extends PIXI.Container {
    private readonly body = new PIXI.Container();
    private readonly video: PIXI.Sprite;
    private readonly freeTag: PIXI.Container;
    private readonly hand: PIXI.Container;
    private shown = false;

    public constructor(private readonly onTap: () => void) {
        super();
        const shine = PIXI.Sprite.from('Image_Effect_Rotate');
        shine.anchor.set(0.5);
        shine.scale.set(SIZE.shine / Math.max(shine.texture.width, shine.texture.height, 1));
        shine.tint = 0xfff2a0;
        shine.alpha = 0.8;
        shine.eventMode = 'none';
        gsap.to(shine, { rotation: Math.PI * 2, duration: 6, ease: 'none', repeat: -1 });
        // A pile of cash: bundles at the back first, the biggest on top.
        const picto = new PIXI.Container();
        picto.y = -14;
        for (const spec of [
            { x: -22, y: 8, size: 62, rotation: -0.35 },
            { x: 22, y: 8, size: 62, rotation: 0.3 },
            { x: 0, y: -12, size: 62, rotation: 0.12 },
            { x: 0, y: 12, size: 86, rotation: -0.05 },
        ]) {
            const bundle = PIXI.Sprite.from('ItemIcon_Money_Bill');
            bundle.anchor.set(0.5);
            bundle.scale.set(spec.size / Math.max(bundle.texture.width, bundle.texture.height, 1));
            bundle.position.set(spec.x, spec.y);
            bundle.rotation = spec.rotation;
            picto.addChild(bundle);
        }
        const label = new PIXI.Text('SELL x2', new PIXI.TextStyle({
            fontFamily: UiKit.fontFamily('primary'), fontSize: 24, fill: 0x9cff9c, stroke: 0x1d140e, strokeThickness: 6, lineJoin: 'round',
        }));
        // (Sharp at its scale.)
        label.resolution = 2 * SCALE;
        label.anchor.set(0.5);
        label.y = SIZE.height / 2 - 12;
        this.video = PIXI.Sprite.from('ItemIcon_Video');
        this.video.anchor.set(0.5);
        this.video.scale.set(40 / Math.max(this.video.texture.width, this.video.texture.height, 1));
        this.video.position.set(SIZE.width / 2 - 10, -SIZE.height / 2 + 14);
        this.freeTag = SellX2Button.tag('FREE', SIZE.width / 2 - 14, -SIZE.height / 2 + 12);
        this.hand = SellX2Button.pointingHand(-6, -20);
        this.body.addChild(picto, label, this.video, this.freeTag);
        UiAnim.pulse(this.body, 0.06, 0.55);
        this.addChild(shine, this.body, this.hand);
        this.visible = false;
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.hitArea = new PIXI.Rectangle(-SIZE.width / 2, -SIZE.height / 2, SIZE.width, SIZE.height);
        // Taps on HUD buttons must not also start the movement joystick underneath.
        this.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            MowAudio.play('click');
            UiAnim.punch(this.body, 0.12);
            this.onTap();
        });
    }

    /** A green pill with white words (the FREE tag), its middle at (x, y). */
    private static tag(text: string, x: number, y: number): PIXI.Container {
        const holder = new PIXI.Container();
        const words = new PIXI.Text(text, new PIXI.TextStyle({ fontFamily: UiKit.fontFamily('primary'), fontSize: 18, fill: 0xffffff, stroke: 0x1d5a1d, strokeThickness: 4 }));
        words.anchor.set(0.5);
        const width = words.width + 16;
        const pill = new PIXI.Graphics().beginFill(0x1d5a1d).drawRoundedRect(-width / 2 - 2, -15, width + 4, 30, 15).endFill()
            .beginFill(0x4fc23a).drawRoundedRect(-width / 2, -13, width, 26, 13).endFill();
        holder.addChild(pill, words);
        holder.position.set(x, y);
        holder.rotation = 0.18;
        return holder;
    }

    /** The UI's pointing hand tapping at (x, y). */
    private static pointingHand(x: number, y: number): PIXI.Container {
        const holder = new PIXI.Container();
        holder.eventMode = 'none';
        holder.position.set(x, y);
        const hand = PIXI.Sprite.from('handHud');
        hand.width = hand.height = 72;
        hand.position.set(10 - 72 * 0.22, 8 - 72 * 0.16);
        holder.addChild(hand);
        gsap.to(holder, { y: y + 10, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        return holder;
    }

    /** Shown (popping in) or not; `free`: a FREE tag instead of the video badge; `first`: the hand points at it. */
    public setShown(show: boolean, free: boolean, first: boolean): void {
        this.video.visible = !free;
        this.freeTag.visible = free;
        this.hand.visible = first;
        if (show === this.shown) return;
        this.shown = show;
        this.visible = show;
        if (!show) return;
        // From its own scale (hidden half-way through popping in, it would stay small).
        gsap.killTweensOf([this, this.scale]);
        this.scale.set(SCALE);
        UiAnim.popIn(this);
    }

    public override destroy(): void {
        gsap.killTweensOf([this, this.scale]);
        this.children.forEach((child) => gsap.killTweensOf(child));
        super.destroy({ children: true });
    }
}
