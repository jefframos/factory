// EconomyUI.ts
//
// Renders EconomyStorage's money balance (see games/pizza/game/data/
// EconomyStorage.ts) as a small panel pinned to a screen corner — a trimmed,
// single-row specialization of GlobalResourcesUI.ts's shape (icon on the
// left, amount right-aligned, "pop" animated via playGainFeedback() each
// time the balance grows). Fixed to CurrencyType.Money rather than a
// dynamic per-type row list like GlobalResourcesUI — the base currency
// panel always shows, even at 0, since it's the one thing every economy
// interaction (queue rewards today, a shop spend later) revolves around.
//
// Subscribes to EconomyStorage.onChange ONCE and repaints only when Money
// actually changes — no per-frame polling. Tracks the last-seen balance
// purely to compute the gained delta for playGainFeedback(), since onChange
// itself only reports WHICH currency changed.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import FrameComponent from './FrameComponent';
import { FrameName } from './FrameRegistry';
import { TextStyleRegistry } from './TextStyleRegistry';
import { EconomyStorage } from '../data/EconomyStorage';
import { CURRENCY_CONFIG, CurrencyType } from '../data/EconomyTypes';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import ViewUtils from 'core/utils/ViewUtils';

export interface EconomyUiConfig {
    /** Width of the row itself, NOT counting `padding` — panelWidth (see that field's own doc) adds padding on both sides on top of this. */
    contentWidth: number;
    rowHeight: number;
    /** Which FrameRegistry entry frames the whole panel — see FrameRegistry.ts. */
    frame: FrameName;
    title: string;
    /** Space between the panel's frame border and its contents (row + title). */
    padding: number;
}

const DEFAULT_CONFIG: EconomyUiConfig = {
    contentWidth: 110,
    rowHeight: 36,
    frame: 'Main',
    title: 'Wallet',
    padding: 12,
};

/** Vertical space reserved above the row for the title text. */
const TITLE_HEIGHT = 22;
/** Gap left between the icon's edge and the row's own height — see the constructor's ViewUtils.elementScaler() call. */
const ICON_PADDING = 4;

/** Icon jiggle on a gain — a quick punch-out-and-settle, not a full spin. Same shape as GlobalResourcesUI's own jiggle. */
const JIGGLE_PUNCH_SCALE = 1.3;
const JIGGLE_PUNCH_SEC = 0.12;
const JIGGLE_SETTLE_SEC = 0.15;

/** "+N" popup on a gain — rises and fades over this long, see playGainFeedback(). */
const GAIN_POPUP_RISE_PX = 16;
const GAIN_POPUP_DURATION_SEC = 0.6;

/** The one currency this panel shows — see this file's own doc for why it's fixed rather than a dynamic per-type row list. */
const DISPLAYED_CURRENCY = CurrencyType.Money;

export default class EconomyUI extends PIXI.Container {
    private readonly config: EconomyUiConfig;
    /** Last-seen balance — the only way to compute a gain's delta on onChange (see this file's own doc). */
    private lastBalance = 0;

    private frameComponent!: FrameComponent;
    private titleText!: PIXI.Text;
    private icon!: PIXI.Sprite;
    private iconBaseScale = 1;
    private amountLabel!: PIXI.Text;

    /** The panel's own footprint, in its local space (top-left at (0,0)) — see GlobalResourcesUI's identical field for why UIService reads these every frame to anchor by a corner other than top-left. */
    public panelWidth = 0;
    public panelHeight = 0;

    /**
     * Where the money icon itself actually renders, in THIS panel's PARENT's local space
     * (i.e. `game.overlayContainer`'s own coordinate system, since UIService adds this panel
     * as a direct child of that container with no extra scale/rotation) — used by
     * FlyingResourceIcon.spawnFlyingIconToOverlayPoint() so a queue's reward can fly to
     * exactly where the wallet icon sits on screen, tracking it live if this panel ever moves
     * (a resize UIService repositions it for) rather than a position snapshotted once.
     */
    public getIconAnchorPosition(target: PIXI.Point = new PIXI.Point()): PIXI.Point {
        return target.set(this.x + this.icon.x, this.y + this.icon.y);
    }

    public constructor(config: Partial<EconomyUiConfig> = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };

        const { frame, title, contentWidth, rowHeight } = this.config;

        this.frameComponent = new FrameComponent(frame, 0, 0);
        this.addChild(this.frameComponent);

