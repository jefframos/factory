// UpgradeShow.ts
//
// A card's upgrade, as a moment of its own (Clash Royale's): the screen goes dark, the card in the middle at its old
// level flashes white, comes back at its new level in a burst of sparks, its name and copies bar over it, then each
// stat counts in under it with its gain in green. A tap (after it's played) closes it.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { MobAudio } from '../audio/MobAudio';
import { MobSave } from '../data/MobSave';
import { CardKind, CardStat, cardStat } from '../data/Settings';
import { CARD_NAMES } from './CardFace';
import { cardTile } from './CardTile';
import { STAT_ICONS, STAT_NAMES, shownStat } from './CardPopup';
import { Overlay } from './Overlay';
import { MOMENT_LOOK } from './Pattern';
import { iconSprite, label } from './UiParts';

const SIZE = { width: 620, height: 900 };

export class UpgradeShow extends Overlay {
    private readonly holder = new PIXI.Container();
    private readonly sparks: { sprite: PIXI.Sprite; vx: number; vy: number; life: number }[] = [];
    private ready = false;
    private readonly calls: gsap.core.Tween[] = [];

    /** `kind` just went from level `from` to the level it has now. */
    public constructor(private readonly kind: CardKind, private readonly from: number, onClose: () => void) {
        super(SIZE, onClose, 0.92, false);
        this.backdrop(MOMENT_LOOK);
        this.dim.on('pointertap', () => {
            if (this.ready) this.close();
        });
        this.panel.eventMode = 'none';
        const glow = iconSprite('Glow_Circle01', 520);
        glow.tint = 0x6dff8f;
        glow.alpha = 0.35;
        glow.y = -60;
        const rays = iconSprite('Image_Effect_Rotate', 560);
        rays.tint = 0x6dff8f;
        rays.alpha = 0.25;
        rays.blendMode = PIXI.BLEND_MODES.ADD;
        rays.y = -60;
        gsap.to(rays, { rotation: Math.PI * 2, duration: 10, ease: 'none', repeat: -1 });
        const name = label(52);
        name.text = CARD_NAMES[kind];
        name.y = -SIZE.height / 2 + 70;
        this.panel.addChild(glow, rays, name, this.holder);
        this.holder.y = -60;
        this.play();
    }

    private play(): void {
        const before = this.cardAt(this.from);
        this.holder.addChild(before);
        gsap.fromTo(this.holder.scale, { x: 0.6, y: 0.6 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2)' });
        // It shakes, flashes white, and comes back at its new level.
        this.calls.push(gsap.delayedCall(0.5, () => {
            gsap.to(this.holder, { rotation: 0.05, duration: 0.05, yoyo: true, repeat: 7, onComplete: () => { this.holder.rotation = 0; } });
        }));
        this.calls.push(gsap.delayedCall(0.95, () => {
            const flash = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(-87, -113, 174, 226, 14).endFill();
            this.holder.addChild(flash);
            flash.alpha = 0;
            gsap.to(flash, { alpha: 1, duration: 0.18, onComplete: () => {
                this.holder.removeChildren().forEach((child) => child.destroy({ children: true }));
                const after = this.cardAt(MobSave.cardLevel(this.kind));
                const white = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(-87, -113, 174, 226, 14).endFill();
                this.holder.addChild(after, white);
                gsap.to(white, { alpha: 0, duration: 0.35 });
                gsap.fromTo(this.holder.scale, { x: 1.25, y: 1.25 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(3)' });
                MobAudio.play('confirm', 1.2);
                this.burst();
                this.stats();
            } });
        }));
    }

    private cardAt(level: number): PIXI.Container {
        // The tile shows the save's level: for the one before, its words are swapped.
        const tile = cardTile(this.kind, 1.5);
        const levelText = tile.children.find((child) => child instanceof PIXI.Text && (child as PIXI.Text).text.startsWith('LV')) as PIXI.Text | undefined;
        if (levelText) levelText.text = `LV ${level}`;
        const word = label(30, 0x6dff8f);
        word.text = `LEVEL ${level}`;
        word.y = 160;
        tile.addChild(word);
        word.scale.set(1 / 1.5);
        return tile;
    }

    /** Each stat, one after another under the card: its new value and its gain. */
    private stats(): void {
        let y = 230;
        let delay = 0.3;
        for (const stat of ['hp', 'damage', 'seconds'] as CardStat[]) {
            const now = cardStat(this.kind, stat, MobSave.cardLevel(this.kind));
            const was = cardStat(this.kind, stat, this.from);
            if (now === undefined || was === undefined || (stat === 'hp' && now <= 0)) continue;
            const row = new PIXI.Container();
            const back = new PIXI.Graphics().beginFill(0x10123a, 0.7).drawRoundedRect(-220, -24, 440, 48, 14).endFill();
            const icon = iconSprite(STAT_ICONS[stat], 40);
            icon.x = -190;
            const name = label(22, 0x9fb4ff);
            name.anchor.set(0, 0.5);
            name.text = STAT_NAMES[stat];
            name.x = -160;
            const value = label(30);
            value.anchor.set(1, 0.5);
            value.text = shownStat(stat, now);
            value.x = 90;
            const gain = label(30, 0x6dff8f);
            gain.anchor.set(1, 0.5);
            const delta = Math.round((now - was) * 10) / 10;
            gain.text = now === was ? '' : stat === 'seconds' ? `${delta}s` : `+${delta}`;
            gain.x = 200;
            row.addChild(back, icon, name, value, gain);
            row.y = y;
            row.alpha = 0;
            this.panel.addChild(row);
            gsap.to(row, { alpha: 1, duration: 0.25, delay });
            gsap.fromTo(row.scale, { x: 0.6, y: 0.6 }, { x: 1, y: 1, duration: 0.3, delay, ease: 'back.out(3)' });
            this.calls.push(gsap.delayedCall(delay, () => MobAudio.play('click', 1.1)));
            y += 62;
            delay += 0.3;
        }
        const tap = label(24, 0xc9d3ff);
        tap.text = 'TAP TO CONTINUE';
        tap.y = SIZE.height / 2 - 40;
        tap.alpha = 0;
        this.panel.addChild(tap);
        gsap.to(tap, { alpha: 1, duration: 0.3, delay: delay + 0.2, onComplete: () => { this.ready = true; } });
    }

    private burst(): void {
        for (let i = 0; i < 46; i++) {
            const sprite = iconSprite('Glow_Circle01', 18 + Math.random() * 18);
            sprite.tint = Math.random() < 0.5 ? 0x6dff8f : 0xffffff;
            sprite.blendMode = PIXI.BLEND_MODES.ADD;
            sprite.y = -60;
            const angle = Math.random() * Math.PI * 2;
            const speed = 260 + Math.random() * 420;
            this.sparks.push({ sprite, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 120, life: 0.7 + Math.random() * 0.5 });
            this.panel.addChild(sprite);
        }
    }

    protected override animate(dt: number): void {
        for (const spark of this.sparks) {
            if (spark.life <= 0) continue;
            spark.life -= dt;
            spark.vy += 500 * dt;
            spark.sprite.x += spark.vx * dt;
            spark.sprite.y += spark.vy * dt;
            spark.sprite.alpha = Math.max(0, Math.min(1, spark.life * 2));
        }
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        this.calls.forEach((call) => call.kill());
        gsap.killTweensOf(this.holder);
        gsap.killTweensOf(this.holder.scale);
        this.panel.children.forEach((child) => {
            gsap.killTweensOf(child);
            gsap.killTweensOf(child.scale);
        });
        super.destroy(options);
    }
}
