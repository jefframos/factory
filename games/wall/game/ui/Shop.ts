// Shop.ts
//
// The shop, where the platform has purchases (IPlatformConnection.canBuy: the phone app, CrazyGames once it's let in,
// the mock with ?shop=1); elsewhere (Poki, YouTube ...) there's no button. Laid out as the pack's shop
// (Preview/13_Shop_1): the starter pack across the top, then what's had for good (no ads, double cash, auto hold), then
// medals (for relics). Paid for on the platform (its store's window), given here (WallProgress.grant). One-time ones
// already had are restored from the store when the game starts (restoreShop).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { Gameplay } from '../ads/Gameplay';
import { WallAnalytics } from '../analytics/WallAnalytics';
import { WallAudio } from '../audio/WallAudio';
import { LOOK_TABS, gainLook, ownsLook } from '../data/Looks';
import { PRODUCTS, ProductDef } from '../data/WallConfig';
import { WallProgress } from '../data/WallProgress';
import { fit, frame, plainText, sprite, text } from './parts';

const BUTTON = 96;
const PANEL = { width: 660, height: 1040 };
const OFFER = { width: 600, height: 176 };
const CARD = { width: 188, height: 222, gap: 18, icon: 104 };
const HEADER = { width: 600, height: 44 };
/** The pack's shop colours (tools/ui-kit: shop card outer, inner). */
const COLORS = { panel: 0x2b3f8f, inner: 0x203070, card: 0x3f8cff, cardInner: 0x93c2ff, offer: 0xffb52e, offerInner: 0xffd66b, owned: 0x2fbf5b, ownedInner: 0x8ee6a8, header: 0x0f1736 };

/** Purchases can be made here, now. */
export const shopOpen = (): boolean => !!PlatformHandler.instance.platform?.canBuy?.();

/** One-time products the store says are had (a reinstall, another device): marked had. Once, at the start. */
export async function restoreShop(): Promise<void> {
    const platform = PlatformHandler.instance.platform;
    if (!platform?.canBuy?.() || !platform.restorePurchases) return;
    try {
        WallProgress.restore(await platform.restorePurchases());
    } catch (error) {
        console.warn('[Shop] restore failed', error);
    }
}

// ---------------------------------------------------------------- the button

export class ShopButton extends PIXI.Container {
    private readonly alert = sprite('Icon_Exclamation', 30);
    private clock = 0;

    public constructor(open: () => void) {
        super();
        // (The storefront as a sticker, its white outline (merge1's), on its own as the settings' gear: no plate under it.)
        const icon = sprite('ItemIcon_Shop_Sticker', BUTTON * 0.9);
        this.alert.position.set(BUTTON / 2 - 12, -BUTTON / 2 + 12);
        this.addChild(icon, this.alert);
        this.hitArea = new PIXI.Circle(0, 0, BUTTON / 2);
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            open();
        });
    }

    public update(delta: number): void {
        this.clock += delta;
        // (The starter pack not had yet: marked.)
        this.alert.visible = !WallProgress.owns('starter');
        this.alert.scale.set(0.9 + 0.1 * Math.sin(this.clock * 6));
    }
}

// ---------------------------------------------------------------- the shop

export class ShopPanel extends PIXI.Container {
    public isOpen = false;
    private readonly dim = new PIXI.Graphics();
    private readonly panel = new PIXI.Container();
    private body = new PIXI.Container();
    /** The store's own prices, by id (the game's where it says none). */
    private prices: Record<string, string> = {};
    private buying = false;

    public constructor(private readonly onToggle: (open: boolean) => void, private readonly got: (def: ProductDef) => void) {
        super();
        this.visible = false;
        this.dim.eventMode = 'static';
        this.dim.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.dim.on('pointertap', () => this.setOpen(false));
        const back = frame('CardFrame03_n_Bg', [30, 29, 30, 33], PANEL.width, PANEL.height);
        back.tint = COLORS.panel;
        const inner = frame('CardFrame03_n_InnerBg', [18, 18, 18, 18], PANEL.width - 30, PANEL.height - 30);
        inner.tint = COLORS.inner;
        back.eventMode = 'static';
        back.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        const ribbon = sprite('Title_Ribbon04_Red', 480);
        ribbon.y = -PANEL.height / 2 + 4;
        const title = text('SHOP', 50, 0xffffff, 0x5c0f16, 9);
        title.y = -PANEL.height / 2 - 8;
        const close = sprite('Icon_Close02', 52);
        close.position.set(PANEL.width / 2 - 50, -PANEL.height / 2 + 52);
        close.eventMode = 'static';
        close.cursor = 'pointer';
        close.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        close.on('pointertap', () => this.setOpen(false));
        this.panel.addChild(back, inner, this.body, ribbon, title, close);
        this.addChild(this.dim, this.panel);
    }

