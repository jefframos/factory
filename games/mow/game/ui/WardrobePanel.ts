// WardrobePanel.ts
//
// The wardrobe's panel (Dig's, the same catalogue and assets): COLORS / FACES / HATS tabs over a paged 3x3 grid.
// Each card shows the item (a colour swatch, the face on a head in the current colour, or the hat's model), and
// whether it's worn, owned or its price. Tapping buys it if needed (MowProgress.wearLook) and puts it on straight
// away. Catalogue and prices: ui/mow.json `wardrobe`; styles: ui/uikit.json (screen "wardrobe").
// While the tutorial's first hat is forced (setForcedItem) the panel stays on that hat, the hand on it, the rest dimmed.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { BakedShape } from './BakedShape';
import { UiAnim } from './UiAnim';
import { tabbedBlock, tagBadge } from './TabBar';
import { ModelIcons } from './ModelIcons';
import { MOW, WardrobeItem } from '../data/MowConfig';
import { MowProgress, LookKind } from '../data/MowProgress';
import MODELS from '../../registry/assetsRegistry/modelsRegistry';
import { t, names, type StringId } from '../i18n/Localization';
import { MowAudio } from '../audio/MowAudio';
import { watchRewardedVideo } from '../ads/RewardedVideo';
import { GameAnalytics } from '../analytics/GameAnalytics';

// Same frame and card size as the collection (CollectionPanel), so both panels scale and read alike.
const WIDTH = 760;
/** (Taller than the collection's by the skin row: SKIN_ROW.) */
const HEIGHT = 748;
/** Frame size, for the HUD to fit the panel on screen. */
export const WARDROBE_SIZE = { width: WIDTH, height: HEIGHT };
/** Cards are wide (filling the panel's width), so prices and labels fit. */
const CARD = 118;
const CARD_W = 212;
const GAP = 14;
/** Row pitch of the 3x3 grid. */
const ROW = 128;
/** The tabs and the content block under them (TabBar): the block's top edge, size and the tabs' size. */
const BLOCK = { top: -HEIGHT / 2 + 240, width: WIDTH - 48, height: HEIGHT - 266, tabWidth: 92, tabHeight: 76 };
/** The skin tones' row: between the title and the tabs; each swatch this big, this far apart. */
const SKIN_ROW = { y: -HEIGHT / 2 + 96, size: 25, step: 66 };
/** The first card row's centre: just inside the block's top. */
const FIRST_ROW_Y = BLOCK.top + 18 + CARD / 2;
const PER_PAGE = 9;
// (Faces are left out: they don't show on the people models.)
const TABS: [LookKind, StringId][] = [['hats', 'tabHats'], ['colors', 'tabColors'], ['patterns', 'tabPatterns'], ['bottoms', 'tabTrousers']];
const FACE_BASE = './mow/images/non-preload/';

const hex = (color: string): number => new THREE.Color(color).getHex();

/** A T-shirt's outline (`size` across, centred): the neck, the shoulders, the sleeves out and down, the body. */
function shirtShape(g: PIXI.Graphics, size: number): PIXI.Graphics {
    const p = (x: number, y: number): [number, number] => [x * size, y * size];
    g.moveTo(...p(-0.16, -0.46));
    g.lineTo(...p(-0.5, -0.28));
    g.lineTo(...p(-0.4, -0.04));
    g.lineTo(...p(-0.29, -0.11));
    g.lineTo(...p(-0.29, 0.46));
    g.lineTo(...p(0.29, 0.46));
    g.lineTo(...p(0.29, -0.11));
    g.lineTo(...p(0.4, -0.04));
    g.lineTo(...p(0.5, -0.28));
    g.lineTo(...p(0.16, -0.46));
    g.quadraticCurveTo(...p(0, -0.3), ...p(-0.16, -0.46));
    return g;
}

/**
 * A T-shirt picture in `top`, its pattern (`kind:#hex`) on it in the second colour (clipped to the shirt), a dark
 * outline over all: the PATTERNS cards and tab, and (plain) the COLORS tab.
 */
