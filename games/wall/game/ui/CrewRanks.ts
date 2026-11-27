// CrewRanks.ts
//
// The crew's ranks, for good (through rewinds too), bought with gems (bosses and fights drop them: WallConfig.fightGems): each
// kind's rank goes up a level at a time, 1 to 100 (RANKS), each adding to its damage; its hats come with the levels, hard hat
// at 1, viking at 40, the crown at 100, the last (tools/build-hats.mjs), each doubling it again. Its button sits under the relics' on the left, from the first boss on; marked when a rank's there
// to buy. Laid out as the relics' shop; its button, as theirs, under it on the left.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { Gameplay } from '../ads/Gameplay';
import { WallAnalytics } from '../analytics/WallAnalytics';
import { WallAudio } from '../audio/WallAudio';
import { CREW, CrewDef, MAX_RANK, RANKS, hatOf, nextHatAt, rankCost, rankMult, short } from '../data/WallConfig';
import { WallProgress } from '../data/WallProgress';
import { frame, plainText, sprite, text, write } from './parts';
import { CARD_SLICE } from './Rarity';

/** Its button: as the relics' (the same size, frame and strip). */
const BUTTON = { size: 104, icon: 66, strip: 28 };
export const CREW_BUTTON = BUTTON.size;
const PANEL = { width: 640, top: 200 };
const ROW = { width: 590, height: 80, gap: 6, icon: 64, hat: 42, buy: { width: 150, height: 64 } };
/** The hats' names, for "VIKING AT LV 40". */
const HAT_NAMES = ['HARD HAT', 'VIKING', 'CROWN'];
const COLORS = { panel: 0x2f7a3a, inner: 0x3f9e4c, row: 0x1a3a20, locked: 0x2a2f33 };

/** A hat's picture (1 hard hat, 2 viking, 3 crown). */
const hatIcon = (hat: number, size: number): PIXI.Sprite => sprite(`Wall_hat_${RANKS.hats[hat - 1]}`, size);

// ---------------------------------------------------------------- the button

export class CrewButton extends PIXI.Container {
    private readonly focus = frame('ItemFrame_FocusLine', [36, 35, 36, 35], BUTTON.size + 14, BUTTON.size + 14);
    private readonly alert = sprite('Icon_Exclamation', 34);
    private readonly count = text('', 26, 0xffffff, 0x100e18, 7);
    private readonly picture = new PIXI.Container();
    private readonly gem = sprite('Icon_Gem', 26);
    private clock = 0;

    /** As the relics' button, in green: the chick in its crown, and the gems there are on its strip. */
    public constructor(open: () => void) {
        super();
        const back = frame('ItemFrame03_Single_Green', [53, 53, 54, 56], BUTTON.size, BUTTON.size, 0.82);
        const glow = sprite('ItemFrame_BgGlow', BUTTON.size - 10);
        glow.tint = 0xb8ffb0;
        glow.alpha = 0.7;
        const stripY = BUTTON.size / 2 - 8 - BUTTON.strip / 2;
        const chick = sprite('Wall_chick', BUTTON.icon);
        chick.y = 6;
        const crown = hatIcon(RANKS.hats.length, BUTTON.icon * 0.55);
        crown.y = -BUTTON.icon * 0.34;
        this.picture.addChild(chick, crown);
        this.picture.y = -BUTTON.strip / 2 + 2;
        const strip = frame('BasicFrame_Round12', [12, 12, 12, 12], BUTTON.size - 16, BUTTON.strip, 0.8);
        strip.tint = 0x100e18;
        strip.alpha = 0.6;
        strip.y += stripY;
        this.gem.y = stripY;
        this.count.anchor.set(0, 0.5);
        this.count.y = stripY - 1;
        this.alert.position.set(BUTTON.size / 2 - 10, -BUTTON.size / 2 + 10);
        this.addChild(this.focus, back, glow, this.picture, strip, this.gem, this.count, this.alert);
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            open();
        });
    }

    /** Where the gems fly to. */
    public get target(): PIXI.Point {
        return new PIXI.Point(this.x, this.y);
    }

    /** Some gems have got here: a jump. */
    public got(): void {
        gsap.killTweensOf(this.scale);
        this.scale.set(1.18);
        gsap.to(this.scale, { x: 1, y: 1, duration: 0.3, ease: 'back.out(3)' });
    }

    public update(delta: number): void {
        this.clock += delta;
        const can = WallProgress.rankToBuy;
        write(this.count, short(WallProgress.gems), BUTTON.size / 2 - 6);
        // (The gem and its number, centred on the strip as one.)
        const gap = 4;
        const width = this.gem.width + gap + this.count.width;
        this.gem.x = -width / 2 + this.gem.width / 2;
        this.count.x = this.gem.x + this.gem.width / 2 + gap;
        this.focus.visible = this.alert.visible = can;
        this.focus.alpha = 0.6 + 0.4 * Math.sin(this.clock * 5);
        this.picture.scale.set(can ? 1 + 0.05 * Math.sin(this.clock * 6) : 1);
    }
}

