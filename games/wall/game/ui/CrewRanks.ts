// CrewRanks.ts
//
// The crew's ranks, for good (through rewinds too), bought with gems (bosses drop them: WallConfig.gemsAt): each kind's
// next rank doubles its damage again (RANKS.mult) and puts a hat on all of that kind, hard hat, viking hat, crown
// (tools/build-hats.mjs). Its button sits under the relics' on the left, from the first boss on; marked when a rank's there
// to buy. Laid out as the relics' shop; its button, as theirs, under it on the left.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { Gameplay } from '../ads/Gameplay';
import { WallAnalytics } from '../analytics/WallAnalytics';
import { WallAudio } from '../audio/WallAudio';
import { CREW, CrewDef, MAX_RANK, RANKS, rankCost, short } from '../data/WallConfig';
import { WallProgress } from '../data/WallProgress';
import { frame, plainText, sprite, text, write } from './parts';
import { CARD_SLICE } from './Rarity';

/** Its button: as the relics' (the same size, frame and strip). */
const BUTTON = { size: 104, icon: 66, strip: 28 };
export const CREW_BUTTON = BUTTON.size;
const PANEL = { width: 640, top: 200 };
const ROW = { width: 590, height: 88, gap: 8, icon: 70, hat: 46, buy: { width: 150, height: 66 } };
const COLORS = { panel: 0x2f7a3a, inner: 0x3f9e4c, row: 0x1a3a20, locked: 0x2a2f33 };

/** A rank's hat's picture (1 hard hat, 2 viking, 3 crown). */
const hatIcon = (rank: number, size: number): PIXI.Sprite => sprite(`Wall_hat_${RANKS.hats[rank - 1]}`, size);

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
        const crown = hatIcon(MAX_RANK, BUTTON.icon * 0.55);
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
        const note = plainText('BOSSES DROP GEMS · RANKS ARE FOR GOOD', 19, 0xe8ffe8);
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

    /** A kind: itself in its hat, its name and what its rank does, and its next hat's price (or MAX, or the wall it comes at). */
    private row(def: CrewDef): PIXI.Container {
        const row = new PIXI.Container();
        const rank = WallProgress.rankOf(def.id);
        const there = WallProgress.best >= def.wall;
        const max = rank >= MAX_RANK;
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
        const what = plainText(!there ? '???' : rank ? `x${RANKS.mult[rank - 1]} DAMAGE` : 'NO RANK YET', 19, rank ? 0x7dffa2 : 0xb9c3cc);
        what.anchor.set(0, 0.5);
        what.position.set(-ROW.width / 2 + 104, 18);
        row.addChild(name, what);
        if (!there) return row;
        // The next hat, and its price.
        const buy = new PIXI.Container();
        buy.x = ROW.width / 2 - ROW.buy.width / 2 - 12;
        buy.addChild(frame(`ItemFrame02_Single_${max ? 'Green' : can ? 'Yellow' : 'Gray'}`, CARD_SLICE, ROW.buy.width, ROW.buy.height));
        if (max) {
            buy.addChild(text('MAX', 30, 0xffffff, 0x100e18, 7));
        } else {
            const next = hatIcon(rank + 1, 50);
            next.x = -44;
            const gem = sprite('Icon_Gem', 30);
            gem.x = -4;
            const cost = text(short(rankCost(def, rank)), 28, 0xffffff, 0x100e18, 7);
            cost.anchor.set(0, 0.5);
            cost.x = 14;
            buy.addChild(next, gem, cost);
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
            WallAnalytics.rank(def.id, WallProgress.rankOf(def.id));
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