function shirtPicture(top: string, pattern: string, size: number): PIXI.Container {
    const holder = new PIXI.Container();
    holder.addChild(shirtShape(new PIXI.Graphics().beginFill(hex(top)), size).endFill());
    const [kind, second] = pattern.split(':');
    if (kind && second) {
        const marks = new PIXI.Graphics().beginFill(hex(second));
        const w = size;
        const top0 = -0.46 * size;
        const h = 0.92 * size;
        if (kind === 'stripes') for (let i = 1; i < 7; i += 2) marks.drawRect(-w / 2, top0 + (h * i) / 7, w, h / 7);
        else if (kind === 'band') marks.drawRect(-w / 2, top0 + h * 0.3, w, h * 0.24);
        else if (kind === 'twotone') marks.drawRect(-w / 2, top0 + h * 0.5, w, h * 0.5);
        else if (kind === 'sleeves') marks.drawRect(-w / 2, top0, w * 0.21, h * 0.5).drawRect(w * 0.29, top0, w * 0.21, h * 0.5);
        marks.endFill();
        const mask = shirtShape(new PIXI.Graphics().beginFill(0xffffff), size).endFill();
        marks.mask = mask;
        holder.addChild(mask, marks);
    }
    holder.addChild(shirtShape(new PIXI.Graphics().lineStyle(Math.max(3, size / 16), 0x1d140e), size));
    return holder;
}

/** One of the kit's bordered picto icons (white, a dark outline: PictoBorder) fitted to `size`, tinted `tint` (the outline stays dark). */
function picto(frame: string, size: number, tint?: string): PIXI.Sprite {
    const sprite = PIXI.Sprite.from(frame);
    sprite.anchor.set(0.5);
    sprite.scale.set(size / Math.max(sprite.texture.width, sprite.texture.height, 1));
    if (tint) sprite.tint = hex(tint);
    return sprite;
}

/**
 * A pair of trousers in the picto icons' style (white, a thick dark outline with round corners, a belt line),
 * `size` tall, tinted `color`: the TROUSERS tab, to sit with the kit's clothes and hat icons.
 */
function trousersPicture(color: string, size: number): PIXI.Container {
    const shape = (g: PIXI.Graphics) => {
        const p = (x: number, y: number): [number, number] => [x * size, y * size];
        g.moveTo(...p(-0.27, -0.4)).lineTo(...p(0.27, -0.4)).lineTo(...p(0.31, 0.4)).lineTo(...p(0.07, 0.4))
            .lineTo(...p(0, -0.06)).lineTo(...p(-0.07, 0.4)).lineTo(...p(-0.31, 0.4)).closePath();
        return g;
    };
    const stroke = Math.max(4, size / 9);
    const holder = new PIXI.Container();
    holder.addChild(shape(new PIXI.Graphics().lineStyle({ width: stroke, color: 0x1d140e, join: PIXI.LINE_JOIN.ROUND }).beginFill(hex(color))).endFill());
    holder.addChild(new PIXI.Graphics().lineStyle({ width: stroke * 0.6, color: 0x1d140e, cap: PIXI.LINE_CAP.ROUND })
        .moveTo(-0.27 * size, -0.25 * size).lineTo(0.27 * size, -0.25 * size));
    return holder;
}

/** The clothes picto with stripes over it (clipped to its shape): the PATTERNS tab. */
function patternPicto(size: number): PIXI.Container {
    const holder = new PIXI.Container();
    holder.addChild(picto('PictoIcon_Clothes', size));
    const stripes = new PIXI.Graphics().beginFill(0x2f6fd8, 0.75);
    for (let i = 0; i < 5; i++) stripes.drawRect(-size / 2, -size / 2 + size * (0.25 + i * 0.16), size, size * 0.07);
    stripes.endFill();
    const mask = picto('PictoIcon_Clothes', size * 0.86);
    stripes.mask = mask;
    holder.addChild(mask, stripes);
    return holder;
}

/** A pattern's card: the worn colour's T-shirt with the pattern on it. */
const patternSwatch = (id: string, top: string): PIXI.Container => shirtPicture(top, id, 78);