// ---------------------------------------------------------------- the panel

export class CrewPanel extends PIXI.Container {
    public isOpen = false;
    private readonly dim = new PIXI.Graphics();
    private readonly panel = new PIXI.Container();
    private readonly gems = text('', 44, 0xffffff, 0x100e18, 9);
    private rows = new PIXI.Container();
    private height_ = 0;

    public constructor(private readonly onToggle: (open: boolean) => void) {
        super();
        this.visible = false;
        this.height_ = PANEL.top + CREW.length * (ROW.height + ROW.gap) + 24;
        this.dim.eventMode = 'static';
        this.dim.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.dim.on('pointertap', () => this.setOpen(false));
        const back = frame('CardFrame03_n_Bg', [30, 29, 30, 33], PANEL.width, this.height_);
        back.tint = COLORS.panel;
        const inner = frame('CardFrame03_n_InnerBg', [18, 18, 18, 18], PANEL.width - 30, this.height_ - 30);
        inner.tint = COLORS.inner;
        back.eventMode = 'static';
        back.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        const top = -this.height_ / 2;
        const ribbon = sprite('Title_Ribbon04_Red', 480);
        ribbon.y = top + 4;
        const title = text('CREW', 50, 0xffffff, 0x5c0f16, 9);
        title.y = top - 8;
        const close = sprite('Icon_Close02', 52);
        close.position.set(PANEL.width / 2 - 50, top + 52);
        close.eventMode = 'static';
        close.cursor = 'pointer';
        close.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        close.on('pointertap', () => this.setOpen(false));
        // The gems there are, and where they come from.
        const purse = frame('ResourceBar_Single_Bg', [11, 11, 11, 11], 230, 62);
        purse.tint = 0x1c1d33;
        purse.position.set(-115, top + 76);
        const gem = sprite('Icon_Gem', 64);
        gem.position.set(-104, top + 106);
        this.gems.anchor.set(0, 0.5);
        this.gems.position.set(-62, top + 106);
        const note = plainText('BOSSES AND FIGHTS DROP GEMS · RANKS ARE FOR GOOD', 19, 0xe8ffe8);
        note.y = top + 162;
        this.panel.addChild(back, inner, purse, gem, this.gems, note, this.rows, ribbon, title, close);
        this.addChild(this.dim, this.panel);
    }

    public setOpen(open: boolean): void {
        if (open === this.isOpen) return;
        this.isOpen = open;
        this.visible = open;
        Gameplay.setBlocked('crew', open);
        this.onToggle(open);
        WallAudio.play('claim', 0.5, open ? 0.8 : 0.9);
        if (!open) return;
        WallAnalytics.panel('crew');
        this.build();
        this.reposition();
        gsap.killTweensOf(this.panel.scale);
        const { x } = this.panel.scale;
        gsap.fromTo(this.panel.scale, { x: x * 0.6, y: x * 0.6 }, { x, y: x, duration: 0.35, ease: 'back.out(1.8)' });
    }

    private build(): void {
        write(this.gems, short(WallProgress.gems), 150);
        this.rows.destroy({ children: true });
        this.rows = new PIXI.Container();
        this.panel.addChildAt(this.rows, 6);
        CREW.forEach((def, i) => {
            const row = this.row(def);
            row.y = -this.height_ / 2 + PANEL.top + ROW.height / 2 + i * (ROW.height + ROW.gap);
            this.rows.addChild(row);
        });
    }

