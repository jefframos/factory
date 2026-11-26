// Settings.ts
//
// The settings, as the pack's (Preview/14_Settings): its button where the sound's was (top left), and a popup with the sound
// as an ON / OFF switch. In the phone app (where the platform has diagnostics) also RESET DATA (tapped twice: the save's
// erased and the game starts over) and a little console: what the ads have been doing (AdMob up, consent, loaded, failed
// with its code), to see on the phone itself whether they're working.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { Gameplay } from '../ads/Gameplay';
import { WallAudio } from '../audio/WallAudio';
import { WallProgress } from '../data/WallProgress';
import { frame, sprite, text, write } from './parts';

const PANEL = { width: 600, header: 96 };
const ROW = { height: 92, side: 50 };
const SWITCH = { width: 160, height: 66, handle: 92 };
const CONSOLE = { width: 520, height: 300, lines: 12, size: 15 };
const COLORS = { panel: 0x0f6fe0, inside: 0x0b45a8, header: 0x1b8cff, track: 0x2b2d4d, on: 0xf5d84a, consoleBack: 0x0a1030 };
/** How long RESET DATA waits for the second tap. */
const CONFIRM_SECONDS = 3;

// ---------------------------------------------------------------- the button

export class SettingsButton extends PIXI.Container {
    public constructor(size: number, open: () => void) {
        super();
        // (The gear on its own: no plate under it.)
        const gear = sprite('Icon_Setting', size * 0.9);
        this.addChild(gear);
        this.hitArea = new PIXI.Circle(0, 0, size / 2);
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            open();
        });
    }
}

// ---------------------------------------------------------------- an ON / OFF switch

class Switch extends PIXI.Container {
    private readonly fill = frame('Switch_Single_Fill', [16, 16, 16, 16], SWITCH.width / 2 + 10, SWITCH.height - 16);
    private readonly handle = new PIXI.Container();
    private readonly words = text('', 26, 0x1b2456, 0xffffff, 3);

    public constructor(private isOn: boolean, private readonly flip: (on: boolean) => void) {
        super();
        const track = frame('Switch_Single_Bg', [24, 24, 24, 24], SWITCH.width, SWITCH.height);
        track.tint = COLORS.track;
        this.fill.tint = COLORS.on;
        this.fill.x = -SWITCH.width / 2 + 8;
        const knob = frame('Switch_Single_Handle', [24, 23, 24, 26], SWITCH.handle, SWITCH.height - 6);
        this.handle.addChild(knob, this.words);
        this.addChild(track, this.fill, this.handle);
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.on('pointertap', () => {
            this.isOn = !this.isOn;
            this.flip(this.isOn);
            this.show(true);
        });
        this.show(false);
    }

    /** ON: the yellow fill, the handle right; OFF: the handle left. */
    private show(moving: boolean): void {
        this.fill.visible = this.isOn;
        write(this.words, this.isOn ? 'ON' : 'OFF');
        const x = (this.isOn ? 1 : -1) * (SWITCH.width / 2 - SWITCH.handle / 2 - 3);
        gsap.killTweensOf(this.handle);
        if (moving) gsap.to(this.handle, { x, duration: 0.18, ease: 'power2.out' });
        else this.handle.x = x;
    }
}

// ---------------------------------------------------------------- the popup

export class SettingsPanel extends PIXI.Container {
    public isOpen = false;
    private readonly dim = new PIXI.Graphics();
    private readonly panel = new PIXI.Container();
    private body = new PIXI.Container();
    private height_ = 400;
    private consoleText?: PIXI.Text;
    private shownLines = '';
    private resetWords?: PIXI.Text;
    private confirmFor = 0;

    public constructor(private readonly onToggle: (open: boolean) => void) {
        super();
        this.visible = false;
        this.dim.eventMode = 'static';
        this.dim.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.dim.on('pointertap', () => this.setOpen(false));
        this.addChild(this.dim, this.panel);
    }

    /** The phone app: it can say what the ads have been doing, and the data can be reset. */
    private get inApp(): boolean {
        return !!PlatformHandler.instance.platform?.diagnostics;
    }

    public setOpen(open: boolean): void {
        if (open === this.isOpen) return;
        this.isOpen = open;
        this.visible = open;
        Gameplay.setBlocked('settings', open);
        this.onToggle(open);
        WallAudio.play('claim', 0.5, open ? 0.8 : 0.9);
        this.confirmFor = 0;
        if (!open) return;
        this.build();
        this.reposition();
        gsap.killTweensOf(this.panel.scale);
        const { x } = this.panel.scale;
        gsap.fromTo(this.panel.scale, { x: x * 0.6, y: x * 0.6 }, { x, y: x, duration: 0.35, ease: 'back.out(1.8)' });
    }

