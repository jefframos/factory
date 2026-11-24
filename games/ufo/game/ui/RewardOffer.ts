// RewardOffer.ts
//
// An offer on the HUD while playing (a new ship, a bigger saucer), for a rewarded video: a coloured card with its picture over
// a slow shine, what it is on the strip under it, and the video's badge on its corner. It pops in when it's shown, its picture
// bobs, and a tap asks the scene (which pauses the level, plays the video and gives it).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { fitSprite, framePlane, iconSprite, killTweensDeep, label, tappable } from './UiParts';

/** The card and the lighter panel in it, the picture, the words on the strip, and the video's badge. */
export const OFFER_SIZE = { width: 132, height: 150 };
const LOOK = {
    frameScale: 0.75, inset: 9, strip: 40, picture: 96, pictureY: -22, shine: 170, words: 22, wordsY: 52,
    badge: 50, video: 36, badgeX: 52, badgeY: -62, bob: 5,
};
const BADGE = 0xffc83a;

export interface OfferLook {
    words: string;
    /** The card's colour and the panel's in it. */
    outer: number;
    inner: number;
    /** An icon's frame, or a picture that's drawn later (a ship's). */
    picture: string | Promise<PIXI.Texture | null>;
}

export class RewardOffer extends PIXI.Container {
    private readonly picture = new PIXI.Sprite(PIXI.Texture.EMPTY);
    private readonly body = new PIXI.Container();
    private isOn = false;

    public constructor(look: OfferLook, onTap: () => void) {
        super();
        const { width, height } = OFFER_SIZE;
        const card = framePlane('CardFrame03_n_Bg', width, height, LOOK.frameScale);
        card.position.set(-width / 2, -height / 2);
        card.tint = look.outer;
        const innerWidth = width - LOOK.inset * 2;
        const innerHeight = height - LOOK.inset - LOOK.strip;
        const inner = framePlane('CardFrame03_n_InnerBg', innerWidth, innerHeight, LOOK.frameScale);
        inner.position.set(-innerWidth / 2, -height / 2 + LOOK.inset);
        inner.tint = look.inner;
        // The shine, kept inside the panel.
        const shine = iconSprite('Image_Effect_Rotate', LOOK.shine);
        shine.y = LOOK.pictureY;
        shine.alpha = 0.55;
        const inside = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(inner.x + 2, inner.y + 2, innerWidth - 4, innerHeight - 4, 12).endFill();
        shine.mask = inside;
        gsap.to(shine, { rotation: Math.PI * 2, duration: 9, ease: 'none', repeat: -1 });
        this.picture.anchor.set(0.5);
        this.picture.y = LOOK.pictureY;
        if (typeof look.picture === 'string') this.setPicture(PIXI.Texture.from(look.picture));
        else void look.picture.then((texture) => texture && this.setPicture(texture));
        const words = label(LOOK.words);
        words.text = look.words;
        words.y = LOOK.wordsY;
        words.scale.set(Math.min(1, (width - 14) / Math.max(words.width, 1)));
        const badge = iconSprite('BorderFrame_Circle60', LOOK.badge);
        badge.tint = BADGE;
        badge.position.set(LOOK.badgeX, LOOK.badgeY);
        const video = iconSprite('ItemIcon_Video', LOOK.video);
        video.position.copyFrom(badge.position);
        this.body.addChild(card, inner, inside, shine, this.picture, words, badge, video);
        this.addChild(this.body);
        this.hitArea = new PIXI.Rectangle(-width / 2, -height / 2, width, height);
        tappable(this, onTap);
        this.visible = false;
    }

    private setPicture(texture: PIXI.Texture): void {
        if (this.destroyed) return;
        this.picture.texture = texture;
        fitSprite(this.picture, LOOK.picture);
    }

    public get shown(): boolean {
        return this.isOn;
    }

    /** Pops in, its picture bobbing and the card breathing; or goes. */
    public show(on: boolean): void {
        if (on === this.isOn || this.destroyed) return;
        this.isOn = on;
        this.visible = on;
        gsap.killTweensOf([this.scale, this.body.scale, this.picture]);
        this.scale.set(1);
        this.body.scale.set(1);
        this.picture.y = LOOK.pictureY;
        if (!on) return;
        gsap.fromTo(this.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2.4)' });
        gsap.to(this.picture, { y: LOOK.pictureY - LOOK.bob, duration: 0.7, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        gsap.to(this.body.scale, { x: 1.05, y: 1.05, duration: 0.65, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }

    public override destroy(): void {
        killTweensDeep(this);
        super.destroy({ children: true });
    }
}