/** The tabs' pictures (a hat's model, the worn shirt, a striped one, the worn trousers), about `size` across. */
function tabIcon(kind: LookKind, size: number): PIXI.Container {
    const look = MowProgress.look;
    if (kind === 'colors') return picto('PictoIcon_Clothes', size, look.color);
    if (kind === 'patterns') return patternPicto(size);
    if (kind === 'bottoms') return trousersPicture(look.bottom ?? MOW.wardrobe.bottoms[0]?.id ?? '#2f4a7a', size);
    return picto('PictoIcon_Hat', size);
}

export class WardrobePanel extends PIXI.Container {
    private readonly body = new PIXI.Container();
    private tab: LookKind = 'hats';
    private page = 0;
    /** The tutorial's forced first hat (MowHud.setWardrobeForced): only it can be tapped. */
    private forcedItem?: string;

    /** `onWear` after a look changes (the scene re-dresses the miner); `say` for short messages. */
    public constructor(private readonly onWear: () => void, private readonly say: (text: string, color: number) => void) {
        super();
        const frame = UiKit.image('wardrobe', 'panel', WIDTH, HEIGHT);
        const ribbon = UiKit.sprite('wardrobe', 'ribbon', 0.55);
        ribbon.y = -HEIGHT / 2;
        const title = UiKit.text('wardrobe', 'title');
        title.anchor.set(0.5);
        title.y = -HEIGHT / 2 - 5;
        // Taps on the panel must not fall through to the movement joystick underneath.
        frame.eventMode = 'static';
        frame.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.addChild(frame, ribbon, title, this.body);
        this.visible = false;
    }

    /** Locks the panel onto one hat (undefined frees it): its tab and page, the hand on it, the rest dimmed. */
    public setForcedItem(id: string | undefined): void {
        if (id === this.forcedItem) return;
        this.forcedItem = id;
        if (id) {
            this.tab = 'hats';
            this.page = Math.floor(Math.max(0, this.items.findIndex((item) => item.id === id)) / PER_PAGE);
        }
        this.refresh();
    }

    private get items(): WardrobeItem[] {
        return MOW.wardrobe[this.tab];
    }