        this.titleText = new PIXI.Text(title, TextStyleRegistry.Info);
        this.titleText.anchor.set(0.5, 0);
        this.addChild(this.titleText);

        this.icon = new PIXI.Sprite(getAssetIcon(CURRENCY_CONFIG[DISPLAYED_CURRENCY].assetKey));
        this.icon.anchor.set(0, 0.5);
        this.icon.position.set(0, rowHeight / 2);
        this.iconBaseScale = ViewUtils.elementScaler(this.icon, rowHeight - ICON_PADDING * 2);
        this.icon.scale.set(this.iconBaseScale);
        this.addChild(this.icon);

        this.amountLabel = new PIXI.Text('0', TextStyleRegistry.Body);
        this.amountLabel.anchor.set(1, 0.5);
        this.amountLabel.position.set(contentWidth, rowHeight / 2);
        this.addChild(this.amountLabel);

        this.layout();

        EconomyStorage.onChange.add(this.onEconomyChanged, this);
        // Seeds lastBalance from whatever's already saved (e.g. this panel building after a
        // reload with existing money) so that read doesn't itself pop as a "gain".
        this.lastBalance = EconomyStorage.getBalance(DISPLAYED_CURRENCY);
        this.amountLabel.text = this.lastBalance.toString();
    }

    private onEconomyChanged = (type: CurrencyType): void => {
        if (type !== DISPLAYED_CURRENCY) {
            return;
        }

        const balance = EconomyStorage.getBalance(DISPLAYED_CURRENCY);
        const gained = balance - this.lastBalance;
        this.lastBalance = balance;
        this.amountLabel.text = balance.toString();

        if (gained > 0) {
            this.playGainFeedback(gained);
        }
    };

    /** Recomputes the panel's footprint and resizes the frame + retitles to match — called once at construction; the row itself never grows/shrinks (fixed to one currency), so nothing else needs to re-layout after. */
    private layout(): void {
        const { contentWidth, padding } = this.config;

        this.panelWidth = contentWidth + padding * 2;
        this.panelHeight = this.config.rowHeight + padding * 2 + TITLE_HEIGHT;

        this.titleText.position.set(this.panelWidth / 2, padding * 0.5);
        this.icon.position.x = padding;
        this.amountLabel.position.x = padding + contentWidth;
        this.icon.position.y = padding + TITLE_HEIGHT + this.config.rowHeight / 2;
        this.amountLabel.position.y = this.icon.position.y;

        this.frameComponent.setSize(this.panelWidth, this.panelHeight);
    }

    /** Money just grew — icon punches out and settles, and a "+N" rises and fades above the amount. Purely decorative; EconomyStorage's balance (already applied by the time onChange fires) is the source of truth regardless. */
    private playGainFeedback(gained: number): void {
        gsap.killTweensOf(this.icon.scale);
        this.icon.scale.set(this.iconBaseScale);
        gsap.timeline()
            .to(this.icon.scale, { x: this.iconBaseScale * JIGGLE_PUNCH_SCALE, y: this.iconBaseScale * JIGGLE_PUNCH_SCALE, duration: JIGGLE_PUNCH_SEC, ease: 'back.out(2)' })
            .to(this.icon.scale, { x: this.iconBaseScale, y: this.iconBaseScale, duration: JIGGLE_SETTLE_SEC, ease: 'power1.out' });

        const popup = new PIXI.Text(`+${gained}`, TextStyleRegistry.ResourceDamage);
        popup.style.fill = '#33cc66';
        popup.anchor.set(1, 1);
        popup.position.set(this.amountLabel.position.x, this.amountLabel.position.y - this.config.rowHeight / 2);
        this.addChild(popup);

        const progress = { t: 0 };
        const baseY = popup.position.y;
        gsap.to(progress, {
            t: 1,
            duration: GAIN_POPUP_DURATION_SEC,
            ease: 'power2.out',
            onUpdate: () => {
                popup.position.y = baseY - progress.t * GAIN_POPUP_RISE_PX;
                popup.alpha = 1 - progress.t;
            },
            onComplete: () => popup.destroy(),
        });
    }

    public override destroy(options?: Parameters<PIXI.Container['destroy']>[0]): void {
        EconomyStorage.onChange.remove(this.onEconomyChanged, this);
        super.destroy(options);
    }
}
