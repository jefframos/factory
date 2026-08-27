// EconomyUI.ts
//
// Renders EconomyStorage's balances (see games/pizza/game/data/
// EconomyStorage.ts) as a row of pills pinned to a screen corner — one pill
// per currency listed in TopBarStyle.ts's TOP_BAR_STYLE.currencies (icon on
// the left, amount right-aligned, "pop" animated via playGainFeedback() each
// time a balance grows). No panel title/frame wraps the row — each currency
// gets its own small framed pill instead, so the topbar reads as a strip of
// stats rather than a titled "Wallet" panel. All sizing/spacing/frame choice
// lives in TopBarStyle.ts — this file only lays pills out and reacts to
// EconomyStorage.onChange.
//
// Subscribes to EconomyStorage.onChange ONCE and repaints only the pill whose
// currency actually changed — no per-frame polling. Tracks each pill's own
// last-seen balance purely to compute the gained delta for
// playGainFeedback(), since onChange itself only reports WHICH currency
// changed.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import FrameComponent from './FrameComponent';
import { TextStyleRegistry } from './TextStyleRegistry';
import { TOP_BAR_STYLE } from './TopBarStyle';
import { EconomyStorage } from '../data/EconomyStorage';
import { CURRENCY_CONFIG, CurrencyType } from '../data/EconomyTypes';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import ViewUtils from 'core/utils/ViewUtils';

/** Icon jiggle on a gain — a quick punch-out-and-settle, not a full spin. Same shape as GlobalResourcesUI's own jiggle. */
const JIGGLE_PUNCH_SCALE = 1.3;
const JIGGLE_PUNCH_SEC = 0.12;
const JIGGLE_SETTLE_SEC = 0.15;

/** "+N" popup on a gain — rises and fades over this long, see playGainFeedback(). */
const GAIN_POPUP_RISE_PX = 16;
const GAIN_POPUP_DURATION_SEC = 0.6;

interface Pill {
    readonly container: PIXI.Container;
    readonly frameComponent: FrameComponent;
    readonly icon: PIXI.Sprite;
    readonly iconBaseScale: number;
    readonly amountLabel: PIXI.Text;
    readonly currency: CurrencyType;
    lastBalance: number;
}

export default class EconomyUI extends PIXI.Container {
    private readonly pills: Pill[] = [];
    private readonly pillsByCurrency = new Map<CurrencyType, Pill>();

    /** The row's own footprint, in its local space (top-left at (0,0)) — see GlobalResourcesUI's identical fields for why UIService reads these every frame to anchor by a corner other than top-left. */
    public panelWidth = 0;
    public panelHeight = 0;

    public constructor() {
        super();

        for (const currency of TOP_BAR_STYLE.currencies) {
            this.pills.push(this.buildPill(currency));
        }

        this.layout();

        EconomyStorage.onChange.add(this.onEconomyChanged, this);
        // Seeds each pill's lastBalance from whatever's already saved (e.g. this row building
        // after a reload with existing currency) so that read doesn't itself pop as a "gain".
        for (const pill of this.pills) {
            pill.lastBalance = EconomyStorage.getBalance(pill.currency);
            pill.amountLabel.text = pill.lastBalance.toString();
        }
    }

    /**
     * Where a given currency's icon actually renders, in THIS row's PARENT's local space (i.e.
     * `game.overlayContainer`'s own coordinate system, since UIService adds this row as a
     * direct child of that container with no extra scale/rotation) — used by
     * FlyingResourceIcon.spawnFlyingIconToOverlayPoint() so a queue's reward can fly to exactly
     * where a currency's pill sits on screen, tracking it live if this row ever moves (a resize
     * UIService repositions it for) rather than a position snapshotted once. Falls back to this
     * row's own position if `currency` isn't shown on the topbar.
     */
    public getIconAnchorPosition(currency: CurrencyType, target: PIXI.Point = new PIXI.Point()): PIXI.Point {
        const pill = this.pillsByCurrency.get(currency);
        if (!pill) {
            return target.set(this.x, this.y);
        }
        return target.set(this.x + pill.container.x + pill.icon.x, this.y + pill.container.y + pill.icon.y);
    }

