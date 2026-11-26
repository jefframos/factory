// Relics.ts
//
// The relic shop: relics bought with medals (cashed in), for good (WallConfig.RELICS): all damage, the crew's damage and
// speed, hold to punch, cash, the power-ups' charge, a head start after a rewind. A medal spent gives no damage any more,
// so each relic is worth far more than the medals it costs. Each is one of the pack's grade badges. Its button sits under
// the rewind's from the first rewind on (the first medals cashed in), marked when there's one to buy.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { Gameplay } from '../ads/Gameplay';
import { WallAnalytics } from '../analytics/WallAnalytics';
import { WallAudio } from '../audio/WallAudio';
import { RELICS, REWIND, RelicDef, relicCost, relicText, short } from '../data/WallConfig';
import { WallProgress } from '../data/WallProgress';
import { frame, plainText, sprite, text, write } from './parts';
import { CARD_SLICE } from './Rarity';

const BUTTON = { size: 104, icon: 64, strip: 28 };
const PANEL = { width: 640, height: 960, top: 214 };
const ROW = { width: 590, height: 94, gap: 8, icon: 84, buy: { width: 132, height: 68 } };
const COLORS = { panel: 0x2b3f8f, inner: 0x4a6ef5, row: 0x1b2456 };

/** Relics are there: medals have been cashed in (a rewind). */
export const relicsKnown = (): boolean => WallProgress.rewinds > 0;

// ---------------------------------------------------------------- the button

export class RelicButton extends PIXI.Container {
    private readonly focus = frame('ItemFrame_FocusLine', [36, 35, 36, 35], BUTTON.size + 14, BUTTON.size + 14);
    private readonly alert = sprite('Icon_Exclamation', 34);
    private readonly count = text('', 26, 0xffffff, 0x100e18, 7);
    private readonly badge = sprite('Icon_GradeBadge_Master', BUTTON.icon);
    private readonly badgeScale = this.badge.scale.x;
    private readonly medal = sprite('ItemIcon_Badge_Gold', 26);
    private clock = 0;

    public constructor(open: () => void) {
        super();
        const back = frame('ItemFrame03_Single_Purple', [53, 53, 54, 56], BUTTON.size, BUTTON.size, 0.82);
        const glow = sprite('ItemFrame_BgGlow', BUTTON.size - 10);
        glow.tint = 0xd8a8ff;
        glow.alpha = 0.7;
        // The badge above, clear of the strip at the foot; on the strip, the medals there are (centred together).
        const stripY = BUTTON.size / 2 - 8 - BUTTON.strip / 2;
        this.badge.y = -BUTTON.strip / 2 + 2;
        const strip = frame('BasicFrame_Round12', [12, 12, 12, 12], BUTTON.size - 16, BUTTON.strip, 0.8);
        strip.tint = 0x100e18;
        strip.alpha = 0.6;
        strip.y += stripY;
        this.medal.y = stripY;
        this.count.anchor.set(0, 0.5);
        this.count.y = stripY - 1;
        this.alert.position.set(BUTTON.size / 2 - 10, -BUTTON.size / 2 + 10);
        this.addChild(this.focus, back, glow, this.badge, strip, this.medal, this.count, this.alert);
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            open();
        });
    }

    public update(delta: number): void {
        this.clock += delta;
        const can = WallProgress.relicToBuy;
        write(this.count, short(WallProgress.medals), BUTTON.size / 2 - 6);
        // (The medal and its number, centred on the strip as one.)
        const gap = 4;
        const width = this.medal.width + gap + this.count.width;
        this.medal.x = -width / 2 + this.medal.width / 2;
        this.count.x = this.medal.x + this.medal.width / 2 + gap;
        this.focus.visible = this.alert.visible = can;
        this.focus.alpha = 0.6 + 0.4 * Math.sin(this.clock * 5);
        this.badge.scale.set(this.badgeScale * (can ? 1 + 0.05 * Math.sin(this.clock * 6) : 1));
    }
}

// ---------------------------------------------------------------- the shop

export class RelicPanel extends PIXI.Container {
    public isOpen = false;
    private readonly dim = new PIXI.Graphics();
    private readonly panel = new PIXI.Container();
    private readonly medals = text('', 44, 0xffe14a, 0x100e18, 9);
    private rows = new PIXI.Container();

