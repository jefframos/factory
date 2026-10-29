// WardrobePanel.ts
//
// The hub closet's panel (bandit-controller's wardrobe, for one miner): COLORS / FACES / HATS tabs over
// a paged 3x3 grid. Each card shows the item (a colour swatch, the face on a head in the current colour,
// or the hat's model), and whether it's worn, owned, locked (the collection-reward Crown) or its price.
// Tapping buys it if needed (DigProgress.wearLook) and puts it on straight away. Catalogue and prices:
// ui/dig.json `wardrobe`; styles: ui/uikit.json (screen "wardrobe").

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { ModelIcons } from './ModelIcons';
import { DIG, WardrobeItem } from '../data/DigConfig';
import { DigProgress, LookKind } from '../data/DigProgress';
import MODELS from '../../registry/assetsRegistry/modelsRegistry';
import { t, names, type StringId } from '../i18n/Localization';
import { DigAudio } from '../audio/DigAudio';

// Same frame and card size as the collection (CollectionPanel), so both panels scale and read alike.
const WIDTH = 640;
const HEIGHT = 624;
/** Frame size, for the HUD to fit the panel on screen. */
export const WARDROBE_SIZE = { width: WIDTH, height: HEIGHT };
/** Cards are wide (filling the panel's width), so prices and labels fit. */
const CARD = 118;
const CARD_W = 180;
const GAP = 20;
/** Row pitch of the 3x3 grid. */
const ROW = 130;
const PER_PAGE = 9;
const TABS: [LookKind, StringId][] = [['colors', 'tabColors'], ['faces', 'tabFaces'], ['hats', 'tabHats']];
const FACE_BASE = './dig/images/non-preload/';

const hex = (color: string): number => new THREE.Color(color).getHex();

export class WardrobePanel extends PIXI.Container {
    private readonly body = new PIXI.Container();
    private tab: LookKind = 'hats';
    private page = 0;

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

    private get items(): WardrobeItem[] {
        return DIG.wardrobe[this.tab];
    }

    public refresh(): void {
        // Stop the old cards' pulses first: a tween left running on a destroyed sprite throws every frame and stalls
        // every other animation in the game (the reward coins froze mid-air).
        UiAnim.kill(this.body);
        this.body.removeChildren().forEach((child) => child.destroy({ children: true }));
        this.body.addChild(this.tabs());
        const pages = Math.ceil(this.items.length / PER_PAGE);
        this.page = Math.min(this.page, pages - 1);
        const shown = this.items.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE);
        shown.forEach((item, i) => {
            const card = this.card(item);
            card.position.set(((i % 3) - 1) * (CARD_W + GAP), -HEIGHT / 2 + 150 + Math.floor(i / 3) * ROW);
            this.body.addChild(card);
        });
        if (pages > 1) {
            const y = HEIGHT / 2 - 56;
            const label = UiKit.text('wardrobe', 'page', { page: this.page + 1, pages });
            label.anchor.set(0.5);
            label.y = y;
            this.body.addChild(label, this.arrow('arrowLeft', -140, y, -1, pages), this.arrow('arrowRight', 140, y, 1, pages));
        }
    }

    private tabs(): PIXI.Container {
        const row = new PIXI.Container();
        row.y = -HEIGHT / 2 + 62;
        TABS.forEach(([kind, label], i) => {
            const tab = new PIXI.Container();
            tab.x = (i - 1) * 180;
            const active = kind === this.tab;
            tab.addChild(UiKit.image('wardrobe', active ? 'tabActive' : 'tab', 160, 56));
            const text = UiKit.text('wardrobe', 'tabLabel', { text: t(label) });
            text.anchor.set(0.5);
            text.y = -2;
            tab.addChild(text);
            if (!active) {
                tab.alpha = 0.85;
            }
            this.tappable(tab, () => {
                this.tab = kind;
                DigAudio.play('tab');
                this.page = 0;
                this.refresh();
            });
            row.addChild(tab);
        });
        return row;
    }

    private arrow(id: string, x: number, y: number, step: number, pages: number): PIXI.Container {
        const arrow = UiKit.sprite('wardrobe', id);
        arrow.scale.set(44 / Math.max(arrow.height, 1));
        arrow.position.set(x, y);
        this.tappable(arrow, () => {
            this.page = (this.page + step + pages) % pages;
            DigAudio.play('click');
            this.refresh();
        });
        return arrow;
    }

    private worn(item: WardrobeItem): boolean {
        const look = DigProgress.look;
        return this.tab === 'colors' ? look.color === item.id : this.tab === 'faces' ? look.face === item.id : look.hat === item.id;
    }

    private card(item: WardrobeItem): PIXI.Container {
        const card = new PIXI.Container();
        const worn = this.worn(item);
        const owned = DigProgress.ownsLook(this.tab, item);
        card.addChild(UiKit.image('wardrobe', worn ? 'cardWorn' : 'card', CARD_W, CARD));
        const art = this.art(item);
        art.y = -8;
        card.addChild(art);

        let status: PIXI.DisplayObject;
        if (worn || owned) {
            status = UiKit.text('wardrobe', 'owned', { text: worn ? t('wearing') : t('owned') });
        } else if (item.unlock) {
            const lock = UiKit.sprite('wardrobe', 'lockIcon');
            lock.scale.set(30 / Math.max(lock.height, 1));
            lock.position.set(CARD_W / 2 - 18, -CARD / 2 + 18);
            card.addChild(lock);
            status = UiKit.text('wardrobe', 'owned', { text: t('collectionLock') }, { fill: 0xffd23f });
        } else {
            const affordable = DigProgress.money >= item.price;
            status = UiKit.text('wardrobe', 'price', { price: item.price.toLocaleString('en-US') }, affordable ? {} : { fill: 0xff8a7a });
        }
        (status as PIXI.Text).anchor.set(0.5, 1);
        status.y = CARD / 2 - 4;
        UiKit.fit(status as PIXI.Text, CARD_W - 16);
        card.addChild(status);
        this.tappable(card, () => this.choose(item, card));
        return card;
    }

    /** The item itself: a swatch, a face on a head in the current colour, or the hat's model. */
    private art(item: WardrobeItem): PIXI.Container {
        if (this.tab === 'colors') {
            return new PIXI.Graphics().lineStyle(4, 0xffffff).beginFill(hex(item.id)).drawCircle(0, 0, 30).endFill();
        }
        if (this.tab === 'faces') {
            const head = new PIXI.Container();
            head.addChild(new PIXI.Graphics().lineStyle(3, 0x1d140e).beginFill(hex(DigProgress.look.color)).drawRoundedRect(-32, -32, 64, 64, 10).endFill());
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
        const wasOwned = DigProgress.ownsLook(this.tab, item);
        if (!DigProgress.wearLook(this.tab, item)) {
            this.say(item.unlock ? t('completeCollection') : t('notEnoughCash'), 0xff8a7a);
            DigAudio.play('error');
            UiAnim.shake(card, 8, 0.35);
            return;
        }
        if (!wasOwned) {
            this.say(t('lookBought', { name: (item.name ? names.look(item.name) : t('newLook')).toUpperCase() }), 0x9cff9c);
        }
        if (wasOwned) {
            DigAudio.play('item');
        } else {
            DigAudio.play('buyCash');
            DigAudio.play('buyStar');
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
