// LookOffer.ts
//
// A card that comes up while playing, with something for the hands that isn't had yet (data/Looks): a gift, on sale, or for a
// video. Taken, it's theirs and worn at once; left, it goes (the strip under it runs out). The first is a gift.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Gameplay } from '../ads/Gameplay';
import { WallAnalytics } from '../analytics/WallAnalytics';
import { WallAudio } from '../audio/WallAudio';
import { LookItem, OFFERS, SlotId, gainLook, lookPrice, lookToOffer, ownsLook, wornLook } from '../data/Looks';
import { WallProgress } from '../data/WallProgress';
import { rarityOf } from '../data/WallConfig';
import { HudBar } from './HudBar';
import { WardrobeActions, costStrip } from './Wardrobe';
import { rarityBand } from './Rarity';
import { flag, frame, sprite, text, write } from './parts';

const CARD = { width: 164, height: 218, art: 122 };
const PICTURE = 192;
const FRAMES = { gift: 'Green', buy: 'Blue', video: 'Purple' } as const;
const FLAGS = { gift: 'GIFT!', buy: 'SALE!', video: 'NEW!' } as const;
const TIMER = { width: CARD.width - 16, height: 24 };

type Kind = keyof typeof FRAMES;

export class LookOffer extends PIXI.Container {
    private readonly body = new PIXI.Container();
    private readonly back = frame('ItemFrame02_Single_Green', [25, 28, 25, 27], CARD.width, CARD.height);
    private readonly focus = frame('ItemFrame_FocusLine', [36, 35, 36, 35], CARD.width + 14, CARD.height + 14);
    private readonly rays = sprite('Image_Effect_Rotate', 210);
    private readonly art = new PIXI.Sprite();
    private readonly nameText = text('', 22, 0xffffff, 0x100e18, 6);
    private stars?: PIXI.Container;
    private readonly flagText = text('', 24, 0xffffff);
    /** What's left of its time: the HUD's own bar (crisp at any size). */
    private readonly left = new HudBar(TIMER.width, TIMER.height, 0xffe14a);
    private cost?: PIXI.Container;
    private shown?: { slot: SlotId; item: LookItem; kind: Kind; price: number };
    private last?: LookItem;
    private timer = 8;
    private clock = 0;
    private busy = false;

