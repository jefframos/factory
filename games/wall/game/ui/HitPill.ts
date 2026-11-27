// HitPill.ts
//
// Over PUNCH HARDER's card: what a hit does now, the tool in hand and the damage, everything counted (the combo too, while there's one). It jumps as it
// grows. Above it, the crew's: all the animals' damage a second as it stands (their boosts, the medals, a frenzy), once
// there's a crew; it changes only when that does (a hire, a boost), never with the hits. Either tapped, a bubble says where
// it comes from: the tool's own, the boosts, the medals, the crew's share, the combo, all the crew a second; the next tap,
// anywhere, closes it.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { gradedName, hitNumber, short, toolAt } from '../data/WallConfig';
import { WallProgress } from '../data/WallProgress';
import { toolArt } from './Wardrobe';
import { fit, frame, sprite, text, write } from './parts';

export const HIT_PILL = { width: 132, height: 46 };
const COLOR = { back: 0x1c1d33, plain: 0xffffff, combo: 0xffe14a };
const SAME_TAP_MS = 80;
const BUBBLE = { width: 250, row: 38, pad: 18, seconds: 4 };
/** The total's pill, over the hit's: its size, and the gap between them. */
const TOTAL = { width: 132, height: 38, gap: 6 };

export class HitPill extends PIXI.Container {
    private readonly icon = new PIXI.Container();
    private readonly value = text('', 30, COLOR.plain, 0x100e18, 7);
    private readonly bubble = new PIXI.Container();
    private readonly total = new PIXI.Container();
    private readonly totalValue = text('', 24, COLOR.plain, 0x100e18, 6);
    private tool = '';
    private shown = 0;
    private bubbleFor = 0;
    private closedAt = -Infinity;
    private combo = 1;