    private build(): void {
        this.panel.removeChildren().forEach((child) => child.destroy({ children: true }));
        this.consoleText = undefined;
        this.resetWords = undefined;
        this.shownLines = '';
        const rows = 1 + (this.inApp ? 2 : 0);
        this.height_ = PANEL.header + 30 + rows * ROW.height + (this.inApp ? CONSOLE.height + 60 : 0) + 30;
        const top = -this.height_ / 2;
        const back = frame('CardFrame03_n_Bg', [30, 29, 30, 33], PANEL.width, this.height_);
        back.tint = COLORS.panel;
        back.eventMode = 'static';
        back.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        const inside = frame('CardFrame03_n_InnerBg', [18, 18, 18, 18], PANEL.width - 26, this.height_ - PANEL.header - 14);
        inside.tint = COLORS.inside;
        inside.y += PANEL.header / 2 - 2;
        // The header: the gear and SETTINGS.
        const gear = sprite('Icon_Setting', 58);
        const title = text('SETTINGS', 44, 0xffffff, 0x0a2a6a, 8);
        title.anchor.set(0, 0.5);
        const head = new PIXI.Container();
        head.addChild(gear, title);
        title.x = 40;
        head.position.set(-(title.width + 40) / 2 + 10, top + PANEL.header / 2 + 4);
        const close = sprite('Icon_Close02', 50);
        close.position.set(PANEL.width / 2 - 44, top + 44);
        close.eventMode = 'static';
        close.cursor = 'pointer';
        close.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        close.on('pointertap', () => this.setOpen(false));
        this.body = new PIXI.Container();
        this.panel.addChild(back, inside, head, this.body, close);
        let y = top + PANEL.header + 30 + ROW.height / 2;
        // The sound.
        this.row(y, WallAudio.muted ? 'PictoIcon_Sound_Off' : 'PictoIcon_Sound', 'SOUND', new Switch(!WallAudio.muted, (on) => {
            if (on === WallAudio.muted) WallAudio.toggleMuted();
        }));
        y += ROW.height;
        if (!this.inApp) return;
        // Real ads (AdMob) or the mock's: the mock's are quicker to test with.
        const platform = PlatformHandler.instance.platform!;
        this.row(y, 'ItemIcon_Video', 'ADMOB ADS', new Switch(!platform.adsMocked?.(), (on) => platform.setAdsMocked?.(!on)));
        y += ROW.height;
        // RESET DATA: tapped twice.
        const reset = new PIXI.Container();
        reset.addChild(frame('Button01_s_Red', [28, 31, 28, 60], 240, 70, 0.8));
        this.resetWords = text('RESET DATA', 26, 0xffffff, 0x5c0f16, 6);
        this.resetWords.y = -3;
        reset.addChild(this.resetWords);
        reset.eventMode = 'static';
        reset.cursor = 'pointer';
        reset.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        reset.on('pointertap', () => this.tapReset());
        this.row(y, 'Icon_Exclamation', 'START OVER', reset);
        y += ROW.height / 2 + 20;
        // The console: what the ads have been doing.
        const label = text('ADS', 22, 0x9fd4ff, 0x0a1030, 5);
        label.anchor.set(0, 0.5);
        label.position.set(-CONSOLE.width / 2, y + 6);
        const box = frame('BasicFrame_Round12', [12, 12, 12, 12], CONSOLE.width, CONSOLE.height);
        box.tint = COLORS.consoleBack;
        box.alpha = 0.9;
        box.y += y + 30 + CONSOLE.height / 2;
        this.consoleText = new PIXI.Text('', {
            fontFamily: 'Consolas, Menlo, monospace', fontSize: CONSOLE.size, fill: 0xbfe3ff, wordWrap: true, wordWrapWidth: CONSOLE.width - 24, breakWords: true, lineHeight: CONSOLE.size + 6,
        });
        this.consoleText.position.set(-CONSOLE.width / 2 + 12, y + 30 + 10);
        this.body.addChild(label, box, this.consoleText);
        this.updateConsole();
    }

    /** A row: its icon and words on the left, its control on the right. */
    private row(y: number, icon: string, words: string, control: PIXI.Container): void {
        const picture = sprite(icon, 46);
        picture.position.set(-PANEL.width / 2 + ROW.side + 10, y);
        const label = text(words, 32, 0xffffff, 0x0a2a6a, 7);
        label.anchor.set(0, 0.5);
        label.position.set(-PANEL.width / 2 + ROW.side + 48, y);
        control.position.set(PANEL.width / 2 - ROW.side - 80, y);
        this.body.addChild(picture, label, control);
    }

    private tapReset(): void {
        if (this.confirmFor > 0) {
            write(this.resetWords!, 'ERASING…');
            void WallProgress.wipe();
            return;
        }
        this.confirmFor = CONFIRM_SECONDS;
        write(this.resetWords!, 'TAP AGAIN', 200);
        WallAudio.play('error');
    }

    /** The last of the platform's lines, newest at the bottom. */
    private updateConsole(): void {
        if (!this.consoleText) return;
        const lines = PlatformHandler.instance.platform?.diagnostics?.() ?? [];
        const shown = lines.slice(-CONSOLE.lines).join('\n') || '(nothing yet)';
        if (shown === this.shownLines) return;
        this.shownLines = shown;
        this.consoleText.text = shown;
        // (What doesn't fit: the oldest go.)
        while (this.consoleText.height > CONSOLE.height - 20 && this.consoleText.text.includes('\n')) {
            this.consoleText.text = this.consoleText.text.slice(this.consoleText.text.indexOf('\n') + 1);
        }
    }

    public update(delta: number): void {
        if (!this.isOpen) return;
        this.updateConsole();
        if (this.confirmFor <= 0) return;
        this.confirmFor -= delta;
        if (this.confirmFor <= 0 && this.resetWords) write(this.resetWords, 'RESET DATA');
    }

    public reposition(): void {
        const full = Game.overlayScreenData;
        const screen = Game.safeScreenData ?? full;
        if (!screen || !full || !this.isOpen) return;
        const { width, height, center } = screen;
        this.dim.clear().beginFill(0x070b1c, 0.78).drawRect(full.topLeft.x - 400, full.topLeft.y - 400, full.width + 800, full.height + 800).endFill();
        this.panel.position.set(center.x, center.y);
        this.panel.scale.set(Math.min(1, (height - 60) / (this.height_ + 30), (width - 30) / PANEL.width));
    }
}
