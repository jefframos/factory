// TractorOffer.ts
//
// An offer on the HUD while playing, for a rewarded video: a paint or a part the tractor hasn't got yet. A coloured card with
// the tractor wearing it over a slow shine, what it is on the strip under it, and the video's badge on its corner. It pops in
// when it's shown, its picture bobs, and a tap asks the scene (which plays the video and puts it on). The first is a gift: FREE
// instead of the badge, the hand on it. One card, shown again
// with something else each time (TractorOffers, in the scene, says when).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { tagBadge } from './TabBar';
import { ModelIcons } from './ModelIcons';
import { MowAudio } from '../audio/MowAudio';
import { MowProgress } from '../data/MowProgress';
import { TractorItem, TractorKind } from '../data/TractorSkins';

/** The card and the lighter panel in it, the picture, the words on the strip, and the video's badge. */
export const TRACTOR_OFFER_SIZE = { width: 148, height: 166 };
const LOOK = {
    frameScale: 0.75, inset: 9, strip: 42, picture: 128, pictureY: -22, shine: 190, words: 23, wordsY: 59,
    badge: 50, video: 36, badgeX: 60, badgeY: -70, bob: 5,
};
const BADGE = 0xffc83a;
const GIFT = { words: 'FREE PAINT', outer: 0x2f9e2a, inner: 0xb6f58a };
const HAND = 78;
const CARDS: Record<TractorKind, { words: string; outer: number; inner: number }> = {
    paints: { words: 'NEW PAINT', outer: 0x2f6fe0, inner: 0x8ec6ff },
    parts: { words: 'NEW PART', outer: 0x7a35d8, inner: 0xcf9bff },
};

function frame(name: string, borders: [number, number, number, number], width: number, height: number): PIXI.NineSlicePlane {
    const plane = new PIXI.NineSlicePlane(PIXI.Texture.from(name), ...borders);
    plane.scale.set(LOOK.frameScale);
    plane.width = width / LOOK.frameScale;
    plane.height = height / LOOK.frameScale;
    return plane;
}

function sprite(name: string, size: number): PIXI.Sprite {
    const made = PIXI.Sprite.from(name);
    made.anchor.set(0.5);
    made.scale.set(size / Math.max(made.texture.width, made.texture.height, 1));
    return made;
}

export class TractorOffer extends PIXI.Container {
    private readonly body = new PIXI.Container();
    private readonly outer: PIXI.NineSlicePlane;
    private readonly inner: PIXI.NineSlicePlane;
    private readonly picture = new PIXI.Container();
    private readonly words: PIXI.Text;
    private readonly badge = new PIXI.Container();
    private readonly freeTag = tagBadge('FREE', LOOK.badgeX - 10, LOOK.badgeY + 2);
    private readonly hand = new PIXI.Container();
    private shown?: { kind: TractorKind; item: TractorItem };

    public constructor(private readonly onTap: () => void) {
        super();
        const { width, height } = TRACTOR_OFFER_SIZE;
        this.outer = frame('CardFrame03_n_Bg', [30, 29, 30, 33], width, height);
        this.outer.position.set(-width / 2, -height / 2);
        const innerWidth = width - LOOK.inset * 2;
        const innerHeight = height - LOOK.inset - LOOK.strip;
        this.inner = frame('CardFrame03_n_InnerBg', [18, 18, 18, 18], innerWidth, innerHeight);
        this.inner.position.set(-innerWidth / 2, -height / 2 + LOOK.inset);
        // The shine, kept inside the panel.
        const shine = sprite('Image_Effect_Rotate', LOOK.shine);
        shine.y = LOOK.pictureY;
        shine.alpha = 0.55;
        const inside = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(this.inner.x + 2, this.inner.y + 2, innerWidth - 4, innerHeight - 4, 12).endFill();
        shine.mask = inside;
        gsap.to(shine, { rotation: Math.PI * 2, duration: 9, ease: 'none', repeat: -1 });
        this.words = new PIXI.Text('', new PIXI.TextStyle({
            fontFamily: UiKit.fontFamily('primary'), fontSize: LOOK.words, fill: 0xffffff, stroke: 0x1d140e, strokeThickness: 5, lineJoin: 'round',
        }));
        this.words.anchor.set(0.5);
        this.words.y = LOOK.wordsY;
        this.body.addChild(this.outer, this.inner, inside, shine, this.picture, this.words);
        if (PlatformHandler.ENABLE_VIDEO_ADS) {
            const badge = sprite('BorderFrame_Circle60', LOOK.badge);
            badge.tint = BADGE;
            badge.position.set(LOOK.badgeX, LOOK.badgeY);
            const video = sprite('ItemIcon_Video', LOOK.video);
            video.position.copyFrom(badge.position);
            this.badge.addChild(badge, video);
        }
        const hand = PIXI.Sprite.from('handHud');
        hand.width = hand.height = HAND;
        hand.position.set(10 - HAND * 0.22, 8 - HAND * 0.16);
        this.hand.addChild(hand);
        this.hand.eventMode = 'none';
        gsap.to(this.hand, { y: 10, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        this.body.addChild(this.badge, this.freeTag);
        this.addChild(this.body, this.hand);
        this.hitArea = new PIXI.Rectangle(-width / 2, -height / 2, width, height);
        this.eventMode = 'static';
        this.cursor = 'pointer';
        // Taps on HUD buttons must not also start the movement joystick underneath.
        this.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            MowAudio.play('click');
            this.onTap();
        });
        this.visible = false;
    }

    /** What's being offered, if anything is. */
    public get offered(): { kind: TractorKind; item: TractorItem } | undefined {
        return this.shown;
    }

    /** Pops in offering this, its picture bobbing and the card breathing (a free one: a gift). */
    public offer(kind: TractorKind, item: TractorItem): void {
        this.shown = { kind, item };
        const card = item.free ? GIFT : CARDS[kind];
        this.badge.visible = !item.free;
        this.freeTag.visible = this.hand.visible = !!item.free;
        this.outer.tint = card.outer;
        this.inner.tint = card.inner;
        this.words.text = card.words;
        this.words.scale.set(1);
        this.words.scale.set(Math.min(1, (TRACTOR_OFFER_SIZE.width - 16) / Math.max(this.words.width, 1)));
        this.picture.removeChildren().forEach((child) => child.destroy());
        this.picture.addChild(ModelIcons.tractorSprite(MowProgress.tool, { paints: '', parts: '', [kind]: item.id }, LOOK.picture));
        this.stop();
        this.visible = true;
        gsap.fromTo(this.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2.4)' });
        gsap.to(this.picture, { y: LOOK.pictureY - LOOK.bob, duration: 0.7, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        gsap.to(this.body.scale, { x: 1.05, y: 1.05, duration: 0.65, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }

    public hide(): void {
        if (!this.shown) return;
        this.shown = undefined;
        this.stop();
        gsap.to(this.scale, { x: 0, y: 0, duration: 0.25, ease: 'back.in(1.8)', onComplete: () => {
            this.visible = false;
        } });
    }

    private stop(): void {
        gsap.killTweensOf([this.scale, this.body.scale, this.picture]);
        this.scale.set(1);
        this.body.scale.set(1);
        this.picture.y = LOOK.pictureY;
    }

    public override destroy(): void {
        UiAnim.kill(this);
        super.destroy({ children: true });
    }
}