    /** `taken`: something's been got. */
    public constructor(private readonly actions: WardrobeActions, private readonly taken: (name: string) => void) {
        super();
        this.visible = false;
        this.rays.y = -26;
        this.rays.alpha = 0.5;
        const inside = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(-CARD.width / 2 + 7, -CARD.height / 2 + 8, CARD.width - 14, CARD.height - 16, 18).endFill();
        this.rays.mask = inside;
        this.art.anchor.set(0.5);
        this.art.y = -30;
        this.nameText.y = 36;
        const tail = flag(this.flagText, 100);
        tail.y = -CARD.height / 2;
        const timer = new PIXI.Container();
        timer.y = CARD.height / 2 + 18;
        this.left.x = -TIMER.width / 2;
        timer.addChild(this.left);
        this.body.addChild(this.focus, this.back, inside, this.rays, this.art, this.nameText, tail, timer);
        this.addChild(this.body);
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            void this.take();
        });
    }

    /** `allowed`: nothing's open over the wall, and it's being played. */
    /**
     * `allowed`: there's a wall being hit (new offers come, and a shown one's time runs); `covered`: a panel's open over it.
     * Once up it stays up between walls, so it doesn't blink as they go by fast; only a panel hides it.
     */
    public update(delta: number, allowed: boolean, covered = false): void {
        if (this.busy) return;
        if (this.shown) {
            this.visible = !covered;
            if (covered) return;
            this.clock += delta;
            this.rays.rotation = this.clock * 0.5;
            this.focus.alpha = 0.6 + 0.4 * Math.sin(this.clock * 5);
            this.art.y = -30 + Math.sin(this.clock * 3) * 4;
            this.body.rotation = Math.sin(this.clock * 2.2) * 0.025;
            // (Its time runs only while there's a wall being hit.)
            if (allowed) this.timer -= delta;
            this.left.setShare(this.timer / OFFERS.stays);
            // (Got some other way meanwhile, or let go.)
            if (this.timer <= 0 || ownsLook(this.shown.slot, this.shown.item)) this.hide(OFFERS.wait);
            return;
        }
        if (!allowed || WallProgress.best < OFFERS.fromWall) return;
        this.timer -= delta;
        if (this.timer <= 0) this.offer();
    }

    private offer(): void {
        const first = WallProgress.offers === 0;
        const found = lookToOffer(this.last);
        if (!found) {
            this.timer = OFFERS.wait;
            return;
        }
        const price = lookPrice(found.item, OFFERS.sale);
        const image = this.actions.picture({ ...wornLook(), [found.slot]: found.item }, PICTURE);
        // (The hands aren't there yet.)
        if (!image) {
            this.timer = 3;
            return;
        }
        const kinds: [Kind, number][] = [
            ['gift', OFFERS.gift],
            ['buy', WallProgress.cash >= price ? OFFERS.buy : 0],
            ['video', WallProgress.playSec >= OFFERS.videoAfter && OFFERS.videoSlots.includes(found.slot) ? OFFERS.video : 0],
        ];
        let roll = Math.random() * kinds.reduce((sum, [, weight]) => sum + weight, 0);
        const kind = first ? 'gift' : (kinds.find(([, weight]) => (roll -= weight) <= 0)?.[0] ?? 'gift');
        this.shown = { ...found, kind, price };
        this.last = found.item;
        WallProgress.countOffer();
        WallAnalytics.offer(kind, found.slot, found.item.id, 'visible');
        // (Its frame: its rarity's; what kind of offer, on its flag.)
        const rarity = rarityOf(found.item.rarity);
        this.back.texture = PIXI.Texture.from(`ItemFrame02_Single_${rarity.frame}`);
        this.stars?.destroy({ children: true });
        this.stars = rarityBand(rarity, CARD.width - 30, 20);
        this.stars.y = 62;
        this.body.addChild(this.stars);
        write(this.flagText, FLAGS[kind], 84);
        write(this.nameText, found.item.name, CARD.width - 24);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = PICTURE;
        canvas.getContext('2d')!.putImageData(image, 0, 0);
        const old = this.art.texture;
        this.art.texture = PIXI.Texture.from(canvas);
        if (old !== PIXI.Texture.EMPTY) old.destroy(true);
        this.art.scale.set(CARD.art / PICTURE);
        this.cost?.destroy({ children: true });
        this.cost = costStrip(kind === 'video' ? { video: true, can: true } : kind === 'buy' ? { price, can: true } : { can: true }, CARD.width - 26, CARD.height / 2 - 36);
        this.body.addChild(this.cost);
        this.timer = OFFERS.stays;
        this.visible = true;
        WallAudio.play('claim', 0.6, 1.2);
        gsap.killTweensOf(this.body.scale);
        this.body.scale.set(0.1);
        gsap.to(this.body.scale, { x: 1, y: 1, duration: 0.5, ease: 'back.out(2.2)' });
    }

    private async take(): Promise<void> {
        const offered = this.shown;
        if (!offered || this.busy) return;
        const { slot, item, kind, price } = offered;
        WallAnalytics.offer(kind, slot, item.id, 'interact');
        if (kind === 'buy' && !WallProgress.spend(price)) {
            WallAudio.play('error');
            gsap.fromTo(this.body.pivot, { x: 9 }, { x: 0, duration: 0.35, ease: 'elastic.out(1, 0.2)' });
            return;
        }
        if (kind === 'video') {
            this.busy = true;
            const watched = await Gameplay.watchVideo();
            this.busy = false;
            if (this.destroyed) return;
            if (!watched) {
                WallAudio.play('error');
                WallAnalytics.look(slot, item.id, 'no-video');
                return;
            }
        }
        WallAnalytics.look(slot, item.id, kind === 'buy' ? 'bought' : kind === 'video' ? 'unlocked' : 'gift');
        gainLook(slot, item);
        WallAudio.play('tool');
        this.actions.changed();
        this.taken(item.name);
        this.hide(OFFERS.afterTaken);
    }

    private hide(wait: number): void {
        this.shown = undefined;
        this.timer = wait;
        gsap.killTweensOf(this.body.scale);
        gsap.to(this.body.scale, { x: 0, y: 0, duration: 0.25, ease: 'back.in(1.6)', onComplete: () => {
            this.visible = false;
        } });
    }
}
