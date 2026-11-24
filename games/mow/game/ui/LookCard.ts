// LookCard.ts
//
// One thing to wear, as a card (the wardrobe's and the tractor's panels): its picture and, by its colour and what's under
// the picture, where it stands: worn (green, a check), owned (grey), one that can be had now (blue, its price — or FREE, or
// the video's badge — on a green button), one the money isn't there for (dark, its price on a grey button).

import * as PIXI from 'pixi.js';
import { UiKit } from './UiKit';
import { t } from '../i18n/Localization';

/** Nearly square, three across: read on a phone. */
export const LOOK_CARD = { width: 200, height: 218, gap: 12, artY: -27 };
const { width: WIDTH, height: HEIGHT } = LOOK_CARD;
/** The price's button, at the card's bottom. */
const PRICE = { width: WIDTH - 24, height: 54, y: HEIGHT / 2 - 37 };

export interface LookCardSpec {
    art: PIXI.Container;
    worn: boolean;
    owned: boolean;
    /** It can be had now: free, for a video, or the money's there. */
    affordable: boolean;
    price: number;
    free?: boolean;
    video?: boolean;
    /** What an owned or worn one says instead of OWNED / WEARING. */
    status?: string;
    /** Its name, small, over the picture. */
    name?: string;
}

export function lookCard(spec: LookCardSpec): PIXI.Container {
    const card = new PIXI.Container();
    const { worn, owned, affordable } = spec;
    card.addChild(UiKit.image('wardrobe', worn ? 'cardWorn' : owned ? 'card' : affordable ? 'cardBuy' : 'cardPoor', WIDTH, HEIGHT));
    spec.art.y += LOOK_CARD.artY;
    if (!affordable && !owned) spec.art.alpha = 0.6;
    card.addChild(spec.art);
    if (spec.name) {
        const name = UiKit.fit(UiKit.text('wardrobe', 'owned', { text: spec.name }, { fontSize: 21, strokeThickness: 5, fill: 0xffffff }), WIDTH - (worn ? 70 : 24));
        name.anchor.set(0.5);
        name.y = -HEIGHT / 2 + 22;
        card.addChild(name);
    }
    if (!worn && !owned) {
        card.addChild(priceButton(spec));
        return card;
    }
    const status = UiKit.fit(UiKit.text('wardrobe', 'owned', { text: spec.status ?? (worn ? t('wearing') : t('owned')) },
        { fontSize: 25, strokeThickness: 6, fill: worn ? 0x9cff9c : 0xd8e4ff }), WIDTH - 20);
    status.anchor.set(0.5);
    status.y = PRICE.y + 4;
    card.addChild(status);
    if (worn) {
        const check = UiKit.sprite('hud', 'check');
        check.scale.set(46 / Math.max(check.width, check.height, 1));
        check.position.set(WIDTH / 2 - 22, -HEIGHT / 2 + 22);
        card.addChild(check);
    }
    return card;
}

/** What it costs, as its button: green if it can be had now, grey if not. */
function priceButton({ price, free, video, affordable }: LookCardSpec): PIXI.Container {
    const button = new PIXI.Container();
    button.y = PRICE.y;
    button.addChild(UiKit.image('wardrobe', affordable ? 'buyButton' : 'poorButton', PRICE.width, PRICE.height));
    const look = { fontSize: 30, strokeThickness: 6, fill: affordable ? 0xffffff : 0xffb3a6, stroke: affordable ? 0x1d5a1d : 0x1d140e };
    const label = free || video ? UiKit.text('wardrobe', 'owned', { text: t('free') }, look) : UiKit.text('wardrobe', 'price', { price: price.toLocaleString('en-US') }, look);
    label.anchor.set(0.5);
    label.y = -3;
    button.addChild(label);
    const frame = video ? 'ItemIcon_Video' : free ? undefined : 'ItemIcon_Money_Bill';
    if (!frame) {
        UiKit.fit(label, PRICE.width - 24);
        return button;
    }
    UiKit.fit(label, PRICE.width - 66);
    const size = video ? 44 : 38;
    const icon = PIXI.Sprite.from(frame);
    icon.anchor.set(0.5);
    icon.scale.set(size / Math.max(icon.texture.width, icon.texture.height, 1));
    // The icon and the price, centred together.
    const gap = 6;
    const span = size + gap + label.width;
    icon.position.set(-span / 2 + size / 2, -2);
    label.x = span / 2 - label.width / 2;
    button.addChild(icon);
    return button;
}