    public constructor(private readonly onToggle: (open: boolean) => void, private readonly bought: (def: RelicDef) => void) {
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
        const title = text('RELICS', 50, 0xffffff, 0x5c0f16, 9);
        title.y = -PANEL.height / 2 - 8;
        const close = sprite('Icon_Close02', 52);
        close.position.set(PANEL.width / 2 - 50, -PANEL.height / 2 + 52);
        close.eventMode = 'static';
        close.cursor = 'pointer';
        close.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        close.on('pointertap', () => this.setOpen(false));
        // The medals there are to spend, and what a kept one's worth.
        const purse = frame('ResourceBar_Single_Bg', [11, 11, 11, 11], 250, 64);
        purse.tint = 0x1c1d33;
        purse.position.set(-125, -PANEL.height / 2 + 74);
        const medal = sprite('ItemIcon_Badge_Gold', 82);
        medal.position.set(-118, -PANEL.height / 2 + 104);
        this.medals.anchor.set(0, 0.5);
        this.medals.position.set(-70, -PANEL.height / 2 + 104);
        const note = plainText(`A MEDAL KEPT: +${Math.round(REWIND.perMedal * 100)}% DAMAGE · A RELIC: MUCH MORE`, 19, 0xe2e8ff);
        note.y = -PANEL.height / 2 + 166;
        this.panel.addChild(back, inner, purse, medal, this.medals, note, this.rows, ribbon, title, close);
        this.addChild(this.dim, this.panel);
    }

    public setOpen(open: boolean): void {
        if (open === this.isOpen) return;
        this.isOpen = open;
        this.visible = open;
        Gameplay.setBlocked('relics', open);
        this.onToggle(open);
        WallAudio.play('claim', 0.5, open ? 0.8 : 0.9);
        if (!open) return;
        WallAnalytics.panel('relics');
        this.build();
        this.reposition();
        gsap.killTweensOf(this.panel.scale);
        const { x } = this.panel.scale;
        gsap.fromTo(this.panel.scale, { x: x * 0.6, y: x * 0.6 }, { x, y: x, duration: 0.35, ease: 'back.out(1.8)' });
    }

    private build(): void {
        write(this.medals, short(WallProgress.medals), 150);
        this.rows.destroy({ children: true });
        this.rows = new PIXI.Container();
        this.panel.addChildAt(this.rows, 6);
        RELICS.forEach((def, i) => {
            const row = this.row(def);
            row.y = -PANEL.height / 2 + PANEL.top + ROW.height / 2 + i * (ROW.height + ROW.gap);
            this.rows.addChild(row);
        });
    }

    /** A relic: its badge, name and level, what it does now and next, and its price (or MAX). */
    private row(def: RelicDef): PIXI.Container {
        const row = new PIXI.Container();
        const level = WallProgress.relicLevel(def.id);
        const max = def.max !== undefined && level >= def.max;
        const can = WallProgress.canBuyRelic(def);
        const back = frame('BasicFrame_Round12', [12, 12, 12, 12], ROW.width, ROW.height);
        back.tint = COLORS.row;
        back.alpha = 0.9;
        const icon = sprite(def.icon, ROW.icon);
        icon.x = -ROW.width / 2 + 50;
        if (!level) icon.alpha = 0.75;
        const name = text(def.name, 27, 0xffffff, 0x100e18, 6);
        name.anchor.set(0, 0.5);
        name.position.set(-ROW.width / 2 + 100, -20);
        const lv = text(level ? `LV${level}` : '', 21, 0xffe14a, 0x100e18, 5);
        lv.anchor.set(0, 0.5);
        lv.position.set(name.x + name.width + 10, -19);
        const what = plainText(def.what, 17, 0xb9c3ee);
        what.anchor.set(0, 0.5);
        what.position.set(-ROW.width / 2 + 100, 9);
        const effect = plainText(max ? relicText(def, level) : `${level ? relicText(def, level) : 'NONE'} ▸ ${relicText(def, level + 1)}`, 21, 0x7dffa2);
        effect.anchor.set(0, 0.5);
        effect.position.set(-ROW.width / 2 + 100, 32);
        row.addChild(back, icon, name, lv, what, effect);
        // Its price.
        const buy = new PIXI.Container();
        buy.x = ROW.width / 2 - ROW.buy.width / 2 - 12;
        buy.addChild(frame(`ItemFrame02_Single_${max ? 'Green' : can ? 'Yellow' : 'Gray'}`, CARD_SLICE, ROW.buy.width, ROW.buy.height));
        if (max) {
            buy.addChild(text('MAX', 30, 0xffffff, 0x100e18, 7));
        } else {
            const medal = sprite('ItemIcon_Badge_Gold', 40);
            medal.x = -32;
            const cost = text(short(relicCost(def, level)), 30, 0xffffff, 0x100e18, 7);
            cost.anchor.set(0, 0.5);
            cost.x = -10;
            buy.addChild(medal, cost);
        }
        buy.eventMode = 'static';
        buy.cursor = 'pointer';
        buy.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        buy.on('pointertap', () => {
            if (!WallProgress.buyRelic(def)) {
                WallAudio.play('error');
                gsap.fromTo(buy.pivot, { x: 8 }, { x: 0, duration: 0.35, ease: 'elastic.out(1, 0.2)' });
                return;
            }
            WallAudio.play('tool');
            WallAnalytics.relic(def.id, WallProgress.relicLevel(def.id));
            this.bought(def);
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
        this.panel.scale.set(Math.min(1, (height - 70) / (PANEL.height + 40), (width - 30) / PANEL.width));
    }
}