    public refresh(): void {
        // Stop the old cards' pulses first: a tween left running on a destroyed sprite throws every frame and stalls
        // every other animation in the game (the reward coins froze mid-air).
        UiAnim.kill(this.body);
        this.body.removeChildren().forEach((child) => child.destroy({ children: true }));
        this.body.addChild(this.skinRow(), this.tabs());
        const pages = Math.ceil(this.items.length / PER_PAGE);
        this.page = Math.min(this.page, pages - 1);
        const shown = this.items.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE);
        shown.forEach((item, i) => {
            const card = this.card(item);
            card.position.set(((i % 3) - 1) * (CARD_W + GAP), FIRST_ROW_Y + Math.floor(i / 3) * ROW);
            this.body.addChild(card);
        });
        if (pages > 1 && !this.forcedItem) {
            const y = BLOCK.top + BLOCK.height - 44;
            const label = UiKit.text('wardrobe', 'page', { page: this.page + 1, pages });
            label.anchor.set(0.5);
            label.y = y;
            this.body.addChild(label, this.arrow('arrowLeft', -140, y, -1, pages), this.arrow('arrowRight', 140, y, 1, pages));
        }
    }

    /**
     * The skin tones, in a row over the tabs: tap one to wear it (free). The special ones (green, blue) show a video
     * badge until a rewarded video unlocks them; the one worn has a gold ring.
     */
    private skinRow(): PIXI.Container {
        const row = new PIXI.Container();
        row.y = SKIN_ROW.y;
        const skins = MOW.wardrobe.skins ?? [];
        const worn = MowProgress.look.skin ?? skins[1]?.id;
        // The face picto (in the worn tone) before the swatches: this row is the skin (the row and it centred together).
        const label = picto('PictoIcon_Face', 54, worn);
        label.anchor.set(1, 0.5);
        const shift = (label.width + 24) / 2;
        label.x = -((skins.length - 1) / 2) * SKIN_ROW.step - SKIN_ROW.size - 20 + shift;
        row.addChild(label);
        skins.forEach((skin, i) => {
            const swatch = new PIXI.Container();
            swatch.x = (i - (skins.length - 1) / 2) * SKIN_ROW.step + shift;
            const on = skin.id === worn;
            swatch.addChild(BakedShape.disc(SKIN_ROW.size + (on ? 5 : 0), { fill: on ? 0xffd34d : 0x1d140e }));
            swatch.addChild(BakedShape.disc(SKIN_ROW.size, { fill: hex(skin.id), rim: 0xffffff, rimWidth: 3 }));
            const locked = !MowProgress.skinUnlocked(skin);
            if (locked) {
                const video = PIXI.Sprite.from('ItemIcon_Video');
                video.anchor.set(0.5);
                video.scale.set(30 / Math.max(video.texture.width, video.texture.height, 1));
                video.position.set(SKIN_ROW.size * 0.7, -SKIN_ROW.size * 0.7);
                swatch.addChild(video);
                UiAnim.pulse(swatch, 0.05, 0.7);
            }
            if (!this.forcedItem) this.tappable(swatch, () => void this.chooseSkin(skin, swatch));
            row.addChild(swatch);
        });
        return row;
    }

    /** A skin tone tapped: worn at once (a special one after its video, the first time). */
    private async chooseSkin(skin: { id: string; video?: boolean }, swatch: PIXI.Container): Promise<void> {
        if (MowProgress.look.skin === skin.id) return;
        if (!MowProgress.skinUnlocked(skin)) {
            if (!(await watchRewardedVideo('special skin'))) {
                GameAnalytics.skin('no-video', skin.id);
                this.say('NO VIDEO RIGHT NOW', 0xff9a8a);
                UiAnim.shake(swatch, 8, 0.35);
                return;
            }
            MowProgress.unlockSkin(skin.id);
            GameAnalytics.skin('unlocked', skin.id);
            this.say('SPECIAL SKIN UNLOCKED!', 0x9cff9c);
            MowAudio.play('buyStar');
        }
        MowProgress.wearSkin(skin.id);
        MowAudio.play('item');
        this.onWear();
        this.refresh();
    }

    /** The tabs over the content block (TabBar); while a hat is forced they don't switch. */
    private tabs(): PIXI.Container {
        for (const [kind] of TABS) if (MowProgress.freeLookBadge(kind)) GameAnalytics.giftBadgeShown(kind);
        const block = tabbedBlock({
            width: BLOCK.width,
            height: BLOCK.height,
            tabWidth: BLOCK.tabWidth,
            tabHeight: BLOCK.tabHeight,
            tabs: TABS.map(([kind, label]) => ({
                id: kind, label: t(label), icon: () => tabIcon(kind, 50), badge: MowProgress.freeLookBadge(kind) ? t('free') : undefined,
            })),
            active: this.tab,
            onSelect: (id) => {
                if (this.forcedItem) return;
                this.tab = id as LookKind;
                GameAnalytics.tabOpened('wardrobe', id);
                MowAudio.play('tab');
                this.page = 0;
                this.refresh();
            },
        });
        block.y = BLOCK.top;
        return block;
    }

    private arrow(id: string, x: number, y: number, step: number, pages: number): PIXI.Container {
        const arrow = UiKit.sprite('wardrobe', id);
        arrow.scale.set(44 / Math.max(arrow.height, 1));
        arrow.position.set(x, y);
        this.tappable(arrow, () => {
            this.page = (this.page + step + pages) % pages;
            MowAudio.play('click');
            this.refresh();
        });
        return arrow;
    }

    private worn(item: WardrobeItem): boolean {
        const look = MowProgress.look;
        if (this.tab === 'bottoms') return (look.bottom ?? MOW.wardrobe.bottoms[0]?.id) === item.id;
        if (this.tab === 'patterns') return (look.pattern ?? '') === item.id;
        return this.tab === 'colors' ? look.color === item.id : this.tab === 'faces' ? look.face === item.id : look.hat === item.id;
    }

    private card(item: WardrobeItem): PIXI.Container {
        const card = new PIXI.Container();
        const worn = this.worn(item);
        const owned = MowProgress.ownsLook(this.tab, item);
        card.addChild(UiKit.image('wardrobe', worn ? 'cardWorn' : 'card', CARD_W, CARD));
        const art = this.art(item);
        art.y = -8;
        card.addChild(art);

        let status: PIXI.DisplayObject;
        if (worn || owned) {
            status = UiKit.text('wardrobe', 'owned', { text: worn ? t('wearing') : t('owned') });
        } else if (item.free) {
            // A gift: "FREE" instead of a price; on a return visit (freeLookBadge) it also wears the tag and pulses.
            status = UiKit.text('wardrobe', 'owned', { text: t('free') }, { fill: 0x7dff8f });
            if (MowProgress.freeLookBadge(this.tab) && !this.forcedItem) {
                card.addChild(tagBadge(t('free'), CARD_W / 2 - 28, -CARD / 2 + 10));
                UiAnim.pulse(card, 0.05, 0.6);
            }
        } else {
            const affordable = MowProgress.money >= item.price;
            status = UiKit.text('wardrobe', 'price', { price: item.price.toLocaleString('en-US') }, affordable ? {} : { fill: 0xff8a7a });
        }
        (status as PIXI.Text).anchor.set(0.5, 1);
        status.y = CARD / 2 - 4;
        UiKit.fit(status as PIXI.Text, CARD_W - 16);
        card.addChild(status);
        if (this.forcedItem && item.id !== this.forcedItem) {
            card.alpha = 0.35;
            return card;
        }
        this.tappable(card, () => this.choose(item, card));
        if (this.forcedItem) {
            UiAnim.pulse(card, 0.06, 0.5);
            card.addChild(this.pointingHand());
        }
        return card;
    }

    /** The handHud pointing hand tapping at the card's middle (same art as the HUD's). */
    private pointingHand(): PIXI.Container {
        const holder = new PIXI.Container();
        holder.eventMode = 'none';
        const hand = PIXI.Sprite.from('handHud');
        hand.width = hand.height = 72;
        hand.position.set(20 - 72 * 0.22, 10 - 72 * 0.16);
        holder.addChild(hand);
        gsap.to(holder, { y: 10, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        return holder;
    }

    /** The item itself: a swatch, a face on a head in the current colour, or the hat's model. */
    private art(item: WardrobeItem): PIXI.Container {
        if (this.tab === 'colors' || this.tab === 'bottoms') {
            return BakedShape.disc(30, { fill: hex(item.id), rim: 0xffffff, rimWidth: 4 });
        }
        if (this.tab === 'patterns') return patternSwatch(item.id, MowProgress.look.color);
        if (this.tab === 'faces') {
            const head = new PIXI.Container();
            head.addChild(new BakedShape(64, 64, 10, { fill: hex(MowProgress.look.color), rim: 0x1d140e, rimWidth: 3 }));
            const face = PIXI.Sprite.from(`${FACE_BASE}${item.id}`);
            face.anchor.set(0.5);
            face.width = face.height = 58;
            head.addChild(face);
            return head;
        }
        const model = MODELS.Hats[item.id as keyof typeof MODELS.Hats];
        return model ? ModelIcons.sprite(`./${model.fullPath}`, CARD * 0.66) : new PIXI.Container();
    }

    private choose(item: WardrobeItem, card: PIXI.Container): void {
        if (this.worn(item)) return;
        const wasOwned = MowProgress.ownsLook(this.tab, item);
        const badged = MowProgress.freeLookBadge(this.tab);
        if (!MowProgress.wearLook(this.tab, item)) {
            this.say(t('notEnoughCash'), 0xff8a7a);
            MowAudio.play('error');
            UiAnim.shake(card, 8, 0.35);
            return;
        }
        if (!wasOwned) {
            this.say(t('lookBought', { name: (item.name ? names.look(item.name) : t('newLook')).toUpperCase() }), 0x9cff9c);
        }
        if (wasOwned) GameAnalytics.lookEquipped(this.tab, item.id);
        else GameAnalytics.lookBought(this.tab, item.id);
        if (!wasOwned && item.free) GameAnalytics.giftClaimed(this.tab, badged);
        if (wasOwned) {
            MowAudio.play('item');
        } else {
            MowAudio.play('buyCash');
            MowAudio.play('buyStar');
        }
        this.onWear();
        this.refresh();
    }

    private tappable(target: PIXI.Container, action: () => void): void {
        target.eventMode = 'static';
        target.cursor = 'pointer';
        // Taps on the panel must not also start the movement joystick underneath.
        target.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        target.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            action();
        });
    }
}