    private buildPill(currency: CurrencyType): Pill {
        const { pillContentWidth, pillHeight, pillFrame, iconPadding } = TOP_BAR_STYLE;

        const container = new PIXI.Container();
        this.addChild(container);

        const frameComponent = new FrameComponent(pillFrame, 0, 0);
        frameComponent.setSize(pillContentWidth + TOP_BAR_STYLE.pillPadding * 2, pillHeight);
        container.addChild(frameComponent);

        const icon = new PIXI.Sprite(getAssetIcon(CURRENCY_CONFIG[currency].assetKey));
        icon.anchor.set(0, 0.5);
        icon.position.set(TOP_BAR_STYLE.pillPadding, pillHeight / 2);
        const iconBaseScale = ViewUtils.elementScaler(icon, pillHeight - iconPadding * 2);
        icon.scale.set(iconBaseScale);
        container.addChild(icon);

        const amountLabel = new PIXI.Text('0', TextStyleRegistry.Body);
        amountLabel.anchor.set(1, 0.5);
        amountLabel.position.set(TOP_BAR_STYLE.pillPadding + pillContentWidth, pillHeight / 2);
        container.addChild(amountLabel);

        const pill: Pill = { container, frameComponent, icon, iconBaseScale, amountLabel, currency, lastBalance: 0 };
        this.pillsByCurrency.set(currency, pill);
        return pill;
    }

    private onEconomyChanged = (type: CurrencyType): void => {
        const pill = this.pillsByCurrency.get(type);
        if (!pill) {
            return;
        }

        const balance = EconomyStorage.getBalance(type);
        const gained = balance - pill.lastBalance;
        pill.lastBalance = balance;
        pill.amountLabel.text = balance.toString();

        if (gained > 0) {
            this.playGainFeedback(pill, gained);
        }
    };

    /** Lays pills out left to right with `pillGap` between them — called once at construction; the row never grows/shrinks (fixed currency list), so nothing else needs to re-layout after. */
    private layout(): void {
        const { pillContentWidth, pillHeight, pillGap, pillPadding } = TOP_BAR_STYLE;
        const pillWidth = pillContentWidth + pillPadding * 2;

        this.pills.forEach((pill, i) => {
            pill.container.position.set(i * (pillWidth + pillGap), 0);
        });

        this.panelWidth = this.pills.length > 0
            ? this.pills.length * pillWidth + (this.pills.length - 1) * pillGap
            : 0;
        this.panelHeight = pillHeight;
    }

    /** A currency just grew — icon punches out and settles, and a "+N" rises and fades above the amount. Purely decorative; EconomyStorage's balance (already applied by the time onChange fires) is the source of truth regardless. */
    private playGainFeedback(pill: Pill, gained: number): void {
        gsap.killTweensOf(pill.icon.scale);
        pill.icon.scale.set(pill.iconBaseScale);
        gsap.timeline()
            .to(pill.icon.scale, { x: pill.iconBaseScale * JIGGLE_PUNCH_SCALE, y: pill.iconBaseScale * JIGGLE_PUNCH_SCALE, duration: JIGGLE_PUNCH_SEC, ease: 'back.out(2)' })
            .to(pill.icon.scale, { x: pill.iconBaseScale, y: pill.iconBaseScale, duration: JIGGLE_SETTLE_SEC, ease: 'power1.out' });

        const popup = new PIXI.Text(`+${gained}`, TextStyleRegistry.ResourceDamage);
        popup.style.fill = '#33cc66';
        popup.anchor.set(1, 1);
        popup.position.set(pill.amountLabel.position.x, pill.amountLabel.position.y - TOP_BAR_STYLE.pillHeight / 2);
        pill.container.addChild(popup);

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