    /** A kind: itself in its hat, its name, its level and what it does, the next hat; and its next level's price (or MAX). */
    private row(def: CrewDef): PIXI.Container {
        const row = new PIXI.Container();
        const level = WallProgress.rankLevel(def.id);
        const rank = hatOf(level);
        const there = WallProgress.best >= def.wall;
        const max = level >= MAX_RANK;
        const can = WallProgress.canRank(def);
        const back = frame('BasicFrame_Round12', [12, 12, 12, 12], ROW.width, ROW.height);
        back.tint = there ? COLORS.row : COLORS.locked;
        back.alpha = 0.9;
        const animal = sprite(`Wall_${def.id}`, ROW.icon);
        animal.position.set(-ROW.width / 2 + 52, 6);
        // (Not met yet: a dark shape, nothing said of it.)
        if (!there) animal.tint = 0x151515;
        row.addChild(back, animal);
        if (rank) {
            const hat = hatIcon(rank, ROW.hat);
            hat.position.set(animal.x, -ROW.height / 2 + 16);
            row.addChild(hat);
        }
        const name = text(there ? def.plural.toUpperCase() : '???', 26, there ? 0xffffff : 0x9aa3a8, 0x100e18, 6);
        name.anchor.set(0, 0.5);
        name.position.set(-ROW.width / 2 + 104, -14);
        // (Its level and damage; then when its next hat comes.)
        const hatNext = nextHatAt(level);
        const said = !there ? '???'
            : max ? `LV ${level} · x${short(rankMult(level))} DAMAGE · CROWNED`
            : level ? `LV ${level} · x${short(rankMult(level))} DAMAGE · ${HAT_NAMES[hatOf(hatNext!) - 1]} AT LV ${hatNext}`
            : `NO RANK YET · ${HAT_NAMES[0]} AT LV 1`;
        const what = plainText(said, 18, level ? 0x7dffa2 : 0xb9c3cc);
        what.anchor.set(0, 0.5);
        what.position.set(-ROW.width / 2 + 104, 16);
        write(what, said, ROW.width - 104 - ROW.buy.width - 30);
        row.addChild(name, what);
        if (!there) return row;
        // The next hat, and its price.
        const buy = new PIXI.Container();
        buy.x = ROW.width / 2 - ROW.buy.width / 2 - 12;
        buy.addChild(frame(`ItemFrame02_Single_${max ? 'Green' : can ? 'Yellow' : 'Gray'}`, CARD_SLICE, ROW.buy.width, ROW.buy.height));
        if (max) {
            buy.addChild(text('MAX', 30, 0xffffff, 0x100e18, 7));
        } else {
            // (+1 LV, and its price in gems; the hat it brings, if the next level brings one.)
            const brings = hatOf(level + 1) > rank;
            const plus = text(brings ? '' : '+1', 24, 0xffffff, 0x100e18, 6);
            plus.x = -46;
            const next = brings ? hatIcon(rank + 1, 46) : undefined;
            if (next) next.x = -44;
            const gem = sprite('Icon_Gem', 30);
            gem.x = -6;
            const cost = text(short(rankCost(def, level)), 28, 0xffffff, 0x100e18, 7);
            cost.anchor.set(0, 0.5);
            cost.x = 12;
            write(cost, short(rankCost(def, level)), 54);
            buy.addChild(next ?? plus, gem, cost);
        }
        buy.eventMode = 'static';
        buy.cursor = 'pointer';
        buy.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        buy.on('pointertap', () => {
            if (!WallProgress.buyRank(def)) {
                WallAudio.play('error');
                gsap.fromTo(buy.pivot, { x: 8 }, { x: 0, duration: 0.35, ease: 'elastic.out(1, 0.2)' });
                return;
            }
            WallAudio.play('tool');
            // (Told at each hat and every 10 levels, not each of a hundred.)
            const now = WallProgress.rankLevel(def.id);
            if (hatOf(now) > hatOf(now - 1) || now % 10 === 0) WallAnalytics.rank(def.id, now);
            this.build();
        });
        row.addChild(buy);
        return row;
    }

    public reposition(): void {
        const full = Game.overlayScreenData;
        const screen = Game.safeScreenData ?? full;
        if (!screen || !full || !this.isOpen) return;
        const { width, height, center } = screen;
        this.dim.clear().beginFill(0x070b1c, 0.78).drawRect(full.topLeft.x - 400, full.topLeft.y - 400, full.width + 800, full.height + 800).endFill();
        this.panel.position.set(center.x, center.y + 16);
        this.panel.scale.set(Math.min(1, (height - 70) / (this.height_ + 40), (width - 30) / PANEL.width));
    }
}
