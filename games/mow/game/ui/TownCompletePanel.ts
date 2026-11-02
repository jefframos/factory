// TownCompletePanel.ts
//
// The end of the town (every section restored): a panel over a dim — rays, a ribbon ("TOWN RESTORED!"), three stars,
// the town's name, how the run went (money earned, trophies and secret chests found) and that more towns are on the
// way — and a CONTINUE button that closes it (the town stays to wander, mow secrets and claim trophies in).
// Styles: the UI kit's "upgrades" panel and ribbon, the "achievements" button.

import * as PIXI from 'pixi.js';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { t } from '../i18n/Localization';

const WIDTH = 520;
const HEIGHT = 470;
/** Frame size, for the HUD to fit the panel on screen. */
export const TOWN_COMPLETE_SIZE = { width: WIDTH, height: HEIGHT };
const BUTTON = { width: 240, height: 64 };

/** How the run went, for the panel's lines. */
export interface TownCompleteStats {
    town: string;
    earned: number;
    trophies: { found: number; total: number };
    secrets: { found: number; total: number };
}

export class TownCompletePanel extends PIXI.Container {
    private readonly body = new PIXI.Container();

    /** `onContinue`: CONTINUE was tapped (the HUD closes it). */
    public constructor(private readonly onContinue: () => void) {
        super();
        this.visible = false;
        this.addChild(this.body);
    }

    /** Builds it for `stats` (call before showing it). */
    public show(stats: TownCompleteStats): void {
        UiAnim.kill(this.body);
        this.body.removeChildren().forEach((child) => child.destroy({ children: true }));
        const top = -HEIGHT / 2;
        UiAnim.rays(this.body, WIDTH * 0.75, 0xfff0a0, 0.55, 10);
        const frame = UiKit.image('upgrades', 'panel', WIDTH, HEIGHT);
        // Taps on the panel must not fall through to the movement joystick underneath.
        frame.eventMode = 'static';
        frame.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        const ribbon = UiKit.sprite('upgrades', 'ribbon', 0.62);
        ribbon.y = top;
        const title = UiKit.text('upgrades', 'title', {}, { fontSize: 40 });
        title.anchor.set(0.5);
        title.text = t('townCompleteTitle');
        UiKit.fit(title, 440);
        title.y = top - 5;
        const stars = [-1, 0, 1].map((side) => {
            const star = PIXI.Sprite.from('ItemIcon_Star_Gold');
            star.anchor.set(0.5);
            star.scale.set((side === 0 ? 92 : 70) / Math.max(star.texture.width, star.texture.height, 1));
            star.position.set(side * 120, top + (side === 0 ? 92 : 104));
            star.rotation = side * 0.25;
            return star;
        });
        const line = (text: string, y: number, size: number, fill = 0xffffff) => {
            const label = UiKit.text('hud', 'toast', { text }, { fontSize: size, strokeThickness: Math.round(size / 4.5), fill, align: 'center' });
            label.anchor.set(0.5);
            label.y = y;
            UiKit.fit(label, WIDTH - 60);
            return label;
        };
        const lines = [
            line(t('townCompleteBody', { town: stats.town }), top + 178, 26, 0xffe27a),
            line(t('townCompleteEarned', { amount: stats.earned.toLocaleString('en-US') }), top + 232, 22, 0x9cff9c),
            line(t('townCompleteTrophies', stats.trophies), top + 266, 22),
            line(t('townCompleteSecrets', stats.secrets), top + 300, 22),
            line(t('townCompleteMore'), top + 348, 20, 0x8fe3ff),
        ];
        const button = new PIXI.Container();
        button.addChild(UiKit.image('achievements', 'buttonClaim', BUTTON.width, BUTTON.height));
        const label = UiKit.text('achievements', 'buttonLabel', { text: t('townCompleteContinue') });
        UiKit.fit(label, BUTTON.width - 20);
        button.addChild(label);
        button.y = HEIGHT / 2 - 50;
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        button.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            this.onContinue();
        });
        UiAnim.pulse(button, 0.05, 0.6);
        this.body.addChild(frame, ribbon, title, ...stars, ...lines, button);
        UiAnim.staggerPop(stars, 0.25, 0.12);
        UiAnim.confetti(this.body, 0, top + 60, 90, 1.2);
    }
}