    public setOpen(open: boolean): void {
        if (open === this.isOpen) return;
        this.isOpen = open;
        this.visible = open;
        Gameplay.setBlocked('shop', open);
        this.onToggle(open);
        WallAudio.play('claim', 0.5, open ? 0.8 : 0.9);
        if (!open) return;
        WallAnalytics.panel('shop');
        this.build();
        this.reposition();
        void this.askPrices();
        gsap.killTweensOf(this.panel.scale);
        const { x } = this.panel.scale;
        gsap.fromTo(this.panel.scale, { x: x * 0.6, y: x * 0.6 }, { x, y: x, duration: 0.35, ease: 'back.out(1.8)' });
    }

    /** The store's prices (in the player's currency), once it says. */
    private async askPrices(): Promise<void> {
        const platform = PlatformHandler.instance.platform;
        if (!platform?.productPrices) return;
        try {
            this.prices = { ...this.prices, ...(await platform.productPrices(PRODUCTS.map(({ id }) => id))) };
            if (this.isOpen) this.build();
        } catch (error) {
            console.warn('[Shop] prices failed', error);
        }
    }

    private build(): void {
        this.body.destroy({ children: true });
        this.body = new PIXI.Container();
        this.panel.addChildAt(this.body, 2);
        let y = -PANEL.height / 2 + 100;
        const header = (words: string) => {
            const bar = frame('BasicFrame_Round12', [12, 12, 12, 12], HEADER.width, HEADER.height);
            bar.tint = COLORS.header;
            bar.alpha = 0.85;
            const label = text(words, 24, 0x7fd8ff, 0x0a1030, 5);
            const row = new PIXI.Container();
            row.addChild(bar, label);
            row.y = y + HEADER.height / 2;
            this.body.addChild(row);
            y += HEADER.height + 14;
        };
        const offer = PRODUCTS.find((def) => def.section === 'offer' && !WallProgress.owns(def.id));
        if (offer) {
            header('BEST OFFER');
            const card = this.offerCard(offer);
            card.y = y + OFFER.height / 2;
            this.body.addChild(card);
            y += OFFER.height + 22;
        }
        for (const [section, words] of [['forever', 'FOREVER'], ['medals', 'MEDALS FOR RELICS']] as const) {
            const defs = PRODUCTS.filter((def) => def.section === section);
            if (!defs.length) continue;
            header(words);
            defs.forEach((def, i) => {
                const card = this.card(def);
                card.position.set((i - (defs.length - 1) / 2) * (CARD.width + CARD.gap), y + CARD.height / 2);
                this.body.addChild(card);
            });
            y += CARD.height + 22;
        }
    }

    private price(def: ProductDef): string {
        return this.prices[def.id] ?? def.price;
    }

    /** The starter pack: across the panel, gold, BEST. */
    private offerCard(def: ProductDef): PIXI.Container {
        const card = new PIXI.Container();
        const back = frame('CardFrame03_n_Bg', [30, 29, 30, 33], OFFER.width, OFFER.height);
        back.tint = COLORS.offer;
        const inner = frame('CardFrame03_n_InnerBg', [18, 18, 18, 18], OFFER.width - 24, OFFER.height - 24);
        inner.tint = COLORS.offerInner;
        const glow = sprite('ItemFrame_BgGlow', 200);
        glow.position.set(-OFFER.width / 2 + 110, 0);
        glow.alpha = 0.8;
        const icon = sprite(def.icon, 140);
        icon.position.set(-OFFER.width / 2 + 110, 0);
        const name = text(def.name, 38, 0xffffff, 0x7a3a00, 8);
        name.anchor.set(0, 0.5);
        name.position.set(-OFFER.width / 2 + 200, -38);
        const what = plainText(def.what, 17, 0x7a3a00, 0xffe3a0, 2);
        what.anchor.set(0, 0.5);
        what.position.set(-OFFER.width / 2 + 200, 2);
        fit(what, OFFER.width - 230);
        const best = text('BEST', 24, 0xffffff, 0x8a0f1a, 6);
        const tag = sprite('Label_Tail_Single_Red', 100);
        const badge = new PIXI.Container();
        badge.addChild(tag, best);
        badge.position.set(-OFFER.width / 2 + 40, -OFFER.height / 2 + 6);
        badge.rotation = -0.2;
        const price = this.priceButton(def, 170);
        price.position.set(OFFER.width / 2 - 110, 46);
        card.addChild(back, inner, glow, icon, name, what, price, badge);
        return card;
    }