    public constructor() {
        super();
        const { width, height } = HIT_PILL;
        const back = frame('ResourceBar_Single_Bg', [11, 11, 11, 11], width, height);
        back.tint = COLOR.back;
        this.icon.position.set(-width / 2 + 16, -2);
        this.value.anchor.set(0, 0.5);
        this.value.position.set(-width / 2 + 46, -1);
        this.bubble.visible = false;
        this.bubble.eventMode = 'none';
        // The total, over it: all the damage a second.
        const totalBack = frame('ResourceBar_Single_Bg', [11, 11, 11, 11], TOTAL.width, TOTAL.height);
        totalBack.tint = COLOR.back;
        const totalIcon = sprite('Wall_chick', 34);
        totalIcon.position.set(-TOTAL.width / 2 + 18, -1);
        this.totalValue.anchor.set(0, 0.5);
        this.totalValue.position.set(-TOTAL.width / 2 + 40, -1);
        this.total.addChild(totalBack, totalIcon, this.totalValue);
        this.total.y = -height / 2 - TOTAL.gap - TOTAL.height / 2;
        this.total.visible = false;
        this.addChild(back, this.icon, this.value, this.total, this.bubble);
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.hitArea = new PIXI.Rectangle(-width / 2 - 14, -height / 2 - TOTAL.gap - TOTAL.height - 10, width + 24, height + TOTAL.gap + TOTAL.height + 20);
        // (Not a punch too.)
        this.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            // (Closed by this very tap, it stays closed.)
            if (performance.now() - this.closedAt > SAME_TAP_MS) this.showBubble();
        });
    }

    /** How far it reaches up from its middle: the hit's pill, and the crew's over it when that's there. */
    public get reachUp(): number {
        return HIT_PILL.height / 2 + (this.total.visible ? TOTAL.gap + TOTAL.height : 0);
    }

    /** `combo`: times the damage now (1: none). */
    public update(delta: number, combo: number): void {
        this.combo = combo;
        const crew = WallProgress.crewDps;
        this.total.visible = crew > 0;
        if (this.total.visible) {
            const label = `${short(crew)}/s`;
            if (label !== this.totalValue.text) write(this.totalValue, label, TOTAL.width - 50);
        }
        const { tool } = WallProgress;
        if (tool.id !== this.tool) {
            this.tool = tool.id;
            this.icon.removeChildren().forEach((child) => child.destroy({ children: true }));
            this.icon.addChild(toolArt(tool, 54));
        }
        const damage = WallProgress.damage * combo;
        const label = hitNumber(damage);
        if (label !== this.value.text) {
            write(this.value, label, HIT_PILL.width - 56);
            if (damage > this.shown) this.jump();
        }
        this.shown = damage;
        this.value.tint = combo > 1 ? COLOR.combo : COLOR.plain;
        if (!this.bubble.visible) return;
        this.bubbleFor -= delta;
        if (this.bubbleFor <= 0) this.hideBubble();
    }

    private jump(): void {
        gsap.killTweensOf(this.scale);
        this.scale.set(1.18);
        gsap.to(this.scale, { x: 1, y: 1, duration: 0.35, ease: 'back.out(3)' });
    }

    /** Any tap, anywhere. */
    private readonly onTap = (): void => {
        this.closedAt = performance.now();
        this.hideBubble();
    };

    private hideBubble(): void {
        this.bubble.visible = false;
        window.removeEventListener('pointerdown', this.onTap, true);
    }

    /** Where it comes from, row by row. */
    private showBubble(): void {
        const { tool, boosts, medals, relics, crew } = WallProgress.damageParts;
        const { frenzy } = WallProgress;
        const rows: [string, string, string][] = [['Wall_fists', (WallProgress.tool.id === toolAt(WallProgress.punchLevel).id ? gradedName(WallProgress.punchLevel) : WallProgress.tool.name).toUpperCase(), short(tool)]];
        if (boosts > 1) rows.push(['ItemIcon_Star_Gold', 'BOOSTS', `x${short(boosts)}`]);
        if (medals > 1) rows.push(['ItemIcon_Trophy_Gold', 'REWINDS', `x${short(medals)}`]);
        if (relics > 1) rows.push(['Icon_GradeBadge_Master', 'RELICS', `x${short(relics)}`]);
        if (frenzy > 1) rows.push(['ItemIcon_Energy_Blue', 'FRENZY', `x${short(frenzy)}`]);
        if (crew > 0) rows.push(['Wall_chick', 'CREW', `+${short(crew)}`]);
        if (this.combo > 1) rows.push(['ItemIcon_Energy_Blue', 'COMBO', `x${short(this.combo)}`]);
        if (WallProgress.crewDps > 0) {
            rows.push(['Wall_chick', 'ALL CREW', `${short(WallProgress.crewDps)}/s`]);
        }
        this.bubble.removeChildren().forEach((child) => child.destroy({ children: true }));
        const height = rows.length * BUBBLE.row + BUBBLE.pad * 2 + 38;
        const back = frame('CardFrame03_n_Bg', [30, 29, 30, 33], BUBBLE.width, height, 0.7);
        back.tint = 0x2b2d4d;
        this.bubble.addChild(back);
        const title = text('YOUR HIT', 24, 0xffe14a, 0x100e18, 6);
        title.y = -height / 2 + BUBBLE.pad + 10;
        this.bubble.addChild(title);
        rows.forEach(([icon, name, amount], i) => {
            const y = -height / 2 + BUBBLE.pad + 52 + i * BUBBLE.row;
            const art = i === 0 ? toolArt(WallProgress.tool, 34) : sprite(icon, 34);
            art.position.set(-BUBBLE.width / 2 + 34, y);
            const words = text(name, 20, 0xd9dcff, 0x100e18, 5);
            words.anchor.set(0, 0.5);
            words.position.set(-BUBBLE.width / 2 + 60, y);
            fit(words, 104);
            const number = text(amount, 24, 0xffffff, 0x100e18, 6);
            number.anchor.set(1, 0.5);
            number.position.set(BUBBLE.width / 2 - 20, y);
            this.bubble.addChild(art, words, number);
        });
        const above = this.total.visible ? TOTAL.gap + TOTAL.height : 0;
        this.bubble.position.set(-HIT_PILL.width / 2 + BUBBLE.width / 2 - 4, -HIT_PILL.height / 2 - above - height / 2 - 8);
        this.bubble.visible = true;
        // (Not the tap that's opening it.)
        window.setTimeout(() => !this.destroyed && this.bubble.visible && window.addEventListener('pointerdown', this.onTap, true));
        this.bubbleFor = BUBBLE.seconds;
        gsap.killTweensOf(this.bubble.scale);
        gsap.fromTo(this.bubble.scale, { x: 0.6, y: 0.6 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(2)' });
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        window.removeEventListener('pointerdown', this.onTap, true);
        super.destroy(options);
    }
}