    /** One of the others: a shop card, its icon, name, what it does, and its price (or OWNED). */
    private card(def: ProductDef): PIXI.Container {
        const card = new PIXI.Container();
        const owned = def.kind === 'once' && WallProgress.owns(def.id);
        const back = frame('CardFrame03_n_Bg', [30, 29, 30, 33], CARD.width, CARD.height);
        back.tint = owned ? COLORS.owned : COLORS.card;
        const inner = frame('CardFrame03_n_InnerBg', [18, 18, 18, 18], CARD.width - 20, CARD.height - 74);
        inner.tint = owned ? COLORS.ownedInner : COLORS.cardInner;
        inner.y -= 24;
        const icon = sprite(def.icon, CARD.icon);
        icon.y = -48;
        const name = text(def.name, 22, 0x1b2456, 0xffffff, 4);
        name.y = 18;
        fit(name, CARD.width - 30);
        card.addChild(back, inner, icon, name);
        if (def.what) {
            const what = plainText(def.what, 14, 0x1b2456, 0xd6e6ff, 2);
            what.y = 40;
            fit(what, CARD.width - 30);
            card.addChild(what);
        }
        if (owned) {
            const check = sprite('Icon_Check02', 44);
            check.y = CARD.height / 2 - 34;
            card.addChild(check);
        } else {
            const price = this.priceButton(def, CARD.width - 30);
            price.y = CARD.height / 2 - 34;
            card.addChild(price);
        }
        return card;
    }

    /** Its price, a button: the store's window, then what it gives. */
    private priceButton(def: ProductDef, width: number): PIXI.Container {
        const button = new PIXI.Container();
        button.addChild(frame('ItemFrame02_Single_Yellow', [25, 27, 25, 27], width, 54));
        const label = text(this.price(def), 28, 0xffffff, 0x7a3a00, 7);
        fit(label, width - 24);
        button.addChild(label);
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        button.on('pointertap', () => void this.buy(def, button));
        return button;
    }

    private async buy(def: ProductDef, button: PIXI.Container): Promise<void> {
        const platform = PlatformHandler.instance.platform;
        if (this.buying || !platform?.purchase) return;
        this.buying = true;
        gsap.fromTo(button.scale, { x: 0.9, y: 0.9 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(3)' });
        let bought = false;
        try {
            bought = await platform.purchase(def.id);
        } catch (error) {
            console.warn('[Shop] purchase failed', error);
        }
        this.buying = false;
        WallAnalytics.shop(def.id, bought ? 'bought' : 'cancelled');
        if (!bought) return;
        WallProgress.grant(def);
        // A look of its rarity, not had yet (Looks is read here, not in WallProgress).
        if (def.give.look) {
            const choices = LOOK_TABS.flatMap((tab) => tab.items.filter((item) => item.rarity === def.give.look && !ownsLook(tab.id, item)).map((item) => ({ slot: tab.id, item })));
            const pick = choices[Math.floor(Math.random() * choices.length)];
            if (pick) gainLook(pick.slot, pick.item);
        }
        WallAudio.play('tool');
        this.got(def);
        if (this.isOpen) this.build();
    }

    public reposition(): void {
        const full = Game.overlayScreenData;
        const screen = Game.safeScreenData ?? full;
        if (!screen || !full || !this.isOpen) return;
        const { width, height, center } = screen;
        this.dim.clear().beginFill(0x070b1c, 0.8).drawRect(full.topLeft.x - 400, full.topLeft.y - 400, full.width + 800, full.height + 800).endFill();
        this.panel.position.set(center.x, center.y + 16);
        this.panel.scale.set(Math.min(1, (height - 70) / (PANEL.height + 40), (width - 30) / PANEL.width));
    }
}

